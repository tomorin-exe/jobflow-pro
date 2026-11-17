import "server-only";
import { betterAuth } from "better-auth/minimal";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import { emailOTP } from "better-auth/plugins/email-otp";
import { APIError, createAuthMiddleware } from "better-auth/api";
import type { PrismaClient } from "@/generated/prisma/client";
import { readAuthEnvironment } from "@/lib/auth-config";
import { getPrisma } from "@/lib/prisma";
import { sendOtpEmail, type OtpMail } from "@/lib/mail";
import { createOtpRateLimiter, type OtpRateLimiter } from "@/lib/otp-rate-limit";
import { createOtpPolicy } from "@/lib/otp-policy";

/** 可注入 Client 以离线验证真实 Adapter；生产入口只通过 getAuth() 调用。 */
export function createAuth(database: PrismaClient, { secret, baseURL }: ReturnType<typeof readAuthEnvironment>, dependencies: { sendMail?: (data: OtpMail) => Promise<void>; limiter?: OtpRateLimiter } = {}) {
  // 1.7.25 的 runInBackgroundOrAwait 会吞掉邮件异常。
  // 按 Request 标记并在 after hook 转成安全 503，不能使用跨请求的共享布尔值。
  const failedDeliveries = new WeakSet<Request>();
  const auth = betterAuth({
    appName: "JobFlow Pro",
    baseURL,
    basePath: "/api/auth",
    secret,
    trustedOrigins: [baseURL],
    // usePlural 保持默认 false，匹配 prisma.user/session/account/verification。
    database: prismaAdapter(database, { provider: "postgresql", transaction: true }),
    emailAndPassword: { enabled: true },
    session: { cookieCache: { enabled: false } },
    verification: { storeIdentifier: "hashed", disableCleanup: true },
    plugins: [emailOTP({
      otpLength: 6, expiresIn: 300, allowedAttempts: 3,
      storeOTP: "encrypted", resendStrategy: "rotate", sendVerificationOnSignUp: false,
      // 数据库限流始终生效；此项额外保留插件的请求级兜底。
      rateLimit: { window: 60, max: 120 },
      sendVerificationOTP: async (data, ctx) => {
        try { await (dependencies.sendMail ?? sendOtpEmail)(data); }
        catch {
          if (ctx?.request) failedDeliveries.add(ctx.request);
          else throw new Error("OTP delivery unavailable");
        }
      },
    })],
    hooks: {
      before: createOtpPolicy({ database, baseURL, limiter: dependencies.limiter ?? createOtpRateLimiter(database, secret), check: (email, otp) => checkOtp(email, otp), session: (headers) => getSession(headers) }),
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.request && failedDeliveries.delete(ctx.request)) throw new APIError("SERVICE_UNAVAILABLE", { code: "OTP_DELIVERY_FAILED", message: "验证码邮件暂时无法发送，请稍后重试。" });
      }),
    },
    emailVerification: { autoSignInAfterVerification: false, afterEmailVerification: async (user, request) => {
      const current = await getSession(request?.headers ?? new Headers());
      if (current?.user.id !== user.id) throw new Error("Email verification session required");
      await database.session.deleteMany({ where: { userId: user.id, id: { not: current.session.id } } });
    } },
    // PostgreSQL Adapter 在此策略下省略 ID；四张认证表必须有原生 UUID 默认值。
    advanced: { database: { generateId: "uuid" } },
    logger: { disabled: true },
  });
  const checkOtp: (email: string, otp: string) => Promise<unknown> = (email, otp) => auth.api.checkVerificationOTP({ body: { email, otp, type: "sign-in" } });
  const getSession: (headers: Headers) => Promise<{ user: { id: string; email: string }; session: { id: string; createdAt: Date | string } } | null> = (headers) => auth.api.getSession({ headers });
  return auth;
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
