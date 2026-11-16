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
}
