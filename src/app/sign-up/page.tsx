import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth/auth-form";
import { AuthShell } from "@/components/auth/auth-shell";
import { getCurrentSession } from "@/lib/session";

export const metadata: Metadata = { title: "注册 · JobFlow Pro" };
export const dynamic = "force-dynamic";

export default async function SignUpPage() {
  if (await getCurrentSession()) redirect("/dashboard");
  return <AuthShell title="从这里，开启下一程" description="创建账号，拥有属于你的求职工作空间。让每一次行动，都离理想工作更近一点。"><AuthForm mode="sign-up" /></AuthShell>;
}
