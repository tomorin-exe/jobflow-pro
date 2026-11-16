import { Icon, type IconName } from "@/components/ui/icon";
import type { Job } from "@/types/job";

interface SummaryCardsProps {
  jobs: readonly Job[];
}

interface SummaryCard {
  label: string;
  value: number;
  hint: string;
  icon: IconName;
  color: string;
}

export function SummaryCards({ jobs }: SummaryCardsProps) {
  const cards: SummaryCard[] = [
    {
      label: "累计投递",
      value: jobs.length,
      hint: "每一次出发，都有迹可循",
      icon: "briefcase",
      color: "bg-[#f0f3f1] text-[#53665a]",
    },
    {
      label: "已投递",
      value: jobs.filter((job) => job.status === "applied").length,
      hint: "耐心等待，好消息会来的",
      icon: "send",
      color: "bg-sky-50 text-sky-600",
    },
    {
      label: "面试中",
      value: jobs.filter((job) => job.status === "interviewing").length,
      hint: "做好准备，自信展现自己",
      icon: "conversation",
      color: "bg-amber-50 text-amber-600",
    },
    {
      label: "已录用",
      value: jobs.filter((job) => job.status === "offered").length,
      hint: "努力，正在收获回响",
      icon: "award",
      color: "bg-emerald-50 text-emerald-600",
    },
  ];

  return (
    <section aria-label="全部投递统计" className="grid grid-cols-2 gap-3 md:gap-5 xl:grid-cols-4">
      {cards.map((card) => (
        <div key={card.label} className="rounded-xl border border-line bg-white p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xs font-medium text-secondary sm:text-sm">{card.label}</h2>
            <span className={`flex size-8 shrink-0 items-center justify-center rounded-lg sm:size-9 ${card.color}`}>
              <Icon name={card.icon} className="size-[18px]" />
            </span>
          </div>
          <p className="mt-2 font-mono text-[32px] leading-tight font-semibold tracking-tight sm:text-[38px]">{String(card.value).padStart(2, "0")}</p>
          <p className="mt-3 text-[11px] leading-5 text-muted sm:text-xs">{card.hint}</p>
        </div>
      ))}
    </section>
  );
}
