import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseAccessError } from "@/lib/database-error";
import { fromDatabaseDate, toDatabaseDate, toJobWriteData } from "@/lib/job-mapper";
import { createJobRepository } from "@/repositories/job-repository";
import type { JobInput, JobStatus } from "@/types/job";

const validInput: JobInput = {
  company: "测试公司", position: "开发工程师", location: "上海",
  status: "applied", appliedAt: "2024-02-29", notes: "测试备注",
};
const testOwner = async () => "11111111-1111-4111-8111-111111111111";

test("日期映射使用 UTC，保留日历日期及四位年份", () => {
  for (const value of ["0001-01-01", "2024-02-29", "2026-03-08", "2026-11-01", "9999-12-31"]) {
    const date = toDatabaseDate(value);
    assert.equal(date.toISOString(), `${value}T00:00:00.000Z`);
    assert.equal(fromDatabaseDate(date), value);
  }
});

test("日期映射拒绝非法日期，不做自动纠正", () => {
  for (const value of ["", "2026-02-30", "2026-13-01", "0000-01-01", "2026-1-1"]) {
    assert.throws(() => toDatabaseDate(value), (error: unknown) =>
      error instanceof DatabaseAccessError && error.code === "INVALID_INPUT");
  }
});

test("输入复用校验、清理空格，写入白名单排除 ID 与时间戳", () => {
  const input = { ...validInput, company: "  测试公司  ", notes: "  备注  ", id: "不可注入", createdAt: "不可注入", userId: "不可注入" };
  const data = toJobWriteData(input);
  assert.equal(data.company, "测试公司");
  assert.equal(data.notes, "备注");
  assert.ok(data.appliedAt instanceof Date);
  assert.equal("id" in data, false);
  assert.equal("createdAt" in data, false);
  assert.equal("updatedAt" in data, false);
  assert.equal("userId" in data, false);
});

test("无效 ID 与输入在访问数据库之前拒绝", async () => {
  let calls = 0;
  const repository = createJobRepository(() => { calls += 1; throw new Error("不应访问数据库"); }, testOwner);
  for (const operation of [
    () => repository.getJobById("invalid"),
    () => repository.updateJob("invalid", validInput),
    () => repository.deleteJob("invalid"),
  ]) {
    await assert.rejects(operation, (error: unknown) => error instanceof DatabaseAccessError && error.code === "INVALID_ID");
  }
  for (const input of [
    { ...validInput, company: "  " },
    { ...validInput, appliedAt: "2026-02-30" },
    { ...validInput, status: "invalid" as JobStatus },
    { ...validInput, notes: "x".repeat(2001) },
  ]) {
    await assert.rejects(() => repository.createJob(input), (error: unknown) =>
      error instanceof DatabaseAccessError && error.code === "INVALID_INPUT");
  }
  assert.equal(calls, 0);
});

test("底层敏感异常不会进入 Repository 返回的错误", async () => {
  const repository = createJobRepository(() => {
    throw new Error("DATABASE_URL=postgresql://private-user:FAKE_SECRET@private-host/private-db");
  }, testOwner);
  await assert.rejects(() => repository.getAllJobs(), (error: unknown) => {
    assert.ok(error instanceof DatabaseAccessError);
    assert.equal(error.code, "DATABASE_UNAVAILABLE");
    assert.equal(error.message, "数据库暂时不可用，请稍后重试。");
    assert.equal(error.cause, undefined);
    assert.doesNotMatch(String(error), /DATABASE_URL|postgresql|FAKE_SECRET|private-host/);
    return true;
  });
});
