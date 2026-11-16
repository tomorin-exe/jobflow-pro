import { JOB_STATUS_META } from "@/lib/job-status";
import type { JobStatus } from "@/types/job";

export function StatusBadge({ status }: { status: JobStatus }) {
  const meta = JOB_STATUS_META[status];

  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${meta.badgeClassName}`}>
      <span aria-hidden="true" className={`size-1.5 rounded-full ${meta.dotClassName}`} />
      {meta.label}
    </span>
  );
}
