import type { Metadata } from "next";
import Link from "next/link";
import { JobDashboard } from "@/components/dashboard/job-dashboard";
import { Sidebar } from "@/components/dashboard/sidebar";
import { Icon } from "@/components/ui/icon";
import { mockJobs } from "@/data/jobs";

export const metadata: Metadata = { title: "本地演示 · JobFlow Pro" };

export default function DemoPage() {
  return (
    <div className="min-h-screen lg:pl-60">
      <a href="#main-content" className="skip-link">跳转到主内容</a>
      <Sidebar />

      <header className="flex h-[68px] items-center justify-between border-b border-line bg-white/70 px-5 sm:px-8 lg:px-10">
        <div className="flex items-center gap-2.5 text-xs">
          <span className="text-muted">工作空间</span>
          <span aria-hidden="true" className="text-[#c8cec8]">/</span>
          <span className="font-medium text-secondary">本地演示</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5 text-[11px] text-secondary">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-brand" />演示模式
          </span>
          <span aria-hidden="true" className="flex size-8 items-center justify-center rounded-full border border-[#e1e8de] bg-[#edf2e8] font-mono text-[11px] font-medium text-[#5d7253]">
            JF
          </span>
        </div>
      </header>

      <main id="main-content" tabIndex={-1} className="mx-auto max-w-[1360px] px-5 pt-8 pb-10 outline-none sm:px-8 sm:pt-10 lg:px-10">
        <div className="mb-7 flex flex-col items-start justify-between gap-3 rounded-xl border border-[#dfe7dc] bg-brand-light px-4 py-3 text-xs leading-6 text-brand sm:flex-row sm:items-center">
          <p><strong className="font-semibold">本地演示</strong> · 记录仅保存在当前浏览器，不属于任何登录账号，也不会自动上传。</p>
          <Link href="/dashboard" className="shrink-0 font-semibold underline underline-offset-4">前往账号工作空间</Link>
        </div>
        <div className="mb-7 flex items-center justify-between gap-5 sm:mb-8">
          <div>
            <p className="mb-2.5 font-mono text-[10px] font-medium tracking-[0.2em] text-brand">YOUR NEXT CHAPTER</p>
            <h1 className="text-[27px] font-semibold tracking-tight sm:text-[30px]">
              岗位管理演示<span className="ml-2 text-brand">.</span>
            </h1>
            <p className="mt-2.5 text-xs leading-6 text-secondary sm:text-sm">把握每一步进展，让理想工作如期而至。</p>
          </div>
          <div className="hidden items-center gap-2 rounded-full border border-[#dfe7dc] bg-[#f0f4eb] px-3.5 py-2 text-[11px] text-[#607451] md:flex">
            <Icon name="leaf" className="size-3.5" />一份努力，一份可能
          </div>
        </div>

        <JobDashboard initialJobs={mockJobs} />

        <footer className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5 text-[10px] tracking-wide text-muted">
          <span>JobFlow Pro <span aria-hidden="true" className="mx-1">/</span> 让每一份努力都有方向</span>
          <span className="font-mono">MADE FOR YOUR NEXT STEP</span>
        </footer>
      </main>
    </div>
  );
}
