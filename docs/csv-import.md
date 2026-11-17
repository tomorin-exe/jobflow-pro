# CSV 批量导入与疑似重复检测

`/dashboard` 的“CSV 导入”只操作当前登录账号的 PostgreSQL 岗位，不读取 `/demo` 的 localStorage。原有单条 CRUD、模拟 `/api/jobs` 和认证机制保留。

## 格式与限制

```csv
公司,职位,地点,状态,投递日期,备注
示例公司,前端工程师,上海,已投递,2026-11-17,"电话沟通，等待面试"
"Acme, Inc",后端工程师,北京,interviewing,2024-02-29,"第一行备注
第二行备注，含""双引号"""
```

- UTF-8，支持 BOM、CRLF/LF/CR、引号内逗号、换行和双引号转义。空行忽略；字段内原始换行保留。二进制控制字符、损坏编码及不闭合引号拒绝。
- 文件最多 256 KiB，最多 500 条数据记录，单记录最多 8192 字符。JSON 请求真实字节流上限 768 KiB，既检查 Content-Length，也累计读取字节。
- 公司、职位、地点、状态、投递日期必填；备注列可以省略。有备注列时，空备注保留末尾逗号。公司/职位/地点最多 100 字符，备注最多 2000 字符，沿用现有校验。
- 状态支持 `applied / interviewing / offered / rejected` 或 `已投递 / 面试中 / 已录用 / 未通过`。日期必须为实际存在的 `YYYY-MM-DD` 日历日期，不猜测 Excel 日期序号或地区格式。
- 英文表头支持 `company,position,location,status,appliedAt,notes`；也支持代码中明确列出的中文别名和 `applied_at`。列可重排。缺失、重复或未知列拒绝，包括所有者、ID、时间戳等保护字段。
- 逐行错误使用文件中的实际起始行号，包含表头、空行及前一记录引号内的换行。一条数据可跨多个物理行。结构无法解析时拒绝整个文件；字段错误行仍可预览，但不能被选中。

## 完整数据流

```text
CsvImportDialog 读取有大小上限的文件，严格 UTF-8 解码
  → 共用 csv-parse 解析与业务校验（尽早显示错误）
  → POST /api/me/jobs/import/preview
  → 服务端 Session + 精确 Origin 校验
  → 服务端重新解析，查询 where: { userId: session.user.id }
  ← 每行内容、错误、CSV 重复行号、自有数据库匹配数量和 previewHash
  → 用户勾选有效行，必要时明确确认保留疑似重复
  → POST /api/me/jobs/import
  → 再次校验 Session/Origin、请求大小、CSV、行号、字段、预览版本和重复确认
  → Repository + mapper → Prisma PostgreSQL transaction
  ← 批次结果；刷新当前用户列表，统计/搜索/筛选/排序从真实列表同步重算
```

解析采用锁定版本 `csv-parse@7.0.3` 的同步浏览器 ESM 入口，前后端共用实现，不用 split 按逗号拆分 CSV，也不将 Node.js stream/Prisma 引入浏览器。参考 [CSV Parse](https://csv.js.org/parse/)、[Sync API](https://csv.js.org/parse/api/sync/) 和[发行入口](https://csv.js.org/parse/distributions/)。同步解析的工作量由文件/记录数上限约束。

## 疑似重复规则

同一用户内，分别对公司、职位、地点执行 Unicode NFKC、去首尾空白、合并连续空白、忽略大小写，再将三者组成无歧义的 JSON 键。CSV 有效行互相比较，并与当前用户的已有岗位比较。无效行不参与；不同用户的数据从数据库查询阶段就被排除，不返回他人匹配数量或岗位 ID。

状态、日期、备注不参与判定，因为同一岗位可能在另一日期再次投递。这是可解释的“疑似重复”提示，允许用户明确保留，不能当作强制唯一约束。默认不选所有疑似重复行；若 CSV 重复组只选择一行且数据库没有匹配，则实际导入不重复，无需额外确认。

预览指纹包含原 CSV 的 SHA-256 及当前用户相关匹配岗位的 ID/规范化键。相关岗位新增、删除或改变匹配关系后，新批次返回 `409 IMPORT_PREVIEW_STALE`，要求重新预览。指纹不是认证凭证；服务端始终独立重算所有内容。

## 原子事务与幂等

每个导入使用 UUID `requestId`，唯一范围是 `(userId, requestId)`。`job_import_batches` 保存请求指纹、原始导入结果 ID 和物理行号，不保存原 CSV、备注、密码或会话。

1. 事务中通过参数化 `SELECT ... FOR UPDATE` 锁住当前用户行，使同一用户的并发导入串行化。
2. 先查询本用户的批次。相同请求返回原结果；同 key 的不同 CSV/选择/重复确认标志返回冲突。预览指纹不属于请求指纹，确保第一次提交后预览变化不会阻止安全回放。
3. 新批次重新比较当前用户数据和有效选择，校验预览指纹及重复确认。
4. 使用现有 mapper 转换 DATE、白名单字段；服务器生成岗位 UUID，并写入可信 userId。
5. `createMany` 创建全部所选岗位，并写入批次结果。任意步骤失败，岗位与批次一起回滚；没有 skipDuplicates 或部分成功语义。

首次成功 `201`，回放 `200`。即使之后手动删除了某个已导入岗位，重试旧批次也只回放结果，不重新创建已删除记录。批次元数据目前不自动过期，以维持这项保证。

使用 ReadCommitted + 用户行锁，而非先读旧快照再等待锁的模式。不同用户可独立导入。普通单条 CRUD 仍沿用原逻辑，不参与导入锁；所以疑似重复检查不是所有可能并发单条写入的绝对唯一保证。无论有无重复，导入都不会更新或删除已有岗位。参考 [Prisma 事务与幂等设计](https://www.prisma.io/docs/orm/v7/prisma-client/queries/transactions)。

客户端用 ref 防止连续点击；请求期间禁用输入、关闭和提交。网络/超时/5xx 视为结果不确定，保留完整在途请求并只允许“重试同一批次”，不自动换新 key。30 秒客户端超时大于 15 秒事务执行上限；仍不能将客户端超时当成数据库回滚的证据。

同一标签页的 sessionStorage 只保存“账号＋CSV＋所选行”的 SHA-256 键和随机批次 ID/原始重复确认标志，不存 CSV 或认证数据。刷新后重新选择相同内容，可以恢复原批次及确认标志；已知成功才移除。存储被浏览器禁用时，仍可在当前弹窗安全重试，但不能承诺跨刷新恢复。不同内容/选择是不同批次；幂等不替代重复提示。

## 修改文件与职责

| 文件 | 作用 |
| --- | --- |
| package.json / package-lock.json | 锁定 csv-parse 版本；新增四组测试命令 |
| prisma/schema.prisma | 新增 JobImportBatch 模型和 User 反向关系；Job 保持不变 |
| prisma/migrations/20261117090000_job_csv_import_batches/migration.sql | 只增表、唯一索引、用户索引和外键；已获准在本地执行，后续不可修改 |
| src/types/job-import.ts | 原始预览行、有效请求、预览/结果类型；预览状态允许非法字符串，不冒充有效岗位 |
| src/types/api.ts | 统一 API 错误码增加导入场景 |
| src/lib/job-csv.ts | 共用 CSV 解析、实际物理行号、字段校验、规范化及重复检测 |
| src/lib/jobs.ts | 允许同一校验器检查预览中的未知状态，规范化保留状态类型；业务规则与白名单不变 |
| src/lib/job-import-error.ts | 前后端可复用的预设安全错误码、文案和 HTTP 状态 |
| src/lib/job-import-body.ts | 服务端受限 JSON 字节流和严格 UTF-8 解码 |
| src/lib/job-api.ts | 复用 Session/Origin 校验，将可信 userId 传给导入 Repository；统一安全错误映射 |
| src/repositories/job-import-repository.ts | 当前用户的预览、重复复核、行锁、原子批量写入及持久化幂等回放 |
| src/app/api/me/jobs/import/preview/route.ts | 受保护的预览端点 |
| src/app/api/me/jobs/import/route.ts | 受保护的导入端点 |
| src/lib/job-import-client.ts | 同源 fetch、响应验证、错误映射和不含源文件/认证数据的待确认批次标识 |
| src/components/jobs/csv-import-dialog.tsx | 上传、模板、预览、逐行错误、选择、重复确认及同批重试 |
| src/components/dashboard/job-workspace.tsx | 可选导入按钮，演示控制器不传入，因此演示页不出现导入入口 |
| src/components/dashboard/remote-job-dashboard.tsx | 私人 Dashboard 弹窗与导入成功后刷新真实列表和统计 |
| src/components/ui/modal.tsx | 可选宽弹窗，原表单默认宽度不变 |
| src/hooks/use-remote-jobs.ts | 暴露已有 expire 方法，导入 401 时同步清除私人视图 |
| tests/job-csv.test.ts | 10 项解析/重复/客户端/重试元数据测试 |
| tests/job-import-unit.test.ts | 5 项权限优先、服务端重校验、流式上限/编码和安全错误测试 |
| tests/job-import.test.ts | 8 项已通过的真实事务、用户隔离和并发幂等测试 |
| tests/job-import-http.test.ts | 11 项已通过的真实 HTTP 认证、重复、输入、并发、回放和退出测试 |
| docs/csv-import.md / docs/remote-dashboard.md / README.md | 格式、设计取舍、迁移状态、实际结果和验收说明 |

## API

两条路由均为 Node.js Route Handler，要求真实 Session、可信 Origin、JSON 请求；私有响应使用 `Cache-Control: private, no-store`，不开放任意 CORS。

`POST /api/me/jobs/import/preview`

```json
{ "csv": "公司,职位,地点,状态,投递日期,备注\n示例公司,开发,上海,applied,2026-11-17," }
```

响应 `{ data: { rows: [{ line, input, errors, csvDuplicateLines, existingCount }], previewHash } }`。预览可以含无效行；不写任何岗位。

`POST /api/me/jobs/import`

```json
{
  "csv": "与预览完全相同的原文",
  "selectedRows": [2],
  "allowDuplicates": false,
  "previewHash": "预览返回的64位指纹",
  "requestId": "客户端为该批次生成的UUID"
}
```

响应 `{ data: { batchId, importedCount, jobIds, rowNumbers, replayed } }`。只接收明确白名单，额外 userId/有效标志/元数据不能控制归属或绕过服务端校验。统一错误 `{ error: { code, message } }`：401 会话失效、403 来源不可信、400 输入/CSV 错误、413 资源上限、409 重复确认/过期预览/批次冲突、503 未迁移或数据库不可用。不回显底层 SQL、堆栈或连接信息。

## 迁移与测试

新增 `prisma/migrations/20261117090000_job_csv_import_batches/migration.sql`，只增表、索引和用户外键；不改历史迁移、不回填/删除已有岗位，不运行 reset/db push。Schema 的 User 增加反向集合；Job 不变。

**执行状态：2026-11-17 已获用户批准并成功执行，仅限 `127.0.0.1:5432/jobflow_db`。** 实际账号 `jobflow_app`，服务端 PostgreSQL 18.7。执行前检查数据库连接、两份历史迁移校验和、待执行目录和 SQL；确认只有本份迁移待执行后，先备份，再运行一次 `prisma migrate deploy`。不需要再次执行该迁移。

执行前使用 pg_dump 的 custom 格式备份完整数据库，并通过 pg_restore 的目录及完整解压读取检查，没有向数据库执行恢复。真实备份路径、指纹与核验清单只保存在被 Git 忽略的本地目录，不纳入公开展示材料。

新增表包含 UUID 主键、用户 UUID、请求 UUID、SHA-256 请求指纹、岗位 UUID 数组、物理行号数组和创建时间。约束为主键、`(userId, requestId)` 唯一索引、用户/创建时间索引，以及指向 users 的外键。删除用户时级联删除其批次记录；Job 表及其他原有表结构不变。

Schema 校验和 Prisma Client 生成成功；数据库对 Schema 的只读 diff 为空，三份迁移全部已应用。迁移前、迁移后和所有测试清理后，对 users/sessions/accounts/verifications/jobs 按 ID 排序计算的数据指纹完全一致，均为 0 行。新增批次表最终也为 0 行；这是按明确测试 ID 清理的结果，没有清空表。

日常可重新运行以下检查：

```powershell
npx.cmd prisma migrate status
npm.cmd run prisma:generate
npm.cmd run test:db
npm.cmd run test:csv
npm.cmd run test:import:unit
npm.cmd run test:import:db
$env:API_BASE_URL = 'http://localhost:3017'
npm.cmd run test:import:http
```

HTTP 测试需先启动可信来源为同一地址的生产/开发服务器；不要修改或打印真实 .env.local。若使用 3017 测试端口，应仅在测试进程设置 `BETTER_AUTH_URL=http://localhost:3017`。本次验证服务器已在完成后停止，备份继续保留。

| 检查 | 本轮结果 |
| --- | --- |
| test:db | 22/22 通过 |
| test:api | 22/22 通过 |
| test:auth:http | 2/2 通过 |
| test:jobs | 6/6 通过 |
| test:jobs:http | 17/17 通过 |
| test:remote-jobs | 10/10 通过 |
| test:csv | 10/10 通过 |
| test:import:unit | 5/5 通过，不连接数据库 |
| test:import:db | 8/8 通过 |
| test:import:http | 11/11 通过 |
| lint / typecheck / build | 通过 |
| 自动化测试合计 | 113/113，0 失败、0 跳过 |

新数据库测试使用唯一测试用户/随机公司标记；按明确岗位 ID＋所有者清理，用户删除前确认无未知岗位，用户外键级联清理其独立批次及认证记录。故障测试在真实事务完成 createMany 后注入 ledger 写入故障，断言全部回滚。测试先检查新表存在，结构未就绪时不创建测试账号。

迁移前浏览器已验证：真实注册登录、复杂 CSV 预览、行号/错误/默认选择、显式重复确认、取消不写入、网络失败后重新预览、退出后的页面保护；375×667 弹窗居中无横向溢出。使用原有单条 CRUD 创建一个独立测试岗位，确认 A 的数据库重复提示出现，而 B 上传同一 CSV（即使伪造 A 的 userId）也没有该匹配，相关测试记录均已清理。

迁移后浏览器又完成真实导入：两条岗位与带 CRLF/引号的备注正确保存；在服务器返回 201 后主动中断浏览器响应，“重试同一批次”返回 200/replayed，岗位仍只有两条。第二批一条岗位在提交后中断响应并刷新页面，重新选择相同 CSV/行并确认，客户端恢复原 requestId 和原重复确认标志，仍回放而不重复创建。最终三条记录在刷新、退出和重新登录后保持不变。该用户、三条岗位、两个批次及认证记录均按已记录 ID 精确清理。真实事务故障回滚、并发幂等、双用户数据库写入隔离由上述 19 项数据库/HTTP 集成测试验证通过。

## 手动验收

1. 登录测试账号 A，下载模板并添加包含引号、逗号、换行的备注，再加入一行非法日期；上传后核对实际行号、错误提示及无效行禁选。先取消，确认列表未改变。
2. 再次上传并勾选有效记录，确认导入；核对列表/统计，刷新页面并重新登录，记录应仍在。用已有岗位和两行同键记录再次预览，确认疑似重复默认不选；只有明确勾选与确认后才保留为新岗位，旧岗位不变。
3. 在开发者工具中模拟网络断开/请求响应中断，使用“重试同一批次”，确认只创建一次。账号 B 上传相同文件，A 的岗位不得参与重复计数；退出后预览/写入必须拒绝。`/demo` 的本地 CRUD 和 `/api/jobs` 仍保持原行为。

尚未实现：Excel XLSX、自动编码猜测、文件拖拽、模糊相似度、导入历史 UI、跨设备恢复浏览器未确认批次；这些不属于本次 CSV 范围。
