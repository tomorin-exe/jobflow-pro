# JobFlow Pro

一个从前端演示逐步演进为全栈应用的求职投递管理系统。使用 Next.js、TypeScript、Better Auth、Prisma 与 PostgreSQL，实现登录、私人岗位管理、CSV 批量导入和自动化测试。

**展示入口：** 在线演示待部署 · 项目截图待补充 · GitHub Actions 工作流已配置，首次运行结果以仓库 Actions 页面为准。

<!-- 创建 GitHub 仓库后，将 OWNER/REPOSITORY 替换为实际路径，再启用徽章。
[![CI](https://github.com/OWNER/REPOSITORY/actions/workflows/ci.yml/badge.svg)](https://github.com/OWNER/REPOSITORY/actions/workflows/ci.yml)
-->

## 核心功能

- **私人工作空间**：新增、编辑、删除岗位，状态筛选、搜索、日期排序、实时统计，适配手机与桌面。
- **两种认证方式**：邮箱密码、邮箱验证码注册/登录；QQ SMTP 发信，验证码加密保存，服务端限制发送与猜测次数。
- **跨用户隔离**：页面和每次私人 API 请求都校验真实 Session。所有者取自服务端；越权与不存在统一返回404。
- **CSV 导入**：支持 UTF-8 BOM、引号、逗号、多行备注，提供实际行号错误、逐行勾选和导入确认。
- **疑似重复检测**：只比较当前用户及本 CSV，按规范化的公司＋职位＋地点匹配；默认不选重复项，明确确认后可保留为新岗位。
- **事务与幂等**：岗位与批次结果原子提交；同一用户的导入串行化，响应丢失后的同批重试不会重复创建，删除后重放也不会复活岗位。
- **独立演示**：公开 `/demo` 使用浏览器 localStorage；不会自动导入或混入私人数据库记录。

## 技术栈

| 层次 | 技术 |
| --- | --- |
| 页面与样式 | Next.js 16 App Router、React 19、TypeScript、Tailwind CSS 4 |
| 认证与邮件 | Better Auth 1.7.25、官方 Email OTP、Nodemailer、QQ SMTP |
| 服务端与数据 | Route Handlers、Repository、Prisma 7.10.1、PostgreSQL 18 |
| 导入 | csv-parse、前后端共用校验、预览版本检查、持久化批次幂等 |
| 验证与交付 | Node.js 24 内置测试、模拟 SMTP、GitHub Actions、临时 PostgreSQL service |

实际版本与依赖完整性由 `package-lock.json` 锁定，安装使用 `npm ci`。

## 架构

```mermaid
flowchart TD
  Browser[React Dashboard / CSV 预览] -->|同源 fetch + Cookie| API[受保护 REST API]
  Page[Dashboard Server Component] --> Session[Better Auth Session 校验]
  API --> Session
  Session -->|可信 session.user.id| Repo[Job / Import Repository]
  Repo --> Mapper[字段白名单 / 校验 / DATE 映射]
  Mapper --> Prisma[Prisma Client + PostgreSQL Adapter]
  Prisma --> DB[(PostgreSQL)]
  AuthUI[密码 / OTP 表单] --> Auth[Better Auth Route Handler]
  Auth --> DB
  Auth --> SMTP[Nodemailer / QQ SMTP]
  Demo[公开 /demo] --> Local[独立 localStorage]
```

Better Auth 管理密码、验证码与 HttpOnly Cookie。客户端负责交互，服务端 Session 决定权限；Repository 将每条查询和写入约束到当前用户。Prisma 负责类型化数据库访问，Mapper 保持 PostgreSQL DATE 与前端 `YYYY-MM-DD` 日期一致。

CSV 导入经历“解析 → 预览 → 选择确认 → 服务端重校验 → 事务写入”。客户端预览与 userId 不被当作可信输入；数据库只保存确认选择的有效行，既不覆盖也不删除已有岗位。批次结果与岗位在同一事务中持久化，解决超时后无法判断是否已提交的问题。

## 本地运行

需要 Node.js 24、npm 11+、PostgreSQL 18。Windows PowerShell 若阻止 `npm.ps1`，将下列 `npm` / `npx` 换为 `npm.cmd` / `npx.cmd` 即可，无需修改系统执行策略。

1. 安装锁定依赖：

   ```sh
   npm ci
   ```

2. 用 pgAdmin 或 PostgreSQL 工具创建本地 `jobflow_db` 和拥有该库的应用账号 `jobflow_app`。应用账号应为非管理员；不要使用 postgres 超级用户连接应用。
3. 复制 `.env.example` 为 `.env.local`，只在本机替换占位值。不要覆盖已有配置或提交真实密码：

   ```dotenv
   DATABASE_URL="postgresql://jobflow_app:YOUR_URL_ENCODED_PASSWORD@127.0.0.1:5432/jobflow_db?schema=public"
   BETTER_AUTH_SECRET="REPLACE_WITH_A_RANDOM_SECRET_AT_LEAST_32_CHARACTERS"
   BETTER_AUTH_URL="http://localhost:3000"
   QQ_SMTP_USER="your_mailbox@qq.com"
   QQ_SMTP_AUTH_CODE="REPLACE_WITH_QQ_SMTP_AUTHORIZATION_CODE"
   ```

   数据库密码中的特殊字符需 URL 编码；认证密钥使用本机随机生成的至少32字符值。QQ SMTP 使用授权码，密码注册登录和 `/demo` 不要求配置真实邮件服务。[详细邮件配置及旧账号兼容流程](docs/email-otp.md)。

4. 确认 DATABASE_URL 指向自己的本地开发库。首次运行先校验并审核迁移，已有数据先备份，再执行：

   ```sh
   npm run prisma:validate
   npm run prisma:generate
   npx prisma migrate deploy
   npm run dev
   ```

访问 `http://localhost:3000`。`/` 转向受保护的 `/dashboard`；未登录进入 `/sign-in`。浏览器来源必须与 BETTER_AUTH_URL 一致。

安装、生成 Client 和构建不会自动迁移数据库。不要修改已执行的历史迁移，也不要对业务库运行 reset 或 db push。数据库字段和初始化细节见 [数据库文档](docs/database.md)。

## 测试

```sh
npm run lint
npm run typecheck
npm run build
npm run test:all
npm run check:ci
npm run audit:repo
```

`test:all` 运行全部原有测试及 CI 防护测试，自动启动自己的生产 HTTP 测试服务器，等待 `/api/health`，依次验证模拟 API、认证、岗位和导入，最后停止该进程。默认使用独立端口3017；端口被占用时会失败，不会停止其他进程。HTTP 套件之间等待现有注册限流窗口，不放宽认证策略。

本地数据库测试仅允许 loopback 上的 `jobflow_db / jobflow_app`；CI 仅允许独立的 `jobflow_ci / jobflow_ci_app`，并验证本次任务的数据库标记。测试创建随机账号、岗位和批次，使用事务回滚或按明确ID清理，不清空业务表。未迁移或目标错误会失败，不跳过数据库测试。

邮件测试连接本地随机端口的模拟 SMTP，使用注入发送器。统一测试入口会清空真实 QQ SMTP 凭据，不向真实收件人发送邮件。认证密钥、密码和 OTP 不写入浏览器存储或日志。

本次本地验证：**原有133项＋新增4项CI防护测试，共137项**。测试细分、HTTP启动器与CI边界见 [CI与交付说明](docs/ci.md)。

## GitHub Actions

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) 在 main 推送、Pull Request 和手动触发时运行：

1. Ubuntu runner 配置 Node.js 24，Actions 固定到审核过的提交 SHA。
2. 启动 PostgreSQL 18 service，创建独立临时数据库及非管理员应用角色；每次任务生成随机数据库密码和认证密钥，不使用仓库生产 Secrets。
3. `npm ci`、仓库安全检查、Prisma Client 生成、Schema 校验；仅对带本任务标记的 CI 数据库执行 migrate deploy。
4. ESLint、TypeScript、生产构建、全部单元/数据库/认证/岗位/CSV/模拟SMTP/HTTP测试。
5. 测试启动器清理自己创建的服务进程；job结束时GitHub销毁service。工作流没有推送、发布或部署步骤。

首次云端运行需要你将代码提交到 GitHub；本地 Windows 验证不等同于 Actions 已在 Ubuntu 上运行。首次绿色结果与状态徽章以实际 Actions 记录为准。

## 展示素材与文档

- 在线演示：**待部署**，后续在此填写实际地址。
- 截图：**待补充**。建议展示 `/demo`、CSV错误预览和重复确认，按 [截图规范](docs/screenshots/README.md)只使用模拟资料。
- [认证与Session](docs/authentication.md) · [Email OTP与QQ SMTP](docs/email-otp.md)
- [REST API与权限边界](docs/jobs-api.md) · [Repository与日期映射](docs/repository.md)
- [CSV格式、重复规则、事务与幂等](docs/csv-import.md) · [远程Dashboard状态管理](docs/remote-dashboard.md)
- [GitHub交付、安全检查与CI](docs/ci.md)

当前没有公开部署、XLSX导入、模糊匹配或密码找回界面；这些能力没有被当作已完成的功能展示。
