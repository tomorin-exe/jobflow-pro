import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { EmailOtpForm } from "@/components/auth/email-otp-form";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { getCurrentSession } from "@/lib/session";

export const metadata: Metadata = { title: "验证邮箱 · JobFlow Pro" };
export const dynamic = "force-dynamic";
export default async function VerifyEmailPage() {
  const session = await getCurrentSession();
  if (!session) redirect("/sign-in");
  if (session.user.emailVerified) redirect("/dashboard");
  return <AuthShell title="验证邮箱，保留原有账号" description="先使用原密码登录，再通过邮箱验证码证明邮箱归属。你的岗位和原密码会保留。">
    <EmailOtpForm mode="verify-email" email={session.user.email} />
    <p className="mt-5 text-xs leading-6 text-secondary">会话超过5分钟时，请先退出并重新用密码登录，再完成验证。</p>
    <div className="mt-3"><SignOutButton /></div>
  </AuthShell>;
}
