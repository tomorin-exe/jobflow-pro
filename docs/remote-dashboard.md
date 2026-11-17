# PostgreSQL 私人求职工作空间

`/dashboard` 已接入真实岗位 API，完成登录、CRUD、刷新、退出、重新登录后数据仍存在的流程。`/demo` 继续使用独立的 localStorage 和原模拟初始记录，没有导入到数据库；`/api/jobs` 仍是模拟 GET API。该远程 Dashboard 阶段未增加依赖、未修改数据库结构。后续 CSV 批量导入入口、唯一新增依赖、已执行的本地增表迁移及 113 项验证结果见 [CSV 导入文档](csv-import.md)。

## 完整数据流

```text
/dashboard Server Component
  → getCurrentSession() → Better Auth 验证真实 Cookie / 数据库 Session
  → 未登录 redirect('/sign-in')；已登录才渲染远程工作空间

JobForm / 删除确认 / 刷新按钮
  → useRemoteJobs → 独立的内存状态 Store → jobs-client 同源 fetch
  → /api/me/jobs 或 /api/me/jobs/[id]
  → 再次验证 Session、写入 Origin 校验
  → 按 session.user.id 绑定的 Repository → mapper / Prisma → PostgreSQL
  ← JobRecord（日期字符串、服务器 UUID 和时间戳）
  → 更新同一份 jobs 快照 → 列表、统计、搜索、筛选、排序同步重算
```

服务端页面和每条 API 的权限检查都保留。客户端 Session 观察只用于清除旧账号视图，不能授予访问权限。页面传入的 viewerId 只用于识别客户端视图是否过期，不发送给岗位 API，也不决定所有者。

## 文件与职责

| 文件 | 职责 |
| --- | --- |
| src/lib/jobs-client.ts | GET / POST / PATCH / DELETE，同源 Cookie、no-store、写字段白名单、运行时响应校验及安全错误 |
| src/lib/remote-jobs-store.ts | 请求生命周期、列表快照、CRUD、刷新、重复提交及过期结果处理 |
| src/hooks/use-remote-jobs.ts | 组件独立 Store、订阅与卸载清理；观察账号变化，移除旧视图 |
| src/components/dashboard/remote-job-dashboard.tsx | 私人工作空间的弹窗、提示、加载/失败/未登录状态 |
| src/components/dashboard/job-workspace.tsx | 两种数据源共用的统计、搜索、筛选、排序和列表展示，不读取存储 |
| src/components/dashboard/job-dashboard.tsx | 演示控制器，继续只调用原 useJobs/localStorage |
| JobForm / ConfirmDialog / Modal | 兼容同步和异步回调，请求中禁止重复提交、关闭及 Escape |
| tests/remote-jobs.test.ts | 10 项客户端及状态机测试，不写数据库 |

没有在浏览器导入 Prisma、连接配置或服务端密钥。fetch 使用固定相对地址和 credentials: same-origin，Cookie 由浏览器正常管理；Origin 也由浏览器生成，不手工伪造。没有自行持久化密码、Token 或私人岗位列表。

## 状态与一致性

- 首次加载显示加载提示；成功获取空数组才显示空列表与 0 统计。首次失败不把未知数据当作空列表。
- 刷新失败保留上次真实快照，明确显示错误和“当前显示上次成功读取的记录”；允许刷新重试。
- 新增、修改、删除等待 API 成功才更新快照，不进行未经服务器确认的乐观更新。服务器返回的 UUID、日期、状态作为最终值。
- 统计使用完整的当前用户 API 记录；筛选、搜索和排序只推导可见结果，不改变总体统计，不混入演示数据。
- 每个组件实例独立存储，离开页面不保存到 localStorage；重新进入或刷新页面重新向服务器取数。
- GET 使用 AbortController 与版本号，旧请求即使忽略取消信号，也不能覆盖新结果。卸载作废在途结果，Strict Mode 清理后可重新启动。
- 写入期间同步加锁，列表刷新与重复写入不能插队；表单和删除确认也使用 ref 保护提交，字段、保存、取消和关闭按钮在请求期间禁用。
- 观察到登录用户变化时，清空旧快照并重新进入服务端工作空间。401 后无法继续从该 Store 发受保护操作。

这种订阅方式沿用项目已有 useSyncExternalStore 模式，快照保持不可变，SSR 和首次客户端渲染都使用稳定的加载快照，避免 hydration 不一致。参考 [React useSyncExternalStore](https://react.dev/reference/react/useSyncExternalStore) 与 [Effect 生命周期清理](https://react.dev/reference/react/useEffect)。

## API 错误处理

| 情况 | 界面行为 |
| --- | --- |
| 401 | 清空私人岗位、停止后续操作，显示重新登录入口 |
| 400 | 表单保留草稿并提示必填/状态/日期问题；正常输入先复用原校验器逐字段提示 |
| 403 | 显示请求来源或权限问题，不修改 Origin、CORS 或会话机制绕过限制 |
| 404 | 提示记录不存在，自动重读列表并关闭过期编辑/删除弹窗 |
| 5xx / 断网 | 安全文案、保留草稿和最后真实数据，允许重试或刷新 |
| 错误 JSON / 不合法响应 | 拒绝作为岗位数据使用，提示刷新重试 |

不会把服务器原始 message、SQL、连接字符串或堆栈直接展示给用户。网络中断时写入结果可能未知，程序不自动重发写请求，应先刷新确认再决定是否重试；本阶段未加入服务端 POST 幂等键或离线队列。

## 自动测试与真实浏览器验收

本次实际执行：

| 命令 | 结果 |
| --- | --- |
| npm.cmd run lint / typecheck / build | 通过 |
| npm.cmd run test:db | 22/22 |
| npm.cmd run test:api | 22/22 |
| npm.cmd run test:auth:http | 2/2 |
| npm.cmd run test:jobs | 6/6 |
| npm.cmd run test:jobs:http | 17/17 |
| npm.cmd run test:remote-jobs | 10/10 |

合计 79 项自动测试通过，无失败或跳过。原认证 HTTP 测试仅调整已移除的欢迎占位文案断言，会话安全断言保留。

真实浏览器使用两个隔离的测试账号，实际验证了：

1. 匿名 Dashboard 重定向；注册后显示真实空列表，没有演示初始岗位。
2. 新增、刷新持久化、编辑状态、统计同步、筛选、删除取消/确认。
3. 退出后无法访问；重新登录原账号仍看到保留岗位。
4. 两个独立浏览器会话及同一浏览器切换账号均不混合岗位。
5. 模拟 400 / 403 / 5xx / 断网的安全提示与草稿保留，首次失败可重试；真实 404 自动刷新，真实 Session 撤销后 401 清除视图。
6. 延迟写入时按钮和 Escape 受限，重复提交只发送一次 POST。
7. 320、375、640、675、768、1024、1440px 无横向溢出。
8. /demo 新增、编辑、删除取消/确认、刷新持久化通过；全程未调用私人岗位 API。

数据库测试在事务内回滚；HTTP 测试清理本轮唯一用户和岗位。浏览器测试另外创建两个唯一账号，结束时按本轮邮箱确认用户，再查找本轮随机标记的测试岗位 ID，逐条以 ID + userId 精确删除。最后清理这两个用户及认证记录并断言无残留；没有清空业务表或处理其他用户记录。截图及测试注册表保存在 Git 忽略的 .qa 中，不含密码或 Token。

## 本地手动验收

1. 保持现有 .env.local 私密、PostgreSQL 正常运行。执行 npm.cmd run dev，使用与 BETTER_AUTH_URL 一致的地址（通常 http://localhost:3000）。
2. 注册测试账号或登录，进入 /dashboard。新账号应是空列表，已有账号应显示自己的数据库岗位。
3. 测试空字段提交；填写公司、职位、地点、状态、日期和备注后新增。核对统计、搜索和筛选，再刷新页面确认记录仍在。
4. 编辑状态和日期并保存，核对统计与排序；删除时先取消，再确认，刷新后仍应删除。
5. 保留至少一条记录，退出并直接访问 /dashboard，应转登录。重新登录原账号，保留记录仍存在。
6. 用隐私窗口登录另一个账号，应看不到前一个账号岗位。/demo 的本地记录不能出现在私人列表中。
7. 手动测试完只删除自己记下的测试岗位。原业务记录不需要清空，演示数据也不需要导入。

如需跑 HTTP 回归，先启动本地服务器，在另一个终端设置 API_BASE_URL 为相同来源后运行脚本；不要打印登录响应、Cookie 或密钥。

## 留待后续

localStorage演示数据的直接导入、服务端分页、实时跨设备推送和单条岗位POST幂等尚未实现；其他设备更改后可使用“刷新列表”。CSV批量导入已有独立的预览、人工确认及持久化幂等机制，见[CSV文档](csv-import.md)。
