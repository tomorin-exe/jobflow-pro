import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth/auth-form";
import { AuthShell } from "@/components/auth/auth-shell";
import { getCurrentSession } from "@/lib/session";

export const metadata: Metadata = { title: "登录 · JobFlow Pro" };
export const dynamic = "force-dynamic";

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ registered?: string }> }) {
  if (await getCurrentSession()) redirect("/dashboard");
  const { registered } = await searchParams;
  return (
    <AuthShell title="欢迎回来，继续向前" description="登录你的账号，在清晰的计划中，走好求职的每一步。">
      {registered === "1" && <p role="status" className="mb-5 rounded-lg bg-brand-light p-3 text-sm leading-6 text-brand">注册请求已完成，请登录以继续。</p>}
      <AuthForm mode="sign-in" />
    </AuthShell>
  );
}
