import assert from "node:assert/strict";
import { test } from "node:test";
import { createJobsClient, JobsClientError, type JobsClient } from "@/lib/jobs-client";
import { createRemoteJobsStore } from "@/lib/remote-jobs-store";
import type { JobInput } from "@/types/job";
import type { JobRecord } from "@/types/job-record";

const values: JobInput = { company: "公司", position: "开发", location: "上海", status: "applied", appliedAt: "2026-11-17", notes: "" };
const record: JobRecord = { id: "11111111-1111-4111-8111-111111111111", ...values, createdAt: "2026-11-17T00:00:00Z", updatedAt: "2026-11-17T00:00:00Z" };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function fakeClient(overrides: Partial<JobsClient> = {}): JobsClient {
  return { list: async () => [], create: async () => record, update: async () => ({ ...record, status: "interviewing" }), remove: async () => record, ...overrides };
}

test("客户端只调用同源私人 API，带 Cookie/no-store，使用 POST/PATCH/DELETE 和写入白名单", async () => {
  const calls: { path: string; init: RequestInit }[] = [];
  const api = createJobsClient(async (path, init) => {
    calls.push({ path: String(path), init: init ?? {} });
    return Response.json(init?.method ? { data: record } : { data: [record], total: 1 });
  });
  assert.deepEqual(await api.list(), [record]);
  await api.create({ ...values, userId: "spoof", id: "spoof", createdAt: "spoof", updatedAt: "spoof" } as JobInput);
  await api.update(record.id, { status: "interviewing" });
  await api.remove(record.id);
  assert.deepEqual(calls.map((call) => call.init.method ?? "GET"), ["GET", "POST", "PATCH", "DELETE"]);
  assert.ok(calls.every((call) => call.path.startsWith("/api/me/jobs") && call.init.credentials === "same-origin" && call.init.cache === "no-store"));
  assert.deepEqual(JSON.parse(String(calls[1].init.body)), values);
  assert.deepEqual(JSON.parse(String(calls[2].init.body)), { status: "interviewing" });
  assert.ok(!new Headers(calls[1].init.headers).has("origin"), "Origin 必须由浏览器正常生成");
});

test("401/400/403/404/5xx 映射安全错误，不回显服务端密码、SQL 或堆栈", async () => {
  for (const status of [400, 401, 403, 404, 500, 503]) {
    const api = createJobsClient(async () => Response.json({ error: { code: "UNKNOWN", message: "DATABASE_URL=postgresql://private:FAKE_SECRET@host/db", stack: "private" } }, { status }));
    await assert.rejects(() => api.list(), (error: unknown) => error instanceof JobsClientError && error.status === status && !/FAKE_SECRET|DATABASE_URL|postgresql|stack/.test(error.message));
  }
});

test("网络失败、非法 JSON、错误结构和重复 ID 都不能冒充合法岗位数据", async () => {
  const clients = [
    createJobsClient(async () => { throw new Error("FAKE_SECRET"); }),
    createJobsClient(async () => new Response("{broken")),
    createJobsClient(async () => Response.json({ data: [values], total: 1 })),
    createJobsClient(async () => Response.json({ data: [record, record], total: 2 })),
    createJobsClient(async () => Response.json({ data: [record], total: 0 })),
  ];
  for (const api of clients) await assert.rejects(() => api.list(), (error: unknown) => error instanceof JobsClientError && !error.message.includes("FAKE_SECRET"));
});

test("远程空数据为真实 ready 空列表，新增/编辑/删除更新同一份记录快照", async () => {
  const store = createRemoteJobsStore(fakeClient());
  assert.equal(store.getServerSnapshot().phase, "loading");
  await store.start();
  assert.equal(store.getSnapshot().phase, "ready");
  assert.equal(store.getSnapshot().jobs.length, 0);
  assert.equal((await store.createJob(values)).ok, true);
  assert.deepEqual(store.getSnapshot().jobs, [record]);
  await store.updateJob(record.id, { status: "interviewing" });
  assert.equal(store.getSnapshot().jobs[0].status, "interviewing");
  await store.deleteJob(record.id);
  assert.equal(store.getSnapshot().jobs.length, 0);
  store.stop();
});

test("加载失败可重试，刷新失败保留上次真实数据并标明错误", async () => {
  let fail = true;
  const store = createRemoteJobsStore(fakeClient({ list: async () => { if (fail) throw new JobsClientError(503); return [record]; } }));
  await store.start();
  assert.equal(store.getSnapshot().phase, "error");
  assert.equal(store.getSnapshot().jobs.length, 0);
  fail = false;
  await store.refresh();
  assert.equal(store.getSnapshot().phase, "ready");
  fail = true;
  await store.refresh();
  assert.deepEqual(store.getSnapshot().jobs, [record]);
  assert.equal(store.getSnapshot().problem?.status, 503);
  store.stop();
});

test("新读取取消旧读取，即使旧请求忽略 AbortSignal，延迟结果也不能覆盖新列表", async () => {
  const old = deferred<JobRecord[]>();
  const latest = deferred<JobRecord[]>();
  const signals: (AbortSignal | undefined)[] = [];
  const store = createRemoteJobsStore(fakeClient({ list: (signal) => { signals.push(signal); return signals.length === 1 ? old.promise : latest.promise; } }));
  const first = store.start();
  const second = store.refresh();
  assert.equal(signals[0]?.aborted, true);
  latest.resolve([record]); await second;
  old.resolve([]); await first;
  assert.deepEqual(store.getSnapshot().jobs, [record]);
  store.stop();
});

test("写入中阻止重复提交和刷新；请求成功前不乐观修改统计来源", async () => {
  const pending = deferred<JobRecord>();
  let writes = 0;
  const store = createRemoteJobsStore(fakeClient({ create: () => { writes++; return pending.promise; } }));
  await store.start();
  const save = store.createJob(values);
  assert.equal(store.getSnapshot().busy, true);
  assert.equal(store.getSnapshot().jobs.length, 0);
  assert.equal((await store.createJob(values)).ok, false);
  assert.equal(await store.refresh(), false);
  assert.equal(writes, 1);
  pending.resolve(record); await save;
  assert.equal(store.getSnapshot().jobs.length, 1);
  store.stop();
});

test("400/403 写入失败保持原记录，404 自动重读并移除已不存在记录", async () => {
  let code = 400;
  let reads = 0;
  const store = createRemoteJobsStore(fakeClient({ list: async () => ++reads === 1 ? [record] : [], update: async () => { throw new JobsClientError(code); } }));
  await store.start();
  for (code of [400, 403]) {
    const result = await store.updateJob(record.id, { status: "offered" });
    assert.ok(!result.ok && result.status === code);
    assert.deepEqual(store.getSnapshot().jobs, [record]);
  }
  code = 404;
  await store.updateJob(record.id, { status: "offered" });
  assert.equal(reads, 2);
  assert.equal(store.getSnapshot().jobs.length, 0);
  store.stop();
});

test("401 清除私人记录并停止后续操作，账号切换也能作废进行中的写入结果", async () => {
  const pending = deferred<JobRecord>();
  const store = createRemoteJobsStore(fakeClient({ list: async () => [record], update: () => pending.promise }));
  await store.start();
  const save = store.updateJob(record.id, { status: "offered" });
  store.expire();
  pending.resolve({ ...record, status: "offered" }); await save;
  assert.equal(store.getSnapshot().phase, "unauthorized");
  assert.equal(store.getSnapshot().jobs.length, 0);
  assert.equal(await store.refresh(), false);
  assert.equal((await store.createJob(values)).ok, false);
  store.stop();
  const unauthorized = createRemoteJobsStore(fakeClient({ list: async () => { throw new JobsClientError(401); } }));
  await unauthorized.start();
  assert.equal(unauthorized.getSnapshot().phase, "unauthorized");
  unauthorized.stop();
});

test("卸载取消读取且忽略结果，重启及另一个账号实例不继承旧列表或忙碌状态", async () => {
  const pending = deferred<JobRecord[]>();
  const store = createRemoteJobsStore(fakeClient({ list: () => pending.promise }));
  const read = store.start();
  store.stop();
  pending.resolve([record]); await read;
  assert.equal(store.getSnapshot().jobs.length, 0);
  assert.equal(store.getSnapshot().refreshing, false);
  await store.start();
  assert.deepEqual(store.getSnapshot().jobs, [record], "重启后必须重新加载且不能停留在忙碌状态");
  store.stop();
  const other = createRemoteJobsStore(fakeClient());
  await other.start();
  assert.deepEqual(other.getSnapshot().jobs, []);
  other.stop();
});
