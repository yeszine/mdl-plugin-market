# 交接说明：mdl-plugin-market → MDL-MCP

- 读者：负责 `MDL-MCP` 的项目 AI
- 目的：不读本仓全部源码，也能理解本仓在 v2 架构里的边界、可复用的契约，以及 MDL 侧需要自己实现的部分
- 前提：`mdl-plugin-market` 是**内容、契约与客户端**，不是控制面；MDL 是**唯一账号、租户、可见性、审核与分发权威**

---

## 0. 一句话边界

本仓负责「资产长什么样、怎么装到员工机器上、怎么导出成可校验的目录、怎么投影成 DSH 索引」；MDL 负责「谁是企业、谁是员工、谁能看、谁审的、文件存在哪、怎么签名分发」。

**不要把本仓的 mock 适配器当成 MDL 的服务端来接管。**

---

## 1. 职责划分

| 能力 | 本仓（mdl-plugin-market） | MDL-MCP |
|---|---|---|
| 账号 / 密码 / 会话 | `server/adapters/mock.mjs` 仅本地演示，**不迁移** | 手机号 + 密码；Argon2id；Redis 会话；`accounts` + `account_roles` |
| 租户 / 席位 | 无 | 复用 `organizations` / `users` / `seats.py` |
| 资产目录 / 分类 | `catalog/assets.json`，15 条种子；分类树只做展示与筛选 | 建表、查询、筛选；分类不参与安全/审核/安装判定 |
| 可见性 / 审核 | 适配层接口 + mock 状态机，仅作参考 | 服务端强制 `org_id` 过滤；企业内 / 跨企业双通道 |
| 对象存储 / 签名下载 | 本地对象目录 + HMAC 签名，仅作参考 | 本地卷（P1）或 SeaweedFS（P2）；签名 URL |
| 安装执行 | **本仓职责**：`client/installer.mjs` 写客户机 | **不执行安装**，只发包与回执接口 |
| 提示词注入 / 做同款 | **本仓职责**：生成「安装方法 + 提示词」 | 只存 `same_as` 与依赖关系 |
| 导出 / 格式契约 | **本仓职责**：`export/` + `docs/format-spec.md` | 消费契约，不反向定义宿主格式 |
| DSH 索引 | **本仓职责**：`data/` + `scripts/build.mjs` 产出 format 1 | 可选消费；不把它当控制面数据源 |
| 审计 | 回执记录，仅作参考 | `console_audit_events` + `actor_account_id` |

---

## 2. 阅读顺序

| 顺序 | 文档 / 文件 | 解决什么问题 | 读完可以做什么 |
|---|---|---|---|
| 1 | `docs/v2-architecture.md` 第 0 节 | 结论、缺口、待确认项 | 知道哪些已定、哪些还没定 |
| 2 | `docs/v2-architecture.md` 第 3 节 | 单入口 + 分类 + 能力位模型 | 能设计 MDL 资产表，不会退回「多套 schema」 |
| 3 | `docs/v2-architecture.md` 第 4、5 节 | 可见性 / 审核状态机、手机号 + 密码主线 | 能排 P1 的表与接口 |
| 4 | `docs/format-spec.md` | WorkBuddy 真实落盘格式 | 能判断安装协议字段是否够用 |
| 5 | `server/adapters/contract.mjs` | 适配层 18 个方法 | 能实现 MDL 侧 HTTP 适配器 |
| 6 | `export/schema/asset-record.schema.json` + `export/assets.json` | 当前可校验契约（`asset-record/3.0`） | 能写导入校验器 |
| 7 | `docs/migration-map.md` | 旧仓路径 → 新仓路径 → 改造内容 | 需要考古时再看 |

**不要从源码开始读。** 先读 1–3；源码只在需要确认安装行为时看 `client/installer.mjs`，在确认接口时看 `server/adapters/contract.mjs`。

---

## 3. 契约在哪、怎么消费

### 3.1 当前契约（现在就能用）

| 文件 | 作用 | 消费方式 |
|---|---|---|
| `catalog/assets.json` | 唯一目录源：15 条资产 + 六类两级分类树 + 市场元数据 | 只读；新增资产只改这里 |
| `export/schema/asset-record.schema.json` | `asset-record/3.0` JSON Schema（Draft 2020-12） | 用任意 JSON Schema 校验器校验；MDL 导入时作为第一道闸门 |
| `export/assets.json` | 确定性导出：目录 + 逐文件哈希 + digest + source | 只读消费 |
| `docs/format-spec.md` | WorkBuddy 宿主格式逆向结论 | 安装协议与文件落点的权威说明 |

`export/assets.json` 的顶层：

```text
schema_version, marketplace, generated_at, commit, counts, assets[]
```

其中：

- `assets[].files[]` 是逐文件 `path` / `size` / `sha256`，安装前必须校验。
- `assets[].digest = sha256(asset_id + version + 全部 path:sha256)`。
- `assets[].source` 记录仓库名、提交、内容路径、导出时间；`commit` 由 `GIT_COMMIT` 注入，未设置时为 `unknown`。
- `assets[].capabilities.install.modes` 是安装语义的唯一依据：`direct` / `prompt` / `toggle`。
- **导出只含内容事实，不含审核结论与可见性。** 审核结论必须留在 MDL 服务端。

### 3.2 导出不变量

- 资产按 `skill → expert → team → connector → template → platform-extension`，同类按 `asset_id` 排序；文件按 `path` 排序。
- 同一 `--generated-at`（或 `SOURCE_DATE_EPOCH`）+ 同一 `GIT_COMMIT` 下，连续导出字节一致。
- 15 条资产必须全部通过 schema；`counts` 必须为 `skill 6 / expert 3 / team 2 / connector 2 / template 1 / platform-extension 1`。
- 不写客户机路径、不写真实 `~/.workbuddy`、不写审核人身份。

### 3.3 DSH 投影

`data/market.json` + `data/plugins.json` 经 `scripts/build.mjs` 生成 `index.json`（format 1）。它是同一份目录的第二个投影，不是第二份目录：

- 分类/标签映射见 `README.md` 的「DSH 索引投影」一节。
- `index.json` 与迁移前产物字节一致（见 `verify` 结果）。
- 仓库改名会改变 GitHub Pages 地址，`scripts/build.mjs` 的默认 `--index-url` 需同步；详见 README。

---

## 4. 适配层：MDL 需要实现的接口

服务端只依赖 `server/adapters/contract.mjs` 列出的方法。本地 `mock.mjs` 用内存 + 本地对象目录实现；接 MDL 时新增一个 HTTP 适配器即可，`server/server.mjs` 与 Web 前端不用改。

术语：`viewer = { account_id, org_id, role }`，`role ∈ platform_admin | org_admin | member`。

| 方法 | 入参 | 出参 | 服务端语义 |
|---|---|---|---|
| `health()` | — | `{ ok, adapter, storage }` | 健康检查，不暴露密钥 |
| `login({ phone, password })` | 手机号、密码 | `{ token, account }` 或 `null` | 密码校验只在 MDL；本仓不存密码 |
| `getAccount(token)` | 会话令牌 | `account` 或 `null` | 令牌 → 账号；停用账号返回 `null` 或由上层拒绝 |
| `getOrg(orgId)` | 租户 id | `org` 或 `null` | 只读企业信息 |
| `listAssets({ viewer, category, q })` | 查看者、分类、关键词 | `asset[]` | **只返回已上架且对该 viewer 可见的资产**；分类只做筛选 |
| `getAsset({ viewer, assetId })` | 查看者、资产 id | `asset` 或 `null` | 与 `listAssets` 同一套可见性判定 |
| `listMyAssets({ viewer })` | 查看者 | `asset[]` | 我上传的（含待审 / 驳回） |
| `listReviewQueue({ viewer, status })` | 管理员、状态 | `asset[]` | 非管理员必须抛 `FORBIDDEN` |
| `createUpload({ viewer, fileName, buffer, meta })` | 查看者、文件名、字节、元数据 | `asset` | 校验 slug / 版本 / 包类型；写对象存储；`review.state=pending`、`visibility=org` |
| `reviewAsset({ viewer, assetId, action, note })` | 管理员、资产、`approve/reject` | `asset` | 记录审核人、时间、备注；管理员校验在服务端 |
| `createDownloadLink({ viewer, assetId, ttlSeconds })` | 查看者、资产、TTL | `{ url, exp, sig, sha256, size, fileName }` | 只对已上架且可见资产签发；MDL 用自己的签名体系替换 HMAC |
| `readDownload({ assetId, exp, sig })` | 资产、过期时间、签名 | `{ buffer, fileName, sha256, size }` | 校验签名与过期；返回前校验对象哈希 |
| `recordInstall({ viewer, assetId, version, mode, host })` | 查看者、资产、版本、模式、宿主 | `receipt` | 安装回执；用于统计与审计 |
| `listInstallReceipts({ viewer })` | 查看者 | `receipt[]` | 企业内或有管理权限可见 |
| `getMetrics(assetId)` | 资产 id | `{ downloads, installs, rating }` | 下载 / 安装计数 |
| `listMembers({ viewer })` | 管理员 | `account[]` | 企业成员列表 |
| `setMemberStatus({ viewer, accountId, status })` | 管理员、账号、`pending/active/blocked` | `account` | 成员审核 / 停用 |
| `readObject(sha256)` | 对象哈希 | `Buffer` 或 `null` | 仅服务端内部使用；不暴露给浏览器 |

**MDL 实现要点**

1. 所有方法必须带租户上下文（`viewer.org_id` 或内部解析），不能只靠前端过滤。
2. `asset_id` 全局唯一；上传资产建议保留 `mdl.upload.<slug>` 命名空间，避免与目录种子冲突。
3. `visibility` 至少支持 `public | org | private`；企业内默认 `org`，跨企业才进入平台审核。
4. 审核状态至少支持 `pending | approved | rejected`；与 `state`（`draft | listed | rejected | archived`）解耦。
5. 对象哈希以 `sha256` 为键，天然幂等；对象写入要防路径穿越（本仓 `client/zip.mjs` 有可复用实现）。
6. 签名 URL 的有效期、密钥、审计字段由 MDL 决定；本仓 mock 的 HMAC 只是演示。

---

## 5. 明确不要照搬

| 本仓实现 | 为什么不能照搬 | MDL 应该用什么 |
|---|---|---|
| `server/adapters/mock.mjs` 的内存账号与 `demo` 密码 | 仅本地演示；无持久化、无多副本、无真实密码策略 | MDL 统一账号表 + Argon2id + Redis 会话 |
| 本地对象目录 `runtime/objects/<sha256>.zip` | 单实例、无副本、无生命周期 | 本地卷（P1）→ SeaweedFS（P2） |
| 单机审核状态机 | 没有租户隔离、没有审核人身份、没有跨企业同意 | `asset_review_events` + `platform_reviewer` 角色 + 企业同意 |
| `server/server.mjs` 的 Node HTTP 服务 | 与 MDL Python 运行时、鉴权链、审计链不兼容 | MDL `app/assets/` 模块 + FastAPI 路由 |
| 按分类分派的安装/展示分支 | 新增一类就要改代码；v2 已决定用能力位 | `capabilities.install.modes` 判定 |
| 本仓的 HMAC 签名下载 | 密钥与审计不符合 MDL | MDL 对象存储签名 URL |
| 本仓的 `review` 写入导出 | 审核结论是服务端状态，不应随内容分发 | 导出只写内容事实；审核留服务端 |

---

## 6. 已定死的 v2 决定（不要重新发明）

1. **单入口 + 分类**：技能、专家、专家团、连接器、模板案例、平台扩展功能全部一个列表入口；分类只做展示与筛选，不做存储分型。
2. **一份资产模型**：不设 `asset_type` / `subtype`；`kind` 只做文档级身份（`asset`），`capabilities` 承担行为。
3. **能力位**：`install.modes = direct | prompt | toggle`；客户端按能力位选路径，不按分类分支。
4. **`mdl_` Key 保留**：继续只做机器调用；新增 `account_id` 归属与轮换/吊销，不与人工登录混用。
5. **手机号 + 密码主线**：企业管理员与员工共用统一账号表 + 角色；WorkBuddy 登录是绑定后的快捷方式；邮箱登录取消；短信/微信/SSO 不在本阶段。
6. **平台审核人账号化**：`platform_reviewer` 角色纳入同一账号表，共享 `MCP_ADMIN_TOKEN` 降级为应急。
7. **密码存储**：Argon2id；初始密码机器生成、首次登录强制改密；忘记密码走管理员重置。

---

## 7. MDL 侧待实现清单

### P0：契约对齐（不改代码）

| # | 事项 | 输入 | 输出 | 验收 |
|---|---|---|---|---|
| P0-1 | 评审 `asset-record/3.0` 字段映射 | `export/schema/asset-record.schema.json`、`export/assets.json`、`v2-architecture.md` §3 | 字段映射表与差异清单 | 15 条都能映射；无字段丢失；`category` / `capabilities` 有明确落点 |
| P0-2 | 确认分类树与 `asset_id` 规则 | `catalog/assets.json`、`v2-architecture.md` §3.2/§3.8 | 分类字典 + ID 规范 | 现有 15 条 100% 归类；平台/企业/索引源命名空间无冲突 |
| P0-3 | 确认审核状态机与扫描阻断边界 | `v2-architecture.md` §4 | 状态枚举 + 阻断项清单 | 企业内 / 跨企业 / 平台发布三条路径都能画通 |

### P1：企业内闭环（含认证改造）

| # | 事项 | 输入 | 输出 | 验收 |
|---|---|---|---|---|
| P1-1 | 统一账号与会话 | `v2-architecture.md` §5 | `accounts` / `account_roles` / `identity_bindings` / `password_reset_tokens` | 管理员 + 员工手机号 + 密码可登录；首次登录 100% 强制改密；跨租户 0 泄漏 |
| P1-2 | 资产表与分类 | P0-2 产出 | `assets` / `asset_versions` / `asset_files` / `categories` | 一资产多版本；`(asset_id, version)` 不可变；分类只影响筛选 |
| P1-3 | 上传与校验 | `format-spec.md`、schema 3.0 | 上传接口 + 结构校验 + 逐文件 sha256 | 非法包全部拒绝；合法包可入库；失败原因可读 |
| P1-4 | 企业内可见与分发 | `v2-architecture.md` §4、§6 | 企业内列表、签名下载、安装回执接口 | 同企业可见；跨企业不可见；回执可查 |
| P1-5 | 客户端联调 | `client/installer.mjs`、`server/adapters/contract.mjs` | 直装 / 提示词 / 开关三条路径 + MDL 适配器 | 沙箱内四类资产可装卸；真实根默认 403 |

### P2：跨企业与审核

| # | 事项 | 输入 | 输出 | 验收 |
|---|---|---|---|---|
| P2-1 | 自动检查流水线 | `v2-architecture.md` §4.4、§4.5 | 扫描器 + `scan` 结果字段 | `BLOCKING` 项必拦；语义项只评分并留人工 |
| P2-2 | 平台审核与账号化 | P1-1 账号表 | 审核队列、`asset_review_events`、`platform_reviewer` 角色 | 每次审核可追到 `reviewer_account_id`；共享 token 非唯一入口 |
| P2-3 | 企业同意出域 | `v2-architecture.md` §4.3 | 企业同意记录与接口 | 未同意不得进入平台审核 |
| P2-4 | 召回与下架 | `v2-architecture.md` §4.6 | 召回状态 + 停止新安装 | 已安装不删除；新安装被拒；审计可查 |
| P2-5 | DSH 索引投影 | `scripts/build.mjs`、`data/plugins.json` | format 1 投影 | 可被 DSH 读取；分类映射正确；未知分类不阻塞 |

---

## 8. 边界提醒

- 本仓**不写** MDL 的数据库、不定义 MDL 的账号模型、不实现 MDL 的审核。
- MDL **不要**接管客户机安装；安装必须由客户端执行，服务端只发包、收回执。
- 契约变更（schema、分类、能力位）先改本仓 `export/`、`catalog/` 与 `docs/`，再同步 MDL；不要双写。
- 涉及 WorkBuddy 真实落盘的结论以 `docs/format-spec.md` 为准；标注为【推测】的部分需要实机验证后再固化。
- 本仓不保存任何真实凭证；演示账号密码仅用于本地 mock。
