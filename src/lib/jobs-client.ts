import { isJob } from "@/lib/jobs";
import type { JobInput, JobPatchInput } from "@/types/job";
import type { JobRecord } from "@/types/job-record";

export class JobsClientError extends Error {
  constructor(readonly status: number, readonly code = "REQUEST_FAILED") {
    super(status === 401 ? "登录已过期，请重新登录。"
      : status === 400 ? code === "INVALID_ID" ? "岗位编号无效，请刷新列表后重试。" : "岗位信息不完整或格式不正确，请检查必填项、状态和投递日期。"
      : status === 403 ? "请求来源或权限校验未通过，请确认使用正确的应用地址。"
      : status === 404 ? "该岗位已不存在，请刷新列表后重试。"
      : status >= 500 ? "服务暂时不可用，请稍后重试。"
      : code === "INVALID_RESPONSE" ? "服务返回的数据格式异常，请刷新重试。"
      : "网络请求失败，请检查连接；保存结果不确定时，请先刷新列表确认。");
    this.name = "JobsClientError";
  }
}

export function isJobRecord(value: unknown): value is JobRecord {
  return isJob(value) && "createdAt" in value && typeof value.createdAt === "string"
    && Number.isFinite(Date.parse(value.createdAt)) && "updatedAt" in value && typeof value.updatedAt === "string"
    && Number.isFinite(Date.parse(value.updatedAt));
}
function object(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function writeBody(input: JobPatchInput) {
  const body: JobPatchInput = {};
  for (const field of ["company", "position", "location", "status", "appliedAt", "notes"] as const) {
    if (Object.hasOwn(input, field)) Object.assign(body, { [field]: input[field] });
  }
  return JSON.stringify(body);
}

/** 仅同源 HTTP：不读取 Token，不导入任何服务端认证或数据库模块。 */
export function createJobsClient(fetcher: typeof fetch = fetch) {
  async function request(path: string, init: RequestInit = {}): Promise<unknown> {
    let response: Response;
    try { response = await fetcher(path, { ...init, credentials: "same-origin", cache: "no-store" }); }
    catch (error) {
      if (init.signal?.aborted) throw error;
      throw new JobsClientError(0);
    }
    if (!response.ok) {
      let code = "REQUEST_FAILED";
      try {
        const body: unknown = await response.json();
        if (object(body) && object(body.error) && body.error.code === "INVALID_ID") code = "INVALID_ID";
      } catch { /* 非 JSON 错误仍使用状态码和预设文案，不回显原文。 */ }
      throw new JobsClientError(response.status, code);
    }
    try { return await response.json(); } catch { throw new JobsClientError(0, "INVALID_RESPONSE"); }
  }
  async function record(path: string, method: string, input?: JobPatchInput) {
    const body = await request(path, { method, ...(input ? { headers: { "Content-Type": "application/json" }, body: writeBody(input) } : {}) });
    if (!object(body) || !isJobRecord(body.data)) throw new JobsClientError(0, "INVALID_RESPONSE");
    return body.data;
  }
  return {
    async list(signal?: AbortSignal): Promise<JobRecord[]> {
      const body = await request("/api/me/jobs", { signal });
      if (!object(body) || !Array.isArray(body.data) || !body.data.every(isJobRecord)
        || body.total !== body.data.length || new Set(body.data.map((job) => job.id)).size !== body.data.length) {
        throw new JobsClientError(0, "INVALID_RESPONSE");
      }
      return body.data;
    },
    create: (input: JobInput) => record("/api/me/jobs", "POST", input),
    update: (id: string, input: JobPatchInput) => record(`/api/me/jobs/${encodeURIComponent(id)}`, "PATCH", input),
    remove: (id: string) => record(`/api/me/jobs/${encodeURIComponent(id)}`, "DELETE"),
  };
}
export type JobsClient = ReturnType<typeof createJobsClient>;
export const jobsClient = createJobsClient();
