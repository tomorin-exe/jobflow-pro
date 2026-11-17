"use client";

import Link from "next/link";
import { useId, useRef, useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage, postAuthDestination, validateAuthForm, type AuthFormErrors, type AuthFormValues, type AuthMode } from "@/lib/auth-form";

const inputClassName = "mt-2 w-full rounded-lg border border-line bg-[#fafbf9] px-3 py-3 text-base text-primary aria-invalid:border-red-400 focus:border-brand focus:bg-white sm:text-sm";

export function AuthForm({ mode }: { mode: AuthMode }) {
  const isSignUp = mode === "sign-up";
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const submitting = useRef(false);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<AuthFormErrors>({});
  const [notice, setNotice] = useState<string | null>(null);
  const fields: { name: keyof AuthFormValues; label: string; type: string; autoComplete: string; maxLength: number }[] = [
    ...(isSignUp ? [{ name: "name" as const, label: "姓名", type: "text", autoComplete: "name", maxLength: 100 }] : []),
    { name: "email", label: "邮箱", type: "email", autoComplete: "email", maxLength: 254 },
    { name: "password", label: "密码", type: "password", autoComplete: isSignUp ? "new-password" : "current-password", maxLength: 128 },
    ...(isSignUp ? [{ name: "confirmPassword" as const, label: "确认密码", type: "password", autoComplete: "new-password", maxLength: 128 }] : []),
  ];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const form = new FormData(event.currentTarget);
    const value = (field: keyof AuthFormValues) => String(form.get(field) ?? "");
    const values: AuthFormValues = { name: value("name"), email: value("email"), password: value("password"), confirmPassword: value("confirmPassword") };
    const nextErrors = validateAuthForm(mode, values);
    setErrors(nextErrors);
    setNotice(null);
    const firstInvalid = Object.keys(nextErrors)[0];
    if (firstInvalid) {
      formRef.current?.querySelector<HTMLInputElement>(`[name="${firstInvalid}"]`)?.focus();
      return;
    }
    submitting.current = true;
    setPending(true);
    try {
      const credentials = { email: values.email.trim(), password: values.password };
      const result = isSignUp
        ? await authClient.signUp.email({ ...credentials, name: values.name.trim() })
        : await authClient.signIn.email(credentials);
      if (result.error) {
        setNotice(authErrorMessage(result.error, mode));
        return;
      }
      // 成功响应不等于浏览器已有有效会话；再经官方客户端确认 Cookie 已生效。
      const session = await authClient.getSession({ fetchOptions: { cache: "no-store" } });
      if (session.error) {
        setNotice(isSignUp ? "注册请求已完成，暂时无法确认登录状态。请尝试登录。" : "暂时无法确认登录状态，请稍后重试。");
        return;
      }
      const destination = postAuthDestination(mode, Boolean(session.data?.session && session.data.user));
      if (!destination) {
        setNotice("登录状态未生效，请检查浏览器是否允许 Cookie，然后重试。");
        return;
      }
      formRef.current?.reset();
      // 完整导航重新经过服务端校验，避免沿用认证前的 Router 缓存。
      window.location.replace(destination);
    } catch {
      setNotice("暂时无法完成认证，请检查网络连接后重试。");
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <form ref={formRef} noValidate onSubmit={submit} aria-busy={pending}>
      <h2 className="text-lg font-semibold">{isSignUp ? "创建账号" : "登录账号"}</h2>
      <p className="mt-2 text-xs leading-6 text-secondary">{isSignUp ? "开启属于你的求职工作空间。" : "欢迎回来，继续下一步。"}</p>
      {notice && <p role="alert" className="mt-5 rounded-lg bg-red-50 p-3 text-sm leading-6 text-red-700">{notice}</p>}
      <fieldset disabled={pending} className="mt-6 space-y-4">
        <legend className="sr-only">{isSignUp ? "注册信息" : "登录信息"}</legend>
        {fields.map((field) => (
          <div key={field.name}>
            <label htmlFor={`${id}-${field.name}`} className="text-xs font-medium">{field.label}</label>
            <input
              id={`${id}-${field.name}`} name={field.name} type={field.type} autoComplete={field.autoComplete}
              required maxLength={field.maxLength} autoCapitalize={field.name === "email" ? "none" : undefined}
              spellCheck={field.name === "email" ? false : undefined}
              aria-invalid={Boolean(errors[field.name])}
              aria-describedby={errors[field.name] ? `${id}-${field.name}-error` : isSignUp && field.name === "password" ? `${id}-password-hint` : undefined}
              onChange={() => { setErrors((current) => ({ ...current, [field.name]: undefined })); setNotice(null); }}
              className={inputClassName}
            />
            {errors[field.name] && <p id={`${id}-${field.name}-error`} className="mt-1.5 text-xs text-red-700">{errors[field.name]}</p>}
            {isSignUp && field.name === "password" && !errors.password && <p id={`${id}-password-hint`} className="mt-1.5 text-[11px] text-muted">密码长度为 8–128 个字符。</p>}
          </div>
        ))}
        <button type="submit" disabled={pending} className="mt-2 flex min-h-11 w-full items-center justify-center rounded-lg bg-brand px-4 py-3 text-sm font-medium text-white hover:bg-[#1d6244]">
          {pending ? (isSignUp ? "正在注册…" : "正在登录…") : (isSignUp ? "注册账号" : "登录")}
        </button>
      </fieldset>
      <p role="status" className="mt-3 min-h-5 text-center text-xs text-secondary">{pending ? "正在安全处理，请稍候。" : ""}</p>
      <p className="mt-3 text-center text-xs text-secondary">
        {isSignUp ? "已有账号？" : "还没有账号？"}{" "}
        <Link href={isSignUp ? "/sign-in" : "/sign-up"} className="font-medium text-brand hover:underline">{isSignUp ? "前往登录" : "创建账号"}</Link>
      </p>
    </form>
  );
}
