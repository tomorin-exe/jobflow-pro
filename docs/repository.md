# 岗位 Repository 与真实数据库验证

当前连接是 PostgreSQL 18.7、`jobflow_db`、应用账号 `jobflow_app`。初始迁移已执行，新增认证和岗位归属迁移**尚未执行**。本阶段只读检查岗位数量为 0；没有分配或修改任何业务记录。迁移方案见 [认证说明](authentication.md)。

页面仍使用 localStorage，`GET /api/jobs` 仍使用模拟数据。Repository 仅供服务端使用，尚未通过公开写接口暴露。

## 数据流与文件职责

`服务端调用 → requireUserId → Better Auth 校验 Cookie / 数据库 Session → 按 userId 过滤的 Repository → Prisma Client → PrismaPg / pg → PostgreSQL`

返回数据时经过 mapper，把 Prisma 的 Date 对象转换为可 JSON 序列化的 `JobRecord`。

| 文件 | 职责 |
| --- | --- |
| `src/lib/prisma.ts` | 延迟创建服务端单例，配置 adapter 和连接池；开发热更新复用全局实例 |
| `src/repositories/job-repository.ts` | 默认每次操作从可信会话取 userId，查询及更新条件均含所有者，可注入事务 Client |
| `src/lib/session.ts` | 服务端读取请求头，由 Better Auth 验证 Session，缺少会话时抛出 401 安全错误 |
| `src/lib/job-mapper.ts` | 复用校验器、清理输入、写入字段白名单、转换日期与返回对象 |
| `src/lib/database-error.ts` | 安全错误类型和错误边界，不传播原始异常内容 |
| `src/types/job-record.ts` | 在现有 Job 上增加 ISO 格式的创建、修改时间戳 |
| `tests/database.test.ts` | 迁移后验证真实连接、CRUD、双用户隔离、事务清理、日期边界及故障 |
| `tests/job-repository.test.ts` | 不连接数据库的映射、输入校验和错误脱敏验证 |
| `tests/auth.test.ts` | 未登录拒绝、每种操作所有者条件、额外 userId 字段白名单及认证配置 |

Prisma Client 是根据 schema 生成的类型安全查询工具，`job.findMany/create/update/delete` 等方法通过 adapter 和 pg 执行 PostgreSQL 操作。Repository 则把“如何查询岗位”集中起来，上层不需要到处重复 Prisma 调用、日期转换和错误处理。

## Repository 契约

可从 `@/repositories/job-repository` 导入以下方法。模块带有 `server-only`，不可从浏览器组件导入。

| 方法 | 输入 | 返回 |
| --- | --- | --- |
| `getAllJobs()` | 无 | 当前用户的 `JobRecord[]`，日期降序、相同日期按 ID 升序 |
| `getJobById(id)` | UUID | 当前用户的 `JobRecord`，不存在或属于他人时为 `null` |
| `createJob(input)` | 现有 `JobInput` | 新建的 `JobRecord`，UUID 由 Prisma 生成 |
| `updateJob(id, input)` | UUID + 完整 JobInput | 更新后的 `JobRecord`，不存在或属于他人时为 `null` |
| `deleteJob(id)` | UUID | 删除的 `JobRecord`，不存在或属于他人时为 `null` |

`updateJob` 接受完整表单输入，本阶段不是公开 PATCH 接口。ID、userId、createdAt、updatedAt 不接受输入覆盖；写入时使用显式字段白名单。创建时由服务端强制添加会话 userId；读取、更新、删除使用 `{ id, userId }`，由同一条数据库操作限制所有者，避免先检查再修改的竞态。未归属的 `userId = NULL` 记录对所有用户不可见。

默认导出的五个方法延迟获取单例，每次操作先验证会话，不在导入时访问数据库。未登录时抛出 `AuthError(UNAUTHORIZED)`，不访问岗位表；认证配置/结构不可用时安全失败，不退化为全表查询。

`createJobRepository(() => tx, async () => testUser.id)` 仅供可信服务端测试注入事务及其创建的测试用户；第二个参数是授权解析函数，不是面向客户端的 userId 参数。生产请求使用默认 `requireUserId`，不得把 body、query、URL 或自定义请求头中的用户 ID 注入该函数。浏览器不能导入本模块。所有代码中直接调用 Prisma 的管理或维护脚本仍需单独审核，Repository 不是 PostgreSQL RLS。

## DATE 与时区

- PostgreSQL `DATE` 表示日历日期，模型中的 `appliedAt` 没有时区或时刻。
- Prisma 7 的该字段在 JavaScript 中是 `Date`；现有前端需要 `YYYY-MM-DD` 字符串。
- 写入时先复用日历日期校验，再使用 `new Date(date + "T00:00:00.000Z")`，不依赖本地时区。
- 读取时通过 `toISOString().slice(0, 10)` 取 UTC 日期，不使用本地 `getDate()` 或本地化显示格式。
- `createdAt` / `updatedAt` 是时间点，返回完整的 UTC ISO 字符串。原有前端 Job 接口保持不变。

上一阶段的真实数据库测试已在两个时区通过。本阶段保留闰日、跨年、夏令时边界及 0001/9999 年用例，认证迁移完成后需再次运行。

## 输入与错误处理

写入前复用 `src/lib/jobs.ts` 的校验和 trim 逻辑。无效字段或 UUID 在发出 SQL 前被拒绝。

数据库异常转换为 `DatabaseAccessError`，包含以下安全错误码与预设消息；授权失败则使用 `AuthError`：

- `CONFIGURATION_ERROR`：服务端连接配置不可用。
- `INVALID_INPUT`：输入不满足字段规则，允许返回不含用户输入内容的字段校验提示。
- `INVALID_ID`：不是合法 UUID。
- `DATABASE_UNAVAILABLE`：数据库操作失败或连接不可用。

不把底层错误的 message、stack、cause、Prisma meta 或连接串放入新的异常。Prisma 关闭自动错误日志，Repository 也不会记录原始异常。未来接入 HTTP 时应只返回安全的 code/message，不序列化整个 Error。

如果真实连接失败，先在本机检查 PostgreSQL 服务、`.env.local`、主机端口、数据库名和应用账号；不要粘贴真实密码或连接串，不通过修改管理员或权限设置来掩盖问题。

## 运行数据库验证

前提：PostgreSQL 已运行、`.env.local` 配置正确。测试首先只读检查认证表与 jobs.userId；未执行待审核迁移时明确跳过 5 项真实数据库测试，只运行 12 项单元测试（含 UUID/迁移一致性与真实 Adapter 离线测试）。测试不会自动执行迁移。迁移完成后，独立的 Repository 数据库测试不需要真实认证密钥或浏览器 Cookie，测试用户身份由受控事务夹具提供。

```powershell
npm.cmd run test:db
```

测试脚本使用 Node 内置测试工具及开发依赖 tsx 运行 TypeScript，解析现有路径别名。`--conditions=react-server` 声明这是服务端测试运行环境，使 `server-only` 可被正常导入；浏览器构建保护保持原样。

验证顺序与清理机制：

1. 只读检查新结构，准备就绪后核对数据库为 `jobflow_db`、账号为 `jobflow_app`，再允许测试写入。
2. 在真实 PostgreSQL 事务中创建唯一测试 User，使用同一份 Repository 创建测试岗位。
3. 验证 CRUD、两个用户互不可见、越权更新/删除返回 null、伪造 userId 无效、无归属记录不可见。这验证 Repository 过滤，不代替真实浏览器 Cookie 认证测试。
4. 回滚整个测试事务，断言中途失败也会回滚；不提交测试数据。
5. 只按本次 UUID 查询岗位和用户的残留数量，必须为 0，不用 deleteMany 或清空业务表。
6. 最后关闭脚本连接池。

另有一项故障测试用公开的占位连接串访问不可用端口，确认返回安全错误，不使用真实密码，也不会向目标业务库写入。

可分别验证两个时区：

```powershell
$env:TZ = "Asia/Shanghai"
npm.cmd run test:db
$env:TZ = "America/Los_Angeles"
npm.cmd run test:db
```

## 当前结果

- `npm.cmd run test:db`：12 项单元测试通过，5 项真实数据库测试因待迁移明确跳过，无失败。
- 这不是新结构的数据库验证通过；需要用户审核、执行迁移后重新运行。
- 页面及模拟 GET API 数据来源未切换，也没有开放岗位写 API。

## 上一阶段结果（历史）

- `prisma migrate status`：只读确认 up to date。
- PostgreSQL 18.7，目标数据库和应用账号核对通过。
- 9 项验证：4 项数据库集成、5 项映射/校验；上海和洛杉矶两次运行均 9/9 通过。
- 两次运行均按测试 UUID 确认无残留；未更改其他记录。
- `npm.cmd run lint`、`npm.cmd run build`、`npm.cmd run typecheck`：通过。
- `npm.cmd run test:api`：原有 22 项模拟 API 测试通过。
- 上一阶段 schema 未变；本阶段 schema 已扩展，历史迁移文件保持不变。
