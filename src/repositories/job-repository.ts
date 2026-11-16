import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { DatabaseAccessError, withDatabaseErrors } from "@/lib/database-error";
import { toJobRecord, toJobWriteData } from "@/lib/job-mapper";
import { getPrisma } from "@/lib/prisma";
import type { JobInput } from "@/types/job";
import type { JobRecord } from "@/types/job-record";

type JobDatabase = Pick<Prisma.TransactionClient, "job">;

function validateId(id: string) {
  if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new DatabaseAccessError("INVALID_ID");
  }
}

function isNotFound(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025";
}

/** 可注入事务 Client，使集成测试使用相同业务逻辑并安全回滚。 */
export function createJobRepository(getDatabase: () => JobDatabase = getPrisma) {
  return {
    getAllJobs(): Promise<JobRecord[]> {
      return withDatabaseErrors(async () => {
        const jobs = await getDatabase().job.findMany({ orderBy: [{ appliedAt: "desc" }, { id: "asc" }] });
        return jobs.map(toJobRecord);
      });
    },

    getJobById(id: string): Promise<JobRecord | null> {
      return withDatabaseErrors(async () => {
        validateId(id);
        const job = await getDatabase().job.findUnique({ where: { id } });
        return job ? toJobRecord(job) : null;
      });
    },

    createJob(input: JobInput): Promise<JobRecord> {
      return withDatabaseErrors(async () => {
        const data = toJobWriteData(input);
        return toJobRecord(await getDatabase().job.create({ data }));
      });
    },

    updateJob(id: string, input: JobInput): Promise<JobRecord | null> {
      return withDatabaseErrors(async () => {
        validateId(id);
        const data = toJobWriteData(input);
        try {
          return toJobRecord(await getDatabase().job.update({ where: { id }, data }));
        } catch (error) {
          if (isNotFound(error)) return null;
          throw error;
        }
      });
    },

    deleteJob(id: string): Promise<JobRecord | null> {
      return withDatabaseErrors(async () => {
        validateId(id);
        try {
          return toJobRecord(await getDatabase().job.delete({ where: { id } }));
        } catch (error) {
          if (isNotFound(error)) return null;
          throw error;
        }
      });
    },
  };
}

// 默认入口延迟获取单例；导入 Repository 不会主动连接数据库。
export const { getAllJobs, getJobById, createJob, updateJob, deleteJob } = createJobRepository();
