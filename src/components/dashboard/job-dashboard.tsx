"use client";

import { useState } from "react";
import { SummaryCards } from "@/components/dashboard/summary-cards";
import { JobFilters } from "@/components/jobs/job-filters";
import { JobList } from "@/components/jobs/job-list";
import { JobForm } from "@/components/jobs/job-form";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Icon } from "@/components/ui/icon";
import { useJobs } from "@/hooks/use-jobs";
import type { Job, JobInput, JobMutationResult, JobStatusFilter } from "@/types/job";

type ActiveDialog = { type: "create" } | { type: "edit" | "delete"; job: Job } | { type: "reset" } | null;

export function JobDashboard({ initialJobs }: { initialJobs: readonly Job[] }) {
  const { jobs, phase, problem, createJob, updateJob, deleteJob, retry, resetCorruptData } = useJobs(initialJobs);
  const [status, setStatus] = useState<JobStatusFilter>("all");
  const [search, setSearch] = useState("");
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");
  const [dialog, setDialog] = useState<ActiveDialog>(null);
  const [notice, setNotice] = useState("");
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

  function openDialog(next: Exclude<ActiveDialog, null>) {
    setNotice("");
    setDialog(next);
  }

  function saveJob(input: JobInput): JobMutationResult {
    const result = dialog?.type === "edit" ? updateJob(dialog.job.id, input) : createJob(input);
    if (result.ok) {
      setNotice(dialog?.type === "edit" ? "岗位已更新。" : "岗位已新增。");
      setDialog(null);
    }
    return result;
  }

  function confirmDelete(): JobMutationResult {
    if (dialog?.type !== "delete") return { ok: false, error: "请重新选择要删除的岗位。" };
    const result = deleteJob(dialog.job.id);
    if (result.ok) {
      setNotice("岗位已删除。");
      setDialog(null);
    }
    return result;
  }

  function confirmReset(): JobMutationResult {
    const result = resetCorruptData();
    if (result.ok) {
      setNotice("损坏数据已清空，可以重新添加岗位。");
      setDialog(null);
    }
    return result;
  }

  if (phase === "loading") {
    return <div role="status" className="rounded-xl border border-line bg-white p-8 text-sm text-secondary">正在读取本地岗位记录…</div>;
  }

  return (
    <>
      <SummaryCards jobs={jobs} />

      {notice && !problem && <p role="status" className="mt-4 rounded-lg bg-brand-light px-4 py-3 text-xs text-brand">{notice}</p>}
      {problem && (
        <div role="alert" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
          <p>{problem.message}</p>
          <div className="mt-3 flex flex-wrap gap-3">
            <button type="button" onClick={retry} className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs">重试读取</button>
            {problem.kind === "corrupt" && <button type="button" onClick={() => openDialog({ type: "reset" })} className="rounded-lg border border-red-200 bg-white px-3 py-2 text-xs text-red-700">清空损坏数据</button>}
          </div>
        </div>
      )}

      <section aria-labelledby="applications-heading" className="mt-7 overflow-hidden rounded-xl border border-line bg-white sm:mt-8">
        <div className="flex flex-col gap-5 px-5 pt-6 pb-5 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-7">
          <div>
            <h2 id="applications-heading" className="flex items-center gap-2.5 text-base font-semibold">
              我的投递
              <span className="rounded-md border border-line px-1.5 py-0.5 font-mono text-[10px] font-normal text-muted">{jobs.length}</span>
            </h2>
            <p className="mt-1.5 text-xs text-muted">每个机会，都值得认真记录。</p>
          </div>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
            <div className="relative w-full sm:w-52">
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
            <button type="button" disabled={phase !== "ready"} onClick={() => openDialog({ type: "create" })} className="flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-brand px-4 text-xs font-medium text-white hover:bg-[#1d6244]">
              <Icon name="plus" className="size-4" />新增岗位
            </button>
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
        {phase === "ready" ? (
          <JobList
            jobs={visibleJobs}
            isEmpty={jobs.length === 0}
            onReset={resetFilters}
            onCreate={() => openDialog({ type: "create" })}
            onEdit={(job) => openDialog({ type: "edit", job })}
            onDelete={(job) => openDialog({ type: "delete", job })}
          />
        ) : <div id="job-results" className="border-t border-line px-5 py-12 text-center text-sm text-secondary">暂时无法加载岗位记录，请先处理上方的存储提示。</div>}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-[#fdfefc] px-5 py-4 text-[11px] text-muted sm:px-6 lg:px-7">
          {phase === "ready" ? <p>
            显示 <span className="font-medium text-secondary">{visibleJobs.length}</span> 条，共 <span className="font-medium text-secondary">{jobs.length}</span> 条投递记录
          </p> : <p>本地数据尚未加载，请重试读取。</p>}
          {phase === "ready" && <span className="flex items-center gap-1.5">
            <Icon name="check" className="size-3.5 text-brand" />已展示全部筛选结果
          </span>}
        </div>
      </section>

      <div className="mt-5 flex flex-col items-start justify-between gap-2 px-1 text-[11px] leading-5 text-muted sm:flex-row">
        <p className="flex items-center gap-1.5">
          <Icon name="leaf" className="size-3.5" />求职是一段旅程，保持自己的节奏。
        </p>
        <p>浏览器本地保存 · 当前设备</p>
      </div>

      {(dialog?.type === "create" || dialog?.type === "edit") && (
        <JobForm key={dialog.type === "edit" ? dialog.job.id : "create"} job={dialog.type === "edit" ? dialog.job : undefined} onSave={saveJob} onCancel={() => setDialog(null)} />
      )}
      {dialog?.type === "delete" && (
        <ConfirmDialog title="删除岗位" description={`确定删除「${dialog.job.company} · ${dialog.job.position}」吗？删除后无法撤销。`} confirmLabel="确认删除" onConfirm={confirmDelete} onCancel={() => setDialog(null)} />
      )}
      {dialog?.type === "reset" && (
        <ConfirmDialog title="清空损坏数据" description="这会永久清空当前无法读取的本地岗位数据，并从空列表开始。确定继续吗？" confirmLabel="确认清空" onConfirm={confirmReset} onCancel={() => setDialog(null)} />
      )}
    </>
  );
}
