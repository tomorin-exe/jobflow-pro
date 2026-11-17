import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import nextEnv from "@next/env";
import { CSV_HEADER, CSV_MAX_BYTES } from "@/lib/job-csv";
import { withDatabaseErrors } from "@/lib/database-error";
import { disconnectPrisma, getPrisma } from "@/lib/prisma";
import type { ImportPreview, JobImportRequest, JobImportResult } from "@/types/job-import";
import { assertTestDatabase } from "./helpers/test-database";

nextEnv.loadEnvConfig(process.cwd(), true, { info: () => {}, error: () => { throw new Error("配置加载失败。"); } });
const baseURL = new URL(process.env.API_BASE_URL ?? "http://localhost:3000");
if (!["localhost", "127.0.0.1", "[::1]"].includes(baseURL.hostname)) throw Error("测试只允许访问本地服务。");
const endpoint = "/api/me/jobs/import";
const marker = `CsvHTTP-${randomUUID()}`;
const actors: { email: string; cookie: string; password: string; id?: string; cleanupAllowed: boolean }[] = [];
type Actor = typeof actors[number];
let a: Actor; let b: Actor;
const ids = new Set<string>();
let databaseVerified = false;
const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const csv = (label: string, suffix = "") => `${CSV_HEADER}\n${marker}-${label},开发,上海,已投递,2024-02-29,${suffix}`;
async function local(path: string, init: RequestInit = {}) {
  try { return await fetch(new URL(path, baseURL), { signal: AbortSignal.timeout(30000), redirect: "manual", ...init }); }
  catch { throw new Error("本地导入测试服务不可用或超时，未输出底层错误。"); }
}
async function api(path: string, expected: number | number[], actor?: Actor, body?: unknown, options: { origin?: string | null; raw?: string; contentType?: string } = {}) {
  const headers = new Headers({ "content-type": options.contentType ?? "application/json" });
  if (actor) headers.set("cookie", actor.cookie);
  if (options.origin !== null) headers.set("origin", options.origin ?? baseURL.origin);
  const response = await local(path, { method: "POST", headers, body: options.raw ?? JSON.stringify(body) });
  assert.ok((Array.isArray(expected) ? expected : [expected]).includes(response.status), `导入 HTTP 状态码不符：${response.status}`);
  assert.match(response.headers.get("cache-control") ?? "", /private, no-store/);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  let result: unknown;
  try { result = await response.json(); } catch { throw Error("导入接口未返回 JSON。"); }
  const text = JSON.stringify(result);
  assert.ok(!/DATABASE_URL|BETTER_AUTH_SECRET|postgresql:\/\/|PrismaClient|\bstack\b|"(?:password|session|token|userId)"/i.test(text), "响应不得泄露内部数据");
  for (const user of actors) assert.ok(!text.includes(user.password), "不得泄露密码");
  assert.ok(object(result));
  return result;
}
function errorCode(result: Record<string, unknown>) { assert.ok(object(result.error)); return result.error.code; }
async function preview(actor: Actor, source: string): Promise<ImportPreview> {
  const result = await api(`${endpoint}/preview`, 200, actor, { csv: source });
  assert.ok(object(result.data) && Array.isArray(result.data.rows) && typeof result.data.previewHash === "string");
  return result.data as unknown as ImportPreview;
}
async function request(actor: Actor, source: string, selectedRows?: number[]): Promise<JobImportRequest> {
  const result = await preview(actor, source);
  return { csv: source, previewHash: result.previewHash, selectedRows: selectedRows ?? result.rows.filter((row) => !row.errors.length).map((row) => row.line), requestId: randomUUID(), allowDuplicates: false };
}
async function commit(actor: Actor, input: JobImportRequest, expected = 201): Promise<JobImportResult> {
  const result = await api(endpoint, expected, actor, input);
  assert.ok(object(result.data) && Array.isArray(result.data.jobIds) && result.data.importedCount === result.data.jobIds.length);
  for (const id of result.data.jobIds) { assert.equal(typeof id, "string"); ids.add(id); }
  return result.data as unknown as JobImportResult;
}
async function register(): Promise<Actor> {
  const actor: Actor = { email: `csv-http-${randomUUID()}@example.invalid`, password: `${randomUUID()}-${randomUUID()}`, cookie: "", cleanupAllowed: false };
  actors.push(actor);
  assert.equal(await withDatabaseErrors(() => getPrisma().user.count({ where: { email: actor.email } })), 0); actor.cleanupAllowed = true;
  const response = await local("/api/auth/sign-up/email", { method: "POST", headers: { origin: baseURL.origin, "content-type": "application/json" }, body: JSON.stringify({ name: "CSV HTTP 测试", email: actor.email, password: actor.password }) });
  assert.equal(response.status, 200);
  const result: unknown = await response.json();
  assert.ok(object(result) && object(result.user) && typeof result.user.id === "string"); actor.id = result.user.id;
  actor.cookie = response.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
  assert.ok(actor.cookie); return actor;
}

describe("CSV 导入真实 HTTP 集成", { concurrency: false }, () => {
  before(async () => {
    await assertTestDatabase();
    databaseVerified = true;
    const [schema] = await withDatabaseErrors(() => getPrisma().$queryRaw<{ ready: boolean }[]>`SELECT to_regclass('public.job_import_batches') IS NOT NULL AS ready`);
    assert.ok(schema?.ready, "请先审核并应用 CSV 导入迁移；不在未就绪结构中注册测试账号。");
    a = await register(); b = await register();
  });
  after(async () => {
    try {
      if (!databaseVerified) return;
      for (const actor of actors.filter((actor) => actor.cleanupAllowed)) await withDatabaseErrors(() => getPrisma().$transaction(async (tx) => {
        const user = await tx.user.findUnique({ where: { email: actor.email } });
        if (!user) return;
        if (actor.id) assert.equal(actor.id, user.id);
        const recovered = await tx.job.findMany({ where: { userId: user.id, company: { startsWith: marker } }, select: { id: true } });
        recovered.forEach((row) => ids.add(row.id));
        for (const id of ids) await tx.job.deleteMany({ where: { id, userId: user.id } });
        assert.equal(await tx.job.count({ where: { userId: user.id } }), 0, "存在未知岗位时不删除测试用户");
        await tx.user.delete({ where: { id: user.id, email: actor.email } });
        assert.equal(await tx.jobImportBatch.count({ where: { userId: user.id } }), 0);
        assert.equal(await tx.session.count({ where: { userId: user.id } }), 0);
      }));
    } finally { await disconnectPrisma(); }
  });
  test("两个接口均先验证真实 Session，未登录/伪造 Cookie 返回 401", async () => {
    for (const path of [endpoint, `${endpoint}/preview`]) {
      assert.equal(errorCode(await api(path, 401, undefined, undefined, { origin: null })), "UNAUTHORIZED");
      assert.equal(errorCode(await api(path, 401, { ...a, cookie: "better-auth.session_token=forged" }, { csv: csv("forged"), userId: a.id })), "UNAUTHORIZED");
    }
  });
  test("Cookie 写入严格要求同源，缺失/跨站 Origin 返回 403", async () => {
    for (const path of [endpoint, `${endpoint}/preview`]) for (const origin of [null, "null", "https://evil.example"]) {
      assert.equal(errorCode(await api(path, 403, a, { csv: csv("csrf") }, { origin })), "FORBIDDEN_ORIGIN");
    }
  });
  test("BOM、多行/逗号/转义引号正确预览，实际行号与逐行错误明确", async () => {
    const source = `\uFEFF${CSV_HEADER}\r\n"${marker},引用",开发,上海,已投递,2024-02-29,"第一行\r\n第二行""引号"""\r\n,开发,上海,invalid,2026-02-30,`;
    const result = await preview(a, source);
    assert.deepEqual(result.rows.map((row) => row.line), [2, 4]);
    assert.equal(result.rows[0].input.company, `${marker},引用`);
    assert.ok(!result.rows[0].errors.length && result.rows[1].errors.length >= 3);
  });
  test("A 批量导入选中子集；伪造 userId/前端校验不能覆盖所有者", async () => {
    const source = `${csv("own")}\n${marker}-unselected,后端,北京,offered,2026-11-17,`;
    const input = await request(a, source, [2]);
    const response = await api(endpoint, 201, a, { ...input, userId: b.id, id: randomUUID(), valid: true });
    assert.ok(object(response.data) && Array.isArray(response.data.jobIds));
    const jobId = String(response.data.jobIds[0]); ids.add(jobId);
    const job = await withDatabaseErrors(() => getPrisma().job.findUnique({ where: { id: jobId } }));
    assert.equal(job?.userId, a.id); assert.equal(job?.company, `${marker}-own`);
    assert.equal((await preview(b, csv("own"))).rows[0].existingCount, 0);
    assert.equal((await preview(a, csv("own"))).rows[0].existingCount, 1);
  });
  test("B 的相同岗位可独立导入，同一用户数据库重复必须明确确认", async () => {
    const input = await request(a, csv("own"));
    assert.equal(errorCode(await api(endpoint, 409, a, input)), "IMPORT_DUPLICATES");
    await commit(a, { ...input, allowDuplicates: true });
    await commit(b, await request(b, csv("own")));
    assert.equal((await preview(a, csv("own"))).rows[0].existingCount, 2);
    assert.equal((await preview(b, csv("own"))).rows[0].existingCount, 1);
  });
  test("CSV 内部重复全选需确认，选一行可正常导入", async () => {
    const source = `${csv("internal")}\n${marker}-internal,开发,上海,offered,2026-11-17,另一次`;
    const input = await request(a, source);
    assert.equal(errorCode(await api(endpoint, 409, a, input)), "IMPORT_DUPLICATES");
    await commit(a, { ...input, selectedRows: [2] });
  });
  test("非法行/不存在或重复行号/空选择/非法 key 和类型被服务端拒绝", async () => {
    const source = `${csv("invalid")}\n${marker}-bad,开发,上海,applied,2026-02-30,`;
    const input = await request(a, source, [2]);
    for (const patch of [{ selectedRows: [3] }, { selectedRows: [2, 99] }, { selectedRows: [] }, { selectedRows: [2, 2] }, { requestId: "bad" }, { previewHash: "forged" }, { allowDuplicates: "true" }]) {
      assert.equal(errorCode(await api(endpoint, 400, a, { ...input, ...patch, valid: true })), "IMPORT_INVALID");
    }
    assert.equal(await withDatabaseErrors(() => getPrisma().job.count({ where: { userId: a.id, company: `${marker}-invalid` } })), 0);
  });
  test("预览失效拒绝新批次，重新预览并确认后可继续", async () => {
    const input = await request(a, csv("stale")); await commit(a, input);
    assert.equal(errorCode(await api(endpoint, 409, a, { ...input, requestId: randomUUID(), allowDuplicates: true })), "IMPORT_PREVIEW_STALE");
    await commit(a, { ...await request(a, input.csv), allowDuplicates: true });
  });
  test("丢失响应重试和并发同批请求返回相同结果，改变内容会冲突", async () => {
    const input = await request(a, csv("retry"));
    // 调度不保证哪个 Promise 先获得行锁，但必须恰好一次首次写入、一次回放。
    const response = await Promise.all([api(endpoint, [200, 201], a, input), api(endpoint, [200, 201], a, input)]);
    assert.ok(object(response[0].data) && object(response[1].data));
    assert.deepEqual(response[0].data.jobIds, response[1].data.jobIds);
    assert.deepEqual([response[0].data.replayed, response[1].data.replayed].sort(), [false, true]);
    const replay = await commit(a, input, 200); assert.equal(replay.replayed, true);
    assert.equal((await preview(a, input.csv)).rows[0].existingCount, 1);
    assert.equal(errorCode(await api(endpoint, 409, a, { ...input, allowDuplicates: true })), "IMPORT_KEY_CONFLICT");
  });
  test("错误 Content-Type/JSON/编码/表头/超大请求安全拒绝", async () => {
    assert.equal(errorCode(await api(`${endpoint}/preview`, 400, a, { csv: csv("bad") }, { contentType: "text/plain" })), "INVALID_CONTENT_TYPE");
    await api(`${endpoint}/preview`, 400, a, undefined, { raw: "{broken" });
    for (const source of ["bad,header", `${csv("binary")}\u0000`, `${CSV_HEADER}\n"unclosed`]) await api(`${endpoint}/preview`, 400, a, { csv: source });
    assert.equal(errorCode(await api(`${endpoint}/preview`, 413, a, { csv: "x".repeat(CSV_MAX_BYTES + 1) })), "CSV_LIMIT");
    await api(`${endpoint}/preview`, 413, a, { csv: "x".repeat(800 * 1024) });
    await api(`${endpoint}/preview`, 413, a, { csv: `${CSV_HEADER}\n${Array(501).fill(`${marker},开发,上海,applied,2026-11-17,`).join("\n")}` });
  });
  test("退出后旧 Cookie 不可预览或重放导入", async () => {
    const input = await request(a, csv("logged-out"));
    const response = await local("/api/auth/sign-out", { method: "POST", headers: { origin: baseURL.origin, cookie: a.cookie, "content-type": "application/json" }, body: "{}" });
    assert.equal(response.status, 200);
    for (const path of [endpoint, `${endpoint}/preview`]) assert.equal(errorCode(await api(path, 401, a, input)), "UNAUTHORIZED");
  });
});
