export const JOB_STATUSES = [
  "applied",
  "interviewing",
  "offered",
  "rejected",
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];
export type JobStatusFilter = JobStatus | "all";

export interface Job {
  id: string;
  company: string;
  position: string;
  location: string;
  status: JobStatus;
  /** 不含时区的日历日期，格式为 YYYY-MM-DD。 */
  appliedAt: string;
  notes: string;
}

// 表单不接收 ID，避免编辑岗位时意外改变记录身份。
export type JobInput = Omit<Job, "id">;
export type JobFieldErrors = Partial<Record<keyof JobInput, string>>;
export type JobMutationResult = { ok: true } | { ok: false; error: string };
