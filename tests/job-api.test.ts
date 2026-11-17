import assert from "node:assert/strict";
import { test } from "node:test";
import { AuthError } from "@/lib/auth-error";
import { DatabaseAccessError } from "@/lib/database-error";
import { JobApiError, assertJobWriteOrigin, jobApiErrorResponse, jobStatusParameter, readJobBody, withJobApi } from "@/lib/job-api";
import { toJobPatchWriteData } from "@/lib/job-mapper";
import type { JobPatchInput } from "@/types/job";

const origin = "http://localhost:3000";
const input = { company: "测试公司", position: "开发", location: "上海", status: "applied", appliedAt: "2026-11-17" };
function bodyRequest(body: unknown, type = "application/json") {
  return new Request(`${origin}/api/me/jobs`, { method: "POST", headers: { "content-type": type }, body: JSON.stringify(body) });
}

test("Origin 必须精确匹配配置，缺失/空来源/相似域名/跨站 Fetch Metadata 被拒绝", () => {
  assert.doesNotThrow(() => assertJobWriteOrigin(new Request(origin, { headers: { origin } }), origin));
  for (const supplied of [undefined, "", "null", "http://localhost:3001", "http://localhost:3000.evil.example", `${origin}/`]) {
    const headers = new Headers({ host: "localhost:3000", "x-forwarded-host": "localhost:3000" });
    if (supplied !== undefined) headers.set("origin", supplied);
    assert.throws(() => assertJobWriteOrigin(new Request(origin, { headers }), origin), (error: unknown) => error instanceof JobApiError && error.status === 403);
  }
  assert.throws(() => assertJobWriteOrigin(new Request(origin, { headers: { origin, "sec-fetch-site": "cross-site" } }), origin));
});

test("JSON 白名单屏蔽所有者及元数据，POST 缺省备注为空，PATCH 不补全未提供字段", async () => {
  const data = await readJobBody(bodyRequest({ ...input, userId: "spoof", id: "spoof", createdAt: "spoof", updatedAt: "spoof", unknown: "spoof" }), "create");
  assert.deepEqual(data, { ...input, notes: "" });
  assert.deepEqual(await readJobBody(bodyRequest({ status: "interviewing", userId: "spoof" }), "patch"), { status: "interviewing" });
  for (const value of [null, [], "value", {}, { ...input, company: null }, { ...input, status: "all" }, { userId: "spoof" }]) {
    await assert.rejects(() => readJobBody(bodyRequest(value), "create"), (error: unknown) => error instanceof JobApiError && error.status === 400);
  }
  await assert.rejects(() => readJobBody(bodyRequest({ userId: "spoof" }), "patch"));
  await assert.rejects(() => readJobBody(bodyRequest(input, "text/plain"), "create"));
  await assert.rejects(() => readJobBody(new Request(origin, { method: "POST", headers: { "content-type": "application/json" }, body: "{broken" }), "create"));
});

test("部分写入只保留指定业务字段，复用日期/长度/状态校验，不产生额外更新", () => {
  assert.deepEqual(toJobPatchWriteData({ status: "interviewing" }), { status: "interviewing" });
  assert.deepEqual(toJobPatchWriteData({ notes: "  " }), { notes: "" });
  assert.deepEqual(toJobPatchWriteData({ appliedAt: "2024-02-29" }), { appliedAt: new Date("2024-02-29T00:00:00.000Z") });
  assert.deepEqual(toJobPatchWriteData({ company: "  公司  ", userId: "spoof", id: "spoof" } as JobPatchInput), { company: "公司" });
  for (const value of [{}, { company: "  " }, { position: "x".repeat(101) }, { notes: "x".repeat(2001) }, { appliedAt: "2026-02-30" }, { status: "invalid" }, { company: undefined }, { userId: "spoof" }]) {
    assert.throws(() => toJobPatchWriteData(value as JobPatchInput), (error: unknown) => error instanceof DatabaseAccessError && error.code === "INVALID_INPUT");
  }
});

test("状态参数沿用模拟 API 规则，包括空值、all 与重复参数拒绝", () => {
  assert.equal(jobStatusParameter(new URLSearchParams()), undefined);
  for (const status of ["applied", "interviewing", "offered", "rejected"]) assert.equal(jobStatusParameter(new URLSearchParams({ status })), status);
  for (const query of ["status=", "status=all", "status=APPLIED", "status=unknown", "status=applied&status=applied", "status=applied&status=offered"]) {
    assert.throws(() => jobStatusParameter(new URLSearchParams(query)), (error: unknown) => error instanceof JobApiError && error.code === "INVALID_STATUS");
  }
});

test("HTTP 错误仅含安全 JSON，私有响应不可缓存，也不开放跨站 CORS", async () => {
  for (const [error, status] of [
    [new AuthError("UNAUTHORIZED"), 401], [new JobApiError("FORBIDDEN_ORIGIN"), 403],
    [new JobApiError("JOB_NOT_FOUND"), 404], [new DatabaseAccessError("INVALID_ID"), 400],
    [new DatabaseAccessError("DATABASE_UNAVAILABLE"), 503],
    [new Error("DATABASE_URL=postgresql://private:FAKE_SECRET@host/db"), 500],
  ] as const) {
    const response = jobApiErrorResponse(error);
    assert.equal(response.status, status);
    assert.match(response.headers.get("cache-control") ?? "", /private, no-store/);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
    const body = await response.text();
    assert.doesNotMatch(body, /FAKE_SECRET|DATABASE_URL|postgresql|stack/);
    assert.deepEqual(Object.keys(JSON.parse(body)), ["error"]);
  }
});

test("匿名写请求优先返回 401，不读取请求体、不执行回调或检查客户端指定用户", async () => {
  let called = false;
  const response = await withJobApi(new Request(origin, { method: "POST", body: "{broken", headers: { "x-user-id": "spoof" } }), async () => { called = true; throw new Error("不可调用"); });
  assert.equal(response.status, 401);
  assert.equal(called, false);
});
