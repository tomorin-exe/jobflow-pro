import { JobsClientError, jobsClient, type JobsClient } from "@/lib/jobs-client";
import type { JobInput, JobPatchInput } from "@/types/job";
import type { JobRecord } from "@/types/job-record";

export type RemoteMutationResult = { ok: true } | { ok: false; error: string; status: number };
export interface RemoteJobsSnapshot {
  jobs: readonly JobRecord[];
  phase: "loading" | "ready" | "error" | "unauthorized";
  refreshing: boolean;
  busy: boolean;
  problem: { message: string; status: number } | null;
}
const INITIAL: RemoteJobsSnapshot = { jobs: [], phase: "loading", refreshing: false, busy: false, problem: null };

/** 每个 Hook 独立实例，仅内存缓存；请求序号与取消信号共同阻止过期结果写回。 */
export function createRemoteJobsStore(api: JobsClient = jobsClient) {
  let snapshot = INITIAL;
  let active = false;
  let hasLoaded = false;
  let readVersion = 0;
  let writeVersion = 0;
  let reader: AbortController | undefined;
  const listeners = new Set<() => void>();
  function publish(change: Partial<RemoteJobsSnapshot>) {
    snapshot = { ...snapshot, ...change };
    for (const listener of listeners) listener();
  }
  function cancelRead() { readVersion++; reader?.abort(); reader = undefined; }
  function unauthorized(error: JobsClientError) {
    cancelRead();
    writeVersion++;
    hasLoaded = false;
    publish({ jobs: [], phase: "unauthorized", refreshing: false, busy: false, problem: { message: error.message, status: 401 } });
  }
  function safeError(error: unknown) { return error instanceof JobsClientError ? error : new JobsClientError(0); }

  async function refresh(): Promise<boolean> {
    if (!active || snapshot.busy || snapshot.phase === "unauthorized") return false;
    cancelRead();
    const version = readVersion;
    const controller = new AbortController();
    reader = controller;
    publish({ phase: hasLoaded ? "ready" : "loading", refreshing: true, problem: null });
    try {
      const jobs = await api.list(controller.signal);
      if (!active || version !== readVersion) return false;
      hasLoaded = true;
      publish({ jobs, phase: "ready", refreshing: false, problem: null });
      return true;
    } catch (failure) {
      if (!active || version !== readVersion || controller.signal.aborted) return false;
      const error = safeError(failure);
      if (error.status === 401) unauthorized(error);
      else publish({ phase: hasLoaded ? "ready" : "error", refreshing: false, problem: { message: error.message, status: error.status } });
      return false;
    }
  }

  async function mutate(operation: () => Promise<JobRecord>, apply: (jobs: readonly JobRecord[], job: JobRecord) => readonly JobRecord[]): Promise<RemoteMutationResult> {
    if (snapshot.phase === "unauthorized") return { ok: false, error: "登录已过期，请重新登录。", status: 401 };
    if (!active || snapshot.phase !== "ready" || snapshot.busy || snapshot.refreshing) return { ok: false, error: "请等待当前请求完成后重试。", status: 0 };
    cancelRead();
    const version = ++writeVersion;
    publish({ busy: true, problem: null });
    try {
      const job = await operation();
      if (!active || version !== writeVersion) return { ok: false, error: "页面已切换，请重新加载列表。", status: 0 };
      publish({ jobs: apply(snapshot.jobs, job), busy: false });
      return { ok: true };
    } catch (failure) {
      if (!active || version !== writeVersion) return { ok: false, error: "页面已切换，请重新加载列表。", status: 0 };
      const error = safeError(failure);
      if (error.status === 401) unauthorized(error);
      else {
        publish({ busy: false, ...(error.status === 400 ? {} : { problem: { message: error.message, status: error.status } }) });
        if (error.status === 404) await refresh();
      }
      return { ok: false, error: error.message, status: error.status };
    }
  }
  const upsert = (jobs: readonly JobRecord[], job: JobRecord) => [job, ...jobs.filter((current) => current.id !== job.id)];
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => snapshot,
    getServerSnapshot: () => INITIAL,
    start() { active = true; return refresh(); },
    stop() { active = false; cancelRead(); writeVersion++; snapshot = { ...snapshot, busy: false, refreshing: false }; },
    refresh,
    expire: () => unauthorized(new JobsClientError(401)),
    createJob: (input: JobInput) => mutate(() => api.create(input), upsert),
    updateJob: (id: string, input: JobPatchInput) => mutate(() => api.update(id, input), upsert),
    deleteJob: (id: string) => mutate(() => api.remove(id), (jobs, removed) => jobs.filter((job) => job.id !== removed.id)),
  };
}
