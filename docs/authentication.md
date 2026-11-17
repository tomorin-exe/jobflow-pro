# 注册、登录、会话与岗位归属

认证迁移已经由用户执行完成，本阶段只读确认数据库已是最新状态。实际安装 Better Auth / Prisma Adapter **1.7.25**，Prisma **7.10.1**，Next.js **16.4.6**。本阶段没有修改认证服务配置、Schema、已执行迁移或真实环境变量文件，没有新增依赖或岗位数据库写 API。

## 页面与数据来源

| 地址 | 行为 |
| --- | --- |
| / | 转到 /dashboard，由受保护页面决定是否需要登录 |
| /sign-up | 姓名、邮箱、密码、确认密码注册；已登录用户转到 /dashboard |
| /sign-in | 邮箱密码登录；已登录用户转到 /dashboard |
| /dashboard | 服务端验证 Session，匿名或失效会话重定向 /sign-in；显示姓名、邮箱、退出按钮和“岗位数据库接入中” |
| /demo | 公开的 localStorage 岗位管理演示，明确提示不属于任何登录账号 |
| /api/auth/* | 复用现有 Better Auth GET/POST Handler |
| /api/jobs | 仍为模拟数据 GET API，没有切换到数据库 |

/demo 复用原来的组件、存储键、CRUD、筛选、搜索和排序。移动页面路径不会更改同一浏览器来源下的 localStorage；登录和退出也不会导入、删除或转移演示记录。它们不能冒充当前用户的私人岗位。

## 客户端认证、Cookie 与服务端会话

```text
AuthForm → authClient.signUp.email / signIn.email
         → /api/auth/* → Better Auth → Prisma Adapter → PostgreSQL
         ← Better Auth 设置 HttpOnly 会话 Cookie
         → authClient.getSession() 确认实际会话
         → 完整导航到 /dashboard

/dashboard（Server Component）
         → getCurrentSession() → await headers()
         → Better Auth api.getSession({ headers })
         → 校验数据库 Session
         → 无会话则 redirect("/sign-in")，有效才渲染用户信息

SignOutButton → authClient.signOut()
              → Better Auth 撤销 Session、清理 Cookie
              → getSession() 确认退出 → 完整导航到 /sign-in
```

- **客户端认证调用**负责收集表单、显示加载状态和错误、请求认证服务。客户端的成功状态不能决定服务端访问权限。
- **Cookie**由浏览器按来源和 Cookie 属性自动随请求发送。HttpOnly 会话 Cookie 不提供给前端 JavaScript 直接读取；项目不自行把密码、Session 或访问令牌存入 localStorage。
- **服务端 Session 校验**由 Better Auth 根据请求头中的 Cookie 校验数据库会话及有效期。仅存在 Cookie 不代表已登录。现有配置关闭 Cookie 会话缓存，退出后重放旧 Cookie 也应失效。

服务端使用已有 getCurrentSession，不复制另一套认证实现。该方法把 headers() 放在错误包装之外，让 Next.js 的动态渲染控制异常回到框架；认证配置与数据库错误仍由 readSession 脱敏。三个认证相关页面显式动态渲染，不在 build 时查询用户 Session。没有用 Proxy、useSession 或 Cookie 是否存在代替服务器授权。

登录/退出使用完整站内导航重新请求服务器，避免沿用认证前的 Router 缓存。会话对象和令牌不会作为 Client Component props 传递，工作空间只渲染当前用户姓名、邮箱。

## 表单与错误处理

共用 AuthForm，根据 mode 展示注册或登录字段：

- 注册要求姓名、有效邮箱、8–128 字符密码及一致的确认密码；姓名去首尾空白后最多 100 字符，邮箱最多 254 字符。
- 登录校验邮箱及非空密码，不要求姓名和确认密码。密码从不 trim，确认密码只在浏览器校验，不发送到认证 API。
- 客户端校验改善体验；实际账户创建和密码校验仍由 Better Auth 在服务器执行，不能依赖浏览器校验作为安全边界。
- 错误字段关联 aria-describedby 和 aria-invalid，提交错误后聚焦首个错误字段。请求期间禁用字段和按钮，并用 ref 阻止连续重复提交。
- 注册成功后再查询实际 Session：有效会话去 /dashboard；没有会话去 /sign-in?registered=1。后者只提示“注册请求已完成”，不把 URL 参数当作已创建账号的凭证。
- 错误密码及不存在的账号使用相同提示。UI 只映射已知错误码和状态，不回显服务端 message、密码、连接串或底层异常。认证服务故障显示安全提示；服务端渲染失败由通用 error.tsx 提供重试。
- 注册、登录、退出继续使用官方 authClient；没有自行实现密码加密或会话机制。

本阶段没有加入邮箱验证邮件、密码找回或社交登录，保留现有 Better Auth 服务端配置。

## 数据模型与所有者

| 模型 | 用途 |
| --- | --- |
| User / users | UUID 身份、姓名、唯一邮箱、emailVerified、可空 image、创建/更新时间 |
| Session / sessions | UUID、用户外键、唯一 token、expiresAt、可空 IP/User-Agent、时间戳 |
| Account / accounts | UUID、用户外键、providerId/accountId、库管理的密码哈希及可空 OAuth 令牌字段 |
| Verification / verifications | UUID、identifier、value、expiresAt、createdAt、updatedAt |
| Job / jobs | 原业务字段及可空 UUID userId，关联 User；未归属记录对普通用户不可见 |

认证 UUID 使用 PostgreSQL 内置 gen_random_uuid()：Schema 的 @default(dbgenerated("gen_random_uuid()")) 与 SQL DEFAULT 一致。Better Auth 配置保留 generateId: "uuid"；当前 PostgreSQL Adapter 可以省略插入 ID，由数据库默认值负责。Job ID 保留已有 Prisma uuid()。Verification.updatedAt 已存在并与模型一致。

Adapter 使用单数 user/session/account/verification delegate，Prisma @@map 映射到复数数据库表；不把 modelName 设为数据库复数表名。Job → User 使用 RESTRICT，避免删用户时连带删除岗位；认证 Session/Account 使用 CASCADE。

所有业务岗位 Repository 操作从 requireUserId() 的可信服务端 Session 获取所有者：

- 列表使用 where: { userId }。
- 单条读取、修改、删除在同一条操作中使用 where: { id, userId }；不存在和他人记录均返回 null。
- 新增时显式添加服务端 userId，修改字段白名单排除所有者，客户端额外 userId 无效。
- 工厂注入的身份函数仅供可信服务端测试使用，不能从 HTTP 参数接受用户 ID。

可空 userId 保留历史数据兼容性。无法证明归属的记录不能自动分配给首个注册用户；以后审核确认无空值及旧写入者后，另建 NOT NULL 迁移。此阶段没有将工作空间接入岗位 CRUD。

## 已执行迁移

两个迁移都已应用。当前只读 migrate status 为 up to date；原 Schema、服务端认证配置及所有迁移文件的哈希与本阶段开始一致。不要重写历史迁移、重复手工建表、执行 reset 或结构推送。后续结构变化另建迁移。

## 运行与测试

保持现有 .env.local 私密，程序不会打印或修改它。BETTER_AUTH_URL 应与浏览器使用的协议、主机和端口一致；本地通常统一使用 http://localhost:3000，不混用 localhost 与 127.0.0.1。服务端密钥和 DATABASE_URL 不使用 NEXT_PUBLIC_ 前缀。

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run build
npm.cmd run test:db
npm.cmd start
```

保持服务器运行，在另一个终端执行：

```powershell
$env:API_BASE_URL = "http://localhost:3000"
npm.cmd run test:api
npm.cmd run test:auth:http
```

test:auth:http 只允许本地服务器，先核对应用数据库和账号，再创建一个唯一测试邮箱。它通过真实 HTTP 验证注册、登录、HttpOnly Cookie、工作空间保护、错误凭据及退出后旧 Cookie 失效。finally 只按本次随机邮箱/UUID 清理该测试 User，其 Session/Account 随外键清理，不写岗位，也不清理其他用户。不要把 API_BASE_URL 指向日常生产服务。

数据库测试在独立事务中创建用户和岗位，并回滚所有写入；表单和授权单元测试不写数据库。认证 HTTP 测试与数据库事务测试分别运行。

本次结果：

| 检查 | 结果 |
| --- | --- |
| lint / typecheck / build | 全部通过 |
| test:db | 22/22 通过，含 5 项真实数据库集成，无跳过 |
| 原有 test:api | 22/22 通过，测试文件及模拟 API 未修改 |
| test:auth:http | 2/2 通过，唯一测试账号已精确清理 |
| 浏览器交互 | 必填、邮箱/密码/确认校验、提交禁用、真实注册、登录错误、刷新保持会话、退出与保护路由通过 |
| 浏览器存储 | 没有新增认证 localStorage 项；独立 UI 测试账号已清理 |
| 演示 CRUD | 手机新增、搜索、编辑回填/保存、刷新持久化、删除取消/确认及刷新验证通过 |
| 响应式 | 注册、登录、演示页在 320/375/768/1440px 无横向溢出 |

测试使用独立 3017 端口，仅为测试进程指定同源 BETTER_AUTH_URL，没有改动真实环境变量文件、数据库 URL 或密钥。真实 Cookie 和密码不写入测试日志或文档。

## 手动验收

1. 退出状态打开 /dashboard，应跳到 /sign-in；/demo 仍可公开访问并显示演示标识。
2. 在 /sign-up 提交空表单、非法邮箱、短密码、不一致确认密码，应阻止提交并提示。使用测试邮箱完成注册，按钮请求期间禁用，按实际会话进入工作空间或登录页。
3. 退出后尝试错误密码和不存在账号，均显示友好提示；正确登录后显示自己的姓名与邮箱，刷新仍保持登录。
4. 点击退出，重新访问 /dashboard 不能看到工作空间。开发者工具中不应出现自行保存的密码或认证 localStorage 项。
5. 在 /demo 新增/修改一条演示岗位，刷新确认保留；登录/退出不应把它带入 /dashboard。“岗位数据库接入中”始终明确可见。

数据库双用户隔离已由 Repository 事务测试验证；跨会话岗位 HTTP CRUD 验收仍留到受保护岗位接口接入阶段。不要为测试临时开放未经授权的数据库写接口。

## 官方参考

- [Better Auth Next.js 集成](https://better-auth.com/docs/integrations/next)
- [邮箱密码认证](https://better-auth.com/docs/authentication/email-password)
- [Cookie 与 Session](https://better-auth.com/docs/concepts/session-management)
- [Prisma Adapter](https://better-auth.com/docs/adapters/prisma)
- [Prisma 7 UUID 默认值](https://www.prisma.io/docs/orm/v7/reference/prisma-schema-reference#uuid)
- [Next.js 认证和数据访问层](https://nextjs.org/docs/app/guides/authentication)
