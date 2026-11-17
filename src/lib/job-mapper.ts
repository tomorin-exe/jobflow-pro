import "server-only";
import type { Job as PrismaJob, Prisma } from "@/generated/prisma/client";
import { DatabaseAccessError } from "@/lib/database-error";
import { isCalendarDate, isJobStatus, normalizeJobInput, validateJobInput, validateJobPatchInput } from "@/lib/jobs";
import type { JobInput, JobPatchInput } from "@/types/job";
import type { JobRecord } from "@/types/job-record";

export function toDatabaseDate(value: string): Date {
  if (!isCalendarDate(value)) throw new DatabaseAccessError("INVALID_INPUT", "请选择有效的投递日期。");
  // 使用明确的 UTC 午夜；不用本地时区构造器 new Date(year, month, day)。
  return new Date(`${value}T00:00:00.000Z`);
}

export function fromDatabaseDate(value: Date): string {
  if (Number.isNaN(value.getTime())) throw new DatabaseAccessError("DATABASE_UNAVAILABLE");
  const date = value.toISOString().slice(0, 10);
  if (!isCalendarDate(date)) throw new DatabaseAccessError("DATABASE_UNAVAILABLE");
  return date;
}

export function toJobWriteData(input: JobInput): Pick<Prisma.JobUncheckedCreateInput, "company" | "position" | "location" | "status" | "appliedAt" | "notes"> {
  // 类型约束之外也校验运行时输入，但业务规则仍复用现有校验器。
  if (typeof input !== "object" || input === null
    || !(["company", "position", "location", "appliedAt", "notes"] as const).every((field) =>
      typeof input[field] === "string")
    || !isJobStatus(input.status)) {
    throw new DatabaseAccessError("INVALID_INPUT");
  }
  const firstError = Object.values(validateJobInput(input))[0];
  if (firstError) throw new DatabaseAccessError("INVALID_INPUT", firstError);
  const values = normalizeJobInput(input);
  // 显式白名单，不让运行时传入的额外 id、createdAt 等字段混入写入操作。
  return {
    company: values.company,
    position: values.position,
    location: values.location,
    status: values.status,
    appliedAt: toDatabaseDate(values.appliedAt),
    notes: values.notes,
  };
}

/** 仅输出实际提供的字段，使 PATCH 无需先读记录，也不会覆盖并发更新的其他字段。 */
export function toJobPatchWriteData(input: JobPatchInput): Partial<ReturnType<typeof toJobWriteData>> {
  const fields = ["company", "position", "location", "status", "appliedAt", "notes"] as const;
  if (typeof input !== "object" || input === null || Array.isArray(input)
    || !fields.some((field) => Object.hasOwn(input, field))
    || !fields.every((field) => !Object.hasOwn(input, field) || typeof input[field] === "string")) {
    throw new DatabaseAccessError("INVALID_INPUT");
  }
  const firstError = Object.values(validateJobPatchInput(input))[0];
  if (firstError) throw new DatabaseAccessError("INVALID_INPUT", firstError);
  const data: Partial<ReturnType<typeof toJobWriteData>> = {};
  for (const field of ["company", "position", "location", "notes"] as const) {
    const value = input[field];
    if (Object.hasOwn(input, field) && typeof value === "string") data[field] = value.trim();
  }
  if (Object.hasOwn(input, "status") && isJobStatus(input.status)) data.status = input.status;
  if (Object.hasOwn(input, "appliedAt") && typeof input.appliedAt === "string") data.appliedAt = toDatabaseDate(input.appliedAt);
  return data;
}

export function toJobRecord(job: PrismaJob): JobRecord {
  return {
    id: job.id,
    company: job.company,
    position: job.position,
    location: job.location,
    status: job.status,
    appliedAt: fromDatabaseDate(job.appliedAt),
    notes: job.notes,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}
