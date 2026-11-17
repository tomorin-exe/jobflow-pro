import "server-only";
import { APIError, createAuthMiddleware } from "better-auth/api";
import type { PrismaClient } from "@/generated/prisma/client";
import { OtpRateLimitError, type OtpRateLimiter } from "@/lib/otp-rate-limit";

type Session = { user: { id: string; email: string }; session: { id: string; createdAt: Date | string } };
type Dependencies = {
  database: PrismaClient; baseURL: string; limiter: OtpRateLimiter;
  check: (email: string, otp: string) => Promise<unknown>;
  session: (headers: Headers) => Promise<Session | null>;
};
const sendPath = "/email-otp/send-verification-otp";
const signInPath = "/sign-in/email-otp";
const verifyPath = "/email-otp/verify-email";
const checkPath = "/email-otp/check-verification-otp";
export function createOtpPolicy({ database, baseURL, limiter, check, session }: Dependencies) {
  return createAuthMiddleware(async (ctx) => {
    if (!ctx.path?.startsWith("/email-otp/") && ctx.path !== signInPath) return;
    if (![sendPath, signInPath, verifyPath, checkPath].includes(ctx.path)) throw new APIError("NOT_FOUND", { code: "OTP_ACTION_DISABLED", message: "未开放该验证码操作。" });
    // Server API 调用也走同一业务校验；HTTP 调用额外要求固定来源。
    if (ctx.request && (ctx.headers?.get("origin") !== baseURL || ctx.headers?.get("sec-fetch-site") === "cross-site")) throw new APIError("FORBIDDEN", { code: "INVALID_ORIGIN", message: "请求来源不可信。" });
    const raw: unknown = ctx.body?.email;
    if (typeof raw !== "string" || raw.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) throw new APIError("BAD_REQUEST", { code: "INVALID_EMAIL", message: "邮箱格式不正确。" });
    const email = raw.toLowerCase();
    if ((ctx.path === sendPath || ctx.path === checkPath) && !["sign-in", "email-verification"].includes(ctx.body?.type)) throw new APIError("BAD_REQUEST", { code: "OTP_ACTION_DISABLED", message: "未开放该验证码用途。" });
    if (ctx.path === verifyPath || ([sendPath, checkPath].includes(ctx.path) && ctx.body.type === "email-verification")) {
      const current = await session(ctx.headers ?? new Headers());
      if (!current || current.user.email.toLowerCase() !== email) throw new APIError("UNAUTHORIZED", { code: "UNAUTHORIZED", message: "请先用原密码登录该账号。" });
      if (Date.now() - new Date(current.session.createdAt).getTime() > 5 * 60 * 1000) throw new APIError("FORBIDDEN", { code: "SESSION_NOT_FRESH", message: "请重新登录后验证邮箱。" });
    }
    try { await limiter.consume(email, ctx.path === sendPath ? "send" : "attempt"); }
    catch (error) {
      if (error instanceof OtpRateLimitError) {
        throw new APIError("TOO_MANY_REQUESTS", { code: "OTP_RATE_LIMITED", message: "验证码操作过于频繁，请稍后重试。" }, { "Retry-After": String(error.retryAfter) });
      }
      throw new APIError("SERVICE_UNAVAILABLE", { code: "AUTH_UNAVAILABLE", message: "认证服务暂时不可用。" });
    }
    if (ctx.path !== sendPath && (typeof ctx.body?.otp !== "string" || !/^\d{6}$/.test(ctx.body.otp))) throw new APIError("BAD_REQUEST", { code: "INVALID_OTP", message: "请输入6位数字验证码。" });
    if (ctx.path === signInPath) {
      if (ctx.body.name !== undefined && (typeof ctx.body.name !== "string" || !ctx.body.name.trim() || ctx.body.name.trim().length > 100)) throw new APIError("BAD_REQUEST", { code: "INVALID_NAME", message: "姓名需为1至100个字符。" });
      ctx.body.name = typeof ctx.body.name === "string" ? ctx.body.name.trim() : "求职者";
      const legacy = await database.user.findUnique({ where: { email }, select: { emailVerified: true, accounts: { where: { providerId: "credential", password: { not: null } }, select: { id: true } } } });
      if (legacy && !legacy.emailVerified && legacy.accounts.length) {
        // 官方 1.7.25 直接登录会清除未验证账号的密码/会话。
        // 先用官方方法验证 OTP，只有证明掌控邮箱后才提示兼容流程，避免账号枚举。
        await check(email, ctx.body.otp);
        throw new APIError("FORBIDDEN", { code: "PASSWORD_ACCOUNT_VERIFICATION_REQUIRED", message: "请先用原密码登录并验证邮箱，再使用验证码登录。" });
      }
    }
  });
}
