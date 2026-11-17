import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SignOutButton } from "@/components/auth/sign-out-button";
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
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-5 sm:px-8">
          <Link href="/dashboard" className="flex items-center gap-2.5 text-xl font-bold tracking-tight">
            <span className="flex size-9 items-center justify-center rounded-xl bg-brand text-white"><Icon name="briefcase" /></span>
            <span>JobFlow <span className="text-[10px] tracking-wider text-brand">PRO</span></span>
          </Link>
          <SignOutButton />
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-5 py-10 sm:px-8 sm:py-16">
        <p className="font-mono text-[10px] font-medium tracking-[0.2em] text-brand">YOUR WORKSPACE</p>
        <h1 className="mt-4 break-words text-2xl font-semibold tracking-tight sm:text-3xl">你好，{session.user.name}<span className="text-brand">。</span></h1>
        <p className="mt-3 break-all text-sm leading-7 text-secondary">{session.user.email}</p>
        <div className="mt-8 rounded-2xl border border-line bg-white p-6 sm:p-9">
          <span className="flex size-11 items-center justify-center rounded-xl bg-brand-light text-brand"><Icon name="leaf" /></span>
          <h2 className="mt-5 text-lg font-semibold">岗位数据库接入中</h2>
          <p className="mt-3 max-w-xl text-sm leading-7 text-secondary">你的账号已登录。个人岗位管理将在后续接入数据库，目前此处尚未展示个人岗位记录。</p>
          <div className="mt-6 border-t border-line pt-5">
            <p className="text-xs leading-6 text-secondary">想先体验岗位管理？演示数据保存在当前浏览器，不属于任何登录账号。</p>
            <Link href="/demo" className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-lg bg-brand-light px-4 py-2.5 text-xs font-medium text-brand hover:bg-[#dcecdf]">打开本地演示 <Icon name="arrowRight" className="size-4" /></Link>
          </div>
        </div>
      </main>
    </div>
  );
}
