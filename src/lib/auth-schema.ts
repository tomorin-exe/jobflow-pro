import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { AuthError } from "@/lib/auth-error";
import { getPrisma } from "@/lib/prisma";

/** 只读元数据检查；不触发自动迁移，也不查询认证或岗位业务记录。 */
export async function isAuthSchemaReady(database: PrismaClient = getPrisma()): Promise<boolean> {
  try {
    const [result] = await database.$queryRaw<{ ready: boolean }[]>`
      SELECT (
        to_regclass('public.users') IS NOT NULL
        AND to_regclass('public.sessions') IS NOT NULL
        AND to_regclass('public.accounts') IS NOT NULL
        AND to_regclass('public.verifications') IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'jobs'
            AND column_name = 'userId' AND udt_name = 'uuid'
        )
      ) AS ready
    `;
    return result?.ready === true;
  } catch {
    throw new AuthError("AUTH_UNAVAILABLE");
  }
}

export async function requireAuthSchema(): Promise<void> {
  if (!await isAuthSchemaReady()) throw new AuthError("AUTH_MIGRATION_REQUIRED");
}
