"use client";

import Link from "next/link";

export default function ErrorPage({ reset }: { reset: () => void }) {
  // 不展示 error.message / stack，避免把服务端或认证细节带入页面。
  return (
    <main className="mx-auto max-w-lg px-5 py-20">
      <div className="rounded-2xl border border-line bg-white p-7">
        <h1 className="text-xl font-semibold">页面暂时无法加载</h1>
        <p role="alert" className="mt-3 text-sm leading-7 text-secondary">请稍后重试。如果登录服务暂时不可用，你仍可以体验本地演示。</p>
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <button type="button" onClick={reset} className="rounded-lg bg-brand px-4 py-2.5 text-sm text-white">重试</button>
          <Link href="/sign-in" className="text-sm text-brand hover:underline">前往登录</Link>
          <Link href="/demo" className="text-sm text-secondary hover:underline">本地演示</Link>
        </div>
      </div>
    </main>
  );
}
