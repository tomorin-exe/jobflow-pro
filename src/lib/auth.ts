import "server-only";
import { betterAuth } from "better-auth/minimal";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import type { PrismaClient } from "@/generated/prisma/client";
import { readAuthEnvironment } from "@/lib/auth-config";
import { getPrisma } from "@/lib/prisma";

/** 可注入 Client 以离线验证真实 Adapter；生产入口只通过 getAuth() 调用。 */
export function createAuth(database: PrismaClient, { secret, baseURL }: ReturnType<typeof readAuthEnvironment>) {
  return betterAuth({
    appName: "JobFlow Pro",
    baseURL,
    basePath: "/api/auth",
    secret,
    trustedOrigins: [baseURL],
    // usePlural 保持默认 false，匹配 prisma.user/session/account/verification。
    database: prismaAdapter(database, { provider: "postgresql" }),
    emailAndPassword: { enabled: true },
    session: { cookieCache: { enabled: false } },
    // PostgreSQL Adapter 在此策略下省略 ID；四张认证表必须有原生 UUID 默认值。
    advanced: { database: { generateId: "uuid" } },
    logger: { disabled: true },
  });
}

let instance: ReturnType<typeof createAuth> | undefined;

/** 延迟初始化，build 和模拟 API 不要求认证密钥，也不会自动访问新表。 */
export function getAuth() {
  if (!instance) {
    const environment = readAuthEnvironment();
    instance = createAuth(getPrisma(), environment);
  }
  return instance;
}
