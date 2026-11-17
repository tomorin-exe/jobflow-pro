import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/ui/icon";

export function AuthShell({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-6 sm:px-8">
        <Link href="/" aria-label="JobFlow Pro 首页" className="flex items-center gap-2.5 font-bold tracking-tight">
          <span className="flex size-9 items-center justify-center rounded-xl bg-brand text-white"><Icon name="briefcase" /></span>
          <span className="text-xl">JobFlow <span className="text-[10px] tracking-wider text-brand">PRO</span></span>
        </Link>
        <Link href="/demo" className="text-xs text-secondary hover:text-brand">体验本地演示 <span aria-hidden="true">↗</span></Link>
      </header>
      <main className="mx-auto grid max-w-6xl gap-10 px-5 pt-5 pb-12 sm:px-8 sm:pt-12 lg:grid-cols-2 lg:items-center lg:gap-20 lg:pt-16">
        <div className="max-w-md">
          <p className="font-mono text-[10px] font-medium tracking-[0.2em] text-brand">YOUR NEXT CHAPTER</p>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">{title}<span className="text-brand">.</span></h1>
          <p className="mt-4 text-sm leading-7 text-secondary">{description}</p>
          <div className="mt-7 flex items-center gap-3 text-xs leading-6 text-brand">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-light"><Icon name="leaf" className="size-4" /></span>
            每一步小小的行动，都是向理想工作的靠近。
          </div>
        </div>
        <section aria-label={title} className="w-full max-w-md rounded-2xl border border-line bg-white p-6 shadow-sm sm:p-8 lg:justify-self-end">
          {children}
        </section>
      </main>
      <footer className="px-5 pb-6 text-center text-[11px] text-muted">JobFlow Pro · 让每一份努力都有方向</footer>
    </div>
  );
}
