import { JobImportError, type JobImportErrorCode } from "@/lib/job-import-error";
import { JobsClientError } from "@/lib/jobs-client";
import { isJobStatus, validateJobInput } from "@/lib/jobs";
import type { ImportPreview, JobImportRequest, JobImportResult } from "@/types/job-import";
import type { JobInput } from "@/types/job";

function object(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
const importCodes = new Set<JobImportErrorCode>(["CSV_INVALID", "CSV_HEADERS", "CSV_LIMIT", "IMPORT_INVALID", "IMPORT_DUPLICATES", "IMPORT_PREVIEW_STALE", "IMPORT_KEY_CONFLICT", "IMPORT_MIGRATION_REQUIRED"]);
export class ImportClientError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(importCodes.has(code as JobImportErrorCode) ? new JobImportError(code as JobImportErrorCode).message : new JobsClientError(status).message);
  }
  get uncertain() { return this.status === 0 || this.status >= 500; }
}
function previewData(value: unknown): value is ImportPreview {
  return object(value) && typeof value.previewHash === "string" && /^[a-f0-9]{64}$/.test(value.previewHash)
    && Array.isArray(value.rows) && value.rows.length <= 500 && value.rows.every((row) => object(row) && Number.isSafeInteger(row.line)
      && Array.isArray(row.errors) && row.errors.every((error) => typeof error === "string")
      && Array.isArray(row.csvDuplicateLines) && row.csvDuplicateLines.every(Number.isSafeInteger)
      && Number.isSafeInteger(row.existingCount) && Number(row.existingCount) >= 0 && object(row.input)
      && ["company", "position", "location", "status", "appliedAt", "notes"].every((field) => typeof (row.input as Record<string, unknown>)[field] === "string")
      && (row.errors.length || (isJobStatus(row.input.status) && !Object.keys(validateJobInput(row.input as unknown as JobInput)).length)));
}
function resultData(value: unknown): value is JobImportResult {
  return object(value) && typeof value.batchId === "string" && typeof value.replayed === "boolean"
    && Array.isArray(value.jobIds) && value.jobIds.every((id) => typeof id === "string")
    && Array.isArray(value.rowNumbers) && value.rowNumbers.every(Number.isSafeInteger)
    && value.importedCount === value.jobIds.length && value.rowNumbers.length === value.jobIds.length;
}
export function createJobImportClient(fetcher: typeof fetch = fetch) {
  async function request(path: string, input: unknown) {
    let response: Response;
    try {
      response = await fetcher(`/api/me/jobs/import${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(30000) });
    } catch { throw new ImportClientError(0, "REQUEST_FAILED"); }
    let body: unknown;
    try { body = await response.json(); } catch { throw new ImportClientError(response.ok ? 0 : response.status, "INVALID_RESPONSE"); }
    if (!response.ok) throw new ImportClientError(response.status, object(body) && object(body.error) && typeof body.error.code === "string" ? body.error.code : "REQUEST_FAILED");
    return object(body) ? body.data : undefined;
  }
  return {
    async preview(csv: string): Promise<ImportPreview> {
      const result = await request("/preview", { csv });
      if (!previewData(result)) throw new ImportClientError(0, "INVALID_RESPONSE");
      return result;
    },
    async import(input: JobImportRequest): Promise<JobImportResult> {
      // 不接受/发送所有者或客户端数据库元数据。
      const result = await request("", { csv: input.csv, selectedRows: input.selectedRows, allowDuplicates: input.allowDuplicates, previewHash: input.previewHash, requestId: input.requestId });
      if (!resultData(result)) throw new ImportClientError(0, "INVALID_RESPONSE");
      return result;
    },
  };
}
export const jobImportClient = createJobImportClient();

/** 刷新后可复用未确认结果的批次；不存 CSV、密码或会话。 */
export async function importRequestKey(viewerId: string, input: Omit<JobImportRequest, "requestId" | "previewHash">): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([viewerId, input.csv, [...input.selectedRows].sort((a, b) => a - b)])));
  return `jobflow:csv-import:${Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, "0")).join("")}`;
}
export function pendingImportIdentity(key: string, allowDuplicates: boolean, storage?: Pick<Storage, "getItem" | "setItem">): { requestId: string; allowDuplicates: boolean } {
  try {
    const raw = storage?.getItem(key);
    const existing: unknown = raw ? JSON.parse(raw) : null;
    if (object(existing) && typeof existing.requestId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(existing.requestId) && typeof existing.allowDuplicates === "boolean") return { requestId: existing.requestId, allowDuplicates: existing.allowDuplicates };
  } catch { /* 浏览器禁止存储时，弹窗内仍保留同一个请求，错误提示说明刷新限制。 */ }
  const identity = { requestId: crypto.randomUUID(), allowDuplicates };
  try { storage?.setItem(key, JSON.stringify(identity)); } catch { /* 不存业务字段或认证数据。 */ }
  return identity;
}
