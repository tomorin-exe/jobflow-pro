import { JOB_STATUS_META } from "@/lib/job-status";
import { JOB_STATUSES, type Job, type JobStatusFilter } from "@/types/job";

interface JobFiltersProps {
  jobs: readonly Job[];
  value: JobStatusFilter;
  onChange: (status: JobStatusFilter) => void;
}

export function JobFilters({ jobs, value, onChange }: JobFiltersProps) {
  const options = [
    { value: "all" as const, label: "全部岗位", count: jobs.length },
    ...JOB_STATUSES.map((status) => ({
      value: status,
      label: JOB_STATUS_META[status].label,
      count: jobs.filter((job) => job.status === status).length,
    })),
  ];

  return (
    <div role="group" aria-label="按投递状态筛选" className="flex flex-wrap gap-1 rounded-lg bg-[#f4f6f4] p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          aria-controls="job-results"
          onClick={() => onChange(option.value)}
          className={`flex items-center gap-2 rounded-md px-3 py-2 text-xs font-medium transition-colors sm:text-[13px] ${value === option.value ? "bg-white text-brand shadow-[0_1px_4px_#182d1510]" : "text-secondary hover:bg-white/60 hover:text-primary"}`}
        >
          {option.label}
          <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] leading-none ${value === option.value ? "bg-brand-light text-brand" : "bg-[#e9ede9] text-secondary"}`}>{option.count}</span>
        </button>
      ))}
    </div>
  );
}
