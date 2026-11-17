"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { otpCountdown, otpErrorMessage, validateOtpForm, type OtpErrors, type OtpMode, type OtpValues } from "@/lib/otp-form";

const inputClass = "mt-2 w-full rounded-lg border border-line bg-[#fafbf9] px-3 py-3 text-base aria-invalid:border-red-400 focus:border-brand sm:text-sm";
export function EmailOtpForm({ mode, email = "" }: { mode: OtpMode; email?: string }) {
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);
  const [values, setValues] = useState<OtpValues>({ name: "", email, otp: "" });
  const [errors, setErrors] = useState<OtpErrors>({});
  const [notice, setNotice] = useState("");
  const [problem, setProblem] = useState("");
  const [sent, setSent] = useState(false);
  const [deadline, setDeadline] = useState(0);
  const [clock, setClock] = useState(0);
  useEffect(() => { const timer = window.setInterval(() => setClock(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const seconds = otpCountdown(deadline, clock);
  function validate(requireCode: boolean) {
    const next = validateOtpForm(mode, values, requireCode); setErrors(next); setProblem("");
    const first = Object.keys(next)[0];
    if (first) form.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
    return !first;
  }
  function change(field: keyof OtpValues, value: string) { setValues((current) => ({ ...current, [field]: value })); setErrors((current) => ({ ...current, [field]: undefined })); setProblem(""); }
  function retryAfter(response: Response) {
    if (response.status !== 429) return;
    const value = Number(response.headers.get("retry-after"));
    const seconds = Number.isFinite(value) && value > 0 ? Math.min(value, 3600) : 60;
    setClock(Date.now()); setDeadline(Date.now() + seconds * 1000);
  }
  async function send() {
    if (locked.current || seconds || !validate(false)) return;
    locked.current = true; setBusy(true); setNotice("");
    try {
      const result = await authClient.emailOtp.sendVerificationOtp({ email: values.email.trim().toLowerCase(), type: mode === "verify-email" ? "email-verification" : "sign-in", fetchOptions: { onError: ({ response }) => retryAfter(response) } });
      if (result.error) { setProblem(otpErrorMessage(result.error)); return; }
      setSent(true); setClock(Date.now()); setDeadline(Date.now() + 60000); setValues((current) => ({ ...current, otp: "" }));
      setNotice("验证码请求已受理，请检查收件箱及垃圾邮件。验证码5分钟有效，以最新邮件为准。");
      form.current?.querySelector<HTMLInputElement>('[name="otp"]')?.focus();
    } catch { setProblem(otpErrorMessage(null)); }
    finally { locked.current = false; setBusy(false); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (locked.current || !validate(true)) return;
    locked.current = true; setBusy(true); setNotice("");
    try {
      const credentials = { email: values.email.trim().toLowerCase(), otp: values.otp, fetchOptions: { onError: ({ response }: { response: Response }) => retryAfter(response) } };
      const result = mode === "verify-email" ? await authClient.emailOtp.verifyEmail(credentials)
        : await authClient.signIn.emailOtp({ ...credentials, ...(mode === "sign-up" ? { name: values.name.trim() } : {}) });
      if (result.error) { setProblem(otpErrorMessage(result.error)); return; }
      const current = await authClient.getSession({ fetchOptions: { cache: "no-store" } });
      if (current.error || !current.data?.session || !current.data.user.emailVerified) { setProblem("暂时无法确认登录状态，请稍后重试；请确认浏览器允许 Cookie。"); return; }
      setValues((previous) => ({ ...previous, otp: "" }));
      window.location.replace("/dashboard");
    } catch { setProblem(otpErrorMessage(null)); }
    finally { locked.current = false; setBusy(false); }
  }
  return <form ref={form} noValidate onSubmit={submit} aria-busy={busy}>
    <h2 className="text-lg font-semibold">{mode === "verify-email" ? "验证当前邮箱" : mode === "sign-up" ? "验证码注册" : "验证码登录"}</h2>
    <p className="mt-2 text-xs leading-6 text-secondary">{mode === "verify-email" ? "完成验证后可使用验证码登录，原密码保留，其他旧会话将退出。" : "首次验证新邮箱将创建账号，已有账号验证后登录。"}</p>
    {problem && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-xs leading-6 text-red-700">{problem}</p>}
    {notice && <p role="status" className="mt-4 rounded-lg bg-brand-light p-3 text-xs leading-6 text-brand">{notice}</p>}
    <fieldset disabled={busy} className="mt-5 space-y-4">
      <legend className="sr-only">邮箱验证码信息</legend>
      {mode === "sign-up" && <div><label htmlFor={`${id}-name`} className="text-xs font-medium">姓名</label><input id={`${id}-name`} name="name" autoComplete="name" value={values.name} maxLength={100} onChange={(event) => change("name", event.target.value)} aria-invalid={!!errors.name} aria-describedby={`${id}-name-error`} className={inputClass} /><p id={`${id}-name-error`} className="mt-1 text-xs text-red-700">{errors.name}</p></div>}
      <div><label htmlFor={`${id}-email`} className="text-xs font-medium">邮箱</label><input id={`${id}-email`} name="email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} value={values.email} readOnly={mode === "verify-email" || sent} maxLength={254} onChange={(event) => change("email", event.target.value)} aria-invalid={!!errors.email} aria-describedby={`${id}-email-error`} className={inputClass} /><p id={`${id}-email-error`} className="mt-1 text-xs text-red-700">{errors.email}</p></div>
      {sent && mode !== "verify-email" && <button type="button" onClick={() => { setSent(false); change("otp", ""); setNotice(""); }} className="text-xs text-brand underline">更换邮箱</button>}
      <div><label htmlFor={`${id}-otp`} className="text-xs font-medium">验证码</label><div className="flex items-start gap-2"><input id={`${id}-otp`} name="otp" inputMode="numeric" autoComplete="one-time-code" value={values.otp} maxLength={6} onChange={(event) => change("otp", event.target.value)} aria-invalid={!!errors.otp} aria-describedby={`${id}-otp-error`} className={`${inputClass} min-w-0 flex-1 font-mono tracking-[0.2em]`} /><button type="button" onClick={() => { void send(); }} disabled={busy || seconds > 0} className="mt-2 min-h-12 shrink-0 rounded-lg border border-line px-3 text-xs text-brand disabled:opacity-50">{seconds ? `${seconds} 秒后重发` : sent ? "重新发送" : "发送验证码"}</button></div><p id={`${id}-otp-error`} className="mt-1 text-xs text-red-700">{errors.otp}</p></div>
      <button type="submit" disabled={busy} className="min-h-11 w-full rounded-lg bg-brand px-4 py-3 text-sm font-medium text-white disabled:opacity-50">{busy ? "正在处理…" : mode === "verify-email" ? "确认验证邮箱" : "验证并登录"}</button>
    </fieldset>
    {mode !== "verify-email" && <p className="mt-4 text-xs leading-6 text-secondary">已有未验证邮箱的密码账号？请先切换密码登录，再在工作空间验证邮箱，避免影响原密码。</p>}
  </form>;
}
