import "server-only";
import { JobApiError } from "@/lib/job-api";
import { JobImportError } from "@/lib/job-import-error";

// 最坏情况下 CSV 字符的 JSON 转义也计入请求上限，不能只信任 Content-Length。
export const IMPORT_BODY_MAX_BYTES = 768 * 1024;
export async function readImportBody(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") throw new JobApiError("INVALID_CONTENT_TYPE");
  const length = Number(request.headers.get("content-length"));
  if (length > IMPORT_BODY_MAX_BYTES) throw new JobImportError("CSV_LIMIT");
  if (!request.body) throw new JobApiError("INVALID_JSON");
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > IMPORT_BODY_MAX_BYTES) { await reader.cancel(); throw new JobImportError("CSV_LIMIT"); }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new JobImportError("IMPORT_INVALID");
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof JobImportError) throw error;
    throw new JobApiError("INVALID_JSON");
  } finally { reader.releaseLock(); }
}
