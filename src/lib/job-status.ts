import type { JobStatus } from "@/types/job";

// 用完整类名让 Tailwind 能在构建时发现样式；Record 保证每种状态都有配置。
export const JOB_STATUS_META = {
  applied: {
    label: "已投递",
    badgeClassName: "bg-sky-50 text-sky-700 ring-sky-100",
    dotClassName: "bg-sky-500",
  },
  interviewing: {
    label: "面试中",
    badgeClassName: "bg-amber-50 text-amber-800 ring-amber-100",
    dotClassName: "bg-amber-500",
  },
  offered: {
    label: "已录用",
    badgeClassName: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    dotClassName: "bg-emerald-500",
  },
  rejected: {
    label: "未通过",
    badgeClassName: "bg-stone-100 text-stone-600 ring-stone-200",
    dotClassName: "bg-stone-400",
  },
} satisfies Record<
  JobStatus,
  { label: string; badgeClassName: string; dotClassName: string }
>;
