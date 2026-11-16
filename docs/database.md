# PostgreSQL 与 Prisma

**初始迁移已由用户执行完成，本阶段通过只读命令确认数据库已是最新状态。** 已实现服务端 Repository 并在真实 PostgreSQL 上完成事务内 CRUD 验证，页面和模拟 API 数据来源保持原样。详细用法见 [Repository 与数据库测试](repository.md)。以下模型和初始 SQL 保留不变。

## 版本与配置选择

- 本机 Node.js 24.22.1、TypeScript 5.9，符合 [Prisma 7 系统要求](https://www.prisma.io/docs/orm/v7/reference/system-requirements)。[支持数据库列表](https://www.prisma.io/docs/orm/v7/reference/supported-databases)包含 PostgreSQL 18；本项目目标为用户提供的 PostgreSQL 18.7。
- `prisma`、`@prisma/client`、`@prisma/adapter-pg` 全部精确锁定为 **7.10.1**，采用 Prisma 7 配置方式。检查时 `prisma` 的 `latest` 指向 8 的 RC，因此不使用无版本限制的安装命令。
- 使用 `prisma-client` 生成器，ESM 输出到 `src/generated/prisma`，搭配 `pg` 驱动及 `PrismaPg` adapter；连接地址放在 `prisma.config.ts`，不混入旧版 schema 的 `url = env(...)` 配置。
- `package.json` 开启 ESM。安装后及构建前自动运行 `prisma generate`，只生成代码，不执行 SQL。生成目录被 Git 和 ESLint 忽略；schema、迁移文件与锁文件需要提交。

参考：[Prisma 7 配置](https://www.prisma.io/docs/orm/v7/reference/prisma-config-reference)、[生成器](https://www.prisma.io/docs/orm/v7/prisma-schema/overview/generators)、[PostgreSQL adapter](https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/postgresql)。

## 配置本地连接

根目录 `.env.example` 只有占位值：

```dotenv
DATABASE_URL="postgresql://jobflow_app:YOUR_URL_ENCODED_PASSWORD@localhost:5432/jobflow_db?schema=public"
```

请自行在根目录 `.env.local` 填写真实信息。可先复制示例；下面的命令不会覆盖已有文件：

```powershell
if (!(Test-Path -LiteralPath .env.local)) {
  Copy-Item -LiteralPath .env.example -Destination .env.local
}
```

使用应用账号 `jobflow_app`，不要改为 `postgres` 管理员账号。密码中有特殊字符时，只对密码部分做 URL 百分号编码；不要编码整条连接串，也不要将连接串粘贴到聊天或提交到 Git。

Next.js 自动加载 `.env.local`。Prisma CLI 不在 Next.js 内运行，因此 `prisma.config.ts` 显式调用 `@next/env` 的加载器；它按 `NODE_ENV` 选择配置，未指定时采用生产模式，当前仅使用的 `.env.local` 在开发和生产模式都能读取。已设置的进程环境变量优先于文件。详见 [Next.js 环境变量文档](https://nextjs.org/docs/app/guides/environment-variables)。

没有 `DATABASE_URL` 时，CLI 配置保留空 URL，使 `generate`、`validate`、从空模型到 schema 的离线 `diff` 能运行；真正连接数据库的命令仍要求有效 URL。不要为了构建填写假的真实连接。`DATABASE_URL` 不使用 `NEXT_PUBLIC_` 前缀。

`.gitignore` 已验证会忽略 `.env`、`.env.local`、`.env.production.local`，仅放行没有真实凭据的 `.env.example`。

## Job 模型

Prisma 模型名为 `Job`，通过 `@@map("jobs")` 对应数据库表 `jobs`。现有业务字段名称保持一致：

| 字段 | Prisma / PostgreSQL | 含义与默认值 |
| --- | --- | --- |
| `id` | `String` / `UUID`，主键 | Prisma 创建记录时用 `uuid()` 生成，后续编辑保持不变 |
| `company` | `String` / `VARCHAR(100)` | 公司名称，非空值类型，长度与现有表单上限一致 |
| `position` | `String` / `VARCHAR(100)` | 岗位名称，与当前 `position` 字段一致 |
| `location` | `String` / `VARCHAR(100)` | 工作地点 |
| `status` | `JobStatus` / PostgreSQL 枚举 | `applied`、`interviewing`、`offered`、`rejected`，默认 `applied` |
| `appliedAt` | `DateTime` / `DATE` | 投递日历日期，不保存时刻和时区 |
| `notes` | `String` / `VARCHAR(2000)` | 备注，默认空字符串，与现有可选备注一致 |
| `createdAt` | `DateTime` / `TIMESTAMPTZ(3)` | 创建时刻，数据库默认当前时间，毫秒精度 |
| `updatedAt` | `DateTime` / `TIMESTAMPTZ(3)` | 创建时默认当前时间，Prisma 更新时由 `@updatedAt` 自动维护 |

`NOT NULL` 不等于字符串必须有文字，空白校验仍应复用 `src/lib/jobs.ts`。`uuid()` 是 Prisma 侧默认值，因此 SQL 中主键没有数据库 UUID 默认表达式；直接写 SQL 时需自己提供 UUID。`@updatedAt` 也不是数据库触发器，绕过 Prisma 更新时需要自行维护该字段。

现有前端 `Job.appliedAt` 是 `YYYY-MM-DD` 字符串，Prisma `DateTime` 在服务端使用 `Date`。现已通过 `src/lib/job-mapper.ts` 显式做 UTC 午夜日期转换；Repository 返回兼容 Job 的 `JobRecord`，额外时间戳为 ISO 字符串，前端表单类型保持原样。

索引分别覆盖全列表按投递日期降序，以及按状态筛选后按日期降序的查询。当前模型没有虚假的 `User` 或 `userId`。未来加入真实用户时，用独立迁移创建 User、增加可空外键、回填有效归属，再按业务需要收紧约束。

## 首次迁移：已由用户执行

`prisma/schema.prisma` 描述目标结构；`migration.sql` 保存从旧结构到新结构的具体 SQL；`prisma generate` 只生成 TypeScript Client。只有后续经过确认执行迁移，数据库结构才会变化，Prisma 才会在库中维护 `_prisma_migrations` 历史。

准备阶段使用 [官方离线 diff 流程](https://docs.prisma.io/docs/orm/v7/prisma-migrate/getting-started)生成 [首次迁移 SQL](../prisma/migrations/20261116193829_init_jobs/migration.sql)。用户已完成执行，本阶段只读取迁移状态，没有重建表或修改该文件。`migration_lock.toml` 锁定 provider 为 PostgreSQL。

生成方式如下；该命令已执行，**无需再次执行或覆盖已审核的迁移文件**：

```powershell
node node_modules/prisma/build/index.js migrate diff --from-empty --to-schema prisma/schema.prisma --script --output prisma/migrations/20261116193829_init_jobs/migration.sql
```

使用 CLI 的 `--output` 写 UTF-8 文件，避免旧版 Windows PowerShell 的 `>` 重定向写出 UTF-16 SQL。SQL 仅包含创建 public schema、JobStatus 枚举、jobs 表和两个索引，没有删除或清空数据的语句。

初始 SQL 以空模型为基线，现有库已经完成该迁移，不应再次手工执行建表 SQL。今后需要变更模型时应另建迁移，不修改已经执行的历史文件。

本阶段没有执行迁移、重置或结构推送，没有导入种子数据。数据库测试只创建独立事务记录并回滚。当前模拟 ID 如 `job-001` 不是 UUID，不能原样作为数据库 UUID 导入；未来切换数据来源时仍需单独设计导入与 ID 映射。

## 服务端 Client

统一入口是 `src/lib/prisma.ts` 的 `getPrisma()`：

- `server-only` 阻止浏览器组件导入。
- 导入模块时不创建 Client；真正调用后才读取 `DATABASE_URL` 并初始化 adapter。
- 缺失配置、连接协议不对或使用 `postgres` 时抛出安全的 `CONFIGURATION_ERROR`，不显示原始连接信息。
- 生产环境使用模块缓存；开发热更新通过 `globalThis` 复用，避免反复创建连接池。
- 连接超时为 5 秒、单实例连接池上限为 5，`log: []` 避免 Prisma 自动输出底层敏感异常。
- Repository 调用此模块；页面、localStorage Hook 和模拟 API 仍未调用。脚本结束时通过 `disconnectPrisma()` 关闭连接，请勿在每个请求后断开。

## 准备阶段验证记录

- `npm.cmd run prisma:generate` / 安装后的 generate：通过。
- `npm.cmd run prisma:validate`：通过。
- Prisma 与前端四个状态值一致。
- 使用隔离目录和占位连接串检查：地址缺失、开发模式 `.env.local`、生产模式 `.env.local`、环境变量覆盖文件四种情况均通过，没有读取或输出真实密码。
- `.env*` 与生成代码的 Git 忽略规则已检查。
- `npm.cmd run lint`、`npm.cmd run build`：通过；`npm.cmd run test:api`：22 项通过。
- 准备阶段没有执行迁移；迁移后来由用户完成。当前真实连接与 CRUD 验证结果见 [Repository 文档](repository.md)。
