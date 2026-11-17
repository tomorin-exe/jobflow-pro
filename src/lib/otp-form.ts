export type OtpMode = "sign-in" | "sign-up" | "verify-email";
export type OtpValues = { name: string; email: string; otp: string };
export type OtpErrors = Partial<Record<keyof OtpValues, string>>;
export function validateOtpForm(mode: OtpMode, values: OtpValues, requireCode: boolean): OtpErrors {
  const errors: OtpErrors = {};
  if (mode === "sign-up" && (!values.name.trim() || values.name.trim().length > 100)) errors.name = "请输入1至100个字符的姓名。";
  const email = values.email.trim();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = "请输入有效的邮箱地址。";
  if (requireCode && !/^\d{6}$/.test(values.otp)) errors.otp = "请输入6位数字验证码。";
  return errors;
}
export function otpErrorMessage(error: unknown): string {
  const value = typeof error === "object" && error !== null ? error as { code?: unknown; status?: unknown } : {};
  if (value.status === 429 || value.code === "OTP_RATE_LIMITED") return "验证码操作过于频繁，请等待倒计时结束后重试。";
  if (value.code === "PASSWORD_ACCOUNT_VERIFICATION_REQUIRED") return "此邮箱已有未验证的密码账号。请先用原密码登录，在工作空间验证邮箱后再使用验证码登录；原密码会保留。";
  if (value.code === "SESSION_NOT_FRESH") return "请先退出并重新用原密码登录，再验证邮箱。";
  if (value.code === "UNAUTHORIZED" || value.status === 401) return "登录状态已失效，请先登录该账号。";
  if (value.code === "TOO_MANY_ATTEMPTS") return "该验证码已达到3次尝试上限，请等待后重新发送。";
  if (["INVALID_OTP", "OTP_EXPIRED"].includes(String(value.code))) return "验证码不正确、已过期或已使用，请使用最新邮件中的验证码。";
  if (value.status === 403 && value.code === "INVALID_ORIGIN") return "请求来源校验未通过，请使用正确的应用地址。";
  if (typeof value.status === "number" && value.status >= 500) return "验证码服务暂时不可用，请稍后重试。";
  return "验证码操作未完成，请检查输入或网络后重试。";
}
export function otpCountdown(deadline: number, now: number): number { return Math.max(0, Math.ceil((deadline - now) / 1000)); }
