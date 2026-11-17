import assert from "node:assert/strict";
import { test } from "node:test";
import { AuthError } from "@/lib/auth-error";
import { jobApiErrorResponse, JobApiError } from "@/lib/job-api";
import { readImportBody, IMPORT_BODY_MAX_BYTES } from "@/lib/job-import-body";
import { JobImportError } from "@/lib/job-import-error";
import { createJobImportRepository } from "@/repositories/job-import-repository";
import { CSV_HEADER } from "@/lib/job-csv";

const noDatabase = () => { throw new Error("不允许连接数据库"); };
const userId = "11111111-1111-4111-8111-111111111111";
const csv = `${CSV_HEADER}\n公司,开发,上海,applied,2026-02-30,`;
const code = (value: string) => (error: unknown) => error instanceof JobImportError && error.code === value;
test("身份校验先于解析和查询；无身份或非法身份不能触及数据库", async () => {
  for (const resolve of [async () => { throw new AuthError("UNAUTHORIZED"); }, async () => "forged"]) {
    const repo = createJobImportRepository(noDatabase, resolve);
    await assert.rejects(() => repo.preview("bad"), (error: unknown) => error instanceof AuthError);
    await assert.rejects(() => repo.import({ userId }), (error: unknown) => error instanceof AuthError);
  }
});
test("不信任前端有效标志和字段，非法日期与不存在行号在访问数据库前拒绝", async () => {
  const repo = createJobImportRepository(noDatabase, async () => userId);
  const input = { csv, requestId: userId, previewHash: "a".repeat(64), allowDuplicates: false, selectedRows: [2], valid: true };
  await assert.rejects(() => repo.import(input), code("IMPORT_INVALID"));
  await assert.rejects(() => repo.import({ ...input, selectedRows: [99] }), code("IMPORT_INVALID"));
});
test("请求体按真实字节流累计上限，不依赖 Content-Length；超限会取消流", async () => {
  let cancelled = false;
  const request = new Request("http://localhost/import", { method: "POST", headers: { "content-type": "application/json" }, body: new ReadableStream({ start(controller) {
    controller.enqueue(new Uint8Array(IMPORT_BODY_MAX_BYTES)); controller.enqueue(new Uint8Array(1));
  }, cancel() { cancelled = true; } }), duplex: "half" } as RequestInit);
  await assert.rejects(() => readImportBody(request), code("CSV_LIMIT"));
  assert.equal(cancelled, true);
});
test("流式 UTF-8 解码跨字符边界正确，拒绝无效 UTF-8/JSON/Content-Type", async () => {
  const bytes = new TextEncoder().encode(JSON.stringify({ csv: "公司" }));
  const body = new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); } });
  const request = new Request("http://localhost/import", { method: "POST", headers: { "content-type": "application/json; charset=utf-8" }, body, duplex: "half" } as RequestInit);
  assert.deepEqual(await readImportBody(request), { csv: "公司" });
  for (const body of [new Uint8Array([0xff]), "{bad"]) {
    await assert.rejects(() => readImportBody(new Request("http://localhost", { method: "POST", headers: { "content-type": "application/json" }, body })), (error: unknown) => error instanceof JobApiError && error.code === "INVALID_JSON");
  }
  await assert.rejects(() => readImportBody(new Request("http://localhost", { method: "POST", body: "{}" })), (error: unknown) => error instanceof JobApiError && error.code === "INVALID_CONTENT_TYPE");
});
test("CSV 业务错误响应只有预设 JSON、状态码和 private/no-store，不暴露内部错误", async () => {
  for (const [code, status] of [["IMPORT_DUPLICATES", 409], ["IMPORT_MIGRATION_REQUIRED", 503], ["CSV_LIMIT", 413]] as const) {
    const response = jobApiErrorResponse(new JobImportError(code));
    assert.equal(response.status, status); assert.equal(response.headers.get("cache-control"), "private, no-store");
    const value: unknown = await response.json();
    assert.deepEqual(value, { error: { code, message: new JobImportError(code).message } });
  }
});
