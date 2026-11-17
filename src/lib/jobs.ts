import { JOB_STATUSES, type Job, type JobFieldErrors, type JobInput, type JobPatchInput, type JobStatus } from "@/types/job";

export const JOB_FIELD_LIMITS = { company: 100, position: 100, location: 100, notes: 2000 } as const;

export function isJobStatus(value: unknown): value is JobStatus {
  return typeof value === "string" && JOB_STATUSES.some((status) => status === value);
}

export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-")) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function normalizeJobInput<T>(input: Omit<JobInput, "status"> & { status: T }): Omit<JobInput, "status"> & { status: T } {
  return {
    company: input.company.trim(),
    position: input.position.trim(),
    location: input.location.trim(),
    status: input.status,
    appliedAt: input.appliedAt,
    notes: input.notes.trim(),
  };
}

function validateJobFields(input: Omit<JobPatchInput, "status"> & { status?: unknown }, partial: boolean): JobFieldErrors {
  const errors: JobFieldErrors = {};
  const requiredFields = { company: "公司名称", position: "职位名称", location: "工作地点" } as const;

  for (const field of ["company", "position", "location"] as const) {
    if (partial && !Object.hasOwn(input, field)) continue;
    const value = input[field];
    if (typeof value !== "string" || !value.trim()) errors[field] = `请填写${requiredFields[field]}`;
    else if (value.trim().length > JOB_FIELD_LIMITS[field]) errors[field] = `${requiredFields[field]}最多 ${JOB_FIELD_LIMITS[field]} 个字符`;
  }
  if ((!partial || Object.hasOwn(input, "status")) && !isJobStatus(input.status)) errors.status = "请选择有效的投递状态";
  if (!partial || Object.hasOwn(input, "appliedAt")) {
    if (!input.appliedAt) errors.appliedAt = "请选择投递日期";
    else if (!isCalendarDate(input.appliedAt)) errors.appliedAt = "请填写有效日期，格式为 YYYY-MM-DD";
  }
  if (!partial || Object.hasOwn(input, "notes")) {
    if (typeof input.notes !== "string") errors.notes = "备注格式不正确";
    else if (input.notes.length > JOB_FIELD_LIMITS.notes) errors.notes = `备注最多 ${JOB_FIELD_LIMITS.notes} 个字符`;
  }
  return errors;
}

export function validateJobInput(input: Omit<JobInput, "status"> & { status: unknown }): JobFieldErrors {
  return validateJobFields(input, false);
}

export function validateJobPatchInput(input: JobPatchInput): JobFieldErrors {
  return validateJobFields(input, true);
}

// JSON.parse 的结果是 unknown：TypeScript 类型不会自动校验浏览器里的数据。
export function isJob(value: unknown): value is Job {
  if (typeof value !== "object" || value === null) return false;
  if (!("id" in value) || typeof value.id !== "string" || !value.id.trim()) return false;
  if (!("company" in value) || typeof value.company !== "string") return false;
  if (!("position" in value) || typeof value.position !== "string") return false;
  if (!("location" in value) || typeof value.location !== "string") return false;
  if (!("status" in value) || !isJobStatus(value.status)) return false;
  if (!("appliedAt" in value) || typeof value.appliedAt !== "string") return false;
  if (!("notes" in value) || typeof value.notes !== "string") return false;
  return Object.keys(validateJobInput({
    company: value.company,
    position: value.position,
    location: value.location,
    status: value.status,
    appliedAt: value.appliedAt,
    notes: value.notes,
  })).length === 0;
}

function validatedInput(input: JobInput): JobInput {
  const errors = validateJobInput(input);
  const error = Object.values(errors)[0];
  if (error) throw new Error(error);
  return normalizeJobInput(input);
}

// 纯函数只返回新数组，既不修改原数据，也不读写浏览器存储。
export function addJob(jobs: readonly Job[], input: JobInput, id: string): Job[] {
  if (!id.trim() || jobs.some((job) => job.id === id)) throw new Error("岗位 ID 重复，请重新提交。");
  return [{ id, ...validatedInput(input) }, ...jobs];
}

export function updateJob(jobs: readonly Job[], id: string, input: JobInput): Job[] {
  if (!jobs.some((job) => job.id === id)) throw new Error("该岗位已不存在，请关闭弹窗后重试。");
  const values = validatedInput(input);
  return jobs.map((job) => job.id === id ? { id: job.id, ...values } : job);
}

export function removeJob(jobs: readonly Job[], id: string): Job[] {
  if (!jobs.some((job) => job.id === id)) throw new Error("该岗位已不存在，请关闭弹窗后重试。");
  return jobs.filter((job) => job.id !== id);
}
