import { useId, useRef, useState, type FormEvent } from "react";
import { Modal } from "@/components/ui/modal";
import { JOB_STATUS_META } from "@/lib/job-status";
import { isJobStatus, JOB_FIELD_LIMITS, normalizeJobInput, validateJobInput } from "@/lib/jobs";
import { JOB_STATUSES, type Job, type JobFieldErrors, type JobInput, type JobMutationResult } from "@/types/job";

interface JobFormProps {
  job?: Job;
  onSave: (input: JobInput) => JobMutationResult | Promise<JobMutationResult>;
  onCancel: () => void;
}

function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

const inputClassName = "mt-2 w-full rounded-lg border border-line bg-[#fafbf9] px-3 py-2.5 text-base text-primary aria-invalid:border-red-400 focus:border-brand focus:bg-white sm:text-sm";

export function JobForm({ job, onSave, onCancel }: JobFormProps) {
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const submitting = useRef(false);
  const [pending, setPending] = useState(false);
  const [values, setValues] = useState<JobInput>(() => job ? {
    company: job.company,
    position: job.position,
    location: job.location,
    status: job.status,
    appliedAt: job.appliedAt,
    notes: job.notes,
  } : { company: "", position: "", location: "", status: "applied", appliedAt: today(), notes: "" });
  const [errors, setErrors] = useState<JobFieldErrors>({});
  const [saveError, setSaveError] = useState<string | null>(null);

  function change<K extends keyof JobInput>(field: K, value: JobInput[K]) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setSaveError(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const nextErrors = validateJobInput(values);
    setErrors(nextErrors);
    setSaveError(null);
    const firstInvalid = Object.keys(nextErrors)[0];
    if (firstInvalid) {
      formRef.current?.querySelector<HTMLElement>(`[name="${firstInvalid}"]`)?.focus();
      return;
    }
    submitting.current = true;
    setPending(true);
    try {
      const result = await onSave(normalizeJobInput(values));
      if (!result.ok) setSaveError(result.error);
    } catch { setSaveError("保存未完成，请稍后重试。"); }
    finally { submitting.current = false; setPending(false); }
  }

  return (
    <Modal title={job ? "编辑岗位" : "新增岗位"} description="记录新的机会，带着清晰的计划迈出下一步。标有 * 的项目为必填项。" onClose={() => { if (!submitting.current) onCancel(); }} busy={pending}>
      <form ref={formRef} noValidate onSubmit={submit} className="flex min-h-0 flex-col">
        <fieldset disabled={pending} className="min-h-0 min-w-0 space-y-4 overflow-y-auto p-5 sm:p-6">
          {saveError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm leading-6 text-red-700">{saveError}</p>}
          {([['company', '公司名称'], ['position', '职位名称'], ['location', '工作地点']] as const).map(([field, label]) => (
            <div key={field}>
              <label htmlFor={`${id}-${field}`} className="text-xs font-medium">{label} <span aria-hidden="true" className="text-red-600">*</span></label>
              <input
                id={`${id}-${field}`}
                name={field}
                data-autofocus={field === "company" ? true : undefined}
                required
                maxLength={JOB_FIELD_LIMITS[field]}
                value={values[field]}
                onChange={(event) => change(field, event.target.value)}
                aria-invalid={Boolean(errors[field])}
                aria-describedby={errors[field] ? `${id}-${field}-error` : undefined}
                className={inputClassName}
              />
              {errors[field] && <p id={`${id}-${field}-error`} className="mt-1.5 text-xs text-red-700">{errors[field]}</p>}
            </div>
          ))}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor={`${id}-status`} className="text-xs font-medium">投递状态 <span aria-hidden="true" className="text-red-600">*</span></label>
              <select id={`${id}-status`} name="status" required value={values.status} onChange={(event) => { if (isJobStatus(event.target.value)) change("status", event.target.value); }} aria-invalid={Boolean(errors.status)} aria-describedby={errors.status ? `${id}-status-error` : undefined} className={inputClassName}>
                {JOB_STATUSES.map((status) => <option key={status} value={status}>{JOB_STATUS_META[status].label}</option>)}
              </select>
              {errors.status && <p id={`${id}-status-error`} className="mt-1.5 text-xs text-red-700">{errors.status}</p>}
            </div>
            <div>
              <label htmlFor={`${id}-appliedAt`} className="text-xs font-medium">投递日期 <span aria-hidden="true" className="text-red-600">*</span></label>
              <input id={`${id}-appliedAt`} name="appliedAt" type="date" required min="0001-01-01" max="9999-12-31" value={values.appliedAt} onChange={(event) => change("appliedAt", event.target.value)} aria-invalid={Boolean(errors.appliedAt)} aria-describedby={errors.appliedAt ? `${id}-appliedAt-error` : undefined} className={inputClassName} />
              {errors.appliedAt && <p id={`${id}-appliedAt-error`} className="mt-1.5 text-xs text-red-700">{errors.appliedAt}</p>}
            </div>
          </div>
          <div>
            <label htmlFor={`${id}-notes`} className="text-xs font-medium">备注 <span className="font-normal text-muted">（选填）</span></label>
            <textarea id={`${id}-notes`} name="notes" rows={3} maxLength={JOB_FIELD_LIMITS.notes} value={values.notes} onChange={(event) => change("notes", event.target.value)} aria-invalid={Boolean(errors.notes)} aria-describedby={errors.notes ? `${id}-notes-error` : `${id}-notes-hint`} placeholder="记录岗位要求、面试安排或下一步计划…" className={`${inputClassName} resize-y`} />
            {errors.notes ? <p id={`${id}-notes-error`} className="mt-1.5 text-xs text-red-700">{errors.notes}</p> : <p id={`${id}-notes-hint`} className="mt-1 text-right text-[11px] text-muted">{values.notes.length} / {JOB_FIELD_LIMITS.notes}</p>}
          </div>
        </fieldset>
        <div className="flex shrink-0 justify-end gap-3 border-t border-line px-5 py-4 sm:px-6">
          <button type="button" onClick={onCancel} disabled={pending} className="rounded-lg border border-line px-4 py-2.5 text-sm text-secondary hover:bg-[#f4f6f4]">取消</button>
          <button type="submit" disabled={pending} className="rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white hover:bg-[#1d6244]">{pending ? "正在保存…" : job ? "保存修改" : "新增岗位"}</button>
        </div>
      </form>
    </Modal>
  );
}
