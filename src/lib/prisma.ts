import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { DatabaseAccessError, withDatabaseErrors } from "@/lib/database-error";

const globalForPrisma = globalThis as unknown as { jobflowPrisma?: PrismaClient };
let client: PrismaClient | undefined;

/** 仅服务端可用；首次使用时初始化，导入模块本身不会连接数据库。 */
export function getPrisma(): PrismaClient {
  const existing = globalForPrisma.jobflowPrisma ?? client;
  if (existing) return existing;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new DatabaseAccessError("CONFIGURATION_ERROR");

  let url: URL;
  let username: string;
  try {
    url = new URL(connectionString);
    username = decodeURIComponent(url.username);
  } catch {
    throw new DatabaseAccessError("CONFIGURATION_ERROR");
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new DatabaseAccessError("CONFIGURATION_ERROR");
  }
  if (username === "postgres") {
    throw new DatabaseAccessError("CONFIGURATION_ERROR");
  }

  try {
    client = new PrismaClient({
      adapter: new PrismaPg({ connectionString, connectionTimeoutMillis: 5000, max: 5 }),
      log: [],
      errorFormat: "minimal",
    });
  } catch {
    throw new DatabaseAccessError("DATABASE_UNAVAILABLE");
  }
  // 开发模式下跨热更新复用实例，避免反复创建连接池。
  if (process.env.NODE_ENV !== "production") globalForPrisma.jobflowPrisma = client;
  return client;
}

/** 仅供独立脚本收尾或服务关闭使用，不应在每次请求后断开连接。 */
export async function disconnectPrisma(): Promise<void> {
  const existing = globalForPrisma.jobflowPrisma ?? client;
  client = undefined;
  delete globalForPrisma.jobflowPrisma;
  if (existing) await withDatabaseErrors(() => existing.$disconnect());
}
