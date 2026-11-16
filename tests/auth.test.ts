import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { Prisma, PrismaClient, Job as PrismaJob } from "@/generated/prisma/client";
import { createAuth } from "@/lib/auth";
import { readAuthEnvironment } from "@/lib/auth-config";
import { AuthError, safeAuthError } from "@/lib/auth-error";
import { readSession } from "@/lib/session";
import { createJobRepository } from "@/repositories/job-repository";
import type { JobInput } from "@/types/job";

const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const id = "33333333-3333-4333-8333-333333333333";
const values: JobInput = { company: "测试", position: "开发", location: "上海", status: "applied", appliedAt: "2026-11-17", notes: "" };
const authModels = [
  ["User", "user", "users"], ["Session", "session", "sessions"],
  ["Account", "account", "accounts"], ["Verification", "verification", "verifications"],
] as const;

test("四张认证表具有数据库 UUID 默认值，模型映射及 Verification 时间戳一致", () => {
  const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
  const sql = readFileSync(new URL("../prisma/migrations/20261116211821_better_auth_job_ownership/migration.sql", import.meta.url), "utf8");
  for (const [model, , table] of authModels) {
    const modelBlock = schema.match(new RegExp(`model ${model} \\{([\\s\\S]*?)^\\}`, "m"))?.[1];
    const tableBlock = sql.match(new RegExp(`CREATE TABLE "${table}" \\(([\\s\\S]*?)\\n\\);`))?.[1];
    assert.ok(modelBlock, `缺少 ${model} 模型`);
    assert.ok(tableBlock, `缺少 ${table} 建表语句`);
    assert.match(modelBlock, /id\s+String\s+@id\s+@default\(dbgenerated\("gen_random_uuid\(\)"\)\)\s+@db\.Uuid/);
    assert.ok(modelBlock.includes(`@@map("${table}")`));
    assert.match(tableBlock, /"id" UUID NOT NULL DEFAULT gen_random_uuid\(\)/);
    assert.match(modelBlock, /updatedAt\s+DateTime\s+@default\(now\(\)\)\s+@updatedAt\s+@db\.Timestamptz\(3\)/);
    assert.match(tableBlock, /"updatedAt" TIMESTAMPTZ\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/);
  }
});

test("真实 Better Auth PostgreSQL Adapter 使用单数 delegate 并将 UUID 生成交给数据库", async () => {
  const observed: { model: string; data: Record<string, unknown> }[] = [];
  const stopBeforeDatabase = new Error("只捕获 Adapter 参数，禁止真实数据库写入");
  const database = Object.fromEntries(authModels.map(([, model]) => [model, {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      observed.push({ model, data });
      throw stopBeforeDatabase;
    },
  }])) as unknown as PrismaClient;
  // 使用生产代码的配置工厂；不加载 .env.local、不连接数据库、不模拟 UUID 已生成。
  const auth = createAuth(database, { secret: "unit-test-only-secret-not-for-production-000000", baseURL: "http://localhost:3000" });
  assert.equal(auth.options.advanced?.database?.generateId, "uuid");
  const { adapter } = await auth.$context;
  const data: Record<string, Record<string, unknown>> = {
    user: { name: "Test", email: "adapter@example.invalid", emailVerified: false },
    session: { userId: owner, token: "test-only-token", expiresAt: new Date("2030-01-01T00:00:00Z") },
    account: { userId: owner, providerId: "credential", accountId: owner },
    verification: { identifier: "test-only-verification", value: "test-only-value", expiresAt: new Date("2030-01-01T00:00:00Z") },
  };
  for (const [, model] of authModels) {
    await assert.rejects(() => adapter.create({ model, data: data[model] }), (error: unknown) => error === stopBeforeDatabase);
    const captured = observed.at(-1);
    assert.equal(captured?.model, model);
    assert.equal(captured?.data.id, undefined, "PostgreSQL UUID 策略依赖数据库默认值");
  }
  assert.equal(observed.length, 4);
  assert.ok(observed.find(({ model }) => model === "verification")?.data.updatedAt instanceof Date);
});

test("认证配置拒绝缺失/占位密钥与不可信 URL，不回显输入", () => {
  const secret = "local-unit-test-only-secret-not-for-production";
  assert.deepEqual(readAuthEnvironment({ BETTER_AUTH_SECRET: secret, BETTER_AUTH_URL: "http://localhost:3000" }), { secret, baseURL: "http://localhost:3000" });
  for (const env of [
    {},
    { BETTER_AUTH_SECRET: "short", BETTER_AUTH_URL: "http://localhost:3000" },
    { BETTER_AUTH_SECRET: "REPLACE_WITH_A_RANDOM_SECRET_AT_LEAST_32_CHARACTERS", BETTER_AUTH_URL: "http://localhost:3000" },
    { BETTER_AUTH_SECRET: secret, BETTER_AUTH_URL: "http://untrusted.example" },
    { BETTER_AUTH_SECRET: secret, BETTER_AUTH_URL: "https://user:password@example.com" },
  ]) assert.throws(() => readAuthEnvironment(env), (error: unknown) => error instanceof AuthError && error.code === "AUTH_NOT_CONFIGURED" && !String(error).includes(secret));
});

test("没有 Cookie 时会话为空，未知认证异常被脱敏", async () => {
  assert.equal(await readSession(new Headers()), null);
  const error = safeAuthError(new Error("postgresql://private:FAKE_SECRET@example.invalid/db"));
  assert.equal(error.code, "AUTH_UNAVAILABLE");
  assert.equal(error.cause, undefined);
  assert.doesNotMatch(String(error), /FAKE_SECRET|postgresql/);
});

test("未登录时五种岗位操作全部拒绝，数据库不被访问", async () => {
  let calls = 0;
  const repository = createJobRepository(() => { calls++; throw new Error("不可访问"); }, async () => { throw new AuthError("UNAUTHORIZED"); });
  for (const operation of [
    () => repository.getAllJobs(), () => repository.getJobById(id),
    () => repository.createJob(values), () => repository.updateJob(id, values), () => repository.deleteJob(id),
  ]) await assert.rejects(operation, (error: unknown) => error instanceof AuthError && error.status === 401);
  assert.equal(calls, 0);
});

test("无效的可信用户 ID 也必须拒绝，不能产生无归属查询", async () => {
  const repository = createJobRepository(() => { throw new Error("不可访问"); }, async () => "");
  await assert.rejects(() => repository.getAllJobs(), (error: unknown) => error instanceof AuthError && error.status === 401);
});

test("全部查询与修改使用会话所有者，客户端额外 userId 被忽略", async () => {
  type Args = { where?: { id?: string; userId?: string }; data?: Record<string, unknown> };
  const calls: { method: string; args: Args }[] = [];
  const record: PrismaJob = { id, ...values, userId: owner, appliedAt: new Date("2026-11-17T00:00:00Z"), createdAt: new Date(), updatedAt: new Date() };
  // 只捕获参数，不模拟数据库的过滤行为；真实双用户测试另行在迁移后执行。
  const database = { job: {
    findMany: async (args: Args) => { calls.push({ method: "findMany", args }); return []; },
    findUnique: async (args: Args) => { calls.push({ method: "findUnique", args }); return null; },
    create: async (args: Args) => { calls.push({ method: "create", args }); return record; },
    update: async (args: Args) => { calls.push({ method: "update", args }); return record; },
    delete: async (args: Args) => { calls.push({ method: "delete", args }); return record; },
  } } as unknown as Pick<Prisma.TransactionClient, "job">;
  let sessionReads = 0;
  const repository = createJobRepository(() => database, async () => { sessionReads++; return owner; });
  await repository.getAllJobs();
  await repository.getJobById(id);
  await repository.createJob({ ...values, userId: other } as JobInput);
  await repository.updateJob(id, { ...values, userId: other } as JobInput);
  await repository.deleteJob(id);
  assert.equal(sessionReads, 5);
  for (const call of calls) {
    if (call.method === "create") assert.equal(call.args.data?.userId, owner);
    else assert.equal(call.args.where?.userId, owner);
    if (call.method === "update") assert.equal("userId" in (call.args.data ?? {}), false);
    if (["findUnique", "update", "delete"].includes(call.method)) assert.equal(call.args.where?.id, id);
  }
});
