# 资产市场 v2 架构（宿主：MDL-MCP）

- 日期：2026-11-07
- 状态：v2 模型已在新仓 `mdl-plugin-market` 落为可运行骨架（目录、契约、导出、安装器、DSH 投影）；控制面仍待 MDL-MCP 实现
- 边界：本文只描述架构与边界；账号、租户、可见性、审核、对象存储的权威实现不在本仓，见 `handoff-for-mdl.md`
- 标注约定：**【事实】** 直接读到代码、文档或配置；**【推断】** 基于事实的判断或建议，未在目标环境验证；**【待确认】** 需要用户决策、本稿已给建议默认值。
- 阅读顺序：先看第 0 节结论，再看第 1 节逐条对齐，其余按需查阅。

> 迁移说明：本文原稿写在 `dsh-fmcg-index` 仓的 `workbuddy-market/docs/`，迁入本仓时只做了路径与数量口径更新（旧仓相对路径 → 本仓路径，13 条种子 → 15 条）。历史对照见 `docs/migration-map.md`；文中「本仓」均指 `mdl-plugin-market`。

---

## 修订记录

**v2（2026-11-07，本轮）**，在原稿上做两处方向性修正，其余结论沿用：

1. **取消「三类 + 子类型」，改为「单一入口 + 分类区分」。** 原稿把资产收敛为 `skill` / `plugin` / `template` 三类，专家、专家团、连接器降为 `plugin.subtype`。用户明确要求：技能、专家、专家团、连接器、模板案例、平台扩展功能**全部放进一个入口**，用**分类**区分，目的仍是简化 mdl-mcp 架构。
   - 改动落点：§0.1 第 2 条、§1.1 第 4 条、§2.3、§3 全章重写、§4.1/§4.5、§6.1、§7、§9、§10、附录 B。
   - 核心变化：存储只有**一份资产模型**；`category` 只承担展示与筛选，`capabilities` 承担安装/运行语义；安装分支改为按能力位判定，不再按类型硬编码。三套 schema 的风险由此消除。
2. **认证主线改为「绑定手机号 + 密码」，`mdl_` Key 保持不变。** 员工与企业管理员统一走手机号 + 密码；WorkBuddy 自带登录作为「已绑定手机号之后」的快捷登录；邮箱登录按取消处理；默认密码由系统自动生成；本阶段不做短信验证码、微信登录、SSO。
   - 改动落点：§0（结论与缺口）、§1.1 第 6 条、§2、§5 全章重写、§8、§10、附录 A/B。
   - 核心变化：账号从三套（`console_admins` / `users` / 共享 token）收敛为「一张账号表 + 角色」；平台审核人不再是匿名共享 token；`mdl_` Key 继续只做机器调用，与人工登录彻底分离。

**为什么改**：原稿的「三类 + 子类型」仍然要求宿主按类型分派，新增一类就要动 schema 与安装器分支；改成单入口后，新增分类只是目录树上加节点，不动存储、不动安装器。认证原稿保留了邮箱与「员工不登录」的旧口径，与用户的新要求冲突；且共享 `MCP_ADMIN_TOKEN` 无法记录审核人，套用统一账号表可一并解决。

**沿用的结论**：控制面在 MDL-MCP（§2.2 方案 C）、双通道可见性（§4）、自动检查只做确定性项（§4.4）、安装执行留在客户端（§6）、P0/P1/P2 与 M2/M3 对齐（§8）均不变。

---

## 0. 结论先行

### 0.1 六条结论

1. **控制面必须落在 MDL-MCP，本仓退化为「客户端 + 契约 + 内容种子」。** 资产市场需要账号、租户、可见性、审核、审计、存储、分发，这些能力 MDL-MCP 已经拥有底座（`organizations` / `users` / `api_keys` / `console_admins` / `console_audit_events`），而本仓是零依赖 Node 单机服务，没有多租户，也没有第二套身份。若在本仓重建一套，会直接违背需求「认证不要自成一套」和既有「目录只有一个写入口」的结论。
2. **存储只有一份资产模型，一个列表入口；分类是展示维度，不是存储分型。** 不再有 `asset_type` 三选一和 `subtype`。语义由 `capabilities`（能否安装、能否开关、是否只做同款）承担；展示与筛选由 `category`（树路径 + 标签）承担。`category` 不参与任何安全与安装判定，未知分类也能正常存储与展示。这样新增「专家团」「平台扩展」只是加分类节点，不会长出第四套 schema。
3. **安装语义用能力位表达，不用类型分支。** 可直接安装 = `capabilities.install.modes` 含 `direct`；只能提示词 + 做同款 = 仅含 `prompt`；开关式平台扩展 = `capabilities.install.modes` 含 `toggle`，不落包、不改目录。安装器只读能力位，不读 `category`。
4. **「企业内直接可见」与「跨企业必须审核」在 MDL 既有治理模型里已有对应档位。** 既有文档把「跨企业共享」「资产上架」明确归为**平台审核**，把企业上限内的动作归为**企业自理、立即生效**。v2 只需补资产级状态机，不需要新造治理概念。
5. **认证走「绑定手机号 + 密码」一条主线，`mdl_` Key 原样保留。** 账号统一到一张 `accounts` 表 + 角色（企业管理员 / 员工 / 平台运营）；手机号是登录主键，密码用 Argon2id（沿用 MDL 现有 `console/security.py`），默认密码机器生成、首次登录强制改密。WorkBuddy 登录仅作为绑定后的快捷登录；邮箱登录取消；短信验证码、微信、SSO 不在本阶段。
6. **排期上 v2 与 MDL 现有 M2/M3 对齐；认证改造是 P1 的前置子任务。** MDL 一期明确不做资产市场，M2 做资产登记与私有/企业内上传下载，M3 做审核流 + 市场 + CAP，M5 才做公开市场。v2 的 P0 只产契约与导出，P1 对应 M2（含认证改造），P2 对应 M3；跨企业只做白名单，不等于公开市场。

### 0.2 必须由 MDL-MCP 侧补的八件事

| # | 缺口 | 现状 | 影响 |
|---|---|---|---|
| G1 | 资产表与租户字段 | 只有一张未被引用的 `skill_versions`，无 `org_id`、无 `visibility`、无审核字段 | 不能直接复用，必须新建资产/版本/文件/分类/审核/回执表 |
| G2 | 对象存储 | `docker-compose.yml` 只有 postgres / redis / qdrant / mcp-server / mdl-console，无对象存储服务；架构文档规划 SeaweedFS | P1 前必须定：本地卷（P1）或 SeaweedFS（P2） |
| G3 | 统一账号与员工登录 | `users` 无密码、无登录入口；`console_admins` 是另一张表；一期文档明确「员工不登录后台」 | 需要统一账号表或账号视图，员工才能用手机号 + 密码登录 |
| G4 | 平台运营账号 | `/admin` 只有共享 `MCP_ADMIN_TOKEN` + 内存会话，无账号、无角色、无操作人身份 | 跨企业审核无法落到「谁审的」；统一账号表可一并解决 |
| G5 | 手机号绑定与唯一性 | `users.phone` 可空、无唯一约束、无验证状态；`console_admins.phone` 全局唯一 | 手机号作为登录主键前，必须补唯一性、绑定状态与冲突策略 |
| G6 | 自动检查流水线 | 全仓无资产扫描、无提示词注入检测、无包签名校验 | 跨企业审核的「自检」需要新建，且只能做到确定性项 |
| G7 | 安装执行边界 | MDL 服务端不写客户磁盘 | 安装器必须留在客户端；服务端只发签名包与回执接口 |
| G8 | 身份绑定 | 无 WorkBuddy / 第三方身份绑定表 | 快捷登录需要 `identity_bindings` 与一次性绑定码 |

### 0.3 仍需确认的三个点（其余已确认，详见第 10 节）

1. **企业内高危项是否硬阻断**：本稿建议只阻断确定性高危（路径穿越、硬编码私钥/令牌、包哈希不一致、可执行二进制），其余仅告警。**状态：待确认。**
2. **跨企业分享是否需原企业管理员同意**：本稿建议需要（数据与 IP 出域责任）。**状态：待确认。**
3. **对象存储选型**：本稿建议 P1 本地卷、P2 迁 SeaweedFS。**状态：待确认。**

已确认、不再列为分歧：专家/专家团/连接器不独立成类型（并入统一分类）；员工登录走手机号 + 密码。

---

## 1. 需求解读与可行性评估

### 1.1 逐条对齐

| # | 用户需求 | 与现状的关系 | 判定 | 需要 MDL-MCP 配合 | 硬约束 |
|---|---|---|---|---|---|
| 1 | 宿主是 `MDL-MCP`，多企业多员工 | MDL 已有企业租户、员工、Key、席位与审计；无资产模块 | **可行，方向一致** | 新建资产模块与表；沿用 `org_id` 隔离 | 现有 `skill_versions` 无租户字段，不能直接当资产表用（`MDL-MCP 仓库\mcp-server\app\models.py#L281-L298`） |
| 2 | 企业内分享直接可见可用；跨企业必须自检 + 人工审核 | 既有治理文档已把「跨企业共享」「资产上架」定为平台审核，把企业上限内动作定为企业自理、立即生效 | **可行，且已有制度依据** | 资产级 `scan` / `review` 状态机；企业内发布闸门 | 「直接可见」与「自动检查」存在冲突：若检查同步阻断，就不是直接发布；若完全不检查，又无法承诺安全。必须明确阻断边界（见 §4.4） |
| 3 | 发布方两类：平台管理发布 / 企业员工发布 | MDL 有企业管理员 `ConsoleAdmin` 与平台 `/admin` 共享 token；没有平台运营个人账号 | **部分可行** | 平台运营账号体系；发布者类型字段 | 共享 token 无法区分审核人，跨企业审核的审计责任无法落地（`admin.py#L137-L175`、`#L1920-L1966`） |
| 4 | 技能/专家/专家团/连接器/模板案例/平台扩展**全部一个入口**，用分类区分；去掉 `other` | 本仓现有 4 种 `kind`；MDL v1 登记表 9 类；M2 文档另写 4 类 | **需重定义并迁移** | 资产表不再存 `asset_type`/`subtype`；新增分类树与能力位 | MDL 三处旧口径（9 类 / 4 类 / 本仓 4 kind）都不能直接沿用，需在 M2 建表前统一为「一份模型 + 分类树」（`manifest-asset-record-v1.md#L44`、`phase1-scope-and-acceptance-v1.md#L224-L229`） |
| 5 | 安装方式：skill + 提示词；能直装则直装，否则复制「安装方法 + 提示词」给 AI | 本仓已有四类沙箱安装器、真实根锁、备份、dry-run；MDL 不写客户磁盘 | **可行，复用现有安装器** | 服务端提供签名下载与回执接口；不执行安装 | 服务端无法判断客户端是否可写；判定必须由客户端能力上报，且以能力位而非类型分派 |
| 6 | 员工/企业管理员统一 **绑定手机号 + 密码**；WorkBuddy 登录作为绑定后的快捷方式；邮箱取消 | MDL 企业管理员已有邮箱/手机号 + 密码（Argon2id）；员工只有 `mdl_` Key、无密码、无登录；平台运营是共享 token | **冲突最大，工作量最大** | 统一账号表 + 角色；手机号唯一与绑定状态；身份绑定表；Key 归属账号 | 一期文档明确「员工不登录后台、不支持第三方登录」（`identity-and-onboarding-v1.md#L84`、`#L88-L92`），本需求等于扩一期边界；`users.phone` 目前无唯一约束（`models.py#L136`） |
| 7 | 项目归属围绕 MDL，后续再拆独立平台或 DSH 资源库 | 与本仓既有结论 A' 路线一致：控制面并入 MDL，安装执行面留在客户端 | **可行** | 代码落位方案见 §2.2 | 本仓 Node 与 MDL Python 不能互相 import，必须用 HTTP + JSON Schema 契约解耦 |
| 8 | 合并继续；旧文件清理、旧逻辑复用、为 DSH 索引源留接口 | `feat/merge-asset-hub` 已合并出可用原型，但改动未提交 | **可继续，但不能作为控制面合入** | 无 | 当前改动未提交，直接清理会丢证据；必须先归档提交/打 tag（见 §7.3） |

### 1.2 与现状明确冲突的点

1. **资产口径**：MDL v1 登记表定义 9 类（`manifest-asset-record-v1.md#L44`），M2 文档说首期 4 类（`phase1-scope-and-acceptance-v1.md#L226`），本仓是 4 种 `kind`，本次要求是「单入口 + 分类」。四套口径不能同时存在。**已定方向**：存储不设类型枚举，改为分类树 + 能力位；在 M2 建表前定稿，成本最低。
2. **员工登录**：需求要「员工手机号 + 密码」，但 MDL 一期没有员工账号密码，只有企业管理员有密码。**已定方向**：新增统一账号表（业务视图），`users` 保留为员工主数据，账号通过 `user_id` 关联；不改 `mdl_` Key 体系。
3. **平台审核主体**：需求要「平台人工审核上架」，但 MDL 平台侧只有共享 token。**已定方向**：平台运营账号纳入同一张账号表，`/admin` 逐步从共享 token 迁到账号会话，共享 token 仅保留应急。
4. **企业内零审核**：既有制度里企业管理员动作是「立即生效」，但没有内容安全检查；资产是代码/提示词，风险高于加员工。**待确认**：是否只硬阻断确定性高危项（本稿建议是）。

### 1.3 硬约束（不能承诺的能力）

| 约束 | 说明 | 依据 |
|---|---|---|
| 自动检查不能替代人工 | 提示词注入、脚本真实行为、业务合规无法靠静态扫描证明；自检只能降噪 | 【推断】基于扫描技术边界；MDL 当前无资产扫描实现（全仓无资产市场模块；`get_report_asset` 是 ECharts 报告库，与市场无关） |
| 服务端不能写客户磁盘 | 安装必须由客户端执行，服务端只发签名包与校验值 | 【事实】MDL 是远程多租户服务；本仓安装器直接写 `~/.workbuddy` |
| 跨租户可见性必须在服务端强制 | 不能靠前端过滤；每个查询必须带 `org_id` 或 `visibility=public` | 【事实】MDL 鉴权在服务端按 Key → User → org 求值（`auth.py#L145-L288`） |
| 无对象存储就无法多实例分发 | 本地卷只能单实例；扩容/多副本需要对象存储 | 【事实】`docker-compose.yml` 无对象存储服务；架构文档规划 SeaweedFS |
| 平台无法验证 WorkBuddy 身份真伪 | MDL 没有 WorkBuddy OAuth 客户端；WorkBuddy 只是 MCP 客户端 | 【事实】`install/mdl-mcp.md#L4`、`#L22-L28`；`identity-and-onboarding-v1.md#L88-L90` 明确一期不支持第三方登录 |

---

## 2. 目标架构

### 2.1 总体形态

```text
┌──────────────────────── 员工机器（客户端） ────────────────────────┐
│ WorkBuddy / Trae / DSH                                             │
│   ├─ 市场页（浏览、搜索、安装、做同款）                              │
│   └─ 本机安装器 client/installer.mjs                                │
│        - 能力上报（能否直装、根目录是否可写、宿主类型）               │
│        - 下载 → 校验 sha256 → 备份 → 落盘 → 登记 → 回执             │
└──────────────────────────────┬─────────────────────────────────────┘
                               │ HTTPS（AI 可代跑，也可浏览器直连）
┌──────────────────────────────▼─────────────────────────────────────┐
│ MDL-MCP 控制面（唯一权威）                                          │
│  /mcp            现有 MCP（Key 鉴权，机器调用）                     │
│  /login          统一登录：手机号 + 密码（管理员/员工/平台运营）      │
│  /console        企业管理员：企业内资产、成员、企业内审核/下架        │
│  /admin          平台运营：跨企业审核、来源管理、召回、审计           │
│  /api/assets/*   新增：目录 / 详情 / 上传 / 签名下载 / 安装回执       │
│  assets 模块     asset / version / file / category / source /         │
│                  scan / review / install_receipt                     │
│  存储            PostgreSQL + Redis + 对象存储（P1 本地卷，P2 待定）  │
└─────────────────────────────────────────────────────────────────────┘
```

**关键边界**

- 控制面只认 MDL 的账号：企业管理员、员工、平台运营**同属一张账号表**，靠角色区分；`mdl_` Key 只用于机器调用，与人工登录分离。**【推断】**
- 市场只有**一个入口**：列表页统一展示全部资产，分类树只做筛选与分组，不按类型拆多个页面。**【推断】**
- 客户端只认「目录 + 包 + 能力位 + 回执」，不持有审核权威，不做第二套账号。**【推断】**
- 内容事实（资产、版本、文件哈希、分类、能力位）走 `asset-record`；权限与审核结论只存在服务端，不写进导出文件。**【事实】与既有 status-compare 第 4.3 节一致。**

### 2.2 代码住在哪：三方案对比

| 方案 | 控制面 | 客户端 | 优点 | 致命问题 |
|---|---|---|---|---|
| A. 全部搬进 MDL-MCP | Python 模块 | 也要 Python 或重写 | 单一仓库、单一语言 | 客户端要写 `~/.workbuddy`，把 Python 运行时分发给员工不现实；现有 Node 安装器白做 |
| B. 本仓作为可嵌入服务 | 继续 Node 单进程 | Node | 改动最小 | 等于在 MDL 之外再建一套账号/租户/审核，直接违背需求 6；运维两套进程、两套数据 |
| C. 组合（推荐） | **MDL-MCP 新增 Python 模块** | **本仓保留 Node 客户端** | 单一权威、复用租户与审计；安装器可离线、可直装 | 需要维护一份 JSON Schema 契约与两个运行时 |

**结论：采用 C。**【推断，理由如下】

1. 账号、租户、角色、审计、席位、订阅都只在 MDL 侧，控制面放本仓等于复制这些能力。**【事实】MDL 的 `organizations/users/api_keys/console_admins/console_audit_events` 已完整（`models.py#L76-L209`、`#L462-L504`）。**
2. 安装天然在客户端：安装器要写 `%USERPROFILE%\.workbuddy`、要备份、要判断真实根锁；这些动作服务端做不了。**【事实】本仓 `client/installer.mjs` 已实现四类落盘与登记。**
3. 语言不同，不能 import，只能契约解耦。契约就是 `asset-record` + `package-manifest` + 安装回执 JSON Schema。**【推断】**
4. MDL 已有 `install/mdl-mcp.md` 这种「给 AI 的安装说明」范式，提示词安装路径可以直接复用同一套写法。**【事实】`install/mdl-mcp.md#L10-L45`。**

### 2.3 模块划分与请求链路

| 层 | 模块 | 职责 | 语言/位置 |
|---|---|---|---|
| 控制面 | `app/assets/`（新） | 资产 CRUD、版本、文件、分类绑定、能力位、可见性、审核、来源、回执 | Python，MDL-MCP 仓内 |
| 控制面 | `app/accounts/`（新） | 统一账号、角色、手机号绑定、密码、身份绑定、Key 归属 | Python，MDL-MCP 仓内 |
| 控制面 | `app/console/assets*`（新） | 企业内资产管理页、企业内下架、企业同意出域 | Python + Jinja，MDL-MCP 仓内 |
| 控制面 | `app/admin` 扩展 | 平台审核队列、来源管理、召回、审计查看 | Python，MDL-MCP 仓内 |
| 分发 | 对象存储适配器 | 上传、签名下载、哈希 | Python，MDL-MCP 仓内 |
| 客户端 | `client/installer.mjs` | 直装、开关式启用、备份、登记、回执 | Node，本仓 |
| 客户端 | `client/zip.mjs`、`server/lib/fsutil.mjs` | 解包、路径安全 | Node，本仓 |
| 客户端 | `web/` | 单入口浏览、分类筛选、详情、安装、做同款 | 静态页，本仓；长期可嵌入 Console |
| 契约 | `export/schema/*.json` + `docs/format-spec.md` | 资产记录、包清单、回执 | 本仓，双端共用 |

**典型链路**

1. 登录：手机号 + 密码 → 统一账号会话（Console / 市场共用）→ 首次登录强制改密。
2. 企业员工上传：`POST /api/assets`（multipart 或先传对象存储再登记）→ 服务端结构校验 → 写 `asset/version/file/category` → 返回 `scan` 状态与能力位。
3. 企业内发布：`visibility=org` → `review.state=not_required` → `lifecycle=published`；扫描异步执行，命中确定性高危可自动召回。
4. 跨企业发布：`visibility=public` → 扫描通过 → 企业管理员同意 → 平台审核 → `published`。
5. 安装：客户端 `GET /api/assets/{id}/versions/{v}` → 得到文件清单、签名 URL、`capabilities.install` → 按能力位走直装 / 提示词 / 开关。
6. 做同款：资产详情返回 `same_as`（提示词 + 依赖资产 + 输入定义）→ 客户端先确保依赖已安装 → 把提示词注入对话。

---

## 3. 资产模型 v2（单入口 + 分类）

### 3.1 一份模型、一个入口：`kind` / `category` / `capabilities` 的分工

**原则**

- 存一份资产记录，市场只开一个列表入口；技能、专家、专家团、连接器、模板案例、平台扩展功能全部是同一个列表里的条目。**【推断，符合用户要求】**
- 分类是**展示与筛选维度**，不是存储分型。新增「专家团」「平台扩展」只是分类树上加节点，不改表结构、不改安装器、不新增 schema。**【推断】**
- 行为差异用**能力位**表达。安装器只读 `capabilities`，不读 `category`；服务端审核也不按 `category` 分支。**【推断，避免类型硬编码】**

| 字段 | 承担什么 | 不承担什么 | 取值 |
|---|---|---|---|
| `kind` | **文档级身份**：这条 JSON 是资产、索引源还是回执 | 不表示资产是技能还是专家 | `asset` / `source` / `receipt`（资产记录固定 `asset`） |
| `category` | **展示与筛选**：市场导航、分组、搜索过滤、面包屑 | 不参与安装判定、不参与审核规则、不参与鉴权 | 一级 + 二级路径，如 `skill/analysis`；未知分类允许存在 |
| `capabilities` | **行为语义**：能否直装、能否开关、是否只做同款、依赖谁 | 不表示市场里显示在哪个 tab | 见 §3.4 能力位 |

**反例（明确不做）**：`if asset_type == "template": no_install()`、`if subtype == "expert_team": ...`。这类分支一律改为读能力位。分类改名字、加层级、加新类，都不应导致安装器改代码。

### 3.2 完整分类树与现有 15 条映射

**分类树（两级，够用且可扩展）**

```text
技能 skill
  ├─ 分析与洞察 skill/analysis
  ├─ 文档与报告 skill/report
  ├─ 数据处理 skill/data
  ├─ 自动化 skill/automation
  └─ 可视化 skill/visual
专家 expert
  ├─ 订货协同 expert/order
  ├─ 库存管理 expert/inventory
  └─ 门店经营 expert/store
专家团 team
  ├─ 经营复盘 team/review
  └─ 订货库存 team/order-inventory
连接器 connector
  ├─ ERP 集成 connector/erp
  └─ 数据源 connector/data
模板案例 template
  ├─ 经营看板 template/dashboard
  ├─ 经营报告 template/report
  └─ 门店物料 template/material
平台扩展功能 platform-extension
  ├─ 资产管理 platform-extension/assets
  ├─ 市场入口 platform-extension/market
  └─ 实验性 platform-extension/experimental
```

**分类规则**

- 一级分类固定为上述 6 个，可增加二级；二级名称可增删，不影响存储。
- 一条资产有且只有一个 `category.primary`；可额外挂 `category.labels[]` 做横切（如「需本机网关」「只读」）。
- 分类本身**不带权限含义**：`platform-extension` 不等于只有平台能发，只表示它默认走开关式启用。
- 未分类资产落 `category.primary = "uncategorized"`，仍可正常上架与展示，避免因分类缺失阻塞发布。**【推断】**

**现有 15 条映射**

| 现有条目 | 现有 `kind` | v2 `category.primary` | 能力位（§3.4） |
|---|---|---|---|
| `business-ops-analysis` 经销商经营分析 | skill | `skill/analysis` | `direct` + `prompt` |
| `research-guide` 深度调研 | skill | `skill/analysis` | `direct` + `prompt` |
| `html-report` HTML 报告 | skill | `skill/report` | `direct` + `prompt` |
| `xlsx` 表格处理 | skill | `skill/data` | `direct` + `prompt` |
| `schedule` 定时任务 | skill | `skill/automation` | `direct` + `prompt` |
| `dynamic-ui` 可视化图解 | skill | `skill/visual` | `direct` + `prompt` |
| `fmcg-order-advisor` 订货顾问 | expert | `expert/order` | `direct` + `prompt` |
| `fmcg-inventory-controller` 库存管控师 | expert | `expert/inventory` | `direct` + `prompt` |
| `fmcg-store-audit-analyst` 门店动销分析师 | expert | `expert/store` | `direct` + `prompt` |
| `fmcg-business-review-team` 经营复盘专家团 | team | `team/review` | `direct` + `prompt` |
| `fmcg-order-inventory-team` 订货库存协同专家团 | team | `team/order-inventory` | `direct` + `prompt` |
| `fmcg-erp-readonly` S6 ERP 只读查询 | connector | `connector/erp` | `direct` + `prompt` |
| `fmcg-sellout-dashboard` 门店动销看板 | connector | `connector/data` | `direct` + `prompt` |
| （暂无）经营看板案例 | — | `template/dashboard` | `prompt`（仅做同款） |
| （暂无）平台扩展 | — | `platform-extension/*` | `toggle` |

- 现有 15 条（技能 6 / 专家 3 / 专家团 2 / 连接器 2 / 模板案例 1 / 平台扩展 1）全部可无损迁移：分类只写进 `category`，原有 `kind` 仅作为迁移输入，不进入新记录。**【事实】条目与 `kind` 见 `catalog/assets.json`。**
- 专家与专家团不再需要 `subtype`：它们的差异体现在分类、`preview` 展示形态（「召唤」「团队帮你做」）和 `plugin.entrypoints`，而不是存储类型。**【推断】**
- 截图里的「召唤」「分享」「安装」「使用案例」都是**详情页动作**，由能力位决定显示哪个按钮，不由分类决定。**【推断】**

### 3.3 字段定义（`asset-record/3.0`）

以 MDL 既有 `asset-record/1.0` 为基础做增量，去掉 `asset_type` / `subtype`，新增 `category` 与 `capabilities`。

| 分组 | 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|---|
| 标识 | `schema_version` | string | 是 | 固定 `asset-record/3.0` |
| 标识 | `kind` | enum | 是 | 文档级固定 `asset` |
| 标识 | `asset_id` | string | 是 | `mdl.<category>.<slug>` / `<org_key>.<category>.<slug>` / `<source_id>.<category>.<slug>`，全局唯一 |
| 标识 | `version` | string | 是 | SemVer；发布后不可覆盖 |
| 分类 | `category.primary` | string | 是 | 一级 + 二级路径；未知值允许 |
| 分类 | `category.labels` | string[] | 否 | 横切标签，仅用于筛选 |
| 展示 | `name` | `{zh,en}` | 是 | 市场名称 |
| 展示 | `description` | `{zh,en}` | 是 | 市场简介 |
| 展示 | `tags` | string[] | 否 | 检索标签 |
| 展示 | `preview` | object | 否 | 头像/缩略图/截图，对应 CAP `preview/` |
| 归属 | `owner` | `{org_id,user_id}` | 是 | 企业与作者 |
| 归属 | `publisher` | object | 公开必填 | 平台 / 企业 / 合作方，含认证状态 |
| 治理 | `visibility` | enum | 是 | `private` / `org` / `public` |
| 治理 | `license` | enum | 是 | `MIT` / `Apache-2.0` / `proprietary` / `internal-only` |
| 治理 | `pricing` | object | 是 | 免费 / 套餐内 / 积分（M4 前只填免费） |
| 治理 | `scan` | object | 是 | 见 §4.2；系统维护 |
| 治理 | `review` | object | 是 | 见 §4.2；系统维护 |
| 能力 | `capabilities` | object | 是 | 见 §3.4；**安装与展示行为的唯一依据** |
| 安全 | `scopes` | string[] | 是 | 数据/动作授权范围，默认 `[]` |
| 安全 | `permissions` | object | 是 | `filesystem` / `network` / `shell` / `credentials` / `data_scope` |
| 安全 | `secrets_policy` | object | 是 | 是否允许硬编码密钥、密钥来源 |
| 安全 | `data_use` | object | 公开必填 | 数据用途、字段、保留期、共享范围 |
| 兼容 | `compatibility` | object | 是 | `mdl_core`、`hosts`（workbuddy/trae/dsh/octop）、`min_version`、`runtime` |
| 内容 | `files` | `[{path,sha256,size}]` | 是 | 逐文件哈希；安装前校验 |
| 内容 | `digest` | `{algorithm,value}` | 是 | 整包摘要 |
| 内容 | `skill` | object | 技能类必填 | `format=agentskills/v1`、`name`、`entry=SKILL.md` |
| 内容 | `plugin` | object | 插件类必填 | `manifest_path`、`entrypoints`、`bundled_skills[]` |
| 内容 | `showcase` | object | 案例类必填 | `artifact_url`、`thumbnail`、`screenshots[]`、`data_required[]` |
| 内容 | `same_as` | object | 案例类必填 | `prompt`、`inputs[]`、`outputs[]`、`dependent_assets[]`、`steps[]` |
| 溯源 | `provenance` | object | 案例类选填 | `produced_by_asset_id`、`version`、`generated_at` |
| 溯源 | `source_ref` | object | 索引源必填 | `source_id`、`external_id`、`url`、`external_version` |
| 指标 | `metrics` | object | 系统维护 | `downloads`、`installs`、`rating` |
| 时间 | `created_at` / `updated_at` | string | 系统维护 | ISO 8601 |

**约束**

- `(asset_id, version)` 唯一；版本发布后不可覆盖，只能升版本。
- `capabilities.install.modes` 为空时，该资产不可安装、不可开关，只能展示；`showcase` / `same_as` 至少有一个非空。
- `visibility=public` 时 `license` 不得为 `internal-only`。**【推断，与既有 license 枚举语义一致】**
- `capabilities.install.modes` 含 `direct` 时，`files[]` 与 `digest` 必填，且 `install.hosts` 非空。
- `capabilities.install.modes` 含 `toggle` 时，`toggle.key` 必填；不得同时要求下载包。
- `source_ref` 存在时，`source_ref.source_id` 必须指向已启用的索引源。
- `category.primary` 不参与上述任何约束的判定；分类缺失只影响展示分组，不影响合法性。

### 3.4 能力位（capability flags）

安装语义全部落在这里，**这是客户端与服务端唯一允许分支的字段**。

```json
{
  "capabilities": {
    "install": {
      "modes": ["direct", "prompt"],
      "hosts": ["workbuddy"],
      "entry": "SKILL.md",
      "target": "skills/{name}",
      "dependencies": [
        {"asset_id": "mdl.skill.xlsx", "version": "1.0.0", "optional": false}
      ]
    },
    "toggle": {"supported": false, "key": null, "default": false, "scope": "user"},
    "exhibit": {"showcase": false, "same_as": false},
    "runtime": {"client_side": true, "server_side": false}
  }
}
```

| 能力位 | 含义 | 客户端动作 | 典型分类 |
|---|---|---|---|
| `install.modes` 含 `direct` | 有可分发包，可直接安装 | 下载 → 校验 sha256 → 备份 → 落盘 → 登记 → 回执 | 技能、专家、专家团、连接器 |
| `install.modes` 含 `prompt` | 只能复制「安装方法 + 提示词」由 AI 执行 | 生成可整段复制的文本，等待 AI 执行并回报 | 任何装不了的资产；案例做同款 |
| `install.modes` 含 `toggle` | 开关式平台扩展，不落包 | 改写宿主配置键，记录开关状态；不发下载 | 平台扩展功能 |
| `install.modes` 为空 | 纯展示，不可安装、不可开关 | 只展示详情与来源 | 部分模板案例 |
| `exhibit.same_as=true` | 支持「做同款」 | 注入 `same_as.prompt`，先确保依赖已安装 | 模板案例 |
| `exhibit.showcase=true` | 有成品展示 | 展示 `showcase` 截图与产物链接 | 模板案例、专家团「使用案例」 |

**规则**

- `modes` 可组合；客户端按 `direct > toggle > prompt` 优先级选择，失败逐级降级，不静默吞掉失败。**【推断】**
- 是否走 `direct` 还取决于客户端上报的能力：安装器存在、根目录可写、宿主在 `install.hosts` 内、依赖可满足。服务端不猜。**【推断】**
- `toggle` 与 `direct` 互斥：开关式扩展不下载包，只改配置；若确实需要包，拆成两条资产。**【推断】**
- **参考 DSH 插件设置页**：顶部「已安装 / 发现」两个 tab，设置页内分「内置插件配置 / 实验性插件 / 已安装插件」三组，每项一个开关。映射到本模型：内置 = 平台预置且 `toggle.default=true`；实验性 = `category.primary=platform-extension/experimental`；已安装 = 用户已开启的项。开关状态写 `toggle.key`，不写资产包目录。**【事实】设置页形态来自用户提供的 DSH 截图；【推断】映射规则为本稿建议。**
- 开关状态需要回执：`{asset_id, version, host, key, value, changed_at}`，用于统计与审计；不做授权依据。**【推断】**

### 3.5 宿主格式映射（投影，不是第二套模型）

宿主差异在**适配器/安装器**里投影，主模型不按分类分支。

| 目标 | 来源 | 规则 |
|---|---|---|
| `name.zh` | `plugin.json.displayName` 或 `SKILL.md` frontmatter `description` 首句 | 缺失时用包名，禁止空 |
| `asset_id` slug | `plugin.json.name` / `SKILL.md` frontmatter `name` | 统一 kebab-case；冲突加序号 |
| `version` | `plugin.json.version`；技能包取 `package-manifest` | `SKILL.md` 没有版本，必须由包清单提供 |
| `plugin.manifest_path` | 包内 `.codebuddy-plugin/plugin.json` | 必须存在且可解析 |
| `plugin.entrypoints` | `plugin.json.expertType`、`teamInfo`、`skills`、`mcp` | 原样保留，供宿主识别；**不映射成存储类型** |
| `install.target` | 宿主约定 | WorkBuddy：技能 `skills/<name>`；插件 `plugins/cache/<market>/<name>/<version>` |
| `install.hosts` | `compatibility.hosts` | 至少包含 `workbuddy` 才允许 WorkBuddy 直装 |
| `permissions.*` | `plugin.json` 能力声明 + 扫描结果 | 声明缺失按最严格处理 |
| `files[]` | 实际打包文件 | 逐文件 sha256；忽略 `.DS_Store` 等噪声 |
| `toggle.key` | 平台扩展声明的配置键 | 必须是宿主已注册键；未注册不得上架 |

**事实依据**：技能落点 `skills/<name>/`，插件落点 `plugins/cache/<market>/<name>/<version>/`，并更新 `known_marketplaces.json` 与 `installed_plugins.json`，见 `mdl-plugin-market/docs/format-spec.md` 第 5、8 节；`SKILL.md` 是技能唯一入口，见 `manifest-package-v1.md#L142-L148`。

### 3.6 模板案例（分类 `template`，不是存储类型）

案例不是「文件包」，而是「可复现的成果 + 复现配方」。一条案例必须能回答三个问题：成品长什么样、用什么做出来、别人怎么再做一遍。

```json
{
  "kind": "asset",
  "category": {"primary": "template/dashboard", "labels": ["经营复盘", "看板"]},
  "capabilities": {
    "install": {"modes": ["prompt"], "hosts": ["workbuddy"], "dependencies": []},
    "exhibit": {"showcase": true, "same_as": true}
  },
  "showcase": {
    "artifact_url": "signed://...",
    "thumbnail": "preview/cover.png",
    "screenshots": ["preview/1.png", "preview/2.png"],
    "data_required": ["销售明细", "库存快照"]
  },
  "same_as": {
    "prompt": "用【企业经营看板】技能，基于我上传的销售与库存表，生成同款看板：...",
    "inputs": [
      {"name": "sales", "type": "xlsx", "required": true, "example": "sales_2026Q3.xlsx"}
    ],
    "outputs": [
      {"name": "dashboard", "type": "html"}
    ],
    "dependent_assets": [
      {"asset_id": "mdl.skill.business-ops-analysis", "version": "1.0.0", "role": "skill", "optional": false}
    ],
    "steps": ["安装依赖技能", "上传数据", "粘贴提示词", "按提示补参数"]
  },
  "provenance": {
    "produced_by_asset_id": "mdl.skill.business-ops-analysis",
    "produced_by_version": "1.0.0",
    "generated_at": "2026-10-20T10:00:00+08:00"
  }
}
```

**规则**

- `dependent_assets` 必须精确到版本，禁止浮动；缺失依赖时「做同款」必须先走安装协议。**【推断，保证可复现】**
- `showcase.artifact_url` 使用签名地址，不公开对象存储路径。
- 模板产物如果含真实业务数据，必须在入库前脱敏；`data_use` 与 `showcase.data_required` 要对得上。**【推断】**
- 案例不落包；`capabilities.install.modes` 只能含 `prompt`。判定依据是能力位，不是分类名。

### 3.7 一份目录，多处消费

同一份分类 + 资产目录，投影给三个消费方；**不各自维护一套分类**。

| 消费方 | 消费入口 | 投影方式 | 现在就要留的字段 |
|---|---|---|---|
| WorkBuddy `.codebuddy-plugin` | 本仓安装器 | 一级分类 → 落盘形态（技能目录 / 插件包 / 不落盘）；能力位 → 直装、提示词或开关 | `install.target`、`install.entry`、`plugin.manifest_path` |
| DSH format 1 索引源 | `export/` 新增 `dsh-index` 导出 | 每条资产 → `plugins[]` 一项；`category` → `metadata.category`；`digest` → 校验 | `category`、`source_ref`、`digest`、`compatibility.hosts` |
| 未来独立平台 | `GET /api/assets` + `asset-record/3.0` | 直接消费同一份 JSON，不改模型 | 全部字段；尤其 `category` 与 `capabilities` |

**DSH format 1 投影规则**

| DSH 字段 | 来源 | 说明 |
|---|---|---|
| `plugins[].name` | `asset_id` slug | 稳定去重键 |
| `plugins[].title` / `description` | `name` / `description` | 单语源先填中文 |
| `plugins[].metadata.category` | `category.primary` | 直接写二级路径，DSH 侧可自行分组 |
| `plugins[].labels` | `tags` + `category.labels` | 合并去重 |
| `plugins[].versions[].version` | `version` | 逐版本 |
| `plugins[].versions[].source` | 签名下载地址 | 导出时生成，不写对象存储真实路径 |
| `plugins[].homepage` / `repository` | `publisher` | 来源方信息 |

**【事实】DSH `index.json` 的 format 1 字段见 `index.json#L2`、`#L12`、`#L184`、`#L201`、`#L233-L237`。**
**【推断】两级分类路径天然可映射到 DSH 的 `metadata.category`，不需要为 DSH 单独建分类表；反过来，DSH 导入时未知分类落 `uncategorized`，再人工归类。**

### 3.8 `asset_id` 与版本

| 来源 | 命名空间 | 示例 |
|---|---|---|
| 平台 | `mdl` | `mdl.expert.order-advisor` |
| 企业 | `<org_key>`（`o_` 前缀） | `o_ab12cd.skill.sales-daily-report` |
| 索引源/合作方 | `<source_id>` | `src_dsh_fmcg.skill.business-ops-analysis` |

- `org_key` 已由 MDL 生成并唯一（`models.py#L88`；`admin.py` 内 `_gen_org_key` 生成 `o_` 前缀）。**【事实】**
- `asset_id` 的中间段用一级分类短名（`skill` / `expert` / `team` / `connector` / `template` / `platform-extension`），仅作可读命名空间，**不参与逻辑判定**；分类调整不强制改 `asset_id`。**【推断】**
- 同一 `asset_id` 的不同版本共享 ID；`(asset_id, version)` 不可变。
- 迁移旧内容时优先保留原 slug，避免引用断裂。

### 3.9 现有 15 条迁移

| 现有 `kind` | 数量 | v2 处理 | 迁移动作 |
|---|---|---|---|
| `skill` | 6 | 分类 `skill/*`，能力位 `direct + prompt` | 补 `name.en`、`description.en`、`license`、`permissions`、`install.hosts`、`category` |
| `expert` | 3 | 分类 `expert/*`，能力位 `direct + prompt` | 从 `plugin.json` 提取 `entrypoints`、`bundled_skills`；原 `group` 字段转 `category` |
| `team` | 2 | 分类 `team/*`，能力位 `direct + prompt` | 提取 `teamInfo` 成员到 `plugin.entrypoints.members` |
| `connector` | 2 | 分类 `connector/*`，能力位 `direct + prompt` | 保留 `mcp.json`，补 `permissions.network` |
| `template` | 0 | 分类 `template/*`，能力位仅 `prompt` + `exhibit` | 新建；先用 1 个看板案例打通 |
| `platform-extension` | 0 | 分类 `platform-extension/*`，能力位 `toggle` | 新建；先用 1 个市场入口开关打通 |

---

## 4. 可见性矩阵与审核状态机

### 4.1 三来源 × 三可见范围

| 来源 \ 可见 | `private` | `org`（企业内） | `public`（跨企业） |
|---|---|---|---|
| **平台发布** | 平台内部草稿；无人工审核；扫描可选；仅平台可见 | 不适用（平台资产无企业归属）。企业定制件走「企业来源 + 平台代发」 | 官方市场；扫描必须 `passed`；平台发布负责人复核并留痕；全部企业可见 |
| **企业员工发布** | 仅作者；无人工审核；扫描不阻断；作者可删 | **提交即发布**；扫描异步执行；企业管理员可下架；同企业可见可用 | 扫描 `passed` + **企业管理员同意出域** + 平台人工审核通过；全部企业可见 |
| **合作方 / 索引源** | 不适用 | 平台为企业定向开通；审核来源资质；仅该企业可见 | 需合作协议；扫描 + 平台审核 + 周期复检；全部企业可见 |

**说明**

- 需求 2 的「企业内直接可见可用」= `org` 列：`review.state=not_required`，`lifecycle=published`，不进入平台队列。**【推断，与 `identity-and-onboarding-v1.md#L141` 的「企业自理、立即生效」一致】**
- 需求 2 的「跨企业」= `public` 列：扫描 + 人工审核，二者缺一不可。**【事实】既有文档把「跨企业共享」「资产上架」定为平台审核（`identity-and-onboarding-v1.md#L140`、`#L157-L159`）。**
- 平台发布不是「免检」：平台自己也要留扫描记录与复核记录，否则出问题无法追责。**【推断】**
- 上表按**来源 × 可见范围**分，不按分类分。平台扩展功能、模板案例与技能走同一套通道；它们的差异只体现在能力位（§3.4），不产生额外审核通道。**【推断】**

### 4.2 三条独立状态机

```text
lifecycle:  draft --submit--> submitted --publish--> published --deprecate--> deprecated
                                                        |
                                                        +--recall--> recalled

scan:       queued --> running --> passed | failed | error
                  ^                    |
                  +------ rerun --------+

review:     not_required            （企业内 / 私有）
            pending --> approved | rejected
```

**为什么要拆三条**

- MDL v1 把扫描和审核串成一条（`submitted → scanning → reviewing → published`），适合跨企业，但无法表达「企业内先发布、扫描后补」。**【事实】`manifest-asset-record-v1.md#L136-L145`。**
- 拆开后：企业内可以「先可用、后补扫」，跨企业则要求 `scan=passed` 且 `review=approved`。责任边界清晰。**【推断】**
- `scan` 是每个版本独立执行、可重跑；`review` 也跟着版本走，旧版本结论不自动继承。**【推断】**

### 4.3 谁能审

| 场景 | 审核人 | 现有能力 | 缺口 |
|---|---|---|---|
| 企业内资产 | 企业管理员（统一账号，角色 `org_admin`） | 有登录、有会话、有审计（`console/security.py#L82-L100`、`models.py#L465-L484`） | 一期一企业仅一个管理员（`identity-and-onboarding-v1.md#L66`）；需把 `ConsoleAdmin` 并入统一账号表 |
| 跨企业资产 | 平台运营（统一账号，角色 `platform_reviewer`） | `/admin` 有审核队列模式（企业申请审核，`admin.py#L1939-L1966`） | 只有共享 `MCP_ADMIN_TOKEN`，无个人账号；审核人只能记为 `admin`（`admin.py#L137-L175`）。**本稿用统一账号表解决** |
| 合作方来源 | 平台运营 + 商务 | 无 | 需新建来源准入与合同状态 |
| 平台官方资产 | 平台发布负责人 + 复核人 | 无 | 建议双人留痕；P2 可先单人有完整审计 |

### 4.4 自动检查项与自动化上限

| 检查项 | 能自动到什么程度 | 企业内 | 跨企业 | 实现难度 |
|---|---|---|---|---|
| 包结构 / `SKILL.md` frontmatter / `plugin.json` 必填 | 完全确定 | 阻断 | 阻断 | 低 |
| zip 路径穿越、符号链接、超大文件 | 完全确定 | 阻断 | 阻断 | 低 |
| 逐文件哈希、整包摘要、去重 | 完全确定 | 记录 | 阻断（不一致即拒） | 低 |
| 硬编码密钥 / `.env` / 私钥 / 高熵串 | 高确定，有误报 | P0 告警；P1 阻断 | 阻断 | 中 |
| 可执行文件 / 二进制 / 混淆脚本 | 高确定 | 告警 | 阻断或人工 | 中 |
| 外链与域名提取 | 提取确定，域名善恶需策略 | 告警 | 白名单外人工 | 中 |
| 依赖固定版本、宿主兼容声明 | 完全确定 | 告警 | 阻断 | 低 |
| 许可字段与分发范围一致 | 存在性确定，真伪不确定 | 告警 | 人工 | 中 |
| 提示词注入 / 越权指令 / 诱导泄密 | 只能规则 + 模型评分 | 告警 | **人工必看** | 高 |
| 脚本真实行为 / 数据外泄 | 静态只能近似，动态沙箱成本高 | 告警 | **人工 + 沙箱（P2 可选）** | 高 |
| 业务合规 / 内容违规 | 不能自动 | 企业自担 | 人工 | 高 |

**结论**：自动检查承担「确定性阻断 + 风险降噪」，人工审核承担「语义与合规判断」。任何「自检通过即安全」的承诺都不成立。**【推断】**

### 4.5 发布闸门

```text
publish(asset, version):
  if visibility == private:
      allow if actor == owner
  elif visibility == org:
      deny if scan.status == failed and scan.max_severity in BLOCKING
      allow with review.state = not_required
  elif visibility == public:
      require scan.status == passed
      require review.state == approved
      require org_consent == approved when source == org
      allow
```

- `BLOCKING` 建议先限定为：路径穿越、硬编码私钥/令牌、包哈希不一致、可执行二进制。**状态：待确认（建议默认值）。**
- 企业内若关闭扫描阻断，必须有「企业管理员确认已知风险」的留痕；否则平台无法解释为何风险资产在企业内流通。**【推断】**

### 4.6 审计与召回

- 每个动作写 `console_audit_events` 同构的资产审计：`asset.submit`、`asset.publish`、`asset.review`、`asset.recall`、`asset.download`、`asset.install_receipt`。**【事实】MDL 已有统一审计表（`models.py#L487-L504`）。**
- `recalled` 后：市场不再展示；已安装用户在下一次打开时收到提示；不强制删除本地文件（避免破坏用户环境），但停止新安装与更新。**【推断】**
- 扫描失败自动召回只对企业内 P1 生效，且只对 `BLOCKING` 项；语义类失败只告警。**状态：待确认（随 §10 第 1 项一并拍板）。**

---

## 5. 认证与账号（绑定手机号 + 密码）

### 5.1 MDL-MCP 现有账号与鉴权（只读结论）

| 维度 | 事实 | 证据 |
|---|---|---|
| 企业租户 | `organizations`：`org_key` 唯一、`plan`、`is_active`、`expires_at`、`seat_limit`（默认 10） | `mcp-server/app/models.py#L76-L126` |
| 员工 | `users`：`org_id`、`role`（owner/manager/member）、`phone`（可空、**无唯一约束**）、`wechat_openid`；**无密码字段** | `models.py#L129-L177`（`phone` 见 `#L136`） |
| API Key | `mdl_` 前缀；只存 SHA-256；`scopes`、`data_scope`、`expires_at`、`superseded_at`、`revoked_at`；一员工一活跃 Key | `models.py#L180-L209`；`auth.py#L145-L288` |
| Key 鉴权链路 | 前缀校验 → 哈希 → Redis 缓存 → 用户/企业/订阅/Key 生命周期 → 授权求值（默认拒绝） | `auth.py#L145-L288` |
| 企业管理员 | `console_admins`：`org_id` 非空、邮箱唯一、手机号唯一、Argon2 密码、`role`、`status` | `models.py#L465-L484` |
| 管理员登录 | 邮箱/手机号 + 密码；Argon2id；失败 5 次锁 10 分钟；Redis 会话 8 小时；Cookie `mdl_console_session` | `console/security.py#L15-L100`；`console/main.py#L279-L361` |
| 密码策略 | 8-64 位，至少 3 类字符；Argon2 `PasswordHasher` 默认参数 | `console/security.py#L8-L53` |
| 登录限制 | 一期不支持验证码、不支持第三方登录；员工不登录后台 | `identity-and-onboarding-v1.md#L3`、`#L84`、`#L88-L92` |
| 平台管理 | `/admin` 凭 `MCP_ADMIN_TOKEN`；会话存进程内字典；无账号表、无角色 | `admin.py#L137-L175`；`config.py#L44`；`main.py#L2997-L3002` |
| 租户隔离 | 每次请求由服务端按 Key → User → org 重新求值；企业停用/到期即拒绝 | `auth.py#L217-L260` |
| 授权事实源 | 企业 entitlement → 员工 grant → Key，四层求值，默认拒绝 | `identity-and-onboarding-v1.md#L170-L177` |
| 席位 | 席位 = `deleted_at IS NULL` 的员工数；停用仍占席位 | `models.py#L94-L96`；`mcp-server/app/seats.py` |
| 资产底座 | 仅有 `skill_versions` 表，且全仓无引用；无 asset/market 模块 | `models.py#L281-L298`；全仓 grep `SkillVersion` 仅 2 处定义 |

### 5.2 统一账号模型：一张账号表 + 角色

**结论：不再维护三套身份，统一为 `accounts` + `account_roles`。**【推断，理由见下】

| 角色 | `org_id` | 主要权限 | 对应现实现 |
|---|---|---|---|
| `org_admin` 企业管理员 | 必填 | 企业内成员、资产、企业内下架、同意出域 | 现 `console_admins` |
| `employee` 员工 | 必填 | 浏览/安装、上传自己的资产、回执 | 现 `users` + `mdl_` Key |
| `platform_reviewer` 平台审核人 | 空 | 跨企业审核、来源审核、召回 | 现共享 `MCP_ADMIN_TOKEN` |
| `platform_admin` 平台运营 | 空 | 账号与企业管理、平台发布、审计 | 现共享 `MCP_ADMIN_TOKEN` |

**为什么是一张表 + 角色，而不是三张表**

- 登录入口只有一个（手机号 + 密码），三张表会导致三套登录页、三套限频、三套会话。**【推断】**
- 平台审核必须记录「谁审的」；共享 token 无法追责，统一账号后 `actor_id` 直接落到账号。**【事实】共享 token 无身份（`admin.py#L137-L175`）。**
- 同一个人可能既审平台又管企业；一张表加角色比多表更自然。**【推断】**
- `users` 继续作为员工业务主数据（席位、S2 绑定、授权），`accounts` 只承担登录与角色；通过 `accounts.user_id` 一对一关联，不合并表，避免破坏现有 Key 链路。**【推断，迁移成本最低】**

```text
accounts
  id, phone*unique, phone_bound_at, password_hash, password_must_change,
  status(active/disabled/locked), display_name, org_id null,
  user_id null -> users.id, created_at, updated_at, deleted_at
account_roles
  id, account_id -> accounts.id, role, org_id null, granted_by, granted_at, revoked_at
  唯一约束 (account_id, role, org_id)
identity_bindings
  id, provider(workbuddy/...), external_subject, account_id, org_id,
  verified_at, revoked_at, 唯一约束 (provider, external_subject)
password_reset_tokens
  id, account_id, token_hash, issued_by, expires_at, used_at
api_keys
  新增 account_id nullable -> accounts.id（回填：由 user_id 找对应账号）
```

- 管理员与员工不再分别存密码；`console_admins.email` 字段保留但**不参与登录**，迁移后置空或留作通知地址。**【推断】**
- 手机号全局唯一；一期不做短信验证，绑定动作由管理员完成并留痕（`phone_bound_by`）。**【推断】**
- 平台审核人 `org_id` 为空，不占企业席位；企业管理员与员工占席位，沿用 `seats.py` 口径。**【推断】**

### 5.3 认证主线时序

```text
① 开通 / 邀请
   平台开通企业 → 生成 org_admin 账号
   org_admin 邀请员工 → 生成 employee 账号
        │
        ▼
② 系统自动生成初始密码
   机器生成 12-16 位、满足 3 类字符；只在 Console 展示一次
   password_must_change = true；不存明文、不发邮件
        │
        ▼
③ 首次登录强制改密
   POST /api/auth/login（手机号 + 初始密码）
   → 除改密接口外全部 403 → POST /api/auth/change-password
   → 旧密码立即失效，原会话全部作废
        │
        ▼
④ 绑定手机号
   账号创建时未带手机号 → 首次登录强制绑定；已带则校验唯一性
   冲突处理：提示「该手机号已被占用」，由 org_admin / 平台人工核查
        │
        ▼
⑤ 绑定 WorkBuddy 身份
   org_admin 生成一次性绑定码（10 分钟、单次）
   客户端 POST /api/identity/bind → 写 identity_bindings
        │
        ▼
⑥ 后续登录
   A. 手机号 + 密码（主路径）
   B. WorkBuddy 快捷登录（已绑定后可用；仍需服务端会话）
```

**WorkBuddy 快捷登录的边界**

- MDL 没有 WorkBuddy OAuth，也没有对外身份端点；WorkBuddy 在 MDL 眼里只是 MCP 客户端（`install/mdl-mcp.md#L4`、`#L22-L28`，`identity-and-onboarding-v1.md#L88-L92`）。**【事实】**
- 因此「快捷登录」= 已绑定身份 + 客户端提供的身份断言 + 服务端签发会话；**不是**免认证。断言格式与签名密钥需在 P1 与客户端约定。**【推断】**
- 绑定码是一次性信任建立（TOFU）；解绑走 `identity_bindings.revoked_at`，不影响手机号 + 密码登录。**【推断】**

### 5.4 `mdl_` Key 与账号的关系

| 项 | 规则 |
|---|---|
| 归属 | Key 归属账号（新增 `api_keys.account_id`），同时保留 `user_id` 以兼容现有鉴权链路 |
| 用途 | **只用于机器调用**（MCP、客户端 API）；不得用于网页登录 |
| 人工登录 | 手机号 + 密码 → 会话 Cookie；会话不得调用 MCP 的 Key 鉴权入口 |
| 轮换 | 沿用 `superseded_at` / `superseded_by_key_id`；轮换由账号本人或管理员触发 |
| 吊销 | 沿用 `revoked_at` / `is_active`；账号停用即吊销其全部 Key |
| 多 Key | 一期仍「一账号一活跃 Key」；后续可放开 |
| scope | Key 的 `scopes` 不变；资产相关新增 `assets:read` / `assets:install` / `assets:publish` |

- **机器调用与人工登录彻底分离**：网页会话泄露不能直接调用 MCP；Key 泄露也不能登录后台。**【推断】**
- 现有 `mdl_` Key 不需要重新签发；只需回填 `account_id`。**【推断】**

### 5.5 需要 MDL 新增的表 / 接口 / 字段（可直接排期）

**表**

| # | 表 | 关键字段 | 说明 |
|---|---|---|---|
| T1 | `accounts` | `phone` 唯一、`password_hash`、`password_must_change`、`status`、`org_id`、`user_id` | 统一登录账号 |
| T2 | `account_roles` | `account_id`、`role`、`org_id`、`granted_by`、`revoked_at` | 一账号多角色 |
| T3 | `identity_bindings` | `provider`、`external_subject`、`account_id`、`org_id`、`verified_at` | WorkBuddy 绑定 |
| T4 | `password_reset_tokens` | `account_id`、`token_hash`、`issued_by`、`expires_at`、`used_at` | 管理员重置密码 |
| T5 | `asset_review_events` | `asset_id`、`version`、`reviewer_account_id`、`decision`、`reason` | 审核留痕（由资产模块建） |
| 改 | `api_keys` | 新增 `account_id` nullable | 回填，不改鉴权主链路 |
| 改 | `console_admins` | 迁移到 `accounts` 后只读保留一版 | 双写一个版本后下线 |

**接口**

| # | 方法 | 路径 | 说明 |
|---|---|---|---|
| A1 | POST | `/api/auth/login` | 手机号 + 密码；限频沿用 Redis 计数 |
| A2 | POST | `/api/auth/change-password` | 首次登录强制；改后作废全部会话 |
| A3 | POST | `/api/auth/bind-phone` | 首次登录绑定手机号 |
| A4 | POST | `/api/auth/logout` | 删除会话 |
| A5 | GET | `/api/me` | 返回账号、角色、企业、是否需改密 |
| A6 | POST | `/api/accounts` | 管理员创建员工，返回初始密码一次 |
| A7 | POST | `/api/accounts/{id}/reset-password` | 管理员重置，返回新初始密码一次 |
| A8 | POST | `/api/accounts/{id}/disable` | 停用账号并吊销 Key |
| A9 | POST | `/api/identity/bind-codes` | 管理员生成一次性绑定码 |
| A10 | POST | `/api/identity/bind` | 客户端绑定 WorkBuddy 身份 |

**字段级规则**

- `phone`：中国大陆 11 位或 E.164；入库前归一化；全局唯一；变更需管理员或短信验证（本期仅管理员）。**【推断】**
- `password_must_change=true` 时，除 A2/A4/A5 外全部拒绝。**【推断】**
- `account_roles` 的 `org_id`：平台角色必须为空，企业角色必须非空；由约束或服务端校验保证。**【推断】**
- 所有资产、Key、审计写入都带 `actor_account_id`；旧记录允许为空。**【推断】**

### 5.6 密码存储与默认密码

- **沿用 Argon2id，不换 PBKDF2。** MDL 现网已用 `argon2.PasswordHasher()`（`console/security.py#L8-L39`）；PBKDF2 只存在于本仓原型 `旧 server/lib/auth.mjs（未迁入）`，不作为 MDL 的实现。**【事实】**
- 密码策略沿用 8-64 位、至少 3 类字符；机器生成的初始密码必须满足同一策略。**【事实】`console/security.py#L42-L53`。**
- 初始密码生成：`secrets` 取随机、排除易混淆字符，长度 12-16；只显示一次；服务端只存 Argon2 哈希。**【推断】**
- 重置后：`password_must_change=true`，删除该账号全部 Redis 会话，旧密码立即失效。**【推断】**
- 登录限频沿用现有 5 次失败锁 10 分钟，键从「邮箱」改为 `phone` 哈希。**【事实，改键即可】**

### 5.7 取消邮箱后的替代方案

| 场景 | 无邮箱时怎么做 |
|---|---|
| 初始密码传递 | `org_admin` 在 Console 创建员工后**一次性展示**，由管理员线下/IM/电话告知；或改用「一次性口令」（管理员生成 6 位短码，员工首次登录时用它设置密码） |
| 忘记密码 | 员工联系 `org_admin` 重置；`org_admin` 联系平台重置。**不做自助找回** |
| 通知（审核结果、召回、到期） | 站内消息 + Console 顶部横幅 + 管理员代通知；不做邮件通知 |
| 账号安全提醒 | 登录后站内提示 + 管理员后台可见异常登录记录；不做邮件告警 |
| 企业注册联系 | 平台运营人工联系（已有企业申请审核流程）；邮箱仅作可选备注字段，不参与认证 |

- 一次性口令建议作为 P1 的可选项：`password_reset_tokens` 已能承载，不需要额外的短信通道。**【推断】**
- 邮箱字段保留在 `accounts` 作为可选联系信息，但**不提供登录、不提供自助找回**。**【推断】**

### 5.8 明确不在本阶段

- 短信验证码（登录、绑定、找回均不做）。
- 微信登录 / 微信绑定（`users.wechat_openid` 字段保留，不启用）。
- 邮箱登录、邮箱验证、邮件找回。
- 企业 SSO / OIDC / SAML。
- 员工自助注册（只能由管理员开通或邀请）。

### 5.9 迁移影响、工作量与最小可执行第一步

| 项 | 影响 | 处置 |
|---|---|---|
| 现有 `mdl_` Key | 不变；新增 `account_id` 回填 | 回填脚本按 `user_id` 找账号；找不到则跳过并记录 |
| 现有 `console_admins` | 迁移为 `accounts` + `org_admin` | 双写一版，校验一致后切换登录读取新表 |
| 现有 `users` | 不合并；新增账号一对一关联 | 老员工首次登录时由管理员生成初始密码 |
| `/admin` 共享 token | 保留但降级为应急 | 新审核动作必须走 `platform_reviewer` 账号 |
| 员工席位 | 账号不新增计费口径 | 仍按 `users` 计席位 |
| 审计 | 新增登录/改密/绑定/重置动作 | 复用 `console_audit_events`，`target_type=account` |
| 多副本 | `/admin` 内存会话不可共享 | 平台运营会话改 Redis（与 Console 一致） |

**工作量（按交付物计，不给时长）**

- 2 张新核心表 + 2 张辅助表 + 1 个字段回填；10 个接口；1 次 `console_admins` → `accounts` 数据迁移；1 套登录页改造（手机号为主）。
- 最大风险不是技术，而是**一期文档「员工不登录后台」的边界变更**，需要产品口径同步。**【推断】**
- 与既有排期的关系：认证改造排在 **P1**，是资产市场企业内闭环的前置；MDL 一期（M1）不含资产市场，M2 才做企业内资产，因此 P1 认证改造与 M2 同批进入，不阻塞 M1。**【事实】`phase1-scope-and-acceptance-v1.md#L110`、`#L214-L240`。**

**最小可执行第一步（双写过渡，不破坏现有登录）**

1. 新建 `accounts` + `account_roles`，先把现有 `console_admins` 双写进去。
2. 新增 `POST /api/auth/login`（手机号 + 密码），复用现有 Argon2 校验与限频，读取 `accounts`。
3. Console 登录页改为「手机号 + 密码」，邮箱入口隐藏但保留字段。
4. 用 1 个测试企业 + 1 个管理员 + 1 个员工验证「开通 → 初始密码 → 强制改密 → 绑定手机号」闭环。
5. 验证通过后再接 Key 回填与 `/admin` 账号化；本步不写任何资产代码。

---

## 6. 安装协议

### 6.1 路径判定（只读能力位，不读分类）

```text
modes = asset.capabilities.install.modes          # direct / prompt / toggle
direct_install =
      "direct" in modes
  and current_host in asset.capabilities.install.hosts
  and client.capabilities.installer == true
  and client.capabilities.root_writable == true
  and asset.capabilities.install.dependencies all satisfiable

if "direct" in modes and direct_install:
    direct_path()
elif "toggle" in modes:
    toggle_path()                  # 开关式平台扩展，不下载包
elif "prompt" in modes:
    prompt_path()                  # 复制安装方法 + 提示词，由 AI 执行
else:
    showcase_only()                # 纯展示；若有 same_as 则允许做同款
```

**判定原则**

- 由客户端上报能力，服务端不猜。**【推断】**
- 判定只读 `capabilities`；`category` 不参与。分类改名、加层级、新增分类都不影响安装行为。**【推断】**
- 带 `same_as` 的资产先校验依赖；依赖也无法直装时，整体降级为提示词路径。**【推断】**
- `toggle` 优先于 `prompt`：平台扩展只要能开关，就不该让用户复制安装说明。**【推断】**

### 6.2 直装流程

1. 客户端拉取版本清单：`GET /api/assets/{asset_id}/versions/{version}`，拿到 `files[]`、`digest`、`capabilities.install`。
2. 逐个下载签名 URL（10 分钟有效），校验 `sha256`；不一致立即中止。
3. 解包并做路径穿越/符号链接检查（复用 `client/zip.mjs` 与 `fsutil`）。
4. 备份同名目录（技能目录或插件版本目录）。
5. 落盘：
   - 技能：`<root>/skills/<name>/`，写 `_user_meta.json`。
   - 插件：`<root>/plugins/cache/<market>/<name>/<version>/`，更新 `known_marketplaces.json`、`installed_plugins.json`。
6. 写安装回执（见 §6.6）。
7. 真实根目录默认锁定：未显式 `--allow-real` 返回 `403 REAL_ROOT_LOCKED`。**【事实】现有安装器已实现。**

### 6.3 开关式流程（平台扩展）

1. 客户端读 `capabilities.toggle`：`key`、`default`、`scope`。
2. 校验 `key` 在宿主已注册键列表内；不在列表则拒绝启用并提示版本不匹配。
3. 改写宿主配置（`scope=user` 写用户级，`scope=org` 需管理员权限）。
4. 不下载包、不写 `plugins/cache`、不动 `installed_plugins.json`。
5. 写开关回执：`{asset_id, version, host, key, value, changed_at}`。
6. 关闭时恢复 `default`，不删除用户数据。

**参考 DSH 插件设置页**：顶部「已安装 / 发现」tab；设置页分「内置插件配置 / 实验性插件 / 已安装插件」三组；每项一个开关，开关即生效，无安装步骤。本模型把这三组映射为 `toggle.default` 与 `category.primary`（见 §3.4），不需要单独的扩展类型。

### 6.4 提示词路径的格式

当客户端不能直装、也不能开关时，输出一段可整段复制的文本，必须包含「资产信息 + 校验 + 安装方法 + 回执要求」：

```text
【资产】企业经营看板（mdl.template.dashboard-ops@1.0.0）
【分类】template/dashboard（案例；capabilities.install.modes = ["prompt"]）
【依赖】mdl.skill.business-ops-analysis@1.0.0（未安装则先装）
【下载】https://<mdl-host>/api/assets/.../download?token=... （10 分钟内有效）
【校验】sha256=<64 位十六进制>
【做同款步骤】
1. 先安装依赖技能到 ~/.workbuddy/skills/business-ops-analysis/
2. 上传销售明细与库存快照
3. 发送下面的提示词：
   「用企业经营看板技能，基于我上传的销售与库存表，生成同款看板：...」
【完成后回传】
{"asset_id":"...","version":"...","host":"workbuddy","status":"installed","sha256":"..."}
```

技能/插件版本的「安装方法」段落写具体落点与登记文件，写法沿用 `install/mdl-mcp.md` 的「给 AI 的操作说明」风格。**【事实】`install/mdl-mcp.md#L10-L45` 已证明该范式可用。**

### 6.5 失败回退

| 失败点 | 回退 |
|---|---|
| 客户端无安装器 | 直接生成提示词路径 |
| 根目录不可写 | 提示词路径，要求 AI 写文件并回报失败点 |
| 下载 403/过期 | 重新签发签名 URL；失败 2 次转提示词路径 |
| 哈希不一致 | 中止安装，上报 `integrity_failed`，不覆盖旧版本 |
| 解包路径穿越 | 中止，标记资产风险，通知平台 |
| 依赖缺失 | 先装依赖；依赖不可得则提示用户，不静默降级 |
| 真实根锁 | 提示用户显式开启或改用沙箱 |

### 6.6 安装回执

```json
{
  "asset_id": "mdl.skill.business-ops-analysis",
  "version": "1.0.0",
  "host": "workbuddy",
  "root": "C:/Users/<user>/.workbuddy",
  "status": "installed",
  "sha256": "<实际整包摘要>",
  "installer_version": "0.2.0",
  "installed_at": "2026-11-07T12:00:00+08:00",
  "files": [{"path": "SKILL.md", "sha256": "..."}],
  "error": null
}
```

- 接口：`POST /api/assets/{asset_id}/install-receipts`，用 `mdl_` Key 鉴权，服务端按 Key → org 校验资产可见性。**【推断】**
- 离线：客户端先写本地 `install-receipts.jsonl`，恢复网络后补传；服务端按 `(asset_id, version, host, root_hash, installed_at)` 幂等。**【推断】**
- 回执只用于统计与审计，不作为授权依据。**【推断】**

---

## 7. 旧代码处置

### 7.1 逐项判定

| 模块/文件 | 现状 | 判定 | 去向与理由 | 恢复方式 |
|---|---|---|---|---|
| `data/market.json`（15 条） | skill 6 / expert 3 / team 2 / connector 2 / template 1 / platform-extension 1 | **保留 + 迁移** | 转为 `asset-record/3.0` 种子；映射见 §3.2 与 §3.9 | 原文件在 git 历史；迁移脚本保留旧字段 |
| `data/skills/`、`data/marketplace/` | 内容与插件载荷 | **保留** | 作为导出与安装的 fixture | 文件未删除 |
| `export/export.mjs` + `export/schema/*` | 确定性导出，两次字节一致 | **保留 + 升级** | 升级为 3.0；继续做「内容事实」导出，不写审核结论；新增 DSH 投影模式 | 旧 schema 保留在 git |
| `client/installer.mjs` | 四类安装、备份、真实根锁 | **保留 + 改造** | 分派依据从 `kind` 改为 `capabilities.install.modes`；新增 `toggle` 分支与回执；删除按类型硬编码 | 改造前 tag |
| `client/zip.mjs`、`server/lib/fsutil.mjs` | 解包与路径安全 | **保留** | 客户端核心能力 | 无 |
| `server/server.mjs` | 本地 HTTP、鉴权、上传、审核、下载、安装 | **分拆** | 只保留 `/api/health`、`/api/market`（本地缓存）、`/api/status`、`/api/install`、`/api/uninstall`；删除 `/api/auth/*`、`/api/members`、`/api/assets*`（上传/审核/签名下载） | `git show feat/merge-asset-hub:...` |
| `旧 server/lib/auth.mjs（未迁入）` | PBKDF2 + HMAC 会话 + 签名 URL | **删除** | 与 MDL 账号重复；密码改由 MDL 的 Argon2id 承担，PBKDF2 不迁移；签名下载由 MDL 实现 | 参考实现保留在分支 |
| `旧 server/lib/store.mjs（未迁入）` | JSON 状态 + 对象目录 + 审核状态 | **删除** | 由 MDL PostgreSQL 取代；敏感文件名规则移植到 Python 扫描器 | 参考实现保留在分支 |
| `server/lib/catalog.mjs` | 读 `market.json` | **保留** | 客户端离线缓存读取 | 无 |
| `server/lib/fsutil.mjs` | 路径校验 | **保留** | 客户端与上传校验共用思路 | 无 |
| `web/index.html` + `web/app.js` | 四类浏览 + 登录 + 上传 + 审核 | **改造** | 改为单入口 + 分类筛选；保留浏览/详情/安装/做同款/开关交互；删除登录、上传、审核页（回归 MDL Console）；长期 UI 进 Console 模板 | 旧页面在分支 |
| 旧仓的 `merge-plan.md`、`status-compare.md`、`integration-proposal.md`、`gap-analysis.md` | 调研与合并记录 | **保留为历史** | 本文件为 v2 最新口径；旧文档标注「历史」 | 不改内容 |
| `README.md` | 合并版说明 | **P1 重写** | 指向客户端用法与 MDL 契约 | git 历史 |
| `.gitignore`（`runtime/`） | 本地状态不入库 | **保留** | 客户端回执/缓存仍需忽略 | 无 |

### 7.2 `feat/merge-asset-hub` 分支改动去留

**现状**：分支上有一批未提交改动，包含 `client/`、`server/`、`web/`、`docs/`，其中账号、成员审核、资产审核、签名下载是本地原型。**【事实】`git status` 显示未提交。**

| 改动 | 去留 | 理由 |
|---|---|---|
| `client/installer.mjs` 平移与四类支持 | **保留** | 客户端长期资产，v2 安装协议的基础 |
| `旧 server/lib/auth.mjs（未迁入）`（PBKDF2/HMAC/签名 URL） | **不进入主线** | 身份必须回归 MDL；签名下载由 MDL 实现 |
| `旧 server/lib/store.mjs（未迁入）`（成员/资产状态、对象目录） | **不进入主线** | 同上；只保留敏感文件名规则作为扫描器参考 |
| `web/` 登录/上传/审核页 | **不进入主线** | 企业管理员入口应在 Console；避免双入口 |
| `web/` 浏览/安装/详情交互 | **保留为参考** | 可复用到 Console 模板与客户端页 |
| 旧仓 `merge-plan.md` 等 | **保留** | 合并决策留痕 |

**建议处置顺序**

1. 先在 `feat/merge-asset-hub` 上提交一次归档提交（消息注明「原型归档，待 v2 拆分」），打 tag `archive/merge-asset-hub`。
2. 从该 tag 新建分支 `feat/asset-v2-client`，只提取 `client/`、`export/`、`data/`、`docs/`。
3. 原分支不合入 `main`；`server/` 的账号与审核代码仅作参考，不进入发布路径。

### 7.3 删除后如何恢复

- 所有删除都发生在「新分支」上，旧分支与 tag 保留完整历史；恢复用 `git show archive/merge-asset-hub:<path>` 或从 tag 重新检出。
- `旧 ai-asset-hub 仓库` 始终只读，未被修改，可作为最终兜底参考。
- 本文件第 7.1 节逐项记录了删除理由与恢复位置，避免「删了不知道为什么」。

---

## 8. 分阶段路线

### 8.1 P0 / P1 / P2

| 阶段 | 目标 | 交付物 | 验收口径 | 对真实 `~/.workbuddy` 的影响 | 与 MDL 排期 |
|---|---|---|---|---|---|
| **P0 契约与只读验证** | 不改 MDL 代码，先把模型、导出、安装协议定死 | `v2-architecture.md`；`asset-record/3.0` schema；分类树与 15 条映射表；1 条 template 样例；1 条 platform-extension 样例；安装回执 schema；扫描规则清单 | 15 条全部通过 schema；分类映射 100% 覆盖；导出两次字节一致；沙箱内直装 / 提示词 / 开关三条路径均通过；template 只产出提示词 | **无**（只在 `%TEMP%` 沙箱） | M1 尾声并行；不占 MDL 开发资源 |
| **P1 控制面最小闭环 + 认证改造** | 企业内可用：统一登录、登记、上传、版本、私有/企业内可见、下载、回执 | **认证**：`accounts` / `account_roles` / `identity_bindings` / `password_reset_tokens`、10 个接口、`console_admins` 迁移；**资产**：MDL `app/assets/`、分类表、核心表、`/api/assets/*`、Console 企业资产页、对象存储（本地卷）、客户端直装 + 回执 | 1 个企业管理员 + 20 个员工用手机号 + 密码登录；首次登录 100% 强制改密；跨租户 0 泄漏；企业内发布即可见；三种安装路径回执可查 | **无**。服务端不写盘；客户端只有用户主动点安装才写，且需 `--allow-real` | **= M2**（`phase1-scope-and-acceptance-v1.md#L224-L231`）；认证改造与 M2 同批，不阻塞 M1 |
| **P2 审核与跨企业** | 双通道完整：自动检查 + 平台审核 + 跨企业白名单 + CAP + 召回 | 扫描流水线；平台审核人账号化（`platform_reviewer` 角色）；审核队列；企业同意出域；CAP 构建（workbuddy 适配器）；DSH 索引源接入（只读） | 跨企业资产 100% 有扫描记录与审核人 `actor_account_id`；未审 0 可见；召回后停止新安装；`/admin` 共享 token 不再是唯一入口 | **无**。召回不删除本地文件，只停新安装 | **= M3**（`#L233-L240`）；公开市场与 `mdl-verify` 留到 M5（`#L250`） |

### 8.2 与 MDL 现有排期的关系

```text
MDL M1（Console MVP + Key 闭环）
  └─ P0（契约，不改 MDL 代码）
MDL M2（资产登记 + 私有/企业内上传下载）
  └─ P1（认证改造 + 控制面最小闭环）
MDL M3（审核流 + 私有/企业市场 + CAP）
  └─ P2（跨企业 + 自动检查 + 平台审核）
MDL M4（积分）
MDL M5（公开市场 + mdl-verify + Skills over MCP）
```

- P0 必须早于 M2 启动，否则 M2 建表会按旧的 9 类/4 类口径落地，后面要迁移。**【推断】**
- **认证改造排在 P1，与 M2 同批，不是独立阶段。** 理由：企业内资产必须先有「员工是谁」；而 M1 不含资产市场，不需要提前动登录边界。**【事实】`phase1-scope-and-acceptance-v1.md#L110`、`#L228`。**
- P1 不包含跨企业；「企业内直接可用」正好落在 M2 的「私有/企业内上传下载」。**【事实】`phase1-scope-and-acceptance-v1.md#L228`。**
- P2 的「跨企业」是**受控白名单**，不是 M5 的公开市场；不要提前承诺计费、分成、公开检索。**【推断】**
- 认证改造与 M2 并行时，**先做账号与会话（§5.9 最小第一步），再做资产表**；否则资产上传没有可靠的 `actor_account_id`。**【推断】**

### 8.3 真实 `~/.workbuddy` 的影响

| 阶段 | 服务端 | 客户端 | 结论 |
|---|---|---|---|
| P0 | 不涉及 | 不写真实根目录 | 零影响 |
| P1 | 不写客户磁盘 | 用户主动安装才写；默认真实根锁；写前备份 | 可控 |
| P2 | 不写客户磁盘 | 同上；召回不删除本地文件 | 可控 |

---

## 9. DSH 扩展预留

### 9.1 索引源模型（现在就要建）

一个 URL 就是一个索引源。**索引源不是资产，是候选资产的来源。** 需要独立表，字段如下：

| 字段 | 类型 | 说明 |
|---|---|---|
| `source_id` | string | 稳定 ID，如 `src_dsh_fmcg` |
| `source_type` | enum | `official` / `partner` / `org` / `dsh_index` |
| `url` | string | format 1 索引地址 |
| `org_id` | UUID | 归属企业；平台级源为空 |
| `trust_level` | enum | `trusted` / `review_required` / `blocked` |
| `format_version` | int | 当前为 1 |
| `enabled` | bool | 是否启用 |
| `sync_interval` | int | 同步周期（秒） |
| `last_synced_at` | datetime | 最后成功同步 |
| `last_etag` / `last_modified` | string | 增量同步 |
| `public_key` | text | 源签名公钥（可选） |
| `imported_count` / `rejected_count` | int | 统计 |
| `last_error` | text | 最近错误 |

**安全默认**：新源一律 `review_required`；导入的资产一律 `draft` 或 `pending`，不直接上架。**【推断，与需求 2 的跨企业审核一致】**

### 9.2 `format 1` → v2 映射

DSH `index.json` 的事实字段：`format`、`title`、`description`、`metadata.categories`、`metadata.labels`、`metadata.sortKeys`、`plugins[].name/title/description/homepage/repository/metadata.category/labels`、`plugins[].versions[].version/source`。**【事实】`index.json` 第 2、12、184、201、233-237 行。**

| v2 字段 | 来源 | 规则 |
|---|---|---|
| `category.primary` | `plugins[].metadata.category` | 直接落到二级路径，如 `metadata.category="analysis"` → `skill/analysis`；未知归 `uncategorized`，人工补 |
| `category.labels` | `labels` | 直接映射，作为横切标签 |
| `name.zh` / `name.en` | `title` | 单语源先填 `zh`，`en` 留空待补 |
| `description` | `description` | 直接映射 |
| `sort_keys` | `metadata.sortKeys` | 直接映射到检索排序，不参与分类 |
| `version` | `versions[].version` | 逐版本导入 |
| `source_ref.url` | `versions[].source` | 原始下载地址 |
| `source_ref.external_id` | `plugins[].name` | 去重键 |
| `publisher` | `homepage` / `repository` | 来源方信息 |
| `digest` | **源里没有** | 导入时计算整包摘要，不能信任源 |
| `permissions` | **源里没有** | 按宿主能力默认最严格 |
| `license` | **源里没有** | 必须补；缺失不得上架 |
| `compatibility.hosts` | **源里没有** | 导入时按 `adapters` 探测 |
| `capabilities` | **源里没有** | 默认 `{install:{modes:["prompt"]}}`；有包且宿主匹配才升为 `direct` |

### 9.3 现在就要留的字段

1. `source_ref`（`source_id` / `external_id` / `url` / `external_version`）——否则以后无法追溯与去重。
2. `category.primary` + `category.labels`——DSH 的分类体系直接落进来，不用二次改表；反过来导出时也直接写回 `metadata.category`。
3. `compatibility.hosts`（`workbuddy` / `trae` / `dsh` / `octop`）——CAP 已规划多宿主适配器（`manifest-package-v1.md#L160-L179`）。
4. `capabilities.install.modes`——DSH 导入的资产默认 `prompt`，避免把不可信包当可直装。
5. `files[].sha256` + `digest`——format 1 没有哈希，必须在导入时补。
6. `permissions` + `license` + `data_use`——索引源默认缺失，必须有字段承接「缺失即不可上架」。
7. `adapters` 元数据——即使 P2 不实现，也应在 schema 里预留，避免以后加字段破坏兼容。

### 9.4 一目录多消费的落地方式

- **同一份目录**：`/api/assets` 返回 `asset-record/3.0`；分类树作为独立只读资源 `GET /api/categories`。
- **WorkBuddy**：安装器按 `capabilities.install.modes` 投影为技能目录 / 插件包 / 开关，见 §3.5。
- **DSH**：`export/dsh-index.mjs` 把目录投影成 format 1，见 §3.7；DSH 侧只读，不反向写回资产表。
- **未来独立平台**：直接消费同一 API；若要独立域名，只换部署位置，不换模型。**【推断】**
- **禁止**：为某个宿主单独维护一份分类或一份资产表；宿主差异只能出现在适配器。**【推断】**
4. `files[].sha256` + `digest`——format 1 没有哈希，必须在导入时补。
5. `permissions` + `license` + `data_use`——索引源默认缺失，必须有字段承接「缺失即不可上架」。
6. `adapters` 元数据——即使 P2 不实现，也应在 schema 里预留，避免以后加字段破坏兼容。

### 9.5 不做什么

- **不把 DSH 的分类当作唯一分类**。主分类是平台/企业共用的分类树，DSH 分类做映射，避免被单一宿主绑死。**【推断】**
- **不直接执行索引源里的安装脚本**。导入只是候选，必须经过扫描与审核。**【推断】**
- **不把 `cordis.patch.yml` 之类宿主私有格式写进主模型**。宿主格式放 `adapters/`。**【事实】与 CAP 规则一致（`manifest-package-v1.md#L179`）。**

---

## 10. 待拍板与已确认

### 10.1 仍待拍板（三项，均附建议默认值，不阻塞文档）

| # | 分歧 | 选项 | 建议 | 影响面 |
|---|---|---|---|---|
| D1 | 企业内是否零审查 | A. 完全零检查；B. 只阻断确定性高危项；C. 全量扫描但只告警 | **B**：只阻断路径穿越、硬编码私钥/令牌、包哈希不一致、可执行二进制 | 决定「直接可用」的边界；B 兼顾体验与底线。**状态：待确认** |
| D2 | 跨企业是否要企业同意 | A. 要；B. 不要，平台可直审 | **A**：原企业管理员同意后才进入平台审核 | 涉及企业 IP 与数据出域责任。**状态：待确认** |
| D3 | 对象存储 | A. P1 本地卷；B. P1 直接 SeaweedFS | **A**：P1 本地卷，P2 再迁 SeaweedFS | 决定 P1 部署复杂度与多副本能力。**状态：待确认** |

### 10.2 已确认（不再讨论）

| # | 结论 | 落地位置 |
|---|---|---|
| C1 | 专家 / 专家团 / 连接器**不独立成类型**，并入统一分类 | §3.1、§3.2 |
| C2 | 员工与企业管理员登录走**绑定手机号 + 密码** | §5.2、§5.3 |
| C3 | `mdl_` Key 保留，不改造，只补 `account_id` 归属 | §5.4 |
| C4 | 邮箱登录取消；不做自助找回，走管理员重置 | §5.7 |
| C5 | 平台审核人沿用统一账号表，不再只靠共享 `MCP_ADMIN_TOKEN` | §5.2、§5.5 |

---

## 附录 A：证据索引

### A.1 MDL-MCP

| 结论 | 证据路径 |
|---|---|
| 企业租户、席位上限、S6 连接 | `MDL-MCP 仓库\mcp-server\app\models.py#L76-L126` |
| 员工无密码、`org_id`、角色 owner/manager/member | `models.py#L129-L177` |
| 员工手机号可空且无唯一约束 | `models.py#L136`（`phone` 列定义无 `unique=True`） |
| API Key 哈希、scope、生命周期 | `models.py#L180-L209`；`auth.py#L145-L288` |
| `skill_versions` 存在但未被引用 | `models.py#L281-L298`；全仓 grep 仅 2 处定义 |
| 企业管理员邮箱/手机号 + 密码、手机号唯一 | `models.py#L465-L484` |
| 登录、Argon2id、限频、Redis 会话 | `console\security.py#L8-L100`；`console\main.py#L279-L361` |
| 一期员工不登录、不支持第三方登录 | `docs\mdl-workspace-architecture\identity-and-onboarding-v1.md#L3`、`#L84`、`#L88-L92` |
| 审核三档：跨企业共享/资产上架属平台审核；企业自理立即生效 | `identity-and-onboarding-v1.md#L134-L159` |
| 授权事实源与默认拒绝 | `identity-and-onboarding-v1.md#L170-L177`；`auth.py#L258-L260` |
| 平台 `/admin` 共享 token、内存会话 | `mcp-server\app\admin.py#L137-L175`；`config.py#L44`；`main.py#L2997-L3002` |
| 企业申请审核队列的实现范式 | `admin.py#L1939-L1966` |
| `asset-record/1.0` 字段、9 类资产、visibility、review | `docs\mdl-workspace-architecture\manifest-asset-record-v1.md#L20-L62`、`#L124-L155` |
| CAP 目录与多宿主适配器 | `docs\mdl-workspace-architecture\manifest-package-v1.md#L160-L179` |
| 技能格式 `agentskills/v1` | `manifest-package-v1.md#L142-L148` |
| 一期不做资产市场；M2/M3/M5 顺序 | `docs\mdl-workspace-architecture\phase1-scope-and-acceptance-v1.md#L110`、`#L214-L240` |
| M2 首期 4 类资产口径 | `phase1-scope-and-acceptance-v1.md#L224-L229` |
| 无对象存储服务 | `MDL-MCP 仓库\docker-compose.yml`（仅 postgres/redis/qdrant/mcp-server/mdl-console） |
| WorkBuddy 只是 MCP 客户端、安装写法范式 | `MDL-MCP 仓库\install\mdl-mcp.md#L4`、`#L10-L45` |
| 试点边界：单团队、资产仅三类、迁移到 MDL Console | `MDL-MCP 仓库\docs\AI-Asset-Hub-Pilot-runbook-2026-11-01.md#L6-L30` |

### A.2 本仓 / DSH

| 结论 | 证据路径 |
|---|---|
| 现有 15 条内容与四类 kind | `catalog/assets.json` |
| 四类安装落点与登记文件 | `docs/format-spec.md` 第 5、8 节 |
| 安装器、真实根锁、备份 | `client/installer.mjs`；`server/server.mjs` |
| 确定性导出 | `export/export.mjs`；`export/schema/asset-record.schema.json` |
| 合并原型与清除清单 | `docs/migration-map.md` |
| 单权威、单写入口的结论 | `docs/migration-map.md` 第 4.2-4.3 节 |
| DSH format 1 字段 | `index.json#L2`、`#L12`、`#L184`、`#L201`、`#L233-L237` |

---

## 附录 B：一页纸执行摘要

1. **架构**：MDL 控制面（Python）+ 本仓客户端（Node）+ JSON Schema 契约（`asset-record/3.0`）。
2. **入口**：一个市场入口、一份资产模型；分类树（技能 / 专家 / 专家团 / 连接器 / 模板案例 / 平台扩展功能）只做展示与筛选。
3. **语义**：`capabilities` 承担行为——`direct`（可直装）/ `prompt`（安装方法 + 提示词）/ `toggle`（开关式平台扩展）/ 空（纯展示）；安装器不按分类分支。
4. **通道**：企业内 `review=not_required` 直接发布；跨企业 `scan=passed + org_consent + review=approved`。
5. **认证**：员工与企业管理员统一「绑定手机号 + 密码」；`mdl_` Key 只做机器调用；WorkBuddy 登录是绑定后的快捷方式；邮箱登录取消。
6. **账号**：一张 `accounts` 表 + `account_roles`（`org_admin` / `employee` / `platform_reviewer` / `platform_admin`）；平台审核人不再匿名为共享 token。
7. **密码**：沿用 Argon2id；初始密码机器生成、首次登录强制改密；忘记密码走管理员重置。
8. **安装**：按能力位选择直装 / 开关 / 提示词；服务端不写客户磁盘；真实根目录默认锁定。
9. **路线**：P0 契约（M1 尾声）→ P1 认证改造 + 企业内闭环（M2）→ P2 跨企业 + 审核（M3）。
10. **不承诺**：自动检查不等于安全；跨企业审核不能省人工；服务端不写客户磁盘。
11. **待确认**：企业内高危项是否硬阻断（建议只阻断确定性项）；跨企业是否需原企业同意（建议需要）；对象存储 P1 本地卷 / P2 SeaweedFS（建议按此）。
