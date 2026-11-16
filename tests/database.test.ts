import assert, { AssertionError } from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import nextEnv from "@next/env";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";
import { DatabaseAccessError, withDatabaseErrors } from "@/lib/database-error";
import { isAuthSchemaReady } from "@/lib/auth-schema";
import { toJobWriteData } from "@/lib/job-mapper";
import { disconnectPrisma, getPrisma } from "@/lib/prisma";
import { createJobRepository } from "@/repositories/job-repository";
import type { JobInput } from "@/types/job";

nextEnv.loadEnvConfig(process.cwd(), true, {
  info: () => {},
  error: () => { throw new DatabaseAccessError("CONFIGURATION_ERROR"); },
});

const authSchemaReady = await isAuthSchemaReady();
const migrationSkip = authSchemaReady ? false : "Better Auth / userId 迁移尚未执行，禁止测试写入；不自动迁移。";

type Repository = ReturnType<typeof createJobRepository>;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let serverVersion = "";

before(async () => {
  if (!authSchemaReady) return;
  const [connection] = await withDatabaseErrors(() => getPrisma().$queryRaw<{
    database: string; role: string; version: string;
  }[]>`SELECT current_database() AS database, current_user AS role, current_setting('server_version') AS version`);
  assert.equal(connection?.database, "jobflow_db", "仅允许在指定的应用数据库验证写入");
  assert.equal(connection?.role, "jobflow_app", "数据库验证必须使用应用账号");
  serverVersion = connection.version;
  // 首次真实读取通过 Repository 的脱敏边界；不输出连接串或业务记录。
});

after(async () => { await disconnectPrisma(); });

async function withRollback(work: (repository: Repository, tx: Prisma.TransactionClient, ids: string[], userIds: string[]) => Promise<void>) {
  const rollback = new Error("数据库验证主动回滚");
  const ids: string[] = [];
  const userIds: string[] = [];
  try {
    await getPrisma().$transaction(async (tx) => {
      const user = await tx.user.create({ data: { name: "Integration User", email: `${randomUUID()}@example.invalid` } });
      userIds.push(user.id);
      await work(createJobRepository(() => tx, async () => user.id), tx, ids, userIds);
      // 即使验证中途失败，Prisma 也会回滚。不会提交任何测试写入。
      throw rollback;
    }, { maxWait: 5000, timeout: 15000 });
    assert.fail("验证事务不应被提交");
  } catch (error) {
    if (error !== rollback) {
      if (error instanceof AssertionError || error instanceof DatabaseAccessError) throw error;
      throw new DatabaseAccessError("DATABASE_UNAVAILABLE");
    }
  } finally {
    // 只检查本次创建并返回的 UUID，无批量删除或业务记录修改。
    if (ids.length) {
      const remaining = await withDatabaseErrors(() => getPrisma().job.count({ where: { id: { in: ids } } }));
      assert.equal(remaining, 0, "测试记录必须在事务结束后全部消失");
    }
    if (userIds.length) {
      const remaining = await withDatabaseErrors(() => getPrisma().user.count({ where: { id: { in: userIds } } }));
      assert.equal(remaining, 0, "测试用户必须随事务回滚");
    }
  }
}

function input(appliedAt = "2024-02-29"): JobInput {
  return {
    company: `Integration-${randomUUID()}`,
    position: "仅用于验证的岗位",
    location: "测试地点",
    status: "applied",
    appliedAt,
    notes: "独立事务测试记录，结束后自动回滚",
  };
}

test("真实查询可用，Client 单例复用，列表按日期及 ID 排序", { skip: migrationSkip }, async (context) => {
  context.diagnostic(`数据库 jobflow_db，账号 jobflow_app，PostgreSQL ${serverVersion}`);
  assert.equal(getPrisma(), getPrisma());
  await withRollback(async (repository, _tx, ids) => {
    ids.push((await repository.createJob(input("2026-11-17"))).id);
    ids.push((await repository.createJob(input("2024-02-29"))).id);
    const jobs = await repository.getAllJobs();
    assert.ok(jobs.every((job, index) => index === 0
      || jobs[index - 1].appliedAt > job.appliedAt
      || (jobs[index - 1].appliedAt === job.appliedAt && jobs[index - 1].id <= job.id)), "列表排序不正确");
  });
});

test("真实数据库新增、查询、更新、删除，保持 ID 并清理所有测试记录", { timeout: 30000, skip: migrationSkip }, async () => {
  await withRollback(async (repository, tx, ids) => {
    const values = input();
    const created = await repository.createJob(values);
    ids.push(created.id);
    assert.match(created.id, uuidPattern);
    assert.equal(created.company, values.company);
    assert.equal(created.appliedAt, "2024-02-29");
    assert.ok(Number.isFinite(Date.parse(created.createdAt)));
    assert.ok(Number.isFinite(Date.parse(created.updatedAt)));
    assert.deepEqual(await repository.getJobById(created.id), created);
    assert.ok((await repository.getAllJobs()).some((job) => job.id === created.id));

    const raw = await tx.job.findUniqueOrThrow({ where: { id: created.id } });
    assert.ok(raw.appliedAt instanceof Date);
    assert.equal(raw.appliedAt.toISOString(), "2024-02-29T00:00:00.000Z");

    const updated = await repository.updateJob(created.id, {
      ...values, company: `${values.company}-Updated`, status: "interviewing",
      appliedAt: "2026-03-08", notes: "更新后的测试备注",
    });
    assert.ok(updated);
    assert.equal(updated.id, created.id);
    assert.equal(updated.createdAt, created.createdAt);
    assert.ok(Date.parse(updated.updatedAt) >= Date.parse(created.updatedAt));
    assert.equal(updated.status, "interviewing");
    assert.equal(updated.notes, "更新后的测试备注");
    assert.equal(updated.appliedAt, "2026-03-08");
    assert.deepEqual(await repository.getJobById(created.id), updated);

    assert.equal((await repository.deleteJob(created.id))?.id, created.id);
    assert.equal(await repository.getJobById(created.id), null);
    assert.equal(await repository.updateJob(created.id, values), null);
    assert.equal(await repository.deleteJob(created.id), null);

    // 留一条尚未显式删除的记录，验证回滚也能保证清理。
    const pending = await repository.createJob(input());
    ids.push(pending.id);
    assert.notEqual(pending.id, created.id);
  });
});

test("PostgreSQL DATE 在闰日、跨年和夏令时边界保持原日期", { timeout: 30000, skip: migrationSkip }, async (context) => {
  context.diagnostic(`测试时区：${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
  await withRollback(async (repository, _tx, ids) => {
    for (const date of ["0001-01-01", "1900-02-28", "2000-02-29", "2024-02-29", "2026-01-01", "2026-03-08", "2026-11-01", "2026-12-31", "9999-12-31"]) {
      const created = await repository.createJob(input(date));
      ids.push(created.id);
      assert.equal(created.appliedAt, date);
      assert.equal((await repository.getJobById(created.id))?.appliedAt, date);
    }
  });
});

test("连接失败返回安全错误，不携带底层异常或连接信息", { timeout: 10000, skip: migrationSkip }, async () => {
  const unavailable = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: "postgresql://jobflow_app:TEST_PLACEHOLDER@127.0.0.1:1/jobflow_db",
      connectionTimeoutMillis: 500,
      max: 1,
    }),
    log: [],
    errorFormat: "minimal",
  });
  try {
    const repository = createJobRepository(() => unavailable, async () => "11111111-1111-4111-8111-111111111111");
    await assert.rejects(() => repository.getAllJobs(), (error: unknown) => {
      assert.ok(error instanceof DatabaseAccessError);
      assert.equal(error.code, "DATABASE_UNAVAILABLE");
      assert.equal(error.message, "数据库暂时不可用，请稍后重试。");
      assert.equal(error.cause, undefined);
      assert.doesNotMatch(String(error), /TEST_PLACEHOLDER|DATABASE_URL|postgresql|127\.0\.0\.1/);
      return true;
    });
  } finally {
    await withDatabaseErrors(() => unavailable.$disconnect());
  }
});

test("两个用户不能读取或修改对方岗位，未归属数据不可见，不能伪造所有者", { timeout: 30000, skip: migrationSkip }, async () => {
  await withRollback(async (repositoryA, tx, ids, userIds) => {
    const userB = await tx.user.create({ data: { name: "Integration B", email: `${randomUUID()}@example.invalid` } });
    userIds.push(userB.id);
    const repositoryB = createJobRepository(() => tx, async () => userB.id);
    const a = await repositoryA.createJob({ ...input(), userId: userB.id } as JobInput);
    const b = await repositoryB.createJob(input());
    const legacy = await tx.job.create({ data: { ...toJobWriteData(input()), userId: null } });
    ids.push(a.id, b.id, legacy.id);
    assert.notEqual((await tx.job.findUniqueOrThrow({ where: { id: a.id } })).userId, userB.id);
    assert.deepEqual((await repositoryA.getAllJobs()).map((job) => job.id), [a.id]);
    assert.deepEqual((await repositoryB.getAllJobs()).map((job) => job.id), [b.id]);
    assert.equal(await repositoryA.getJobById(b.id), null);
    assert.equal(await repositoryB.getJobById(a.id), null);
    assert.equal(await repositoryA.getJobById(legacy.id), null);
    assert.equal(await repositoryB.getJobById(legacy.id), null);
    assert.equal(await repositoryA.updateJob(b.id, input()), null);
    assert.equal(await repositoryA.deleteJob(b.id), null);
    assert.equal((await repositoryB.getJobById(b.id))?.id, b.id);
  });
});
