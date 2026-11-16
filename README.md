# JobFlow Pro

基于 Next.js App Router、TypeScript 和 Tailwind CSS 的求职投递管理页面。目前仅包含前端和固定的本地演示数据，没有数据库、登录或外部 API。

## 本地运行

首次安装依赖需要可访问 npm 仓库的网络环境。

```bash
npm ci
npm run dev
```

访问终端显示的本地地址，通常为 http://localhost:3000。

```bash
npm run lint       # ESLint，任何警告也会导致检查失败
npm run build      # 生产构建，同时检查 TypeScript
npm run typecheck  # 单独执行 TypeScript 检查
npm start          # 运行上一步构建的生产版本
```

## 代码结构与关键设计

- `src/app/page.tsx`：服务端页面入口，组合页面框架并将本地岗位数据传给交互组件。
- `src/app/layout.tsx`：全局 HTML 布局、中文语言设置和页面 metadata。
- `src/app/globals.css`：Tailwind 入口、主题颜色、字体和键盘焦点样式。
- `src/app/icon.svg`：本地站点图标，不依赖远程图片或字体。
- `src/types/job.ts`：定义 `Job` 接口与状态联合类型。`as const` 保留状态的字面量类型，`JobStatusFilter` 额外允许 `all`。
- `src/data/jobs.ts`：8 条模拟记录；`satisfies Job[]` 验证记录满足接口而不丢失推断类型。
- `src/lib/job-status.ts`：统一管理状态文案与样式；`satisfies Record<JobStatus, ...>` 能发现缺失的状态配置。
- `src/components/dashboard/sidebar.tsx`：响应式品牌与导航，手机上变为顶部栏。
- `src/components/ui/icon.tsx`：复用的内联 SVG 图标，无需额外图标依赖。
- `src/components/dashboard/job-dashboard.tsx`：客户端交互入口，用 `useState` 保存状态筛选、搜索词和日期排序方式。
- `src/components/dashboard/summary-cards.tsx`：根据完整数据计算统计；切换筛选不会改变总体统计。
- `src/components/jobs/job-filters.tsx`：受控筛选组件，接收当前值并通过 `onChange` 通知父组件；使用 `aria-pressed` 表示选中状态。
- `src/components/jobs/status-badge.tsx`：复用状态标签，颜色之外也显示文字。
- `src/components/jobs/job-list.tsx`：桌面语义化表格、手机卡片与可重置的空结果提示。
- `package.json`：运行脚本和必要依赖；`tsconfig.json`：严格类型检查和 `@/` 路径别名。
- `package-lock.json`：锁定依赖的实际版本与完整性信息，配合 `npm ci` 复现安装。
- `eslint.config.mjs`：Next.js 和 TypeScript 的 ESLint 规则；`postcss.config.mjs`：Tailwind CSS 处理配置。
- `.gitignore`：忽略依赖、构建产物和本地环境文件。

### 数据如何流动

`mockJobs → HomePage → JobDashboard → 统计 / 筛选 / 列表`

只有需要交互的 `JobDashboard` 标记为 `"use client"`。它的子组件属于同一个客户端模块树，其余页面框架保留在服务端。

筛选结果直接由 `jobs`、`status` 和 `search` 推导，不重复保存在 state 中。状态与关键词条件使用逻辑 AND，因此可以组合筛选。小规模本地数据不需要 `useMemo` 或状态管理库。

记录默认按 `YYYY-MM-DD` 日期字符串降序排列，也可以选择最早投递优先；这种固定格式的字符串顺序与日期顺序相同。`filter` 先产生新数组再 `sort`，不会修改传入的数据。页面直接格式化日历日期，不使用可能带来时区偏移的 `new Date()`。

筛选按钮旁的数字表示全部数据中的状态数量，底部显示当前搜索和筛选后的数量。所有交互只在当前页面内生效，刷新后恢复默认状态。

## 手动验证

1. 运行 `npm run dev` 并打开首页：桌面应显示 8 条记录，统计依次为 08、03、03、01；公司、职位、状态、投递日期齐全，日期从新到旧。
2. 依次点击“已投递”“面试中”“已录用”：分别显示 3、3、1 条对应状态记录。回到“全部岗位”显示 8 条。搜索不存在的公司应出现空结果，点击“重置所有筛选”恢复 8 条。
3. 将浏览器缩窄到 375px：顶部导航、两列统计和岗位卡片没有横向溢出；筛选与搜索仍可使用。日期排序切换到“最早投递优先”后，2026.11.06 应排在第一条。按 Tab 键能依次聚焦搜索框、筛选按钮和排序选择框，并用 Enter 或空格激活按钮。

项目已生成 `package-lock.json`，应与源码一起提交到版本控制。日常安装使用 `npm ci`；只有有意调整依赖时才使用 `npm install` 并检查锁文件变更。

## 本次环境的验证结果

- 依赖安装成功，使用用户配置的 npm 镜像源，未新增依赖。
- `npm run lint` 通过，0 错误、0 警告。初始化 PostCSS 配置的匿名默认导出已改为命名变量后导出。
- `npm run typecheck` 通过。
- `npm run build` 通过，首页成功生成静态页面。
- 在生产版本中完成浏览器验证：默认 8 条记录与统计、四种状态筛选、公司/职位/城市搜索、忽略关键词大小写与首尾空格、组合筛选、空结果重置、日期升降序以及刷新恢复默认视图均通过。
- 响应式检查通过：320、375、768、1024、1440px 宽度均无横向溢出，手机显示卡片、桌面显示表格。
- 手机端筛选、搜索、重置、排序、Tab 焦点及 Enter/空格操作通过；浏览器控制台无错误或警告。已检查桌面与手机截图。

以上浏览器检查使用当前环境提供的 Chromium，不代表已覆盖所有浏览器与实体手机。

上次未完成的依赖备份和本次验证截图保留在 `.qa`，该目录被 Git 和 TypeScript 忽略，不参与应用运行。当前依赖已完整安装在根目录的 `node_modules`。
