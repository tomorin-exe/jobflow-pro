"use client";

import Link from "next/link";
import { useState } from "react";
import { JobWorkspace } from "@/components/dashboard/job-workspace";
import { JobForm } from "@/components/jobs/job-form";
import { CsvImportDialog } from "@/components/jobs/csv-import-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useRemoteJobs } from "@/hooks/use-remote-jobs";
import type { RemoteMutationResult } from "@/lib/remote-jobs-store";
import type { Job, JobInput } from "@/types/job";

type Dialog = { type: "create" | "import" } | { type: "edit" | "delete"; job: Job } | null;

export function RemoteJobDashboard({ viewerId }: { viewerId: string }) {
  const remote = useRemoteJobs(viewerId);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [notice, setNotice] = useState("");
  function open(next: Exclude<Dialog, null>) { setNotice(""); setDialog(next); }
  function finish(result: RemoteMutationResult, message: string) {
    if (result.ok || result.status === 404 || result.status === 401) {
      setDialog(null);
      setNotice(result.ok ? message : result.status === 404 ? "该岗位已不存在。" : "");
    }
    return result;
  }
  async function save(input: JobInput) {
    return finish(await (dialog?.type === "edit" ? remote.updateJob(dialog.job.id, input) : remote.createJob(input)), dialog?.type === "edit" ? "岗位已更新。" : "岗位已新增。");
  }
  async function remove(): Promise<RemoteMutationResult> {
    if (dialog?.type !== "delete") return { ok: false, error: "请重新选择要删除的岗位。", status: 400 };
    return finish(await remote.deleteJob(dialog.job.id), "岗位已删除。");
  }
  if (remote.phase === "unauthorized") return (
    <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm leading-7 text-amber-900">
      <p>登录已过期，请重新登录。私人岗位已从当前页面移除。</p>
      <Link href="/sign-in" className="mt-3 inline-block font-medium underline underline-offset-4">重新登录</Link>
    </div>
  );
  if (remote.phase === "loading") return <div role="status" className="rounded-xl border border-line bg-white p-8 text-sm text-secondary">正在加载你的岗位记录…</div>;
  if (remote.phase === "error") return (
    <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm leading-7 text-amber-900">
      <p>{remote.problem?.message}</p>
      <button type="button" onClick={() => { void remote.refresh(); }} className="mt-3 rounded-lg border border-amber-300 bg-white px-4 py-2 text-xs">重试加载</button>
    </div>
  );
  return (
    <>
      <JobWorkspace jobs={remote.jobs} title="我的投递" storageLabel="账号保存 · 当前登录用户" disabled={remote.busy} refreshing={remote.refreshing} onRefresh={() => { setNotice(""); void remote.refresh(); }} onImport={() => open({ type: "import" })} onCreate={() => open({ type: "create" })} onEdit={(job) => open({ type: "edit", job })} onDelete={(job) => open({ type: "delete", job })}>
        {notice && <p role="status" className="mt-4 rounded-lg bg-brand-light px-4 py-3 text-xs text-brand">{notice}</p>}
        {remote.problem && <div role="alert" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900"><p>{remote.problem.message}</p><p className="mt-1 text-xs">当前显示上次成功读取的记录，可刷新列表重试。</p></div>}
      </JobWorkspace>
      {(dialog?.type === "create" || dialog?.type === "edit") && <JobForm key={dialog.type === "edit" ? dialog.job.id : "create"} job={dialog.type === "edit" ? dialog.job : undefined} onSave={save} onCancel={() => setDialog(null)} />}
      {dialog?.type === "delete" && <ConfirmDialog title="删除岗位" description={`确定删除「${dialog.job.company} · ${dialog.job.position}」吗？删除后无法撤销。`} confirmLabel="确认删除" onConfirm={remove} onCancel={() => setDialog(null)} />}
      {dialog?.type === "import" && <CsvImportDialog viewerId={viewerId} onClose={() => setDialog(null)} onUnauthorized={() => { setDialog(null); remote.expire(); }} onImported={async (result) => {
        const refreshed = await remote.refresh();
        setNotice(`${result.replayed ? "该批次已处理，" : ""}成功导入 ${result.importedCount} 条岗位。${refreshed ? "" : "列表刷新失败，请点击刷新列表；请勿重复创建批次。"}`);
        setDialog(null);
      }} />}
    </>
  );
}
