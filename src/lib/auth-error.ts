import "server-only";

export type AuthErrorCode = "UNAUTHORIZED" | "AUTH_NOT_CONFIGURED" | "AUTH_MIGRATION_REQUIRED" | "AUTH_UNAVAILABLE";
const messages: Record<AuthErrorCode, string> = {
  UNAUTHORIZED: "请先登录后再访问岗位数据。",
  AUTH_NOT_CONFIGURED: "认证服务尚未完成配置。",
  AUTH_MIGRATION_REQUIRED: "认证数据库迁移尚未完成。",
  AUTH_UNAVAILABLE: "认证服务暂时不可用，请稍后重试。",
};

export class AuthError extends Error {
  readonly code: AuthErrorCode;
  readonly status: number;

  constructor(code: AuthErrorCode) {
    super(messages[code]);
    this.name = "AuthError";
    this.code = code;
    this.status = code === "UNAUTHORIZED" ? 401 : 503;
  }
}

export function safeAuthError(error: unknown): AuthError {
  return error instanceof AuthError ? error : new AuthError("AUTH_UNAVAILABLE");
}
