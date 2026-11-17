"use client";

import { useState } from "react";
import { JobWorkspace } from "@/components/dashboard/job-workspace";
import { JobForm } from "@/components/jobs/job-form";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useJobs } from "@/hooks/use-jobs";
import type { Job, JobInput, JobMutationResult } from "@/types/job";

type ActiveDialog = { type: "create" } | { type: "edit" | "delete"; job: Job } | { type: "reset" } | null;

/** 演示控制器继续只使用原来的 localStorage Hook，不调用私人岗位 API。 */
export function JobDashboard({ initialJobs }: { initialJobs: readonly Job[] }) {
  const { jobs, phase, problem, createJob, updateJob, deleteJob, retry, resetCorruptData } = useJobs(initialJobs);
  const [dialog, setDialog] = useState<ActiveDialog>(null);
  const [notice, setNotice] = useState("");
  function openDialog(next: Exclude<ActiveDialog, null>) { setNotice(""); setDialog(next); }
  function saveJob(input: JobInput): JobMutationResult {
    const result = dialog?.type === "edit" ? updateJob(dialog.job.id, input) : createJob(input);
    if (result.ok) { setNotice(dialog?.type === "edit" ? "岗位已更新。" : "岗位已新增。"); setDialog(null); }
    return result;
  }
  function confirmDelete(): JobMutationResult {
    if (dialog?.type !== "delete") return { ok: false, error: "请重新选择要删除的岗位。" };
    const result = deleteJob(dialog.job.id);
    if (result.ok) { setNotice("岗位已删除。"); setDialog(null); }
    return result;
  }
  function confirmReset(): JobMutationResult {
    const result = resetCorruptData();
    if (result.ok) { setNotice("损坏数据已清空，可以重新添加岗位。"); setDialog(null); }
    return result;
  }
  if (phase === "loading") return <div role="status" className="rounded-xl border border-line bg-white p-8 text-sm text-secondary">正在读取本地岗位记录…</div>;

  return (
    <>
      <JobWorkspace jobs={jobs} title="演示投递" storageLabel="浏览器本地保存 · 当前设备" available={phase === "ready"} onCreate={() => openDialog({ type: "create" })} onEdit={(job) => openDialog({ type: "edit", job })} onDelete={(job) => openDialog({ type: "delete", job })}>
        {notice && !problem && <p role="status" className="mt-4 rounded-lg bg-brand-light px-4 py-3 text-xs text-brand">{notice}</p>}
        {problem && <div role="alert" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
          <p>{problem.message}</p>
          <div className="mt-3 flex flex-wrap gap-3">
            <button type="button" onClick={retry} className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs">重试读取</button>
            {problem.kind === "corrupt" && <button type="button" onClick={() => openDialog({ type: "reset" })} className="rounded-lg border border-red-200 bg-white px-3 py-2 text-xs text-red-700">清空损坏数据</button>}
          </div>
        </div>}
      </JobWorkspace>
      {(dialog?.type === "create" || dialog?.type === "edit") && <JobForm key={dialog.type === "edit" ? dialog.job.id : "create"} job={dialog.type === "edit" ? dialog.job : undefined} onSave={saveJob} onCancel={() => setDialog(null)} />}
      {dialog?.type === "delete" && <ConfirmDialog title="删除岗位" description={`确定删除「${dialog.job.company} · ${dialog.job.position}」吗？删除后无法撤销。`} confirmLabel="确认删除" onConfirm={confirmDelete} onCancel={() => setDialog(null)} />}
      {dialog?.type === "reset" && <ConfirmDialog title="清空损坏数据" description="这会永久清空当前无法读取的本地岗位数据，并从空列表开始。确定继续吗？" confirmLabel="确认清空" onConfirm={confirmReset} onCancel={() => setDialog(null)} />}
    </>
  );
}
