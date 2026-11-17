import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { RemoteJobDashboard } from "@/components/dashboard/remote-job-dashboard";
import { Icon } from "@/components/ui/icon";
import { getCurrentSession } from "@/lib/session";

export const metadata: Metadata = { title: "我的工作空间 · JobFlow Pro" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  // getCurrentSession 内部使用 await headers() 和 Better Auth api.getSession 验证真实会话。
  // 这是服务端权限边界，不依赖客户端状态或 Cookie 是否存在。
  const session = await getCurrentSession();
  if (!session) redirect("/sign-in");

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-white/80">
        <div className="mx-auto flex max-w-[1360px] items-center justify-between gap-4 px-5 py-5 sm:px-8 lg:px-10">
          <Link href="/dashboard" className="flex items-center gap-2.5 text-xl font-bold tracking-tight">
            <span className="flex size-9 items-center justify-center rounded-xl bg-brand text-white"><Icon name="briefcase" /></span>
            <span>JobFlow <span className="text-[10px] tracking-wider text-brand">PRO</span></span>
          </Link>
          <SignOutButton />
        </div>
      </header>
      <main className="mx-auto max-w-[1360px] px-5 py-8 sm:px-8 sm:py-10 lg:px-10">
        <p className="font-mono text-[10px] font-medium tracking-[0.2em] text-brand">YOUR WORKSPACE</p>
        <h1 className="mt-4 break-words text-2xl font-semibold tracking-tight sm:text-3xl">你好，{session.user.name}<span className="text-brand">。</span></h1>
        <p className="mt-3 break-all text-sm leading-7 text-secondary">{session.user.email}</p>
        <p className="mt-3 text-xs leading-6 text-secondary">记录每次投递，所有进展保存到你的账号。</p>
        {!session.user.emailVerified && <p className="mt-4 rounded-lg border border-line bg-white p-3 text-xs leading-6 text-secondary">你的邮箱尚未验证。<Link href="/verify-email" className="ml-1 font-medium text-brand underline">验证邮箱以启用验证码登录</Link>，原密码和岗位会保留。</p>}
        <div className="mt-7">
          <RemoteJobDashboard key={session.user.id} viewerId={session.user.id} />
        </div>
        <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5 text-xs leading-6 text-muted"><span>私人工作空间 · 仅展示当前账号岗位</span><Link href="/demo" className="text-brand hover:underline">本地演示（独立数据）</Link></footer>
      </main>
    </div>
  );
}
