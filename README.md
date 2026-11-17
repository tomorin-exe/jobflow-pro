# JobFlow Pro

基于 Next.js App Router、TypeScript 和 Tailwind CSS 的求职投递管理系统。已接入 Better Auth 注册、登录和退出，`/dashboard` 使用可信服务端 Session 保护，目前显示账号欢迎页。原 localStorage 岗位 CRUD 保留在明确标识的 `/demo`；两个只读岗位/健康 API 保持原样。认证迁移已执行，岗位 Repository 已按用户隔离，页面尚未接入岗位数据库 CRUD。

## 本地运行

首次安装依赖需要可访问 npm 仓库的网络环境。

当前 Windows PowerShell 如阻止 `npm.ps1`，请使用 `npm.cmd` 调用以下相同脚本，无需修改系统执行策略。

```bash
npm ci
npm run dev
```

访问终端显示的本地地址，通常为 http://localhost:3000。

首页转到受保护的 `/dashboard`，未登录时跳至 `/sign-in`；注册入口为 `/sign-up`，无需登录的本地演示入口为 `/demo`。使用与已有 `BETTER_AUTH_URL` 相同的来源。

```bash
npm run lint       # ESLint，任何警告也会导致检查失败
npm run build      # 生产构建，同时检查 TypeScript
npm run typecheck  # 单独执行 TypeScript 检查
npm run test:api   # HTTP 接口测试，需要先启动 Next.js 服务
npm run test:db    # 认证/Repository 单元测试及数据库测试；未执行认证迁移时跳过真实 CRUD
npm run test:auth  # 认证配置、授权边界单元测试，不连接数据库
npm run test:auth:http # 真实认证及页面保护，需要运行本地服务器；自动清理唯一测试账号
npm start          # 运行上一步构建的生产版本
npm run prisma:validate # 离线校验 Prisma schema
npm run prisma:generate # 只生成客户端，不创建数据库表
```

## 代码结构与关键设计

- PostgreSQL 配置与字段说明见 [数据库说明](docs/database.md)；Repository、错误处理和集成测试见 [数据访问层说明](docs/repository.md)。认证配置、迁移审核和双用户测试见 [认证说明](docs/authentication.md)。
- `prisma/schema.prisma`：Job、User、Session、Account、Verification 模型，状态枚举和索引。
- `prisma.config.ts`：Prisma 7 CLI 配置，复用 Next.js 环境变量加载器读取 `.env.local`。
- `prisma/migrations/`：首次和认证/岗位归属迁移均已执行，本阶段不修改历史文件。
- `src/lib/auth.ts`、`auth-client.ts`：Better Auth 服务端延迟实例和同源 React 客户端。
- `src/lib/session.ts`：读取可信服务端 Session，未登录时拒绝访问数据库岗位。
- `src/lib/auth-config.ts`、`auth-schema.ts`、`auth-error.ts`：配置校验、只读结构检查及安全错误。
- `src/app/api/auth/[...all]/route.ts`：Better Auth GET/POST 入口，迁移未完成时返回安全的 503。
- `src/lib/prisma.ts`：仅服务端可导入的延迟单例和关闭方法，使用 PrismaPg / pg，关闭原始错误日志。
- `src/repositories/job-repository.ts`：按会话 userId 隔离的岗位查询和 CRUD，可为服务端测试注入事务 Client。
- `src/lib/job-mapper.ts`：输入校验、写入字段白名单与 UTC 日期映射。
- `src/lib/database-error.ts`：可安全交给上层处理的错误，不携带原始连接信息或底层异常。
- `src/types/job-record.ts`：兼容现有 Job，附加 ISO 创建/修改时间戳。
- `tests/database.test.ts`：真实数据库与 CRUD、事务回滚清理、日期边界和连接失败测试。
- `tests/job-repository.test.ts`：日期映射、输入校验和错误脱敏测试。
- `tests/auth.test.ts`：未登录拒绝、所有者查询条件、伪造 userId 与配置脱敏测试。
- `tests/auth-form.test.ts`：表单校验、友好错误和按实际 Session 导航测试。
- `tests/auth-http.test.ts`：真实 HTTP 注册/登录/退出、旧 Cookie 撤销、保护页面和唯一账号清理。
- `.env.example`：数据库地址、认证密钥及应用 URL 的占位示例，无真实凭据。
- `src/app/page.tsx`：首页转向账号工作空间。
- `src/app/sign-in/page.tsx`、`sign-up/page.tsx`：动态认证页面，已登录时转工作空间。
- `src/app/dashboard/page.tsx`：服务端校验 Session，展示姓名、邮箱、退出入口及岗位接入提示。
- `src/app/demo/page.tsx`：保留旧页面、模拟初始数据和 localStorage 演示。
- `src/components/auth/`：复用认证页面框架、注册/登录表单和退出按钮。
- `src/lib/auth-form.ts`：表单类型、校验、白名单错误文案及固定站内导航逻辑。
- `src/app/error.tsx`：安全的页面错误与重试，不显示服务端异常细节。
- `src/app/layout.tsx`：全局 HTML 布局、中文语言设置和页面 metadata。
- `src/app/globals.css`：Tailwind 入口、主题颜色、字体和键盘焦点样式。
- `src/app/icon.svg`：本地站点图标，不依赖远程图片或字体。
- `src/types/job.ts`：定义包含备注的 `Job`、不含 ID 的表单输入 `JobInput`、字段错误和操作结果类型。
- `src/types/api.ts`：健康检查、岗位列表和参数错误的 JSON 响应类型；岗位响应复用 `Job`。
- `src/data/jobs.ts`：8 条首次访问时使用的初始记录；`satisfies Job[]` 校验数据结构。
- `src/app/api/health/route.ts`：`GET /api/health` 健康检查。
- `src/app/api/jobs/route.ts`：`GET /api/jobs`，读取模拟数据并校验可选的 `status` 参数。
- `tests/api.test.mjs`：使用 Node 内置 `node:test`、`fetch` 和断言模块，对真实 HTTP 服务验证接口契约。
- `src/lib/jobs.ts`：字段清理、必填/长度/日历日期/状态校验、运行时数据类型检查，以及返回新数组的 CRUD 纯函数。
- `src/lib/job-storage.ts`：存储键、JSON 解析、重复 ID 校验、唯一 ID 生成、读写异常处理和可订阅的数据快照。
- `src/hooks/use-jobs.ts`：用 `useSyncExternalStore` 将存储快照接入 React，并提供新增、修改、删除、重试和清空损坏数据方法。
- `src/lib/job-status.ts`：统一管理状态文案与样式；`satisfies Record<JobStatus, ...>` 能发现缺失的状态配置。
- `src/components/dashboard/sidebar.tsx`：响应式品牌与导航，手机上变为顶部栏。
- `src/components/ui/icon.tsx`：复用的内联 SVG 图标，无需额外图标依赖。
- `src/components/dashboard/job-dashboard.tsx`：组合数据 Hook、统计、列表、筛选和弹窗；保存筛选、搜索、排序及弹窗状态。
- `src/components/dashboard/summary-cards.tsx`：根据完整数据计算统计；切换筛选不会改变总体统计。
- `src/components/jobs/job-filters.tsx`：受控筛选组件，接收当前值并通过 `onChange` 通知父组件；使用 `aria-pressed` 表示选中状态。
- `src/components/jobs/status-badge.tsx`：复用状态标签，颜色之外也显示文字。
- `src/components/jobs/job-list.tsx`：桌面表格、手机卡片、备注、编辑/删除入口，并区分真实空列表与筛选无结果。
- `src/components/jobs/job-form.tsx`：新增/编辑共用表单，回填数据、字段错误提示、首个错误字段聚焦及保存失败提示。
- `src/components/ui/modal.tsx`：原生 dialog 弹窗，视口居中、锁定背景滚动、焦点管理、Escape 关闭和内部滚动布局。
- `src/components/ui/confirm-dialog.tsx`：删除岗位和清空损坏数据共用的确认弹窗，默认聚焦取消按钮。
- `package.json`：运行脚本和必要依赖；`tsconfig.json`：严格类型检查和 `@/` 路径别名。
- `package-lock.json`：锁定依赖的实际版本与完整性信息，配合 `npm ci` 复现安装。
- `eslint.config.mjs`：Next.js 和 TypeScript 的 ESLint 规则；`postcss.config.mjs`：Tailwind CSS 处理配置。
- `.gitignore`：忽略依赖、构建产物和本地环境文件。

### 数据如何流动

`表单 → 字段校验 → CRUD 纯函数 → localStorage 写入 → 发布快照 → useJobs → 统计 / 筛选 / 列表`

1. 服务端页面只传入初始数据，不访问 `window`。`useJobs` 在浏览器订阅外部存储后读取数据，服务端和首次客户端渲染都显示相同的加载状态，避免 hydration 不一致。
2. 表单用 `useState` 管理尚未保存的草稿。取消或按 Escape 关闭时不会调用写入方法。
3. 提交时先校验必填项、长度、日期和状态，再交给数据层。CRUD 函数返回新数组，修改岗位时保持原 ID。
4. 数据层先写入 localStorage，成功后才发布新快照。React 收到通知后重新计算统计、搜索、筛选和排序。如果存储写入失败，列表维持原样，弹窗保留输入并显示错误。
5. 新增 ID 优先使用 `crypto.randomUUID()`，不支持时使用 `crypto.getRandomValues()`；数据层也会检查 ID 是否重复。ID 不进入表单输入类型，不会被编辑覆盖。

只有交互区域 `JobDashboard` 标记为 `"use client"`，其子组件属于同一个客户端模块树；页面框架保留在服务端。`useSyncExternalStore` 用于订阅 React 外部的数据源，快照对象仅在数据变化时更新。

筛选结果直接由 `jobs`、`status` 和 `search` 推导，不重复保存在 state 中。状态与关键词条件使用逻辑 AND，因此可以组合筛选。小规模本地数据不需要 `useMemo` 或状态管理库。

记录默认按 `YYYY-MM-DD` 日期字符串降序排列，也可以选择最早投递优先；这种固定格式的字符串顺序与日期顺序相同。`filter` 先产生新数组再 `sort`，不会修改传入的数据。页面直接格式化日历日期，不使用可能带来时区偏移的 `new Date()`。

筛选按钮旁的数字表示全部岗位中的状态数量，底部显示当前结果数量。新增/修改岗位时保留当前筛选、关键词和排序条件，所以不符合条件的岗位可能暂时不显示。刷新后岗位数据保留，筛选、搜索和排序恢复默认值。

## localStorage 如何工作

存储键为 `jobflow-pro.jobs.v1`，值是整个岗位数组的 JSON 字符串。保存使用 `JSON.stringify`，读取使用 `JSON.parse`。JSON 的结果先按 `unknown` 处理，再检查数组、字段、状态、日历日期和 ID 唯一性；TypeScript 接口本身不会验证浏览器中的 JSON。

| 读取结果 | 行为 |
| --- | --- |
| `getItem` 返回 `null` | 仅此时初始化并保存 8 条模拟数据 |
| 内容是有效数组，包括 `[]` | 原样读取；空数组不会恢复模拟数据 |
| JSON 无法解析或记录结构不合法 | 保留原始内容，提示重试或确认清空，不自动覆盖 |
| 读写权限不足或空间不足 | 显示错误；写入失败不会更新列表或显示保存成功 |

确认“清空损坏数据”会保存 `[]`，从空列表开始；取消不改变原始内容。代码只操作本项目的存储键，不调用 `localStorage.clear()`。

数据按站点源（协议、域名、端口）隔离，保存在当前浏览器，刷新和关闭页面后通常仍保留。更换浏览器、设备或地址不会自动共享数据，清理站点数据会移除记录。`storage` 事件用于接收其他标签页的更新；这不提供数据库级的并发事务。

表单中公司、职位和地点各最多 100 个字符，备注选填且最多 2000 个字符；投递日期必须是真实有效的 `YYYY-MM-DD` 日历日期。

## 只读 REST API

这两个接口只读取 `src/data/jobs.ts` 的模拟数据。页面的数据源仍是 localStorage；在页面新增、编辑或删除的记录不会同步到这些接口，接口也不会读取浏览器存储。

| 请求 | HTTP 状态 | 响应 |
| --- | --- | --- |
| `GET /api/health` | 200 | `{ "status": "ok", "service": "jobflow" }` |
| `GET /api/jobs` | 200 | `{ "data": [完整 Job 记录], "total": 8 }` |
| `GET /api/jobs?status=applied` | 200 | 当前 3 条已投递记录及 `total: 3` |
| `GET /api/jobs?status=interviewing` | 200 | 当前 3 条面试中记录及 `total: 3` |
| `GET /api/jobs?status=offered` | 200 | 当前 1 条已录用记录及 `total: 1` |
| `GET /api/jobs?status=rejected` | 200 | 当前 1 条未通过记录及 `total: 1` |

不传 `status` 表示返回全部岗位；传入时必须是上述英文状态值之一，且区分大小写。空值、中文显示文案、前后空格、前端专用的 `all` 和重复参数都会返回 400。示例：

```json
{
  "error": {
    "code": "INVALID_STATUS",
    "message": "status 参数只能出现一次，且必须是以下值之一：applied、interviewing、offered、rejected。"
  }
}
```

`total` 始终等于当前返回的 `data.length`。两个 Route Handler 只导出 `GET`；POST、PATCH、DELETE 未实现，由 Next.js 返回 405。

### Route Handler 如何工作

文件路径决定 URL：`src/app/api/jobs/route.ts` 对应 `/api/jobs`，导出的 `GET` 函数处理 GET 请求。`NextRequest.nextUrl.searchParams` 提供 URL 查询参数，现有 `isJobStatus` 对外部输入进行运行时校验。合法请求对 `mockJobs` 进行只读筛选，再使用 `NextResponse.json` 返回 JSON 和 Content-Type；错误请求显式设置 HTTP 400。

`src/types/api.ts` 定义服务端响应契约，`JobsResponse.data` 使用已有 `Job[]`。泛型 `NextResponse.json<JobsResponse>` 让错误的响应字段在编译阶段暴露；查询参数仍需要运行时校验，因为 TypeScript 不会检查用户实际发来的字符串。

### 运行接口测试

先在一个终端启动服务，例如使用生产版本：

```bash
npm run build
npm start
```

再在另一个终端执行：

```bash
npm run test:api
```

默认测试地址是 `http://127.0.0.1:3000`，也可对 `npm run dev` 启动的服务测试。若端口不同，在 PowerShell 中设置：

```powershell
$env:API_BASE_URL = "http://127.0.0.1:3012"
npm run test:api
```

测试会发送真实请求，因此能覆盖 Next.js 路由映射、查询参数解析、HTTP 状态码、JSON Content-Type、响应结构和未实现方法的 405 行为。当前有 22 项测试，包含默认数据、全部合法状态、非法/空/重复参数以及筛选后原始数据不变；无需安装额外测试依赖。

## 手动验证

1. **首次读取**：运行 `npm run dev`，用没有本项目存储记录的测试浏览器打开页面，应出现 8 条初始记录。已有存储时应读取原有记录。
2. **新增与校验**：点击“新增岗位”，空表单提交应显示必填错误并聚焦第一个错误字段；只填空格或清空日期也不能提交。填全字段和备注后保存，列表、统计即时变化。再次打开表单后取消或按 Escape，不能新增记录。
3. **编辑与刷新**：点击任一记录的编辑，核对六个字段全部回填。修改后先取消，数据应不变；重新编辑并保存，刷新页面确认修改和备注保留。可在开发者工具的 Application → Local Storage 中核对该岗位 ID 未变化。
4. **筛选、搜索和排序**：新增一个特殊公司名的岗位，用公司、职位或城市搜索；切换状态筛选；修改岗位状态和投递日期后，检查当前筛选和日期排序重新生效。搜索不存在的关键词应显示筛选空态，重置后恢复全部岗位。
5. **删除确认**：点击删除后先取消，再尝试 Escape，都不能移除记录。点击“确认删除”后应即时消失，刷新后仍不存在。
6. **删除全部**：在无重要数据的测试环境逐一删除全部记录，刷新后仍显示“还没有岗位记录”；开发者工具中存储值应为 `[]`。点击“添加第一个岗位”应能重新新增。
7. **损坏数据**：在单独的测试地址中备份该存储键原值，再将值改为 `{broken` 并刷新。应显示错误且不覆盖原文；重试读取和取消清空都不改数据，确认清空后应保存 `[]` 并显示真实空态。异常验证后可恢复备份。
8. **手机、矮屏与弹窗**：将宽度设为 375px、高度设为 667px，再测试新增、编辑和删除。弹窗应居中，标题和保存按钮始终可见，只有表单内容区滚动；背景不能滚动，关闭后恢复。用 Tab 检查焦点留在弹窗内，用 Escape 取消，页面不能横向溢出。

项目已生成 `package-lock.json`，应与源码一起提交到版本控制。日常安装使用 `npm ci`；只有有意调整依赖时才使用 `npm install` 并检查锁文件变更。

## 本次环境的验证结果

- 认证与初始数据库迁移均已执行；本阶段保留 Schema、服务端认证配置和全部迁移文件，未修改真实环境变量文件。
- 注册、登录、受保护工作空间、退出及演示页已完成；lint、typecheck、生产构建全部通过。
- test:db 为 22/22，原有 test:api 为 22/22，新增 test:auth:http 为 2/2，均无失败和跳过。
- 真实 HTTP 与浏览器验证注册/登录、错误凭据、刷新会话、退出后旧 Cookie 失效和页面保护；独立测试账号均已清理。
- 注册、登录及演示页在 320/375/768/1440px 无横向溢出；密码及认证会话不存入 localStorage。

## 认证迁移准备阶段记录（历史）

- Better Auth 阶段：jobs 只读计数为 0；新增迁移未执行，已执行的初始迁移及 lock 文件哈希保持不变。
- 已锁定 Better Auth 与 Prisma adapter 为 1.7.25，保留 Prisma 7.10.1；schema 校验、Client 生成、lint、typecheck、build 全部通过。
- 最终迁移审查已为四张认证表补充 PostgreSQL 原生 UUID 默认值；Verification.updatedAt 原本已经存在且与 Schema 一致，离线 diff 核对 SQL 完全匹配。
- 原有模拟 API 测试 22/22 通过；test:db 为 12 项单元测试通过（含 UUID 与 Adapter 审查测试）、5 项数据库集成测试因待迁移跳过，没有失败。
- 生产服务上的认证 Session 查询及空注册请求均返回 503 / AUTH_MIGRATION_REQUIRED，未创建认证或业务记录。
- 只读 migrate status 退出码为 1，原因是新增迁移尚未应用，符合本次只准备不执行的要求。真实登录及双用户数据库隔离待用户审核迁移后验证。

## 历史验证记录

- Repository 阶段：只读确认迁移 up to date；实际连接 `jobflow_db` / `jobflow_app`，确认 PostgreSQL 18.7。
- 新增 9 项验证（4 项数据库集成、5 项映射/校验），在上海和洛杉矶时区均 9/9 通过；测试事务回滚后按测试 UUID 确认无残留。
- lint、TypeScript、生产构建和原有 22 项模拟 API 测试通过。schema 和迁移文件未修改，未执行迁移、重置或业务数据清空。
- Repository 阶段仅新增开发依赖 tsx，用于在 Node 测试中执行同一份 TypeScript Repository；当时运行时 Prisma、adapter 与 pg 版本未变。
- 以下为先前 Prisma 准备阶段与前端阶段的历史验证记录。
- Prisma 准备阶段：已锁定 Prisma CLI、Client、PostgreSQL adapter 为 7.10.1；schema 校验、Client 生成、lint、构建和 22 项只读 API 测试通过。
- 已在隔离目录验证开发/生产环境加载 `.env.local`、缺失地址时允许离线工具运行，以及环境变量优先级；没有读取或输出真实数据库密码。
- 首次 SQL 由离线 diff 生成，尚未应用。没有连接或检查实际数据库结构，真实连接及迁移执行需等待审核。
- 本阶段只读 API：在生产服务上执行 `npm run test:api`，22 项通过、0 失败，未跳过测试。
- REST API 与 CRUD 阶段未新增外部服务；本次新增 Prisma 和本地 PostgreSQL 所需依赖。
- `npm run lint` 通过，0 错误、0 警告。
- `npm run typecheck` 通过。
- `npm run build` 通过，首页成功生成静态页面。
- 以下前端浏览器记录保留自 CRUD 阶段；本次没有修改 Dashboard、表单或 localStorage 数据逻辑。
- 在独立测试端口的生产版本中验证通过：新增、六字段回填、编辑取消/保存、删除取消/Escape/确认、备注、ID 稳定唯一、刷新持久化、统计更新及筛选/搜索/排序兼容。
- 删除全部后存储为 `[]`，刷新不会恢复模拟数据；真实空态仍可新增。
- 无效 JSON、非数组、字段缺失、非法状态、无效日期及重复 ID 均被识别，原文保留。重试、取消清空及确认清空均通过。
- 模拟存储读取权限失败和写入空间不足：有可见错误提示，失败的新增/编辑/删除均不改变原始存储和列表。
- 320、375、768、1024、1440px 宽度含长文本均无横向溢出；手机 CRUD、2000 字符备注、弹窗焦点限制及关闭后滚动恢复通过。
- 桌面、矮屏和手机弹窗居中，标题与保存按钮保持可见，背景滚动被锁定。已检查桌面、手机和表单截图；浏览器控制台无错误或警告。

以上浏览器检查使用当前环境提供的 Chromium，不代表已覆盖所有浏览器与实体手机。

上次未完成的依赖备份和本次验证截图保留在 `.qa`，该目录被 Git 和 TypeScript 忽略，不参与应用运行。当前依赖已完整安装在根目录的 `node_modules`。
