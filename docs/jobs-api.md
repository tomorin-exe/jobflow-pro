# 当前用户岗位 REST API

`/api/me/jobs` 与 `/api/me/jobs/[id]` 通过真实 Better Auth Session 访问 PostgreSQL；`/dashboard` 已接入这些 API。原 `/api/jobs` 仍返回模拟数据，`/demo` 仍是独立本地演示，不会自动导入数据库。前端状态与验收见 [远程 Dashboard](remote-dashboard.md)。

## 路由与响应

| 方法 | 路径 | 成功状态 | JSON |
| --- | --- | --- | --- |
| GET | `/api/me/jobs` | 200 | `{ "data": JobRecord[], "total": number }` |
| POST | `/api/me/jobs` | 201 | `{ "data": JobRecord }`，同时返回相对 Location |
| GET | `/api/me/jobs/[id]` | 200 | `{ "data": JobRecord }` |
| PATCH | `/api/me/jobs/[id]` | 200 | `{ "data": JobRecord }` |
| DELETE | `/api/me/jobs/[id]` | 200 | `{ "data": 已删除的 JobRecord }` |

JobRecord 只有 id、company、position、location、status、appliedAt、notes、createdAt、updatedAt。不会返回 userId、密码、Session 或令牌。appliedAt 为 `YYYY-MM-DD` 日历日期，创建/修改时间是 UTC ISO 字符串。

列表按投递日期降序，相同日期按 ID 升序。可选 `?status=applied`，合法值为 applied / interviewing / offered / rejected。未传时查询当前用户全部岗位；空值、all、非法或重复参数返回 400，规则与模拟 API 相同。total 表示当前筛选结果数量，尚未添加分页。

POST 请求示例：

```json
{
  "company": "示例公司",
  "position": "全栈工程师",
  "location": "上海",
  "status": "applied",
  "appliedAt": "2026-11-17",
  "notes": "准备作品集"
}
```

前五个字段必填，notes 可省略，默认空字符串。company / position / location 最多 100 字符，notes 最多 2000 字符；字段清理、状态及真实日历日期校验复用现有模块。日期不会被自动纠正，例如 2026-02-30 会拒绝。

PATCH 只发送需要修改的字段，例如：

```json
{ "status": "interviewing", "notes": "下周一面试" }
```

没有提供的字段保持不变；至少需要一个有效业务字段。空对象或只含受保护字段的 PATCH 返回 400。清空备注发送 `"notes": ""`；null 不是合法字段值。POST/PATCH 只接受 application/json，可带 charset 参数。id、userId、createdAt、updatedAt 及其他非业务字段会被忽略，不能覆盖服务器值。

错误统一为：

```json
{ "error": { "code": "JOB_NOT_FOUND", "message": "岗位不存在。" } }
```

| 状态 | 含义 / 常见 code |
| --- | --- |
| 400 | INVALID_ID、INVALID_STATUS、INVALID_INPUT、INVALID_JSON、INVALID_CONTENT_TYPE |
| 401 | UNAUTHORIZED：没有有效登录会话 |
| 403 | FORBIDDEN_ORIGIN：写入来源不可信或缺失 |
| 404 | JOB_NOT_FOUND：不存在或属于其他用户，响应完全一致 |
| 503 | 认证配置/连接不可用或 DATABASE_UNAVAILABLE |
| 500 | INTERNAL_ERROR：未知异常，仅返回预设文案 |

成功和错误都带 `Cache-Control: private, no-store`。不返回底层 SQL、数据库连接信息、Error stack 或认证凭据。先认证，再检查 Origin、参数和请求体；匿名请求即使 JSON/Origin 不正确也返回 401。对于已认证的非法请求先返回参数错误；404 契约针对参数合法的请求。

## 数据流与隔离

```text
Route Handler → withJobApi
              → readSession(request.headers) / Better Auth 验证
              → 写请求核对配置的 Origin
              → 绑定 session.user.id 的请求级 Repository
              → mapper / 共用输入校验 → Prisma → PostgreSQL
```

withJobApi 每个请求只验证一次会话，之后传给 Repository 的身份解析函数只返回本次已验证的 userId，不来自 body、query、URL 或自定义头。没有全局保存“当前用户”，并发 A/B 请求不会共享所有者状态。直接服务端调用 Repository 时，默认仍通过 requireUserId 验证 Session。

Repository 列表 SQL 同时限定 userId 和可选 status；单条读取、更新、删除均在同一条数据库操作中限定 `{ id, userId }`。不存在与越权都映射成同一 404，不先查询全表判断记录是否存在。新增强制服务器 userId；mapper 的显式白名单不允许修改所有者。

PATCH 使用部分字段 mapper，直接执行一次受所有者限制的 update。不会先读取旧记录，再把整条旧快照写回，避免不同字段的并发 PATCH 相互覆盖。同一字段同时修改仍遵循最后写入生效，此阶段未加入版本号或乐观锁。

两条路由均使用 Node.js runtime；动态参数为 Promise，在 Handler 内通过 `await params` 读取。没有修改 Schema 或执行数据库迁移。

## Cookie 写入与 CSRF

POST/PATCH/DELETE 必须携带精确匹配服务器配置 BETTER_AUTH_URL 的 Origin（协议、主机、端口一致）。校验来源不从可伪造的 Host / X-Forwarded-Host 推导，不使用前缀匹配，不允许缺失 Origin、`null` 或带路径的 Origin。Sec-Fetch-Site 为 cross-site 也拒绝。

没有开放任意跨站 CORS，也没有通过反射客户端 Origin 授权。可信 Origin 不是身份凭据；仍必须有 Better Auth 验证的会话。浏览器同源 fetch 自动携带 Origin，PowerShell 等非浏览器客户端需要显式设置它。

参考：[OWASP Origin / Fetch Metadata 防护](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)、[Next.js Route Handler 与异步参数](https://nextjs.org/docs/app/api-reference/file-conventions/route)、[Better Auth 服务端 Session](https://better-auth.com/docs/integrations/next)。

## 浏览器手动测试

先运行项目，使用与 BETTER_AUTH_URL 一致的地址登录。在同源页面开发者工具 Console 执行；无需读取 HttpOnly Cookie，不要把 Cookie/密码复制到代码或聊天：

```js
const created = await (await fetch('/api/me/jobs', {
  method: 'POST',
  credentials: 'same-origin',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    company: '手动测试公司', position: '开发工程师', location: '上海',
    status: 'applied', appliedAt: '2026-11-17', notes: '手动验收'
  })
})).json();
const testJobId = created.data.id;
await (await fetch('/api/me/jobs?status=applied')).json();
await (await fetch(`/api/me/jobs/${testJobId}`, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ status: 'interviewing' })
})).json();
await (await fetch(`/api/me/jobs/${testJobId}`, { method: 'DELETE' })).json();
```

使用普通/隐私窗口分别登录 A/B：A 新建记录后，B 使用该 ID 进行读、改、删应全部 404；B 的列表不能出现 A 岗位。A 能正常操作。退出后访问这些接口为 401。手动测试结束只删除自己记下的测试 ID。

## PowerShell 手动测试

以下示例使用 Cookie 容器及显式 Origin。Get-Credential 隐藏密码输入；不要直接输出登录响应（Better Auth 自身响应可能含认证令牌）、Cookie 容器或登录请求体。

```powershell
$jobflowBase = 'http://localhost:3000'
$jobflowOrigin = @{ Origin = $jobflowBase }
$jobflowCredential = Get-Credential -Message '请输入 JobFlow 邮箱和密码'
$jobflowLoginBody = @{
  email = $jobflowCredential.UserName
  password = $jobflowCredential.GetNetworkCredential().Password
} | ConvertTo-Json
$jobflowAuthResult = Invoke-RestMethod -Method Post `
  -Uri "$jobflowBase/api/auth/sign-in/email" `
  -Headers $jobflowOrigin -ContentType 'application/json; charset=utf-8' `
  -Body ([Text.Encoding]::UTF8.GetBytes($jobflowLoginBody)) `
  -SessionVariable jobflowSession
$jobflowCredential = $null
$jobflowLoginBody = $null
$jobflowAuthResult = $null

$jobflowPayload = @{
  company = '手动测试公司'; position = '开发工程师'; location = '上海'
  status = 'applied'; appliedAt = (Get-Date -Format 'yyyy-MM-dd'); notes = '仅供验收'
} | ConvertTo-Json
$jobflowCreated = Invoke-RestMethod -Method Post `
  -Uri "$jobflowBase/api/me/jobs" -WebSession $jobflowSession `
  -Headers $jobflowOrigin -ContentType 'application/json; charset=utf-8' `
  -Body ([Text.Encoding]::UTF8.GetBytes($jobflowPayload))
$jobflowJobId = $jobflowCreated.data.id

Invoke-RestMethod -Uri "$jobflowBase/api/me/jobs?status=applied" -WebSession $jobflowSession
Invoke-RestMethod -Method Patch -Uri "$jobflowBase/api/me/jobs/$jobflowJobId" `
  -WebSession $jobflowSession -Headers $jobflowOrigin `
  -ContentType 'application/json' -Body '{"status":"interviewing"}'
Invoke-RestMethod -Method Delete -Uri "$jobflowBase/api/me/jobs/$jobflowJobId" `
  -WebSession $jobflowSession -Headers $jobflowOrigin
$null = Invoke-RestMethod -Method Post -Uri "$jobflowBase/api/auth/sign-out" `
  -WebSession $jobflowSession -Headers $jobflowOrigin `
  -ContentType 'application/json' -Body '{}'
# 再次请求岗位列表应得到 401；PowerShell 会把非 2xx 状态作为请求异常报告。
```

## 自动验证与清理

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run build
npm.cmd run test:db
npm.cmd run test:jobs
# 启动同源的本地服务器后，在另一终端运行：
$env:API_BASE_URL = 'http://localhost:3000'
npm.cmd run test:api
npm.cmd run test:auth:http
npm.cmd run test:jobs:http
```

新 HTTP 测试先核对数据库 jobflow_db 和账号 jobflow_app，创建两个本轮唯一测试用户。岗位带随机公司标记，记录返回的 UUID。即使创建成功但响应中断，也可按本轮用户和随机标记找回 ID；删除始终限定精确岗位 ID 与所属测试用户。最后删除本轮用户及其认证记录并断言无残留，不清空业务表、不删除其他用户或旧岗位。

实际结果：lint、typecheck、build 通过；原 test:db **22/22**、原 test:api **22/22**、原认证 HTTP **2/2**、新增单元测试 **6/6**、新增岗位 HTTP **17/17** 全部通过，无跳过。测试还验证不同用户并发请求不会串号、不同字段部分更新不互相覆盖，以及退出后重放旧 Cookie 对五种接口全部返回 401。

测试使用独立本地端口，仅给测试服务进程设置匹配的 BETTER_AUTH_URL，没有打印或修改真实环境变量文件、数据库 URL 或密钥。当前 Dashboard 已接入这些 API；本轮前端接入不改变 Schema、迁移、认证配置、Repository、API 或演示数据层。新增客户端测试及浏览器验收见 [远程 Dashboard](remote-dashboard.md)。
