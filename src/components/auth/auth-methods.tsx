"use client";
import { useState } from "react";
import { AuthForm } from "@/components/auth/auth-form";
import { EmailOtpForm } from "@/components/auth/email-otp-form";
import type { AuthMode } from "@/lib/auth-form";

export function AuthMethods({ mode }: { mode: AuthMode }) {
  const [method, setMethod] = useState<"password" | "otp">("password");
  return <>
    <div role="group" aria-label="选择认证方式" className="mb-6 flex gap-2 rounded-lg bg-[#f4f6f2] p-1">
      {([['password', '邮箱密码'], ['otp', '邮箱验证码']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={method === value} onClick={() => setMethod(value)} className={`min-h-10 flex-1 rounded-md px-3 text-xs ${method === value ? "bg-white font-medium text-brand shadow-sm" : "text-secondary"}`}>{label}</button>)}
    </div>
    {method === "password" ? <AuthForm mode={mode} /> : <EmailOtpForm key={mode} mode={mode} />}
  </>;
}
