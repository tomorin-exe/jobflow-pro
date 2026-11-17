# 邮箱验证码注册、登录与 QQ SMTP

版本：Better Auth / Prisma Adapter 1.7.25，Nodemailer 10.6.0，Next.js 16.4.6。复用现有认证框架、Cookie、Prisma 与 User/Session/Account/Verification，不增加数据库模型或迁移，不改变岗位 API、CSV 导入和数据隔离规则。

## 页面与数据流

- `/sign-up`、`/sign-in` 默认保留邮箱密码表单，可切换“邮箱验证码”。注册模式收集姓名、邮箱和验证码；登录模式只收集邮箱和验证码。新邮箱首次验证时由官方插件创建已验证账号，默认姓名为“求职者”；已有已验证账号登录时不覆盖姓名。
- `/dashboard` 对未验证邮箱显示验证入口。
- `/verify-email` 是服务端 Session 保护页，显示当前会话邮箱，不能由客户端指定另一个所有者。验证后返回工作空间。

```text
EmailOtpForm → 官方 authClient.emailOtp.sendVerificationOtp
  → /api/auth/email-otp/send-verification-otp
  → 固定 Origin、输入、用途、数据库限流及必要的会话校验
  → Better Auth 生成随机6位码 → 在 Verification 加密保存（标识也哈希）
  → Nodemailer → smtp.qq.com:465，连接即TLS → 邮箱

输入验证码 → 官方 authClient.signIn.emailOtp / emailOtp.verifyEmail
  → 服务端重新校验及限流 → 官方插件原子消费、过期和错误次数检查
  → 新用户注册/已有用户登录，或验证当前密码账号邮箱
  ← 官方设置 HttpOnly 会话 Cookie
  → getSession 确认真实会话 → 完整导航 /dashboard → 服务端再次校验
```

验证码固定 6 位、有效期 300 秒、每个码最多 3 次错误尝试；重发采用 rotate，提示使用最新邮件。验证码加密使用 Better Auth 官方 `storeOTP: "encrypted"`，密钥由现有 BETTER_AUTH_SECRET 管理；项目不自行生成 OTP、加密密码或创建会话。验证码、密码和 Session 不保存到浏览器 localStorage/sessionStorage，不输出日志。

参考 [Better Auth Email OTP](https://better-auth.com/docs/plugins/email-otp)。安全细节同时核对了本地 1.7.25 的插件、原子 consume、Prisma Adapter 和未验证账号处理源码；不依赖其他版本的假设。

## 未验证密码账号的兼容与安全

**重要版本行为：** 1.7.25 的 Email OTP 登录会对 `emailVerified: false` 的已有用户运行 `revokeUnprovenAccountAccess`，删除旧 Account 关联（包含密码）并撤销旧 Session，防止账号被预先冒领。本项目不能直接让旧密码账号走这条路径，否则用户可能意外失去原密码。

本次选择双重证明的兼容流程：

1. 原有邮箱密码注册/登录保持可用，不要求先配置 SMTP。密码注册不自动发验证码，也不更改原有自动登录行为。
2. 未验证的已有密码账号尝试 OTP 登录时，先通过官方 checkVerificationOTP 验证邮箱证明；错误码仍使用普通验证码错误。仅当验证码正确时提示先使用原密码登录，避免匿名查询账号是否存在。此分支不会进入插件的密码/会话清理流程，也不会发放新 Session。
3. 用户用原密码登录后，在 `/verify-email` 验证邮箱。服务端要求会话邮箱与请求邮箱相同，且 Session 创建时间不超过 5 分钟；匿名、他人 Cookie、过旧会话都不能验证该账号。会话过旧时页面提供退出按钮，需重新密码登录。
4. 验证成功保留原密码哈希和用户 ID、岗位，只撤销该用户的其他旧会话，当前会话保留；随后邮箱密码和 OTP 两种登录都可使用。

新 OTP 账号本来就没有密码，不会假造 credential Account。已验证密码账号使用 OTP 时也保留密码。未开放密码重置、改邮箱及其他 OTP 用途；旧密码遗忘后的账号恢复需要后续独立设计，不通过本次流程静默重置密码或自动认领账号。没有批量更改任何现有用户的 emailVerified。

## 服务端限流

前端倒计时仅改善体验，真实限制在服务器，开发模式也生效。通过 Verification 独立的 `jobflow-otp-limit-v1:` 命名空间记录配额元数据，邮箱键使用 HMAC-SHA256，不存原邮箱。它们不是 OTP，不会参与验证码验证。

| 范围 | 配额 |
| --- | --- |
| 每邮箱发送，合并登录/注册/验证用途 | 每60秒1次，每小时5次 |
| 全站发送，保护同一个 QQ 发件邮箱 | 每分钟10次，每小时60次 |
| 每邮箱验证，跨重发/用途累计 | 每15分钟10次 |
| 全站验证 | 每分钟120次 |
| 每个 OTP 的错误尝试 | 官方插件最多3次 |

事务内通过参数化 PostgreSQL advisory lock 原子地检查并更新配额，多个 Node 进程、重启、换 IP 或伪造 X-Forwarded-For 不能绕过这层限制；邮件在锁释放后发送。配额按固定窗口从首次请求计时，拒绝时不部分增加其他桶，返回 429 与 Retry-After。插件请求级限流额外作为兜底，原有密码注册/登录限流保持不变。参考 [官方限流说明](https://better-auth.com/docs/concepts/rate-limit)。

限流查询失败会拒绝操作，不放行发信。现有 Verification 没有唯一 identifier 约束，应用通过同一命名空间锁保证计数记录单一。为避免库默认的全表过期清理误删其他验证/配额，设置 verification.disableCleanup；过期码仍被拒绝，当前邮箱的消费/重发会处理对应记录。过期元数据的定期维护可后续独立添加，当前不做全表删除。高流量部署应重新评估全站配额及限流存储，不直接提高 QQ 邮箱的供应商额度。

## QQ SMTP 配置与手动验收

1. 登录你自己的 QQ 邮箱网页，在设置中找到 SMTP/IMAP 服务，按界面指引开启服务并生成 SMTP 授权码。使用完整 QQ 邮箱地址，密码项填写授权码，不能填写 QQ 登录密码。可以通过 [QQ 邮箱帮助中心](https://service.mail.qq.com/)查询当前界面操作。
2. 在私密 `.env.local` 中自行填写下面两个值；不要贴到聊天、日志或提交到 Git。`.env.example` 只有占位值：

   ```dotenv
   QQ_SMTP_USER="你的完整QQ邮箱地址"
   QQ_SMTP_AUTH_CODE="你本地生成的SMTP授权码"
   ```

3. 保留现有 DATABASE_URL、BETTER_AUTH_SECRET，确认 BETTER_AUTH_URL 与浏览器协议、主机和端口完全一致。修改后重启 `npm.cmd run dev`。不要混用 localhost 与 127.0.0.1。
4. 用一个由你掌控、尚未注册的邮箱打开 `/sign-up` →“邮箱验证码”。输入姓名/邮箱，发送验证码；检查收件箱及垃圾邮件，确认 JobFlow Pro 发件名和6位验证码，填写后进入工作空间。刷新并退出，再用验证码登录；每次重发至少等60秒，使用最新邮件。
5. 测试错误码、超过5分钟的旧码、同一码重放，应安全拒绝；三次错误后需等待重新发送。不要通过连续真实发信进行压力测试。
6. 用一个既有、未验证的密码账号验收兼容流程：原密码登录仍可用；进入工作空间的验证入口，5分钟内完成邮箱验证；当前会话保留，其他旧会话失效。退出后确认原密码和 OTP 都能登录同一个账号，岗位仍在。

服务器固定使用 `smtp.qq.com`、465、secure:true；开启证书校验和至少 TLS1.2，发件地址与 SMTP 用户一致，设置连接/握手/传输超时，不开启 SMTP debug/logger，不允许消息读取本地文件或 URL。参考 [Nodemailer SMTP](https://nodemailer.com/smtp)。SMTP 初始化延迟到实际发信时，未配置 SMTP 不影响密码功能或构建。1.7.25 会吞掉发信异常，因此按 Request 记录失败，并在 after hook 返回安全503；不把授权码、SMTP 响应或堆栈交给浏览器。

本轮没有发送真实 QQ 邮件，真实网络连通、QQ 授权码及收件送达情况需要按以上步骤在本机验收。

## 修改文件

| 文件 | 职责 |
| --- | --- |
| src/lib/auth.ts | 官方 OTP 插件、事务 Adapter、加密/哈希存储、请求级投递错误与验证后旧会话撤销 |
| src/lib/auth-client.ts | 官方 emailOTPClient，无自定义 Token 存储 |
| src/lib/mail.ts | QQ 配置校验、固定 TLS SMTP、按需初始化、可注入模拟 transport、安全错误 |
| src/lib/otp-policy.ts | 固定 Origin、用途白名单、邮箱/代码/姓名校验、旧密码兼容、当前邮箱/新鲜会话验证 |
| src/lib/otp-rate-limit.ts | 持久化配额、跨实例锁及 Retry-After |
| src/lib/otp-form.ts | 浏览器表单校验、倒计时和安全错误文案 |
| src/components/auth/auth-methods.tsx | 密码/验证码入口切换，默认保留密码 |
| src/components/auth/email-otp-form.tsx | 发送、倒计时、重发、确认、错误、Cookie会话确认与固定站内跳转 |
| src/app/sign-in/page.tsx / sign-up/page.tsx | 复用原布局，接入认证方式切换 |
| src/app/verify-email/page.tsx | 服务端保护的旧密码账号邮箱验证页 |
| src/app/dashboard/page.tsx | 未验证邮箱提示，不改岗位数据逻辑 |
| .env.example | QQ SMTP 的无密钥占位配置 |
| package.json / package-lock.json | test:otp 脚本，锁定仅开发使用的 smtp-server 与类型包；复用原 Nodemailer |
| tests/otp-form.test.ts | 5项表单、倒计时、错误、SMTP配置和注入/脱敏测试 |
| tests/email-otp.test.ts | 15项真实本地 HTTP + 模拟SMTP + 数据库兼容、安全、限流测试 |
| docs/email-otp.md / authentication.md / README.md | 设计取舍、配置、兼容与真实结果 |

## 验证结果

| 检查 | 结果 |
| --- | --- |
| lint / typecheck / build | 通过 |
| test:db | 22/22 |
| test:api | 22/22 |
| test:auth:http | 2/2 |
| test:jobs | 6/6 |
| test:jobs:http | 17/17 |
| test:remote-jobs | 10/10 |
| test:csv | 10/10 |
| test:import:unit | 5/5 |
| test:import:db | 8/8 |
| test:import:http | 11/11 |
| test:otp | 20/20 |
| 合计 | 133/133，无失败、无跳过 |

模拟 SMTP 是真实监听127.0.0.1随机端口的 smtp-server，Nodemailer 通过 TCP 投递，测试解析 MIME 并在内存读取 OTP；没有运行时测试开关或公开取码接口。HTTP 认证测试由官方 toNodeHandler 承载相同 createAuth 配置，接真实隔离数据库记录，注入模拟邮件 transport。QQ 生产 TLS 配置单独断言；模拟 SMTP 不代表真实 QQ 的 TLS/送达已经验收。

覆盖：加密存储/哈希标识、有效期、首次注册、登录、过期、3次错误、重发轮换、并发单次消费、Cookie/退出、Origin、SMTP拒收脱敏、持久限流与全站邮件额度、原密码哈希保留和旧会话撤销。测试仅清理本轮随机邮箱、已识别 Verification 标识和测试配额命名空间，按ID/所有者删除，不清空表。

原有 HTTP 测试一度并发触发密码注册每10秒3次的现有限流；窗口恢复后分批重跑通过，没有关闭限流或修改旧测试。浏览器在1440/375px核对原布局、切换、必填校验、60秒禁用和安全错误提示，无横向溢出；通过虚拟浏览器时钟验证倒计时结束可重发、429的120秒 Retry-After会更新倒计时，以及匿名访问 /verify-email 重定向登录。UI检查拦截发送请求，没有向真实收件人发送邮件。最终 Schema、历史迁移、岗位/CSV API、Repository 及演示存储保护文件哈希未变化，测试数据无残留。
