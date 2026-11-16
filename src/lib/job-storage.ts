import { addJob, isJob, removeJob, updateJob } from "@/lib/jobs";
import type { Job, JobInput, JobMutationResult } from "@/types/job";

export const JOB_STORAGE_KEY = "jobflow-pro.jobs.v1";

type StorageProblem = { kind: "corrupt" | "unavailable"; message: string };
interface JobsSnapshot {
  jobs: readonly Job[];
  phase: "loading" | "ready" | "error";
  problem: StorageProblem | null;
}

type StoredJobs = { kind: "missing" } | { kind: "loaded"; jobs: Job[] } | { kind: "corrupt" };
const SERVER_SNAPSHOT: JobsSnapshot = { jobs: [], phase: "loading", problem: null };

export function readStoredJobs(storage: Pick<Storage, "getItem">): StoredJobs {
  const raw = storage.getItem(JOB_STORAGE_KEY);
  // null 表示从未保存；"[]" 则表示用户已经主动删除了全部岗位。
  if (raw === null) return { kind: "missing" };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every(isJob)) return { kind: "corrupt" };
    if (new Set(parsed.map((job) => job.id)).size !== parsed.length) return { kind: "corrupt" };
    return { kind: "loaded", jobs: parsed };
  } catch {
    return { kind: "corrupt" };
  }
}

function writeStoredJobs(storage: Pick<Storage, "setItem">, jobs: readonly Job[]) {
  storage.setItem(JOB_STORAGE_KEY, JSON.stringify(jobs));
}

function newJobId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // getRandomValues 在不支持 randomUUID 的浏览器中仍可生成随机 ID。
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `job-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** 外部存储适配器：保存稳定快照，让 React 订阅变化，避免 SSR 访问 window。 */
export function createJobsStore(initialJobs: readonly Job[]) {
  let snapshot = SERVER_SNAPSHOT;
  let initialized = false;
  const listeners = new Set<() => void>();

  function publish(next: JobsSnapshot) {
    snapshot = next;
    listeners.forEach((listener) => listener());
  }

  function corrupt() {
    publish({
      jobs: snapshot.jobs,
      phase: "error",
      problem: { kind: "corrupt", message: "本地岗位数据格式异常，原始内容未被覆盖。请重试读取，或确认清空损坏数据后重新开始。" },
    });
  }

  function reload() {
    initialized = true;
    try {
      const storage = window.localStorage;
      const result = readStoredJobs(storage);
      if (result.kind === "corrupt") return corrupt();
      const jobs = result.kind === "loaded" ? result.jobs : initialJobs.map((job) => ({ ...job }));
      if (result.kind === "missing") writeStoredJobs(storage, jobs);
      publish({ jobs, phase: "ready", problem: null });
    } catch {
      publish({
        jobs: snapshot.jobs,
        phase: "error",
        problem: { kind: "unavailable", message: "无法读写浏览器存储。请检查浏览器权限或可用空间，然后重试读取。" },
      });
    }
  }

  function mutate(transform: (jobs: readonly Job[]) => Job[]): JobMutationResult {
    if (snapshot.phase !== "ready") return { ok: false, error: "本地数据尚未准备好，请先重新读取。" };
    try {
      const storage = window.localStorage;
      // 再读取一次，尽量避免覆盖其他标签页中已经完成的修改。
      const current = readStoredJobs(storage);
      if (current.kind === "corrupt") {
        corrupt();
        return { ok: false, error: "本地数据格式已变化，保存已取消，原始内容未被覆盖。" };
      }
      const next = transform(current.kind === "loaded" ? current.jobs : snapshot.jobs);
      // 先写入，成功后再发布给 React；写入失败不能向用户显示“已保存”。
      writeStoredJobs(storage, next);
      publish({ jobs: next, phase: "ready", problem: null });
      return { ok: true };
    } catch (error) {
      const message = error instanceof DOMException
        ? "无法保存到浏览器，请检查存储空间或浏览器权限后重试。当前记录未更改。"
        : error instanceof Error ? error.message : "保存失败，请重试。";
      return { ok: false, error: message };
    }
  }

  function resetCorruptData(): JobMutationResult {
    try {
      const storage = window.localStorage;
      if (readStoredJobs(storage).kind !== "corrupt") {
        reload();
        return { ok: false, error: "存储内容已变化，已重新读取，请关闭弹窗后确认。" };
      }
      writeStoredJobs(storage, []);
      publish({ jobs: [], phase: "ready", problem: null });
      return { ok: true };
    } catch {
      return { ok: false, error: "无法清空本地数据，请检查浏览器权限后重试。" };
    }
  }

  function onStorage(event: StorageEvent) {
    if (event.key === JOB_STORAGE_KEY || event.key === null) reload();
  }

  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => SERVER_SNAPSHOT,
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (listeners.size === 1) window.addEventListener("storage", onStorage);
      if (!initialized) reload();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) window.removeEventListener("storage", onStorage);
      };
    },
    create: (input: JobInput) => mutate((jobs) => addJob(jobs, input, newJobId())),
    update: (id: string, input: JobInput) => mutate((jobs) => updateJob(jobs, id, input)),
    remove: (id: string) => mutate((jobs) => removeJob(jobs, id)),
    reload,
    resetCorruptData,
  };
}
