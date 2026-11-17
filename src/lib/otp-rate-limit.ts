import "server-only";
import { createHmac } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";

export class OtpRateLimitError extends Error {
  constructor(readonly retryAfter: number) { super("验证码操作过于频繁，请稍后重试。"); }
}
export const OTP_RATE_PREFIX = "jobflow-otp-limit-v1:";
type Action = "send" | "attempt";
export interface OtpRateLimiter { consume: (email: string, action: Action) => Promise<void> }
/** Verification 的独立命名空间只存限流元数据，不保存验证码或原始邮箱。
 * advisory lock 保证跨进程检查/计数原子性；邮件发送在锁外。
 */
export function createOtpRateLimiter(database: PrismaClient, secret: string, options: { namespace?: string; now?: () => number } = {}): OtpRateLimiter {
  const namespace = options.namespace ?? OTP_RATE_PREFIX;
  const now = options.now ?? Date.now;
  return { async consume(email, action) {
    const subject = createHmac("sha256", secret).update(email.toLowerCase()).digest("hex");
    const rules = action === "send" ? [
      { key: "send-global-minute", max: 10, seconds: 60 },
      { key: "send-global-hour", max: 60, seconds: 3600 },
      { key: `send-email-minute:${subject}`, max: 1, seconds: 60 },
      { key: `send-email-hour:${subject}`, max: 5, seconds: 3600 },
    ] : [
      { key: "attempt-global-minute", max: 120, seconds: 60 },
      { key: `attempt-email:${subject}`, max: 10, seconds: 900 },
    ];
    await database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${namespace}, 0))`;
      const time = now();
      const rows = await tx.verification.findMany({ where: { identifier: { in: rules.map((rule) => namespace + rule.key) } } });
      const updates = rules.map((rule) => {
        const matches = rows.filter((row) => row.identifier === namespace + rule.key);
        if (matches.length > 1) throw new Error("Invalid limiter state");
        const row = matches[0];
        const value: unknown = row && row.expiresAt.getTime() > time ? JSON.parse(row.value) : 0;
        if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("Invalid limiter state");
        return { rule, row, count: value, expiresAt: row && row.expiresAt.getTime() > time ? row.expiresAt : new Date(time + rule.seconds * 1000) };
      });
      const retryAfter = Math.max(0, ...updates.filter(({ rule, count }) => count >= rule.max).map(({ expiresAt }) => Math.ceil((expiresAt.getTime() - time) / 1000)));
      if (retryAfter) throw new OtpRateLimitError(retryAfter);
      for (const { rule, row, count, expiresAt } of updates) {
        const data = { identifier: namespace + rule.key, value: JSON.stringify(count + 1), expiresAt };
        if (row) await tx.verification.update({ where: { id: row.id }, data });
        else await tx.verification.create({ data });
      }
    }, { maxWait: 5000, timeout: 10000 });
  } };
}
