# GitHub 交付与 CI

## 边界

工作流为 `.github/workflows/ci.yml`，使用 Ubuntu 24.04、Node.js 24 和 PostgreSQL 18 service。只授予 contents:read；checkout 不持久化令牌，checkout/setup-node 均固定到官方 v7 当前提交 SHA。触发器为 main 的 push、pull_request 和 workflow_dispatch，没有 pull_request_target、生产 Secrets、推送或部署。

官方参考：[PostgreSQL service](https://docs.github.com/en/actions/tutorials/use-containerized-services/create-postgresql-service-containers)、[checkout](https://github.com/actions/checkout)、[setup-node](https://github.com/actions/setup-node)、[npm ci](https://docs.npmjs.com/cli/v11/commands/npm-ci)。

## 独立数据库

服务初始账号 `jobflow_ci_admin` 只用于创建测试角色和数据库；它不是应用连接账号。`ci-environment.mjs` 在runner上生成随机应用数据库密码、认证密钥和数据库标记，写入 GitHub 的 GITHUB_ENV，并掩码密码/密钥。QQ SMTP 配置为空。这里不读取仓库或生产 Secrets，也不生成或复制 `.env.local`。

`ci-database.mjs prepare` 仅允许 Linux GitHub Actions，连接新service的postgres库：若测试库/角色已存在直接失败，不复用或删除；创建非管理员 `jobflow_ci_app` 和其拥有的 `jobflow_ci`。数据库comment保存本任务随机标记。

`ci-database.mjs migrate` 在部署前检查CI标志、loopback URL、固定库名/角色、非超级用户和本任务数据库标记，之后才执行已提交迁移的 `migrate deploy`。普通本地测试没有迁移步骤；该CI命令不能在本地Windows运行，更不能回退连接jobflow_db。没有reset、db push、DROP或历史迁移修改。

Docker中的服务端 `inet_server_addr()` 可能是容器私网IP。CI校验客户端连接为127.0.0.1，并核验数据库标记；不错误地要求容器报告loopback。本地测试仍要求服务端地址为127.0.0.1或::1。统一校验位于 tests/helpers/test-database.ts 和 scripts/lib/test-target.mjs。

## 安装、生成和检查

Node版本记录在.nvmrc与package.engines。npm ci使用完整锁文件；registry URL统一为公开registry.npmjs.org，没有改变既有依赖的版本或integrity。npm安装脚本只批准Prisma、Prisma engines及esbuild，没有通配放行；postinstall只生成Client，不执行SQL。随后仍显式生成/校验，再部署CI迁移。

`check:ci` 用直接声明的 js-yaml 解析 YAML，核对事件、只读权限、固定Action SHA、Node24、PostgreSQL18、服务端口、无真实SMTP以及步骤顺序。它检查语法与本项目安全契约，不替代GitHub托管环境的实际执行。

CI依次执行lint、typecheck、build与test:all。新数据库未迁移或目标不符会失败，原数据库测试的历史“跳过未迁移库”逻辑已移除。

## 跨平台测试与进程

`npm run test:all` 顺序运行原有套件，保留各自断言与清理。Node子进程直接使用process.execPath，不依赖npm.cmd、PowerShell、bash、Windows安装路径或额外测试框架。

`npm run test:http` 仅负责HTTP阶段：

1. 读取配置并验证明确的loopback数据库/HTTP目标。清空子进程QQ SMTP环境变量。
2. 检查测试端口空闲；绝不杀死未知进程。默认http://127.0.0.1:3017，可用API_BASE_URL指定另一个loopback端口。
3. 启动自己拥有的Next.js生产进程，在60秒内等待健康JSON，启动失败/超时不会运行HTTP测试。
4. 顺序运行test:api、test:auth:http、test:jobs:http、test:import:http。账号注册套件间等11秒，遵守现有每10秒3次的限流；不使用跳过、伪造IP或关闭限流。
5. finally或中断处理停止自己启动的子进程；先SIGTERM，再按需要SIGKILL。日志位于忽略的.qa/http-server.log，不自动上传公开artifact。GitHub取消/结束job时还会清理runner进程树与service。

测试使用独立随机邮箱、账号、岗位和批次。常规结束时各套件按精确ID回滚/清理；CI任务结束后临时数据库随service销毁。异常强制杀进程时不对真实本地数据库做整表清理，未知残留应按本轮标记人工核查。

## 邮件测试

test:otp使用本地随机端口的smtp-server和注入的Nodemailer transport，与QQ生产通道分离。统一测试入口和CI把真实QQ配置清空，意外触发生产邮件路径会安全失败，不会真实发信。原密码注册不自动发验证码，现有认证安全策略保持不变。

## 安全审查

`npm run audit:repo` 检查当前候选文件、暂存区以及全部可达Git历史blob：敏感文件/备份/产物路径、高置信私钥和Token模式，以及本机已配置秘密的精确值匹配；只输出文件位置和类别，不回显值。不能替代全面的专业秘密扫描和截图人工审查。

本次检查未发现.env.local、备份、真实SMTP授权码、认证密钥或真实测试账号凭据被跟踪。固定单元测试占位值不是可登录的真实凭据；集成账号与密码运行时随机生成。公开截图尚未添加，仓库只预留演示素材位置。

**历史隐私待用户决定：** 当前6个历史提交包含非GitHub noreply的作者/提交者邮箱元数据，未输出地址。公开仓库被克隆时仍可读取这些元数据。没有重写历史或修改Git身份；发布前请决定是否接受，并可在GitHub个人邮箱设置中使用noreply地址用于后续提交。如需处理既有历史，应另行审核，不自动force-push。

公开文档不记录本机真实备份文件、秘密值、私人的截图或邮箱。忽略规则覆盖.env、QA/测试产物、数据库备份和私钥，历史扫描只报告风险，不自动删除文件或改历史。

## 本地验证与首次 GitHub 操作

本轮Windows本地执行lint、typecheck、build、全部原有133项和新增4项CI防护测试；另在无.env的独立忽略目录执行干净npm ci，验证锁文件与Prisma生成。YAML语法及数据库连接/步骤契约通过。当前没有Docker或已安装的WSL Linux发行版，也没有推送，因此不能声称Ubuntu service、云端首次迁移或GitHub Actions已经成功运行。

你需要手动完成：

1. 在GitHub创建目标仓库，确认公开范围及作者邮箱隐私；自行审核、提交并推送最新文件。当前暂存区和工作区并不完全一致，提交前检查git diff和git diff --cached，避免只提交旧的暂存版本。
2. 打开Actions页，允许所需Actions，查看首次CI；不需要配置真实数据库、QQ邮箱或认证Secrets。
3. 首次运行通过后，在仓库Rulesets/分支保护中将此CI检查设为合并要求；工作流步骤本身不修改仓库规则。
4. 将README注释中的OWNER/REPOSITORY换为真实仓库路径并启用徽章。在线演示和合成截图准备好后再填写，不预先标为已上线。

测试数量：test:db22、test:api22、test:auth:http2、test:jobs6、test:jobs:http17、test:remote-jobs10、test:csv10、test:import:unit5、test:import:db8、test:import:http11、test:otp20，以及CI工具4，共137项。新工具测试验证本地/CI白名单、外部/管理员/替代参数拒绝、HTTP地址限制及子进程清理。

## 本轮修改文件清单

| 类别 | 文件 | 作用 |
| --- | --- | --- |
| 工作流 | .github/workflows/ci.yml | Node24、PostgreSQL18、临时配置、生成/迁移/检查/完整测试 |
| 公开说明 | README.md、docs/ci.md、docs/screenshots/README.md | 项目介绍、架构图、运行/测试、素材占位、安全结果及手动交付步骤 |
| 详细文档整理 | docs/database.md、docs/repository.md、docs/remote-dashboard.md、docs/csv-import.md | 去除过期跳过逻辑、明确真实数据来源及单条/批量幂等区别，移除真实备份指纹 |
| 环境与依赖 | .nvmrc、.env.example、.gitignore、package.json、package-lock.json | Node版本、占位配置、备份/密钥忽略、脚本、安装策略与公开registry锁文件 |
| CI数据库 | scripts/ci-environment.mjs、scripts/ci-database.mjs | 随机CI配置、新库/非管理员角色、任务标记核验及限定迁移 |
| 自动测试 | scripts/run-tests.mjs、scripts/run-http-tests.mjs、scripts/lib/process.mjs | 保留各套件Node条件、顺序运行、健康检查、限流等待和进程清理 |
| 测试目标 | scripts/lib/test-target.mjs、tests/helpers/test-database.ts | 本地/CI固定白名单、实际角色/标记及容器连接校验 |
| 安全与配置审查 | scripts/security-audit.mjs、scripts/check-ci.mjs | 工作区/暂存区/历史秘密风险检查、YAML及工作流契约 |
| 防护测试 | tests/ci-tools.test.mjs | 4项新增测试 |
| 现有测试兼容 | tests/database.test.ts、tests/auth-http.test.ts、tests/jobs-http.test.ts、tests/job-import.test.ts、tests/job-import-http.test.ts、tests/email-otp.test.ts | 统一数据库核验，结构未就绪直接失败；目标未验证时不执行清理 |

本轮没有改动应用认证策略、岗位/CSV逻辑、Schema或历史迁移；本地正常账号和应用限流记录保留。临时安装目录、备份、审查记录及测试服务器日志均位于忽略目录，不提交。
