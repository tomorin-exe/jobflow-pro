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
      <span className="font-semibold text-primary">{company}</span>
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
  onReset: () => void;
}

export function JobList({ jobs, onReset }: JobListProps) {
  if (jobs.length === 0) {
    return (
      <div id="job-results" className="flex min-h-72 flex-col items-center justify-center px-5 py-12 text-center">
        <span className="mb-4 flex size-12 items-center justify-center rounded-full bg-brand-light text-brand"><Icon name="search" className="size-5" /></span>
        <h3 className="text-sm font-semibold">没有找到匹配的岗位</h3>
        <p className="mt-2 text-xs leading-6 text-secondary">试试其他关键词，或调整投递状态。</p>
        <button type="button" onClick={onReset} className="mt-5 rounded-lg border border-line px-4 py-2 text-xs font-medium text-brand transition-colors hover:bg-brand-light">重置所有筛选</button>
      </div>
    );
  }

  return (
    <div id="job-results">
      <table className="hidden w-full text-left text-sm md:table">
        <caption className="sr-only">求职岗位列表，包含公司、职位、状态及投递日期</caption>
        <thead className="border-y border-line bg-[#fafbf9] text-xs text-secondary">
          <tr>
            <th scope="col" className="w-[27%] px-6 py-3.5 font-medium lg:pl-7">公司名称</th>
            <th scope="col" className="w-[33%] px-3 py-3.5 font-medium">职位名称</th>
            <th scope="col" className="w-[19%] px-3 py-3.5 font-medium">投递状态</th>
            <th scope="col" className="px-3 py-3.5 pr-6 font-medium">投递日期</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {jobs.map((job) => (
            <tr key={job.id} className="transition-colors hover:bg-[#fafcf9]">
              <td className="px-6 py-[19px] lg:pl-7">
                <CompanyIdentity company={job.company} />
              </td>
              <td className="px-3 py-[19px]">
                <p className="font-medium">{job.position}</p>
                <p className="mt-1.5 flex items-center gap-1 text-[11px] text-muted">
                  <Icon name="pin" className="size-3" />{job.location}
                </p>
              </td>
              <td className="px-3 py-[19px]">
                <StatusBadge status={job.status} />
              </td>
              <td className="px-3 py-[19px] pr-6">
                <ApplicationDate date={job.appliedAt} />
              </td>
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
            <p className="mt-4 text-sm font-medium">{job.position}</p>
            <p className="mt-2 flex items-center gap-1 text-xs text-muted">
              <Icon name="pin" className="size-3" />{job.location}
            </p>
            <div className="mt-4 flex items-center justify-between border-t border-dashed border-line pt-3">
              <span className="text-[11px] text-muted">投递日期</span>
              <ApplicationDate date={job.appliedAt} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
