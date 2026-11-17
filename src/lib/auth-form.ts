export type AuthMode = "sign-in" | "sign-up";
export interface AuthFormValues {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
}
export type AuthFormErrors = Partial<Record<keyof AuthFormValues, string>>;

// 与现有 Better Auth 邮箱密码配置的默认注册长度一致，密码不做 trim。
export const PASSWORD_LIMITS = { min: 8, max: 128 } as const;

export function validateAuthForm(mode: AuthMode, values: AuthFormValues): AuthFormErrors {
  const errors: AuthFormErrors = {};
  if (mode === "sign-up") {
    if (!values.name.trim()) errors.name = "请输入姓名。";
    else if (values.name.trim().length > 100) errors.name = "姓名不能超过 100 个字符。";
  }
  const email = values.email.trim();
  if (!email) errors.email = "请输入邮箱。";
  else if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = "请输入有效的邮箱地址。";

  if (!values.password) errors.password = "请输入密码。";
  else if (values.password.length > PASSWORD_LIMITS.max
    || (mode === "sign-up" && values.password.length < PASSWORD_LIMITS.min)) {
    errors.password = mode === "sign-up" ? "密码长度需为 8–128 个字符。" : "密码不能超过 128 个字符。";
  }
  if (mode === "sign-up") {
    if (!values.confirmPassword) errors.confirmPassword = "请再次输入密码。";
    else if (values.password !== values.confirmPassword) errors.confirmPassword = "两次输入的密码不一致。";
  }
  return errors;
}

/** 仅使用已知错误码和状态；绝不回显服务端 message、请求体或底层异常。 */
export function authErrorMessage(error: unknown, action: AuthMode | "sign-out"): string {
  const info = typeof error === "object" && error !== null ? error as { code?: unknown; status?: unknown } : {};
  const code = typeof info.code === "string" ? info.code : "";
  if (info.status === 429) return "操作过于频繁，请稍后再试。";
  if (typeof info.status === "number" && info.status >= 500) return "认证服务暂时不可用，请稍后重试。";
  if (action === "sign-in" && ["INVALID_EMAIL_OR_PASSWORD", "INVALID_PASSWORD", "USER_NOT_FOUND"].includes(code)) {
    return "邮箱或密码不正确，请重新输入。";
  }
  if (action === "sign-up" && ["USER_ALREADY_EXISTS", "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL"].includes(code)) {
    return "注册未完成，请检查输入，或尝试使用此邮箱登录。";
  }
  return action === "sign-out" ? "退出登录未完成，请重试。"
    : action === "sign-up" ? "注册未完成，请检查输入或稍后重试。" : "登录未完成，请检查输入或稍后重试。";
}

/** 固定站内目标，按实际会话结果导航，不接受客户端提供的任意跳转地址。 */
export function postAuthDestination(mode: AuthMode, hasSession: boolean): string | null {
  if (hasSession) return "/dashboard";
  return mode === "sign-up" ? "/sign-in?registered=1" : null;
}
