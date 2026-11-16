# Better Auth 认证、岗位归属与待审核迁移

本阶段已经准备认证服务、客户端调用入口和岗位授权边界，**尚未执行新迁移**。只读检查 `jobs` 为 **0 条**，没有删除、修改或自动分配任何业务记录。Dashboard 继续使用 localStorage，`GET /api/jobs` 继续返回模拟数据；没有新增岗位写 API，也没有新增登录页面。

## 版本与官方依据

实际安装并精确锁定 `better-auth@1.7.25`、`@better-auth/prisma-adapter@1.7.25`，保留 Prisma CLI / Client / PostgreSQL adapter `7.10.1`，不混入 Prisma 8 的配置。

- [Better Auth Prisma adapter](https://better-auth.com/docs/adapters/prisma)：当前指南针对 Prisma 7 + PostgreSQL，使用独立的 `@better-auth/prisma-adapter`。
- [Prisma 官方 Better Auth + Next.js 指南](https://www.prisma.io/docs/guides/authentication/better-auth/nextjs)：目前采用 Prisma 7；Prisma 8 的客户端 API 不同。
- [Better Auth 核心数据模型与 UUID 配置](https://better-auth.com/docs/concepts/database)：User、Session、Account、Verification 及 `generateId: "uuid"`。
- [Better Auth Next.js 集成](https://better-auth.com/docs/integrations/next)：App Router catch-all Route Handler、React client、服务端 Session 获取。
- [邮箱密码认证](https://better-auth.com/docs/authentication/email-password)：注册、登录、退出交给库处理。
- [Next.js 认证指南](https://nextjs.org/docs/app/guides/authentication)：在可信服务端数据访问层校验会话和权限。

## 认证架构与数据流

```text
浏览器 authClient.signUp.email / signIn.email / signOut / getSession
    → 同源 /api/auth/[...all] (GET / POST)
    → 检查认证表结构、读取私密配置
    → Better Auth → Prisma Adapter → 现有 Prisma Client → PostgreSQL
    → Better Auth 管理 Session 和 Cookie

服务端岗位方法
    → requireUserId() → await headers() → Better Auth 验证 Session
    → Repository 强制 userId 条件 → Prisma → 当前用户的岗位
```

服务端模块均使用 `server-only`。认证实例延迟初始化，复用已有 `getPrisma()` 单例，因此 build、Dashboard 和模拟 API 不要求认证密钥，也不连接认证表。`auth-client.ts` 只导入 Better Auth 的 React 客户端，不导入 Prisma。当前没有调用会写 Cookie 的 Server Action，因此不需要 `nextCookies` 插件；Cookie 由认证 HTTP Handler 处理。以后改用此类 Server Action 时按官方文档补充插件。

`readSession()` 在没有 Cookie 时返回 null；有 Cookie 时必须由 Better Auth 查询并校验 Session，不能仅凭 Cookie 存在就认为已登录。已关闭会话 Cookie 缓存；有效性以库的数据库会话检查为准。会话不存在时 `requireUserId()` 抛出 401。服务不可用、缺少配置或迁移未完成时安全失败，不退回无用户过滤的查询。

注册和登录通过 Better Auth 的邮箱密码功能完成，密码哈希、验证和会话令牌全部由库处理。`Account.password` 保存库产生的哈希，不是明文。当前用于本地学习，没有配置邮件发送、邮箱验证流程或密码找回；`emailVerified` 的存在不表示已完成邮箱验证。正式对外开放前需单独完成这些产品与运维配置。

## 新旧结构对比

| 结构 | 当前已执行的初始结构 | 待审核迁移后的目标 |
| --- | --- | --- |
| `jobs` | 原有业务字段、UUID 主键和两个索引 | 原字段不变，增加可空 UUID `userId`、User 外键及两个用户查询索引 |
| `users` | 无 | User 认证身份，每个用户有多个岗位、会话和账号 |
| `sessions` | 无 | 数据库会话、唯一 token、有效期、用户外键 |
| `accounts` | 无 | 邮箱密码或未来外部提供方的账号信息、密码哈希 |
| `verifications` | 无 | 库使用的验证标识、值和有效期；目前未配置邮件流程 |

字段说明（数据库名称通过 `@@map` 使用小写复数，Prisma delegate 仍是 `user` 等）：

| 模型 | 字段及作用 |
| --- | --- |
| User | `id` UUID 主键；`name` 显示名称；`email` 唯一邮箱；`emailVerified` 默认 false；`image` 可空头像 URL；`createdAt` / `updatedAt` 创建及修改时刻 |
| Session | `id` UUID；`userId` UUID 所属用户；`token` 唯一会话令牌；`expiresAt` 到期时刻；可空 `ipAddress` / `userAgent` 请求信息；创建/修改时刻 |
| Account | `id` UUID；`userId` UUID；`accountId` 提供方账号标识；`providerId` 提供方；可空 `password` 为库管理的密码哈希；可空 accessToken / refreshToken / idToken、访问/刷新令牌有效期和 scope 供未来 OAuth 使用；创建/修改时刻 |
| Verification | `id` UUID；`identifier` 验证用途标识；`value` 库管理的验证值；`expiresAt` 到期时刻；创建/修改时刻 |
| Job 新字段 | `userId` 可空 UUID，与 User.id 类型完全一致；`user` 为 Prisma 关系字段，不额外创建数据库列 |

所有认证时间点使用 `TIMESTAMPTZ(3)`；岗位投递日期仍是 `DATE`，原有 UTC 映射不变。Better Auth 使用 `advanced.database.generateId: "uuid"`，当前 PostgreSQL Adapter 会把四张认证表的 ID 生成交给数据库。因此认证模型使用 `@default(dbgenerated("gen_random_uuid()")) @db.Uuid`，对应 SQL 明确包含 `DEFAULT gen_random_uuid()`。岗位 ID 仍保留原有 Prisma `uuid()`，不修改已执行的初始迁移。邮箱、Session token 和 `(providerId, accountId)` 有唯一约束；用户外键和过期清理字段有索引。

## 最终迁移审查

本次只读检查迁移历史中认证迁移记录为 0，才修改待执行 SQL；历史初始迁移及锁文件哈希未变，初始迁移文件 checksum 也与数据库记录匹配。岗位计数仍为 0。已检查新表/索引名称和 jobs.userId 没有冲突，应用账号具备本次建表和修改 jobs 的权限；未修改任何权限。使用原始 schema 到当前 schema 的离线 Prisma diff 核对，除注释与 BEGIN / COMMIT 包装外，与待执行 SQL 完全一致，没有连接影子库或应用 SQL。

### UUID 生成责任

`@default(uuid())` 是 Prisma 层默认值，不会在 PostgreSQL 建表 SQL 中生成默认表达式，不能当作数据库默认值。[Prisma 7 官方说明](https://www.prisma.io/docs/orm/v7/reference/prisma-schema-reference#uuid)明确区分两者。[Better Auth UUID 文档](https://better-auth.com/docs/concepts/database#uuids)及本机 1.7.25 Adapter 源码确认 PostgreSQL 原生 UUID 模式通常省略插入的 ID。

因此四张认证表采用数据库生成策略，原有 `generateId: "uuid"` 无需改成自行生成 ID 的回调。PostgreSQL 18 内置 [gen_random_uuid()](https://www.postgresql.org/docs/18/functions-uuid.html)，不需要安装扩展或管理员权限。本机只读调用验证了 20 个有效且互不相同的 v4 UUID，没有创建任何记录；这不等同于已经测试新表插入。

新增离线测试直接使用生产配置工厂和真实 Better Auth Adapter，在进入 Prisma delegate 时拦截写入，确认 user / session / account / verification 四条路径都省略 ID，并验证 Schema 和 SQL 均提供相应默认值。测试不伪造数据库插入已成功的结论。

### Verification 和名称映射

当前 `verifications` 的建表 SQL **已经包含** `updatedAt TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`，与模型的 `@default(now()) @updatedAt` 及 Better Auth 1.7.25 的创建/更新行为一致，无需重复添加。回归测试覆盖所有认证表时间戳，尤其 Verification.updatedAt。

配置保留 Adapter 的 `usePlural: false` 默认值；Better Auth model 名为 user / session / account / verification，对应 Prisma 单数 delegate。Prisma 的 `@@map` 再映射到 users / sessions / accounts / verifications。不能把 modelName 改为数据库复数表名，否则 Adapter 会寻找不存在的 `prisma.users` 等属性。

### Job.userId 的选择

| 方案 | 优点 | 代价 |
| --- | --- | --- |
| 现在设置 NOT NULL | 数据库立即拒绝无归属岗位；当前空表容易实施 | 审核后若出现旧记录会导致迁移失败；需要重写保留无归属记录的兼容测试和迁移约定 |
| 保留可空扩展（本次选择） | 不误分配旧数据；兼容当前无归属隔离测试；迁移时即使出现记录也保留 | 数据库层暂时不能阻止绕过 Repository 写入无归属记录，后续需审计并收紧 |

可空不代表普通用户可以创建无归属岗位。生产 Repository 的创建、读取、更新、删除仍全部从可信服务端 Session 确定 userId，输入白名单排除所有者字段；没有会话就拒绝，无归属记录对所有普通用户不可见。测试工厂的用户解析函数只用于可信服务器测试，不能接受客户端用户 ID。未来确认无未归属数据、无旧写入者后，另建 NOT NULL 迁移，不改历史文件。

## 待审核 SQL：只准备，不执行

完整文件：[20261116211821_better_auth_job_ownership/migration.sql](../prisma/migrations/20261116211821_better_auth_job_ownership/migration.sql)。它通过旧 schema 到新 schema 的离线 diff 生成，不连接影子数据库，也不应用 SQL。已执行的初始迁移及 migration_lock 未修改。

SQL 的操作顺序为：

1. `BEGIN` 开始事务。
2. `ALTER TABLE "jobs" ADD COLUMN "userId" UUID`，可空、无默认用户，不回填记录。
3. 创建 users、sessions、accounts、verifications 四张表及其主键，四个 UUID 主键均有 `DEFAULT gen_random_uuid()`。
4. 创建邮箱、token、账号的唯一索引，认证查询索引，以及两个岗位所有者复合索引。
5. 建立 jobs → users 的 `ON DELETE RESTRICT` 外键；sessions / accounts → users 使用 `ON DELETE CASCADE`。
6. `COMMIT`。任何一步失败，PostgreSQL 事务会整体回滚。

没有 DELETE、TRUNCATE、DROP 或业务数据 UPDATE。User 删除被岗位外键限制，避免删除账号时连带删除岗位；Session / Account 的级联只处理该用户的认证记录。当前没有公开删除用户的功能。

即使岗位数量当前为 0，也选择可空扩展：审核到执行之间可能有其他工具写入记录。若到时出现旧记录，它们保持 `userId = NULL`，不会自动归给第一个注册用户或任意用户，也不会被 Repository 暴露。

如果以后需要接管无归属数据，应先备份并核对数量、确认真实所有者，形成按“岗位 UUID → 已验证 User UUID”的人工审核映射；再准备单独的、精确到指定 UUID、可审查的事务回填。无法证明归属的记录继续保留但不可见，不能以“当前登录用户”为依据批量接管。审计确认无空值后，再准备新的 NOT NULL 迁移。本文件不包含回填或收紧约束。

风险：DDL 会锁定相关表，普通索引创建和外键检查在大表上可能阻塞写入；执行前需重新确认数据量、安排适当窗口。若库中已存在同名表、索引或列，迁移会失败，必须先调查，不能重置或强行推送。新代码和新 Client 依赖新字段，部署时需协调迁移顺序。可空列是过渡约束，可信服务端写入口必须持续强制所有者，不允许直接暴露通用 Prisma 写接口。

## 需要用户手动完成的步骤

1. 审核 schema 和完整 SQL；确认连接指向 `jobflow_db` / `jobflow_app`，自行备份并再次检查岗位数量。不要重新执行初始建表 SQL。
2. 在现有 `.env.local` **追加** `BETTER_AUTH_SECRET`（本地随机生成、至少 32 字符）和 `BETTER_AUTH_URL="http://localhost:3000"`。保留现有 DATABASE_URL，不要用示例覆盖整个文件，也不要提交或向聊天粘贴秘密。示例占位密钥会被代码拒绝；不要使用 NEXT_PUBLIC_ 前缀。
3. URL 必须与浏览器来源一致（协议、主机、端口）；本地统一用 localhost:3000，勿混用 127.0.0.1。生产环境必须使用 HTTPS。更改配置后重启 Next.js。
4. **只有审核并决定执行后**，由用户在项目根目录运行以下命令；本次开发没有运行它：

   ```powershell
   npm.cmd exec -- prisma migrate deploy
   npm.cmd exec -- prisma migrate status
   npm.cmd run prisma:generate
   ```

   deploy 根据迁移历史只应用未执行迁移，不会再次创建已成功应用的初始表。若执行失败，先分析安全的本地诊断，不修改旧迁移、权限或管理员配置来掩盖问题。

5. 运行 lint、typecheck、build、数据库测试，并按需要在上海和洛杉矶时区分别运行 `test:db`。启动 Next.js 后运行原有 `test:api`。

认证调用入口已准备，未来 Client Component 可以直接使用（这些是说明，不会自动执行）：

```ts
import { authClient } from "@/lib/auth-client";

// name / email / password 来自用户表单，不要将密码写入源码或日志。
const registration = await authClient.signUp.email({ name, email, password });
const login = await authClient.signIn.email({ email, password });
const session = await authClient.getSession();
const logout = await authClient.signOut();
// 使用返回值的 error 处理失败；React 中也可用 authClient.useSession()。
```

本阶段不新增用户表单，也不导入 localStorage 岗位到数据库。localStorage 仍属于同一浏览器来源，不具备按账户隔离能力；不能用当前 Dashboard 验证数据库的用户隔离。

## 岗位权限边界

默认 Repository 的五个方法都先调用 `requireUserId()`，身份只来自服务端验证后的 Session：

- 列表：`where: { userId }`，不支持客户端指定用户。
- 单条读取 / 修改 / 删除：`where: { id, userId }`，在同一条操作中限制所有者；不存在或属于他人均返回 null。
- 新增：显式业务字段白名单加服务端 userId，额外 body.userId 被忽略。
- 修改：白名单排除 userId，不能转移所有者。
- 未登录：401；认证表未就绪或连接异常：安全错误，不返回底层异常和连接串。

测试工厂允许注入“可信用户解析函数”和事务 Client，仅用于服务端测试夹具。不得把 HTTP 参数中的用户 ID 注入工厂。未来所有岗位 HTTP/Server Action 入口必须使用默认 Repository，并把 null 映射为不泄露他人记录存在性的 404；不能只在页面导航或 Proxy 中判断是否有 Cookie。数据库管理员脚本和直接 Prisma 调用仍需单独权限审核。

## 验证结果与双用户测试

当前 `npm.cmd run test:db`：**12 项单元测试通过、5 项数据库集成测试跳过、0 失败**。包含本次增加的 UUID/字段一致性和真实 Adapter 离线测试。跳过原因是本次不允许执行新迁移，新 Client 查询 jobs 会涉及尚不存在的 userId；不能宣称数据库新结构 CRUD 已验证成功。此前的双时区 9/9 是上一阶段结果。

本次已执行的其他检查：

| 检查 | 实际结果 |
| --- | --- |
| `npm.cmd run lint` | 通过，0 警告 |
| `npm.cmd run typecheck` | 通过 |
| `npm.cmd run build` | 通过，包含 Prisma Client 生成，认证路由构建成功 |
| `npm.cmd run prisma:validate` | 通过 |
| `npm.cmd run test:api` | 在独立端口生产服务上 22/22 通过，原有测试未修改 |
| 认证 HTTP 入口 | GET get-session、POST 空 sign-up/email 均返回 503 / AUTH_MIGRATION_REQUIRED，无认证写入 |
| `prisma migrate status`（只读） | 退出码 1，明确报告只有新增认证迁移待应用；符合本次要求 |
| 业务数据和历史文件 | jobs 复查仍为 0；初始 migration.sql 与 migration_lock 的哈希未变；.env.local 被 Git 忽略 |

真实注册、密码登录、注销和 Cookie Session 的端到端验证尚未执行，因为它们需要新认证表及本地密钥配置；这不是已经通过的测试。

准备的数据库隔离用例在迁移后自动运行：事务内创建 A/B 两个唯一测试 User、各自岗位和一个无归属夹具，验证互不可见、跨用户更新/删除无效、伪造 userId 被忽略，最后回滚并核对这些测试 UUID 无残留。它验证真实 Repository / PostgreSQL，不验证 Better Auth 的浏览器登录链路。

后续完整手动验收：

1. 迁移及配置完成后，用两个独立浏览器配置或普通/隐私窗口，通过接入的认证表单或客户端入口分别注册并登录 A/B。检查 Session 返回不同 UUID；退出后 getSession 应为空，未登录岗位请求应拒绝。错误密码不能登录。
2. 通过以后新增的受保护岗位入口（或受控服务端测试）分别创建 A1/B1。A 只能列出 A1，B 只能列出 B1。以 B 的会话请求 A1 UUID 的读、改、删，均应返回不存在且 A1 保持不变；反向同样验证。请求体伪造 userId 不能新增给对方，也不能转移已有岗位。
3. 验证无归属岗位双方都不可见；会话到期/注销后旧会话不能继续操作。刷新后数据库岗位仍存在。同一浏览器的 localStorage 不属于上述测试范围。

当前没有岗位数据库 HTTP CRUD，因此以上跨会话 HTTP 验收需留到受保护接口接入阶段。现阶段不要为测试临时开放未授权接口。真实注册/登录写入也等待本次迁移经用户审核执行后再验证。
