# 岗位 Repository 与真实数据库验证

当前实际连接是 PostgreSQL 18.7、`jobflow_db`、应用账号 `jobflow_app`。只读迁移检查显示数据库已是最新状态。本阶段没有执行任何迁移或修改 schema。

页面仍使用 localStorage，`GET /api/jobs` 仍使用模拟数据。Repository 仅供服务端使用，尚未通过公开写接口暴露。

## 数据流与文件职责

`服务端调用 / 集成测试 → Repository → Prisma Client → PrismaPg adapter → pg → PostgreSQL`

返回数据时经过 mapper，把 Prisma 的 Date 对象转换为可 JSON 序列化的 `JobRecord`。

| 文件 | 职责 |
| --- | --- |
| `src/lib/prisma.ts` | 延迟创建服务端单例，配置 adapter 和连接池；开发热更新复用全局实例 |
| `src/repositories/job-repository.ts` | 数据访问接口与排序、查询不存在的处理，可注入事务 Client |
| `src/lib/job-mapper.ts` | 复用校验器、清理输入、写入字段白名单、转换日期与返回对象 |
| `src/lib/database-error.ts` | 安全错误类型和错误边界，不传播原始异常内容 |
| `src/types/job-record.ts` | 在现有 Job 上增加 ISO 格式的创建、修改时间戳 |
| `tests/database.test.ts` | 真实连接、CRUD、事务清理、日期边界及故障验证 |
| `tests/job-repository.test.ts` | 不连接数据库的映射、输入校验和错误脱敏验证 |

Prisma Client 是根据 schema 生成的类型安全查询工具，`job.findMany/create/update/delete` 等方法通过 adapter 和 pg 执行 PostgreSQL 操作。Repository 则把“如何查询岗位”集中起来，上层不需要到处重复 Prisma 调用、日期转换和错误处理。

## Repository 契约

可从 `@/repositories/job-repository` 导入以下方法。模块带有 `server-only`，不可从浏览器组件导入。

| 方法 | 输入 | 返回 |
| --- | --- | --- |
| `getAllJobs()` | 无 | `JobRecord[]`，日期降序、相同日期按 ID 升序 |
| `getJobById(id)` | UUID | `JobRecord`，不存在时为 `null` |
| `createJob(input)` | 现有 `JobInput` | 新建的 `JobRecord`，UUID 由 Prisma 生成 |
| `updateJob(id, input)` | UUID + 完整 JobInput | 更新后的 `JobRecord`，不存在时为 `null` |
| `deleteJob(id)` | UUID | 删除的 `JobRecord`，不存在时为 `null` |

`updateJob` 接受完整表单输入，本阶段不是公开 PATCH 接口。ID、createdAt、updatedAt 不接受调用方覆盖；写入时使用显式字段白名单。更新使用同一主键，删除只按指定 UUID 执行，不存在全表清空方法。

`createJobRepository(() => tx)` 可以使用调用方提供的 Prisma 事务 Client。默认导出的五个方法会延迟获取单例，不在导入时访问数据库。

## DATE 与时区

- PostgreSQL `DATE` 表示日历日期，模型中的 `appliedAt` 没有时区或时刻。
- Prisma 7 的该字段在 JavaScript 中是 `Date`；现有前端需要 `YYYY-MM-DD` 字符串。
- 写入时先复用日历日期校验，再使用 `new Date(date + "T00:00:00.000Z")`，不依赖本地时区。
- 读取时通过 `toISOString().slice(0, 10)` 取 UTC 日期，不使用本地 `getDate()` 或本地化显示格式。
- `createdAt` / `updatedAt` 是时间点，返回完整的 UTC ISO 字符串。原有前端 Job 接口保持不变。

真实数据库测试涵盖闰日、跨年、夏令时边界及 0001/9999 年，并分别在 `Asia/Shanghai` 和 `America/Los_Angeles` 下验证。

## 输入与错误处理

写入前复用 `src/lib/jobs.ts` 的校验和 trim 逻辑。无效字段或 UUID 在发出 SQL 前被拒绝。

对外只抛出 `DatabaseAccessError`，包含以下安全错误码与预设消息：

- `CONFIGURATION_ERROR`：服务端连接配置不可用。
- `INVALID_INPUT`：输入不满足字段规则，允许返回不含用户输入内容的字段校验提示。
- `INVALID_ID`：不是合法 UUID。
- `DATABASE_UNAVAILABLE`：数据库操作失败或连接不可用。

不把底层错误的 message、stack、cause、Prisma meta 或连接串放入新的异常。Prisma 关闭自动错误日志，Repository 也不会记录原始异常。未来接入 HTTP 时应只返回安全的 code/message，不序列化整个 Error。

如果真实连接失败，先在本机检查 PostgreSQL 服务、`.env.local`、主机端口、数据库名和应用账号；不要粘贴真实密码或连接串，不通过修改管理员或权限设置来掩盖问题。

## 运行数据库验证

前提：PostgreSQL 已运行、初始迁移已执行、根目录 `.env.local` 已配置。测试不会自动执行迁移。

```powershell
npm.cmd run test:db
```

测试脚本使用 Node 内置测试工具及开发依赖 tsx 运行 TypeScript，解析现有路径别名。`--conditions=react-server` 声明这是服务端测试运行环境，使 `server-only` 可被正常导入；浏览器构建保护保持原样。

验证顺序与清理机制：

1. 读取连接上下文，确认数据库为 `jobflow_db`、账号为 `jobflow_app`，再允许测试写入。
2. 在真实 PostgreSQL 事务中使用同一份 Repository 创建带唯一标记、由 Prisma 生成 UUID 的测试记录。
3. 验证新增、按 ID 查询、列表查询、更新、删除，以及查询不存在时的返回值。
4. 回滚整个测试事务，断言中途失败也会回滚；不提交测试数据。
5. 在事务结束后，只按本次返回的 UUID 查询残留数量，必须为 0。没有通过 deleteMany 或清空业务表做清理。
6. 最后关闭脚本连接池。

另有一项故障测试用公开的占位连接串访问不可用端口，确认返回安全错误，不使用真实密码，也不会向目标业务库写入。

可分别验证两个时区：

```powershell
$env:TZ = "Asia/Shanghai"
npm.cmd run test:db
$env:TZ = "America/Los_Angeles"
npm.cmd run test:db
```

## 实际结果

- `prisma migrate status`：只读确认 up to date。
- PostgreSQL 18.7，目标数据库和应用账号核对通过。
- 9 项验证：4 项数据库集成、5 项映射/校验；上海和洛杉矶两次运行均 9/9 通过。
- 两次运行均按测试 UUID 确认无残留；未更改其他记录。
- `npm.cmd run lint`、`npm.cmd run build`、`npm.cmd run typecheck`：通过。
- `npm.cmd run test:api`：原有 22 项模拟 API 测试通过。
- schema 与已有迁移文件内容保持不变；没有添加公开写接口、身份认证或虚假用户隔离。
