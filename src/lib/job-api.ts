import "server-only";
import { NextResponse } from "next/server";
import { readAuthEnvironment } from "@/lib/auth-config";
import { AuthError } from "@/lib/auth-error";
import { DatabaseAccessError } from "@/lib/database-error";
import { JobImportError } from "@/lib/job-import-error";
import { isJobStatus } from "@/lib/jobs";
import { getPrisma } from "@/lib/prisma";
import { readSession } from "@/lib/session";
import { createJobRepository } from "@/repositories/job-repository";
import { JOB_STATUSES, type JobInput, type JobPatchInput, type JobStatus } from "@/types/job";
import type { JobApiErrorCode, JobApiErrorResponse } from "@/types/api";

type JobRepository = ReturnType<typeof createJobRepository>;
const cacheHeaders = { "Cache-Control": "private, no-store" };

const apiErrors = {
  FORBIDDEN_ORIGIN: { status: 403, message: "写入请求必须来自可信的应用来源。" },
  INVALID_STATUS: { status: 400, message: `status 参数只能出现一次，且必须是以下值之一：${JOB_STATUSES.join("、")}。` },
  INVALID_JSON: { status: 400, message: "请求体必须是有效的 JSON。" },
  INVALID_CONTENT_TYPE: { status: 400, message: "请求体必须使用 application/json。" },
  INVALID_INPUT: { status: 400, message: "岗位信息不完整或格式不正确。" },
  JOB_NOT_FOUND: { status: 404, message: "岗位不存在。" },
} as const;

export class JobApiError extends Error {
  constructor(readonly code: keyof typeof apiErrors) { super(apiErrors[code].message); }
  get status() { return apiErrors[this.code].status; }
}

export function jobJson<T>(body: T, status = 200, headers?: HeadersInit) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Cache-Control", cacheHeaders["Cache-Control"]);
  return NextResponse.json<T>(body, { status, headers: responseHeaders });
}

export function jobApiErrorResponse(error: unknown) {
  let code: JobApiErrorCode = "INTERNAL_ERROR";
  let message = "服务暂时不可用，请稍后重试。";
  let status = 500;
  if (error instanceof JobApiError || error instanceof AuthError || error instanceof JobImportError) {
    ({ code, message, status } = error);
  } else if (error instanceof DatabaseAccessError) {
    if (error.code === "INVALID_ID" || error.code === "INVALID_INPUT") {
      code = error.code;
      message = error.message; // 仅来自已有校验器的预设文案，不含用户值。
      status = 400;
    } else {
      code = "DATABASE_UNAVAILABLE";
      message = "数据库暂时不可用，请稍后重试。";
      status = 503;
    }
  }
  return jobJson<JobApiErrorResponse>({ error: { code, message } }, status);
}

/** 只信任配置的固定来源，不能从 Host / X-Forwarded-Host 推导可信来源。 */
export function assertJobWriteOrigin(request: Request, trustedOrigin: string): void {
  if (request.headers.get("origin") !== trustedOrigin || request.headers.get("sec-fetch-site") === "cross-site") {
    throw new JobApiError("FORBIDDEN_ORIGIN");
  }
}

/** 每次请求先验证真实 Session，再将可信身份绑定到请求范围内的 Repository。 */
export async function withJobApi(request: Request, work: (repository: JobRepository, userId: string) => Promise<Response>) {
  try {
    const session = await readSession(request.headers);
    if (!session?.user.id) throw new AuthError("UNAUTHORIZED");
    if (["POST", "PATCH", "DELETE"].includes(request.method)) {
      assertJobWriteOrigin(request, readAuthEnvironment().baseURL);
    }
    const userId = session.user.id;
    const repository = createJobRepository(getPrisma, async () => userId);
    return await work(repository, userId);
  } catch (error) {
    return jobApiErrorResponse(error);
  }
}

export function jobStatusParameter(params: URLSearchParams): JobStatus | undefined {
  const status = params.get("status");
  if (params.getAll("status").length > 1 || (status !== null && !isJobStatus(status))) throw new JobApiError("INVALID_STATUS");
  return status === null ? undefined : status as JobStatus;
}

export async function readJobBody(request: Request, mode: "create"): Promise<JobInput>;
export async function readJobBody(request: Request, mode: "patch"): Promise<JobPatchInput>;
export async function readJobBody(request: Request, mode: "create" | "patch"): Promise<JobPatchInput> {
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") throw new JobApiError("INVALID_CONTENT_TYPE");
  let body: unknown;
  try { body = await request.json(); } catch { throw new JobApiError("INVALID_JSON"); }
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw new JobApiError("INVALID_INPUT");
  const input: JobPatchInput = {};
  // 按显式白名单提取并验证类型。业务必填/长度/日期校验仍在 mapper 中复用。
  for (const field of ["company", "position", "location", "appliedAt", "notes"] as const) {
    if (Object.hasOwn(body, field)) {
      const value: unknown = Reflect.get(body, field);
      if (typeof value !== "string") throw new JobApiError("INVALID_INPUT");
      input[field] = value;
    } else if (mode === "create") {
      if (field === "notes") input.notes = "";
      else throw new JobApiError("INVALID_INPUT");
    }
  }
  if (Object.hasOwn(body, "status")) {
    const status: unknown = Reflect.get(body, "status");
    if (!isJobStatus(status)) throw new JobApiError("INVALID_INPUT");
    input.status = status;
  } else if (mode === "create") throw new JobApiError("INVALID_INPUT");
  if (!Object.keys(input).length) throw new JobApiError("INVALID_INPUT");
  return input;
}
