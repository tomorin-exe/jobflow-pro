"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { Modal } from "@/components/ui/modal";
import { CSV_HEADER, CSV_MAX_BYTES, parseJobCsv, selectedDuplicateLines } from "@/lib/job-csv";
import { JobImportError } from "@/lib/job-import-error";
import { ImportClientError, pendingImportIdentity, importRequestKey, jobImportClient } from "@/lib/job-import-client";
import { JOB_STATUS_META } from "@/lib/job-status";
import { isJobStatus } from "@/lib/jobs";
import type { ImportPreview, JobImportRequest, JobImportResult } from "@/types/job-import";

interface Props {
  viewerId: string;
  onClose: () => void;
  onUnauthorized: () => void;
  onImported: (result: JobImportResult) => Promise<void>;
}
const secondary = "rounded-lg border border-line px-3 py-2 text-xs text-secondary hover:border-brand disabled:opacity-50";

export function CsvImportDialog({ viewerId, onClose, onUnauthorized, onImported }: Props) {
  const locked = useRef(false);
  const revision = useRef(0);
  const [csv, setCsv] = useState("");
  const [filename, setFilename] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [allowDuplicates, setAllowDuplicates] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState<{ request: JobImportRequest; key: string } | null>(null);
  const duplicates = preview ? selectedDuplicateLines(preview.rows, selected) : [];
  function failure(cause: unknown) {
    if (cause instanceof ImportClientError && cause.status === 401) { onUnauthorized(); return; }
    setError(cause instanceof JobImportError || cause instanceof ImportClientError ? cause.message : "文件读取失败，请使用 UTF-8 编码的 CSV 文件重试。");
  }
  async function loadPreview(source: string) {
    parseJobCsv(source); // 尽早反馈；服务端仍独立重做所有解析、校验和重复检测。
    const result = await jobImportClient.preview(source);
    setPreview(result);
    setSelected(result.rows.filter((row) => !row.errors.length && !row.existingCount && !row.csvDuplicateLines.length).map((row) => row.line));
    setAllowDuplicates(false);
  }
  async function fileChanged(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || locked.current) return;
    const version = ++revision.current;
    locked.current = true; setBusy(true); setError(""); setPreview(null); setSelected([]); setRetry(null); setCsv(""); setFilename(file.name);
    try {
      if (file.size > CSV_MAX_BYTES) throw new JobImportError("CSV_LIMIT");
      const source = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
      if (revision.current !== version) return;
      setCsv(source);
      await loadPreview(source);
    } catch (cause) { failure(cause); }
    finally { locked.current = false; setBusy(false); event.target.value = ""; }
  }
  async function rePreview() {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(""); setPreview(null);
    try { await loadPreview(csv); } catch (cause) { failure(cause); }
    finally { locked.current = false; setBusy(false); }
  }
  function select(lines: number[]) { setSelected(lines); setAllowDuplicates(false); setError(""); }
  async function submit() {
    if (locked.current || !preview || !selected.length || (duplicates.length && !allowDuplicates)) return;
    locked.current = true; setBusy(true); setError("");
    let pending = retry;
    try {
      if (!pending) {
        const values = { csv, selectedRows: selected, allowDuplicates };
        const key = await importRequestKey(viewerId, values);
        let storage: Storage | undefined;
        try { storage = window.sessionStorage; } catch { /* 浏览器可能禁止存储；当前弹窗内可安全重试。 */ }
        pending = { key, request: { ...values, previewHash: preview.previewHash, ...pendingImportIdentity(key, allowDuplicates, storage) } };
      }
      // 发送前保留完整请求；超时后必须复用同一批次，不能默默换新 ID。
      setRetry(pending);
      const result = await jobImportClient.import(pending.request);
      try { window.sessionStorage.removeItem(pending.key); } catch { /* 成功结果已由数据库保存。 */ }
      setRetry(null);
      await onImported(result);
    } catch (cause) {
      if (cause instanceof ImportClientError && !cause.uncertain) {
        setRetry(null);
        if (pending) try { window.sessionStorage.removeItem(pending.key); } catch { /* 无敏感数据。 */ }
        if (cause.status === 409) setPreview(null);
      }
      failure(cause);
    } finally { locked.current = false; setBusy(false); }
  }
  function downloadTemplate() {
    const url = URL.createObjectURL(new Blob([`\uFEFF${CSV_HEADER}\r\n示例公司,前端工程师,上海,已投递,2026-11-17,请替换为自己的记录\r\n`], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "jobflow-jobs-template.csv"; link.click(); URL.revokeObjectURL(url);
  }
  return (
    <Modal wide title="CSV 批量导入" description="先预览、勾选，再确认导入。仅比较当前账号的岗位；导入只创建新记录，不覆盖或删除已有岗位。" onClose={() => { if (!locked.current) onClose(); }} busy={busy}>
      <div className="min-h-0 space-y-4 overflow-y-auto p-5 text-sm sm:p-6">
        <div className="flex flex-wrap items-center gap-3">
          <label className={`${secondary} cursor-pointer`}>选择 CSV 文件<input aria-label="选择 CSV 文件" type="file" accept=".csv,text/csv" disabled={busy || !!retry} onChange={(event) => { void fileChanged(event); }} className="mt-2 block max-w-full text-xs" /></label>
          <button type="button" onClick={downloadTemplate} className={secondary}>下载模板</button>
          {filename && <span className="max-w-full break-all text-xs text-muted">{filename}</span>}
        </div>
        <p className="text-xs leading-6 text-secondary">UTF-8（支持 BOM），最多 256 KiB / 500 行。表头：{CSV_HEADER}。日期为 YYYY-MM-DD；状态支持已投递、面试中、已录用、未通过及对应英文值。备注可选；支持引号内的逗号和换行。</p>
        <p className="rounded-lg bg-brand-light p-3 text-xs leading-6 text-brand">疑似重复：公司＋职位＋地点相同（忽略大小写、全半角和多余空白）。日期、状态、备注不同仍会提示，请自行判断是否为另一次投递。</p>
        {busy && <p role="status" className="text-xs text-brand">正在处理，请稍候…</p>}
        {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs leading-6 text-red-800">{error}</p>}
        {retry && !busy && <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-6 text-amber-900">上次请求结果尚未确认。请使用下方“重试同一批次”，系统不会重复创建。当前内容已锁定。浏览器允许会话存储时，刷新后重新选择相同文件和行也能复用批次；禁止存储时请留在此窗口重试。</p>}
        {preview && <>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <p role="status">共 {preview.rows.length} 行 · 无效 {preview.rows.filter((row) => row.errors.length).length} 行 · 已选 {selected.length} 行</p>
            <button type="button" className={secondary} disabled={busy || !!retry} onClick={() => select(preview.rows.filter((row) => !row.errors.length && !row.existingCount && !row.csvDuplicateLines.length).map((row) => row.line))}>选择有效且不重复的行</button>
            <button type="button" className={secondary} disabled={busy || !!retry} onClick={() => select([])}>清空选择</button>
          </div>
          {!preview.rows.length ? <p className="py-6 text-center text-secondary">CSV 只有表头，没有可导入的岗位。</p> : <ol aria-label="CSV 导入预览" className="divide-y divide-line rounded-xl border border-line">
            {preview.rows.map((row) => <li key={row.line} className="p-4">
              <div className="flex items-start gap-3">
                <input type="checkbox" aria-label={`导入第 ${row.line} 行`} checked={selected.includes(row.line)} disabled={busy || !!retry || !!row.errors.length} onChange={(event) => select(event.target.checked ? [...selected, row.line] : selected.filter((line) => line !== row.line))} className="mt-1 size-4 shrink-0 accent-brand" />
                <div className="min-w-0 flex-1 space-y-1 text-xs leading-6 [overflow-wrap:anywhere]">
                  <p className="font-medium">第 {row.line} 行 · {row.input.company || "公司未填写"} · {row.input.position || "职位未填写"}</p>
                  <p className="text-secondary">{row.input.location} · {isJobStatus(row.input.status) ? JOB_STATUS_META[row.input.status].label : row.input.status} · {row.input.appliedAt}</p>
                  {row.input.notes && <p className="whitespace-pre-wrap text-muted">备注：{row.input.notes}</p>}
                  {!!row.errors.length && <p className="text-red-700">无法导入：{row.errors.join("；")}</p>}
                  {!!row.csvDuplicateLines.length && <p className="text-amber-800">CSV 内疑似重复：第 {row.csvDuplicateLines.slice(0, 5).join("、")} 行{row.csvDuplicateLines.length > 5 ? "等" : ""}</p>}
                  {!!row.existingCount && <p className="text-amber-800">当前账号已有 {row.existingCount} 条疑似重复岗位</p>}
                </div>
              </div>
            </li>)}
          </ol>}
          {!!duplicates.length && <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-6 text-amber-900"><input type="checkbox" checked={allowDuplicates} disabled={busy || !!retry} onChange={(event) => setAllowDuplicates(event.target.checked)} className="mt-1.5 accent-brand" />仍导入所选 {duplicates.length} 条疑似重复岗位，保留为新记录（不会覆盖已有记录）</label>}
        </>}
      </div>
      <div className="flex shrink-0 flex-wrap justify-end gap-3 border-t border-line px-5 py-4 sm:px-6">
        <button type="button" className={secondary} disabled={busy} onClick={onClose}>取消</button>
        {csv && !preview && !retry && <button type="button" className={secondary} disabled={busy} onClick={() => { void rePreview(); }}>重新预览</button>}
        <button type="button" disabled={busy || !preview || !selected.length || (!!duplicates.length && !allowDuplicates)} onClick={() => { void submit(); }} className="rounded-lg bg-brand px-4 py-2 text-xs font-medium text-white disabled:opacity-50">{busy ? "处理中…" : retry ? "重试同一批次" : `确认导入 ${selected.length} 条岗位`}</button>
      </div>
    </Modal>
  );
}
