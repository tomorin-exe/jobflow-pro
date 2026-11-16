import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { DatabaseAccessError, withDatabaseErrors } from "@/lib/database-error";
import { toJobRecord, toJobWriteData } from "@/lib/job-mapper";
import { getPrisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/session";
import { AuthError } from "@/lib/auth-error";
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

/** 默认信任服务端 Session；注入解析函数只供可信服务端测试，绝不能接收客户端 userId。 */
export function createJobRepository(getDatabase: () => JobDatabase = getPrisma, resolveUserId: () => Promise<string> = requireUserId) {
  async function owner() {
    const id = await resolveUserId();
    if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      throw new AuthError("UNAUTHORIZED");
    }
    return id;
  }
  return {
    async getAllJobs(): Promise<JobRecord[]> {
      const userId = await owner();
      return withDatabaseErrors(async () => {
        const jobs = await getDatabase().job.findMany({ where: { userId }, orderBy: [{ appliedAt: "desc" }, { id: "asc" }] });
        return jobs.map(toJobRecord);
      });
    },

    async getJobById(id: string): Promise<JobRecord | null> {
      const userId = await owner();
      return withDatabaseErrors(async () => {
        validateId(id);
        const job = await getDatabase().job.findUnique({ where: { id, userId } });
        return job ? toJobRecord(job) : null;
      });
    },

    async createJob(input: JobInput): Promise<JobRecord> {
      const userId = await owner();
      return withDatabaseErrors(async () => {
        const data = toJobWriteData(input);
        return toJobRecord(await getDatabase().job.create({ data: { ...data, userId } }));
      });
    },

    async updateJob(id: string, input: JobInput): Promise<JobRecord | null> {
      const userId = await owner();
      return withDatabaseErrors(async () => {
        validateId(id);
        const data = toJobWriteData(input);
        try {
          return toJobRecord(await getDatabase().job.update({ where: { id, userId }, data }));
        } catch (error) {
          if (isNotFound(error)) return null;
          throw error;
        }
      });
    },

    async deleteJob(id: string): Promise<JobRecord | null> {
      const userId = await owner();
      return withDatabaseErrors(async () => {
        validateId(id);
        try {
          return toJobRecord(await getDatabase().job.delete({ where: { id, userId } }));
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
