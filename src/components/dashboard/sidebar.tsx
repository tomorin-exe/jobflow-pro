import { Icon } from "@/components/ui/icon";

export function Sidebar() {
  return (
    <aside className="flex border-b border-line bg-white lg:fixed lg:inset-y-0 lg:left-0 lg:w-60 lg:flex-col lg:border-r lg:border-b-0">
      <a href="#main-content" aria-label="JobFlow Pro，前往主内容" className="flex items-center gap-2.5 px-5 py-5 lg:px-7 lg:py-9">
        <span className="flex size-9 items-center justify-center rounded-xl bg-brand text-white shadow-sm">
          <Icon name="briefcase" className="size-5" />
        </span>
        <span className="flex items-baseline gap-1.5 text-xl font-bold tracking-tight">
          JobFlow <span className="text-[10px] font-semibold tracking-wider text-brand">PRO</span>
        </span>
      </a>

      <nav aria-label="主导航" className="ml-auto flex items-center pr-5 lg:mt-6 lg:ml-0 lg:block lg:px-4">
        <p className="mb-3 hidden px-4 text-[10px] font-semibold tracking-[0.18em] text-muted lg:block">本地演示</p>
        <a href="#main-content" aria-current="page" className="flex items-center gap-3 rounded-lg bg-brand-light px-3 py-2.5 text-sm font-semibold text-brand lg:px-4 lg:py-3">
          <Icon name="grid" className="hidden size-[18px] sm:block" />
          <span>演示投递</span>
          <span className="ml-auto hidden size-1.5 rounded-full bg-brand lg:block" />
        </a>
      </nav>

      <div className="mt-auto hidden px-5 pb-7 lg:block">
        <div className="relative overflow-hidden rounded-xl border border-[#e1e9df] bg-[#f4f7f0] p-4">
          <div className="mb-5 flex size-8 items-center justify-center rounded-full bg-white text-brand"><Icon name="leaf" className="size-[18px]" /></div>
          <p className="text-sm font-semibold leading-6 text-[#3a5145]">好机会，正在路上。</p>
          <p className="mt-1 text-xs leading-6 text-[#718075]">每一步小小的行动，<br />都是向理想工作的靠近。</p>
          <div aria-hidden="true" className="absolute -right-8 -bottom-8 size-24 rounded-full border-[16px] border-[#e8eedf]" />
        </div>
        <div className="mt-6 flex items-center gap-2 px-1 text-[11px] text-muted">
          <span className="size-1.5 rounded-full bg-brand" />
          专注当下，记录每一次成长
        </div>
      </div>
    </aside>
  );
}
