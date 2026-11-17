import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import nextEnv from "@next/env";
import { withDatabaseErrors } from "@/lib/database-error";
import { isJob } from "@/lib/jobs";
import { disconnectPrisma, getPrisma } from "@/lib/prisma";
import type { JobRecord } from "@/types/job-record";
import { assertTestDatabase } from "./helpers/test-database";

nextEnv.loadEnvConfig(process.cwd(), true, { info: () => {}, error: () => { throw new Error("无法加载本地测试配置。"); } });
const baseURL = new URL(process.env.API_BASE_URL ?? "http://localhost:3000");
if (!["localhost", "127.0.0.1", "[::1]"].includes(baseURL.hostname)) throw new Error("岗位集成测试只允许访问本地测试服务。");
const prefix = `MeJobs-${randomUUID()}`;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const collection = "/api/me/jobs";
const missingId = randomUUID();
const testIds = new Set<string>();
let databaseVerified = false;
type Actor = { email: string; password: string; cookie: string; id?: string; cleanupAllowed: boolean };
const actors: Actor[] = [];
let a: Actor;
let b: Actor;
let aJob: JobRecord;
let bJob: JobRecord;

function object(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
async function json(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { throw new Error("接口未返回预期 JSON，未输出响应原文。"); }
}
async function fetchLocal(path: string, options: RequestInit = {}) {
  try { return await fetch(new URL(path, baseURL), { redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(10000), ...options }); }
  catch { throw new Error("本地岗位测试服务不可用，请检查服务器和 API_BASE_URL。"); }
}
function assertSafe(body: unknown) {
  const serialized = JSON.stringify(body);
  assert.ok(!/DATABASE_URL|BETTER_AUTH_SECRET|postgresql:\/\/|PrismaClient|\bstack\b|"(?:password|session|token|accessToken|refreshToken|userId)"/i.test(serialized), "岗位响应不能携带认证、所有者或数据库内部数据");
  for (const actor of actors) assert.ok(!serialized.includes(actor.password), "不得返回测试密码");
}
type Options = { method?: string; actor?: Actor; cookie?: string; body?: unknown; raw?: string; contentType?: string; origin?: string | null; headers?: Record<string, string> };
async function api(path: string, expected: number, options: Options = {}) {
  const method = options.method ?? "GET";
  const headers = new Headers(options.headers);
  const cookie = options.cookie ?? options.actor?.cookie;
  if (cookie) headers.set("cookie", cookie);
  if (["POST", "PATCH", "DELETE"].includes(method) && options.origin !== null) headers.set("origin", options.origin ?? baseURL.origin);
  const body = options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
  if (body !== undefined) headers.set("content-type", options.contentType ?? "application/json");
  const response = await fetchLocal(path, { method, headers, body });
  assert.equal(response.status, expected, `${method} 岗位接口状态码不正确`);
  assert.match(response.headers.get("content-type") ?? "", /^application\/json\b/i);
  assert.match(response.headers.get("cache-control") ?? "", /private, no-store/);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  const result = await json(response);
  assertSafe(result);
  return { response, body: result };
}
function data(body: unknown): JobRecord {
  assert.ok(object(body) && isJob(body.data), "响应必须包含有效岗位 data");
  const record = body.data;
  assert.ok("createdAt" in record && typeof record.createdAt === "string" && "updatedAt" in record && typeof record.updatedAt === "string");
  assert.ok(uuid.test(record.id), "数据库岗位主键必须是 UUID");
  assert.deepEqual(Object.keys(record).sort(), ["id", "company", "position", "location", "status", "appliedAt", "notes", "createdAt", "updatedAt"].sort());
  if (record.company.startsWith(prefix)) testIds.add(record.id);
  return record as JobRecord;
}
function list(body: unknown) {
  assert.ok(object(body) && Array.isArray(body.data));
  assert.equal(body.total, body.data.length);
  return body.data.map((value) => data({ data: value }));
}
function errorCode(body: unknown) {
  assert.ok(object(body) && object(body.error) && typeof body.error.code === "string" && typeof body.error.message === "string");
  assert.deepEqual(Object.keys(body), ["error"]);
  return body.error.code;
}
function input(label = "A") {
  return { company: `${prefix}-${label}`, position: "接口测试岗位", location: "上海", status: "applied", appliedAt: "2024-02-29", notes: "独立 HTTP 测试记录" };
}
async function register(label: string): Promise<Actor> {
  const actor: Actor = { email: `me-jobs-${randomUUID()}@example.invalid`, password: `${randomUUID()}-${randomUUID()}`, cookie: "", cleanupAllowed: false };
  actors.push(actor);
  assert.equal(await withDatabaseErrors(() => getPrisma().user.count({ where: { email: actor.email } })), 0);
  actor.cleanupAllowed = true;
  const response = await fetchLocal("/api/auth/sign-up/email", { method: "POST", headers: { origin: baseURL.origin, "content-type": "application/json" }, body: JSON.stringify({ name: `岗位测试用户 ${label}`, email: actor.email, password: actor.password }) });
  assert.equal(response.status, 200, "测试用户注册应成功，请确认认证来源与测试服务器一致");
  const body = await json(response);
  assert.ok(object(body) && object(body.user) && typeof body.user.id === "string" && uuid.test(body.user.id));
  actor.id = body.user.id;
  actor.cookie = response.headers.getSetCookie().map((line) => line.split(";", 1)[0]).join("; ");
  assert.ok(Boolean(actor.cookie), "测试用户必须获得真实会话 Cookie");
  return actor;
}

describe("当前用户岗位真实 HTTP API", { concurrency: false }, () => {
  before(async () => {
    await assertTestDatabase();
    databaseVerified = true;
    a = await register("A");
    b = await register("B");
  });
  after(async () => {
    try {
      if (!databaseVerified) return;
      // 即使 POST 已提交但响应中断，也先按唯一测试用户及本轮随机标记找回 ID。
      // 所有 DELETE 均有精确岗位 ID + 所有者条件，不清空表，不清理其他用户。
      for (const actor of actors.filter((value) => value.cleanupAllowed)) {
        await withDatabaseErrors(() => getPrisma().$transaction(async (tx) => {
          const user = await tx.user.findUnique({ where: { email: actor.email }, select: { id: true } });
          if (!user) return;
          if (actor.id) assert.equal(user.id, actor.id);
          const recovered = await tx.job.findMany({ where: { userId: user.id, company: { startsWith: prefix } }, select: { id: true } });
          for (const job of recovered) testIds.add(job.id);
          for (const id of testIds) await tx.job.deleteMany({ where: { id, userId: user.id } });
          assert.equal(await tx.job.count({ where: { userId: user.id } }), 0, "存在未识别岗位时禁止连带删除用户");
          await tx.user.delete({ where: { id: user.id, email: actor.email } });
          assert.equal(await tx.session.count({ where: { userId: user.id } }), 0);
          assert.equal(await tx.account.count({ where: { userId: user.id } }), 0);
        }));
      }
      assert.equal(await withDatabaseErrors(() => getPrisma().job.count({ where: { id: { in: [...testIds] } } })), 0, "测试岗位必须全部清理");
      assert.equal(await withDatabaseErrors(() => getPrisma().user.count({ where: { email: { in: actors.filter((value) => value.cleanupAllowed).map((value) => value.email) } } })), 0, "测试用户必须全部清理");
    } finally { await disconnectPrisma(); }
  });

  test("未登录访问五种接口均为 401，写请求缺少 Origin 或 JSON 也优先拒绝认证", async () => {
    for (const [method, path] of [["GET", collection], ["GET", `${collection}/${missingId}`], ["POST", collection], ["PATCH", `${collection}/${missingId}`], ["DELETE", `${collection}/${missingId}`]]) {
      assert.equal(errorCode((await api(path, 401, { method, origin: null })).body), "UNAUTHORIZED");
    }
    assert.equal(errorCode((await api(collection, 401, { headers: { cookie: "better-auth.session_token=forged", "x-user-id": a.id! } })).body), "UNAUTHORIZED");
  });

  test("新用户列表为空，只返回自己的数据且私有响应不可缓存", async () => {
    assert.deepEqual(list((await api(collection, 200, { actor: a })).body), []);
    assert.deepEqual(list((await api(collection, 200, { actor: b })).body), []);
  });

  test("POST 返回 201 和 Location，伪造 ID/所有者/时间戳均不能覆盖受保护字段", async () => {
    const spoofId = randomUUID();
    const result = await api(collection, 201, { method: "POST", actor: a, body: { ...input(), userId: b.id, id: spoofId, createdAt: "1900-01-01T00:00:00Z", updatedAt: "1900-01-01T00:00:00Z" } });
    aJob = data(result.body);
    assert.notEqual(aJob.id, spoofId);
    assert.ok(!aJob.createdAt.startsWith("1900") && !aJob.updatedAt.startsWith("1900"));
    assert.equal(result.response.headers.get("location"), `${collection}/${aJob.id}`);
    const row = await withDatabaseErrors(() => getPrisma().job.findUnique({ where: { id: aJob.id }, select: { userId: true } }));
    assert.equal(row?.userId, a.id);
  });

  test("A 可以查询自己的单条和列表，DATE 映射为原始日历字符串", async () => {
    assert.deepEqual(data((await api(`${collection}/${aJob.id}`, 200, { actor: a })).body), aJob);
    assert.equal(aJob.appliedAt, "2024-02-29");
    assert.deepEqual(list((await api(collection, 200, { actor: a })).body).map((job) => job.id), [aJob.id]);
  });

  test("B 无法读取、修改、删除 A 岗位，A 数据保持不变", async () => {
    for (const method of ["GET", "PATCH", "DELETE"]) {
      assert.equal(errorCode((await api(`${collection}/${aJob.id}`, 404, { method, actor: b, ...(method === "PATCH" ? { body: { notes: "越权修改" } } : {}) })).body), "JOB_NOT_FOUND");
    }
    assert.deepEqual(data((await api(`${collection}/${aJob.id}`, 200, { actor: a })).body), aJob);
    assert.deepEqual(list((await api(collection, 200, { actor: b })).body), []);
  });

  test("A/B 列表互相隔离，query 或自定义头不能切换所有者，POST 缺省备注为空", async () => {
    const withoutNotes: Partial<ReturnType<typeof input>> = input("B");
    delete withoutNotes.notes;
    bJob = data((await api(collection, 201, { method: "POST", actor: b, body: withoutNotes })).body);
    assert.equal(bJob.notes, "");
    assert.deepEqual(list((await api(`${collection}?userId=${b.id}`, 200, { actor: a, headers: { "x-user-id": b.id! } })).body).map((job) => job.id), [aJob.id]);
    assert.deepEqual(list((await api(collection, 200, { actor: b })).body).map((job) => job.id), [bJob.id]);
    await api(`${collection}/${bJob.id}`, 404, { actor: a });
  });

  test("PATCH 是部分更新，未传字段和主键不变，伪造所有者及元数据无效", async () => {
    const updated = data((await api(`${collection}/${aJob.id}`, 200, { method: "PATCH", actor: a, body: { status: "interviewing", userId: b.id, id: randomUUID(), createdAt: "1900-01-01", updatedAt: "1900-01-01" } })).body);
    assert.equal(updated.id, aJob.id);
    assert.equal(updated.company, aJob.company);
    assert.equal(updated.appliedAt, aJob.appliedAt);
    assert.equal(updated.notes, aJob.notes);
    assert.equal(updated.createdAt, aJob.createdAt);
    assert.equal(updated.status, "interviewing");
    assert.ok(Date.parse(updated.updatedAt) >= Date.parse(aJob.updatedAt));
    assert.equal((await withDatabaseErrors(() => getPrisma().job.findUnique({ where: { id: updated.id }, select: { userId: true } })))?.userId, a.id);
    aJob = updated;
  });

  test("状态筛选只作用于当前用户，total 等于筛选后数量，排序保持日期降序", async () => {
    data((await api(collection, 201, { method: "POST", actor: a, body: { ...input("A-second"), appliedAt: "2026-01-01" } })).body);
    for (const status of ["applied", "interviewing", "offered", "rejected"]) {
      const jobs = list((await api(`${collection}?status=${status}`, 200, { actor: a })).body);
      assert.ok(jobs.every((job) => job.status === status && job.id !== bJob.id));
      assert.equal(jobs.length, status === "applied" || status === "interviewing" ? 1 : 0);
    }
    const jobs = list((await api(collection, 200, { actor: a })).body);
    assert.ok(jobs[0].appliedAt >= jobs[1].appliedAt);
  });

  test("并发请求保持用户隔离，不同字段的 PATCH 不会覆盖对方的更新", async () => {
    const [, , otherUser] = await Promise.all([
      api(`${collection}/${aJob.id}`, 200, { method: "PATCH", actor: a, body: { notes: "并发备注" } }),
      api(`${collection}/${aJob.id}`, 200, { method: "PATCH", actor: a, body: { location: "杭州" } }),
      api(collection, 200, { actor: b }),
    ]);
    assert.deepEqual(list(otherUser.body).map((job) => job.id), [bJob.id]);
    const updated = data((await api(`${collection}/${aJob.id}`, 200, { actor: a })).body);
    assert.equal(updated.notes, "并发备注");
    assert.equal(updated.location, "杭州");
    assert.equal(updated.status, aJob.status);
    aJob = updated;
  });

  test("不存在和属于他人的岗位返回完全相同的 404 JSON", async () => {
    for (const method of ["GET", "PATCH", "DELETE"]) {
      const options = { method, actor: b, ...(method === "PATCH" ? { body: { notes: "不存在" } } : {}) };
      assert.deepEqual((await api(`${collection}/${missingId}`, 404, options)).body, (await api(`${collection}/${aJob.id}`, 404, options)).body);
    }
  });

  test("非法 UUID 在 GET/PATCH/DELETE 均返回 400", async () => {
    for (const method of ["GET", "PATCH", "DELETE"]) {
      assert.equal(errorCode((await api(`${collection}/job-001`, 400, { method, actor: a, ...(method === "PATCH" ? { body: { notes: "测试" } } : {}) })).body), "INVALID_ID");
    }
  });

  test("非法/空/重复状态参数及非法写入状态被拒绝", async () => {
    for (const query of ["status=", "status=all", "status=APPLIED", "status=unknown", "status=applied&status=applied", "status=applied&status=offered"]) {
      assert.equal(errorCode((await api(`${collection}?${query}`, 400, { actor: a })).body), "INVALID_STATUS");
    }
    await api(collection, 400, { method: "POST", actor: a, body: { ...input(), status: "invalid" } });
    await api(`${collection}/${aJob.id}`, 400, { method: "PATCH", actor: a, body: { status: "invalid" } });
  });

  test("非法日期 POST/PATCH 被拒绝，不会自动纠正或改变原记录", async () => {
    for (const appliedAt of ["2026-02-30", "2026-1-1", "0000-01-01"]) {
      await api(collection, 400, { method: "POST", actor: a, body: { ...input(), appliedAt } });
      await api(`${collection}/${aJob.id}`, 400, { method: "PATCH", actor: a, body: { appliedAt } });
    }
    assert.deepEqual(data((await api(`${collection}/${aJob.id}`, 200, { actor: a })).body), aJob);
  });

  test("错误 JSON/Content-Type、空 PATCH、错误字段类型和长度返回 400", async () => {
    await api(collection, 400, { method: "POST", actor: a, raw: "{broken" });
    await api(collection, 400, { method: "POST", actor: a, body: input(), contentType: "text/plain" });
    for (const body of [null, [], {}, { ...input(), company: " " }, { ...input(), location: 1 }, { ...input(), position: "x".repeat(101) }]) {
      await api(collection, 400, { method: "POST", actor: a, body });
    }
    for (const body of [{}, { userId: b.id }, { notes: null }, { notes: "x".repeat(2001) }]) {
      await api(`${collection}/${aJob.id}`, 400, { method: "PATCH", actor: a, body });
    }
  });

  test("所有写方法拒绝缺失、null、跨站或非精确匹配 Origin，拒绝不可信 Fetch Metadata", async () => {
    const before = list((await api(collection, 200, { actor: a })).body);
    for (const method of ["POST", "PATCH", "DELETE"]) {
      const path = method === "POST" ? collection : `${collection}/${aJob.id}`;
      const body = method === "POST" ? input("csrf") : method === "PATCH" ? { notes: "CSRF" } : undefined;
      for (const origin of [null, "null", "https://evil.example", `${baseURL.origin}/`, `${baseURL.origin}.evil.example`]) {
        assert.equal(errorCode((await api(path, 403, { method, actor: a, body, origin })).body), "FORBIDDEN_ORIGIN");
      }
      await api(path, 403, { method, actor: a, body, headers: { "sec-fetch-site": "cross-site" } });
    }
    assert.deepEqual(list((await api(collection, 200, { actor: a })).body), before, "被拒绝的跨站请求不应改变岗位");
  });

  test("不开放跨站 CORS 预检，DELETE 自己的岗位后查询返回 404", async () => {
    const options = await fetchLocal(collection, { method: "OPTIONS", headers: { origin: "https://evil.example", "access-control-request-method": "POST" } });
    assert.equal(options.headers.get("access-control-allow-origin"), null);
    const own = data((await api(collection, 201, { method: "POST", actor: a, body: input("delete") })).body);
    assert.deepEqual(data((await api(`${collection}/${own.id}`, 200, { method: "DELETE", actor: a })).body), own);
    await api(`${collection}/${own.id}`, 404, { actor: a });
  });

  test("退出后重放旧 Cookie，五种接口均 401，不能通过伪造用户参数继续操作", async () => {
    const oldCookie = a.cookie;
    const result = await fetchLocal("/api/auth/sign-out", { method: "POST", headers: { origin: baseURL.origin, cookie: oldCookie, "content-type": "application/json" }, body: "{}" });
    assert.equal(result.status, 200);
    for (const [method, path] of [["GET", collection], ["GET", `${collection}/${aJob.id}`], ["POST", collection], ["PATCH", `${collection}/${aJob.id}`], ["DELETE", `${collection}/${aJob.id}`]]) {
      assert.equal(errorCode((await api(path, 401, { method, cookie: oldCookie, body: method === "POST" ? input("logged-out") : method === "PATCH" ? { notes: "失效会话" } : undefined, headers: { "x-user-id": a.id! } })).body), "UNAUTHORIZED");
    }
    assert.equal(data((await api(`${collection}/${bJob.id}`, 200, { actor: b })).body).id, bJob.id);
  });
});
