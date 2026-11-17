import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import nextEnv from "@next/env";
import { CSV_HEADER } from "@/lib/job-csv";
import { JobImportError } from "@/lib/job-import-error";
import { DatabaseAccessError, withDatabaseErrors } from "@/lib/database-error";
import { disconnectPrisma, getPrisma } from "@/lib/prisma";
import { createJobImportRepository } from "@/repositories/job-import-repository";
import type { JobImportRequest } from "@/types/job-import";
import { assertTestDatabase } from "./helpers/test-database";

nextEnv.loadEnvConfig(process.cwd(), true, { info: () => {}, error: () => { throw new Error("本地测试配置无法加载。"); } });
const marker = `CsvDB-${randomUUID()}`;
const users: { id: string; email: string }[] = [];
const jobIds = new Set<string>();
let a: string;
let b: string;
const repo = (id: string) => createJobImportRepository(getPrisma, async () => id);
const source = (label: string, extra = "") => `${CSV_HEADER}\n${marker}-${label},开发,上海,applied,2024-02-29,${extra}`;
const code = (value: string) => (error: unknown) => error instanceof JobImportError && error.code === value;
async function request(id: string, csv: string, selectedRows?: number[]): Promise<JobImportRequest> {
  const preview = await repo(id).preview(csv);
  return { csv, selectedRows: selectedRows ?? preview.rows.filter((row) => !row.errors.length).map((row) => row.line), allowDuplicates: false, previewHash: preview.previewHash, requestId: randomUUID() };
}

describe("CSV 数据库事务、幂等与用户隔离", { concurrency: false }, () => {
  before(async () => {
    await assertTestDatabase();
    const [schema] = await withDatabaseErrors(() => getPrisma().$queryRaw<{ ready: boolean }[]>`SELECT to_regclass('public.job_import_batches') IS NOT NULL AS ready`);
    assert.ok(schema?.ready, "请先审核并应用 CSV 导入迁移；不在未就绪结构中创建测试账号。");
    for (let i = 0; i < 2; i++) {
      const user = { id: randomUUID(), email: `csv-db-${randomUUID()}@example.invalid` };
      users.push(user);
      await withDatabaseErrors(() => getPrisma().user.create({ data: { ...user, name: "CSV 隔离测试" } }));
    }
    a = users[0].id; b = users[1].id;
  });
  after(async () => {
    try {
      for (const user of users) await withDatabaseErrors(() => getPrisma().$transaction(async (tx) => {
        const owned = await tx.user.findUnique({ where: { id: user.id, email: user.email } });
        if (!owned) return;
        const recovered = await tx.job.findMany({ where: { userId: user.id, company: { startsWith: marker } }, select: { id: true } });
        for (const row of recovered) jobIds.add(row.id);
        for (const id of jobIds) await tx.job.deleteMany({ where: { id, userId: user.id } });
        assert.equal(await tx.job.count({ where: { userId: user.id } }), 0, "未知岗位阻止删除测试用户");
        await tx.user.delete({ where: { id: user.id, email: user.email } });
        assert.equal(await tx.jobImportBatch.count({ where: { userId: user.id } }), 0);
      }));
    } finally { await disconnectPrisma(); }
  });
  test("批量创建与 ledger 同事务提交，日期/所有者映射正确", async () => {
    const csv = `${source("bulk")}\n${marker}-bulk2,后端,杭州,offered,2026-11-17,备注`;
    const input = await request(a, csv);
    const result = await repo(a).import({ ...input, userId: b });
    result.jobIds.forEach((id) => jobIds.add(id));
    assert.equal(result.importedCount, 2); assert.equal(result.replayed, false);
    const records = await withDatabaseErrors(() => getPrisma().job.findMany({ where: { id: { in: result.jobIds } } }));
    assert.ok(records.every((job) => job.userId === a));
    assert.ok(records.some((job) => job.appliedAt.toISOString().slice(0, 10) === "2024-02-29"));
    assert.equal(await withDatabaseErrors(() => getPrisma().jobImportBatch.count({ where: { id: result.batchId, userId: a } })), 1);
  });
  test("重复检测仅包含当前用户；另一用户的相同岗位不影响预览和写入", async () => {
    const csv = source("bulk");
    const pa = await repo(a).preview(csv); const pb = await repo(b).preview(csv);
    assert.equal(pa.rows[0].existingCount, 1); assert.equal(pb.rows[0].existingCount, 0);
    const result = await repo(b).import(await request(b, csv)); result.jobIds.forEach((id) => jobIds.add(id));
    assert.equal((await repo(a).preview(csv)).rows[0].existingCount, 1);
    assert.equal((await repo(b).preview(csv)).rows[0].existingCount, 1);
  });
  test("无效行选择导致整个批次被拒绝；选择有效子集可以导入", async () => {
    const csv = `${source("subset")}\n${marker}-invalid,开发,上海,applied,2026-02-30,`;
    const input = await request(a, csv, [2, 3]);
    const count = await withDatabaseErrors(() => getPrisma().job.count({ where: { userId: a } }));
    await assert.rejects(() => repo(a).import(input), code("IMPORT_INVALID"));
    assert.equal(await withDatabaseErrors(() => getPrisma().job.count({ where: { userId: a } })), count);
    const result = await repo(a).import({ ...input, selectedRows: [2] }); result.jobIds.forEach((id) => jobIds.add(id));
    assert.equal(result.importedCount, 1);
  });
  test("疑似重复默认阻止，明确确认后只新增，不覆盖已有岗位", async () => {
    const input = await request(a, source("bulk"));
    await assert.rejects(() => repo(a).import(input), code("IMPORT_DUPLICATES"));
    const result = await repo(a).import({ ...input, allowDuplicates: true }); result.jobIds.forEach((id) => jobIds.add(id));
    assert.equal((await repo(a).preview(input.csv)).rows[0].existingCount, 2);
  });
  test("预览后相关数据改变返回 409，不插入任何岗位", async () => {
    const input = await request(a, source("stale"));
    const first = await repo(a).import(input); first.jobIds.forEach((id) => jobIds.add(id));
    await assert.rejects(() => repo(a).import({ ...input, requestId: randomUUID(), allowDuplicates: true }), code("IMPORT_PREVIEW_STALE"));
    assert.equal((await repo(a).preview(input.csv)).rows[0].existingCount, 1);
  });
  test("相同批次并发重试只有一次写入，修改过请求内容不得复用 key", async () => {
    const input = await request(a, source("concurrent"));
    const results = await Promise.all([repo(a).import(input), repo(a).import(input)]);
    results[0].jobIds.forEach((id) => jobIds.add(id));
    assert.deepEqual(results[0].jobIds, results[1].jobIds);
    assert.deepEqual(results.map((value) => value.replayed).sort(), [false, true]);
    await assert.rejects(() => repo(a).import({ ...input, allowDuplicates: true }), code("IMPORT_KEY_CONFLICT"));
  });
  test("删除已导入岗位后重放仍返回原结果，不会复活已删除记录", async () => {
    const input = await request(a, source("deleted")); const result = await repo(a).import(input);
    result.jobIds.forEach((id) => jobIds.add(id));
    await withDatabaseErrors(() => getPrisma().job.delete({ where: { id: result.jobIds[0], userId: a } }));
    const replay = await repo(a).import(input);
    assert.equal(replay.replayed, true); assert.deepEqual(replay.jobIds, result.jobIds);
    assert.equal(await withDatabaseErrors(() => getPrisma().job.count({ where: { id: result.jobIds[0] } })), 0);
  });
  test("岗位写入后 ledger 故障会完整回滚，无半个批次或孤立岗位", async () => {
    const input = await request(a, source("rollback"));
    // 仅代理本测试事务的 ledger delegate，岗位仍写入真实 PostgreSQL，随后注入故障。
    const repository = createJobImportRepository(() => ({
      job: getPrisma().job,
      $transaction: (work, options) => getPrisma().$transaction((tx) => work({ ...tx,
        jobImportBatch: new Proxy(tx.jobImportBatch, { get(target, field, receiver) {
          if (field === "create") return () => { throw new Error("TEST_FAILURE_PRIVATE_DETAIL"); };
          return Reflect.get(target, field, receiver);
        } }),
      }), options),
    }), async () => a);
    await assert.rejects(() => repository.import(input), (error: unknown) => error instanceof DatabaseAccessError && !error.message.includes("PRIVATE"));
    assert.equal(await withDatabaseErrors(() => getPrisma().job.count({ where: { userId: a, company: `${marker}-rollback` } })), 0);
    assert.equal(await withDatabaseErrors(() => getPrisma().jobImportBatch.count({ where: { userId: a, requestId: input.requestId } })), 0);
  });
});
