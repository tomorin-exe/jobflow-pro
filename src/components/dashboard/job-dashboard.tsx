"use client";

import { useState } from "react";
import { SummaryCards } from "@/components/dashboard/summary-cards";
import { JobFilters } from "@/components/jobs/job-filters";
import { JobList } from "@/components/jobs/job-list";
import { Icon } from "@/components/ui/icon";
import type { Job, JobStatusFilter } from "@/types/job";

export function JobDashboard({ jobs }: { jobs: readonly Job[] }) {
  const [status, setStatus] = useState<JobStatusFilter>("all");
  const [search, setSearch] = useState("");
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");
  const keyword = search.trim().toLocaleLowerCase("zh-CN");

  // 筛选结果由数据和交互状态推导，不另存一份 state，避免数据不同步。
  // filter 返回新数组，sort 不会原地修改传入的只读岗位数据。
  const visibleJobs = jobs
    .filter((job) =>
      (status === "all" || job.status === status) &&
      [job.company, job.position, job.location].some((value) =>
        value.toLocaleLowerCase("zh-CN").includes(keyword),
      ),
    )
    .sort((a, b) => {
      const dateOrder = sortOrder === "newest"
        ? b.appliedAt.localeCompare(a.appliedAt)
        : a.appliedAt.localeCompare(b.appliedAt);
      return dateOrder || a.id.localeCompare(b.id);
    });

  function resetFilters() {
    setStatus("all");
    setSearch("");
  }

  return (
    <>
      <SummaryCards jobs={jobs} />

      <section aria-labelledby="applications-heading" className="mt-7 overflow-hidden rounded-xl border border-line bg-white sm:mt-8">
        <div className="flex flex-col gap-5 px-5 pt-6 pb-5 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-7">
          <div>
            <h2 id="applications-heading" className="flex items-center gap-2.5 text-base font-semibold">
              我的投递
              <span className="rounded-md border border-line px-1.5 py-0.5 font-mono text-[10px] font-normal text-muted">{jobs.length}</span>
            </h2>
            <p className="mt-1.5 text-xs text-muted">每个机会，都值得认真记录。</p>
          </div>
          <div className="relative w-full sm:w-60">
            <label htmlFor="job-search" className="sr-only">搜索公司、职位或城市</label>
            <Icon name="search" className="pointer-events-none absolute top-3 left-3 size-4 text-muted" />
            <input
              id="job-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索公司、职位或城市…"
              className="h-10 w-full rounded-lg border border-line bg-[#fafbf9] pr-10 pl-9 text-xs placeholder:text-muted focus:border-brand focus:bg-white"
            />
            {search && (
              <button
                type="button"
                aria-label="清空搜索"
                onClick={() => setSearch("")}
                className="absolute top-1 right-1 flex size-8 items-center justify-center rounded-md text-secondary hover:bg-brand-light"
              >
                <Icon name="close" className="size-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-col items-start gap-3 px-5 pb-5 sm:px-6 lg:px-7 xl:flex-row xl:items-center xl:justify-between">
          <JobFilters jobs={jobs} value={status} onChange={setStatus} />
          <label className="flex shrink-0 items-center gap-2 text-[11px] text-secondary">
            <span>投递日期</span>
            <select
              aria-label="按投递日期排序"
              value={sortOrder}
              onChange={(event) => setSortOrder(event.target.value === "oldest" ? "oldest" : "newest")}
              className="h-9 cursor-pointer rounded-lg border border-line bg-white px-2 text-xs"
            >
              <option value="newest">最近投递优先</option>
              <option value="oldest">最早投递优先</option>
            </select>
          </label>
        </div>

        <p role="status" aria-atomic="true" className="sr-only">
          筛选结果：{visibleJobs.length} 条岗位记录
        </p>
        <JobList jobs={visibleJobs} onReset={resetFilters} />

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-[#fdfefc] px-5 py-4 text-[11px] text-muted sm:px-6 lg:px-7">
          <p>
            显示 <span className="font-medium text-secondary">{visibleJobs.length}</span> 条，共 <span className="font-medium text-secondary">{jobs.length}</span> 条投递记录
          </p>
          <span className="flex items-center gap-1.5">
            <Icon name="check" className="size-3.5 text-brand" />已展示全部筛选结果
          </span>
        </div>
      </section>

      <div className="mt-5 flex flex-col items-start justify-between gap-2 px-1 text-[11px] leading-5 text-muted sm:flex-row">
        <p className="flex items-center gap-1.5">
          <Icon name="leaf" className="size-3.5" />求职是一段旅程，保持自己的节奏。
        </p>
        <p>本地模拟数据 · 仅用于功能演示</p>
      </div>
    </>
  );
}
