import { StatusBadge } from "@/components/jobs/status-badge";
import { Icon } from "@/components/ui/icon";
import type { Job } from "@/types/job";

const companyColors = [
  "bg-[#eaf3fd] text-[#3576b4]",
  "bg-[#fef0ed] text-[#c86651]",
  "bg-[#f1ecfa] text-[#8a64b6]",
  "bg-[#fff5df] text-[#a77b28]",
  "bg-[#eaf3ee] text-[#49795b]",
];

function CompanyIdentity({ company }: { company: string }) {
  const color = companyColors[company.charCodeAt(0) % companyColors.length];

  return (
    <div className="flex items-center gap-3">
      <span aria-hidden="true" className={`flex size-10 shrink-0 items-center justify-center rounded-[11px] text-base font-bold ${color}`}>
        {company.slice(0, 1)}
      </span>
      <span className="min-w-0 font-semibold text-primary [overflow-wrap:anywhere]">{company}</span>
    </div>
  );
}

function ApplicationDate({ date }: { date: string }) {
  // 直接显示日历日期，避免 Date 的 UTC 转换让用户看到前一天。
  return (
    <time dateTime={date} className="font-mono text-xs tracking-wide text-secondary">
      {date.replaceAll("-", ".")}
    </time>
  );
}

interface JobListProps {
  jobs: readonly Job[];
  isEmpty: boolean;
  onReset: () => void;
  onCreate: () => void;
  onEdit: (job: Job) => void;
  onDelete: (job: Job) => void;
}

function JobActions({ job, onEdit, onDelete }: Pick<JobListProps, "onEdit" | "onDelete"> & { job: Job }) {
  return (
    <div className="flex items-center justify-end gap-1">
      <button type="button" aria-label={`编辑${job.company}的${job.position}`} onClick={() => onEdit(job)} className="flex min-h-8 items-center gap-1.5 rounded-md px-2 text-xs text-secondary hover:bg-brand-light hover:text-brand">
        <Icon name="edit" className="size-3.5" /><span className="md:sr-only xl:not-sr-only">编辑</span>
      </button>
      <button type="button" aria-label={`删除${job.company}的${job.position}`} onClick={() => onDelete(job)} className="flex min-h-8 items-center gap-1.5 rounded-md px-2 text-xs text-secondary hover:bg-red-50 hover:text-red-700">
        <Icon name="trash" className="size-3.5" /><span className="md:sr-only xl:not-sr-only">删除</span>
      </button>
    </div>
  );
}

export function JobList({ jobs, isEmpty, onReset, onCreate, onEdit, onDelete }: JobListProps) {
  if (jobs.length === 0) {
    return (
      <div id="job-results" className="flex min-h-72 flex-col items-center justify-center px-5 py-12 text-center">
        <span className="mb-4 flex size-12 items-center justify-center rounded-full bg-brand-light text-brand"><Icon name="search" className="size-5" /></span>
        <h3 className="text-sm font-semibold">{isEmpty ? "还没有岗位记录" : "没有找到匹配的岗位"}</h3>
        <p className="mt-2 text-xs leading-6 text-secondary">{isEmpty ? "从一个新的机会开始，记录你的第一份投递。" : "试试其他关键词，或调整投递状态。"}</p>
        <button type="button" onClick={isEmpty ? onCreate : onReset} className="mt-5 rounded-lg border border-line px-4 py-2 text-xs font-medium text-brand transition-colors hover:bg-brand-light">{isEmpty ? "添加第一个岗位" : "重置所有筛选"}</button>
      </div>
    );
  }

  return (
    <div id="job-results">
      <table className="hidden w-full table-fixed text-left text-sm md:table">
        <caption className="sr-only">求职岗位列表，包含公司、职位、状态及投递日期</caption>
        <thead className="border-y border-line bg-[#fafbf9] text-xs text-secondary">
          <tr>
            <th scope="col" className="w-[23%] px-6 py-3.5 font-medium lg:pl-7">公司名称</th>
            <th scope="col" className="w-[29%] px-3 py-3.5 font-medium">职位名称</th>
            <th scope="col" className="w-[15%] px-3 py-3.5 font-medium">投递状态</th>
            <th scope="col" className="w-[18%] px-3 py-3.5 font-medium">投递日期</th>
            <th scope="col" className="w-[15%] px-3 py-3.5 pr-5 text-right font-medium">操作</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {jobs.map((job) => (
            <tr key={job.id} className="transition-colors hover:bg-[#fafcf9]">
              <td className="px-6 py-[19px] lg:pl-7">
                <CompanyIdentity company={job.company} />
              </td>
              <td className="px-3 py-[19px]">
                <p className="font-medium [overflow-wrap:anywhere]">{job.position}</p>
                <p className="mt-1.5 flex items-center gap-1 text-[11px] text-muted">
                  <Icon name="pin" className="size-3 shrink-0" /><span className="[overflow-wrap:anywhere]">{job.location}</span>
                </p>
                {job.notes && <p className="mt-1.5 line-clamp-2 whitespace-pre-wrap text-[11px] text-muted [overflow-wrap:anywhere]" title={job.notes}><span className="sr-only">备注：</span>{job.notes}</p>}
              </td>
              <td className="px-3 py-[19px]">
                <StatusBadge status={job.status} />
              </td>
              <td className="px-3 py-[19px]">
                <ApplicationDate date={job.appliedAt} />
              </td>
              <td className="px-3 py-[19px] pr-5"><JobActions job={job} onEdit={onEdit} onDelete={onDelete} /></td>
            </tr>
          ))}
        </tbody>
      </table>

      <ul aria-label="求职岗位列表" className="divide-y divide-line border-t border-line md:hidden">
        {jobs.map((job) => (
          <li key={job.id} className="p-5">
            <div className="flex items-center justify-between gap-3 text-sm">
              <CompanyIdentity company={job.company} />
              <StatusBadge status={job.status} />
            </div>
            <p className="mt-4 text-sm font-medium [overflow-wrap:anywhere]">{job.position}</p>
            <p className="mt-2 flex items-center gap-1 text-xs text-muted">
              <Icon name="pin" className="size-3 shrink-0" /><span className="[overflow-wrap:anywhere]">{job.location}</span>
            </p>
            {job.notes && <p className="mt-3 line-clamp-2 whitespace-pre-wrap text-xs leading-5 text-secondary [overflow-wrap:anywhere]"><span className="sr-only">备注：</span>{job.notes}</p>}
            <div className="mt-4 flex items-center justify-between border-t border-dashed border-line pt-3">
              <span className="text-[11px] text-muted">投递日期</span>
              <ApplicationDate date={job.appliedAt} />
            </div>
            <div className="mt-2"><JobActions job={job} onEdit={onEdit} onDelete={onDelete} /></div>
          </li>
        ))}
      </ul>
    </div>
  );
}
