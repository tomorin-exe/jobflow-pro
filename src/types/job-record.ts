import type { Job } from "@/types/job";

/** 可 JSON 序列化的数据库岗位，兼容现有 Job，并附带 ISO 时间戳。 */
export interface JobRecord extends Job {
  createdAt: string;
  updatedAt: string;
}
