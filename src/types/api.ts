import type { Job } from "@/types/job";
import type { JobRecord } from "@/types/job-record";
import type { JobImportErrorCode } from "@/lib/job-import-error";

export interface HealthResponse {
  status: "ok";
  service: "jobflow";
}

export interface JobsResponse {
  data: Job[];
  /** 当前筛选结果的数量。 */
  total: number;
}

export interface ApiErrorResponse {
  error: {
    code: "INVALID_STATUS";
    message: string;
  };
}

export interface PersonalJobsResponse {
  data: JobRecord[];
  total: number;
}

export interface PersonalJobResponse {
  data: JobRecord;
}

export type JobApiErrorCode = JobImportErrorCode | "UNAUTHORIZED" | "FORBIDDEN_ORIGIN" | "INVALID_STATUS" | "INVALID_ID"
  | "INVALID_INPUT" | "INVALID_JSON" | "INVALID_CONTENT_TYPE" | "JOB_NOT_FOUND"
  | "AUTH_NOT_CONFIGURED" | "AUTH_MIGRATION_REQUIRED" | "AUTH_UNAVAILABLE"
  | "DATABASE_UNAVAILABLE" | "INTERNAL_ERROR";

export interface JobApiErrorResponse {
  error: { code: JobApiErrorCode; message: string };
}
