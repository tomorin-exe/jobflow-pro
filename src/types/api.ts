import type { Job } from "@/types/job";

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
