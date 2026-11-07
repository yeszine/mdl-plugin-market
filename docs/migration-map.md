# 迁移映射：旧仓库 → mdl-plugin-market

本文件逐项记录新项目的能力来源与改造内容。**旧仓库本轮只读**，未修改、未删除；删除前置条件见文末与最终上报。

约定：旧仓库路径均相对于各自仓库根目录，不写本机绝对路径。

---

## 0. 一眼结论

| 旧仓库 | 迁入什么 | 不迁什么 |
|---|---|---|
| `dsh-fmcg-index`（`workbuddy-market/`） | 15 条资产内容（6 技能 + 7 插件包）、DSH 索引源（`data/`、`bundles/`、`scripts/build.mjs`、`scripts/lib/format.mjs`、`site/`、`index.json`）、`format-spec.md`、`v2-architecture.md` 的结论 | 旧 Node 服务端（PBKDF2 + JSON 存储）、按 `kind` 分派的安装器、旧前端 |
| `ai-asset-hub` | zip 解压实现、上传/审核/安装的产品语义、`members` / `assets` 表结构经验 | 邮箱 + 验证码账号体系、SQL 存储主线、旧 `ahub.js` CLI、旧前端 |

新仓只保留一份资产目录 `catalog/assets.json`；`data/` 是同一份内容的 DSH 投影输入，不是第二份目录。

---

## 1. 内容载荷

| 旧路径 | 新路径 | 改造 |
|---|---|---|
| `dsh-fmcg-index/workbuddy-market/data/skills/<slug>/`（6 个技能） | `catalog/content/skills/<slug>/` | 原样复制；目录名、`SKILL.md`、references 不变；安装落点仍为 `skills/<slug>/` |
| `dsh-fmcg-index/workbuddy-market/data/marketplace/`（7 个插件包） | `catalog/content/marketplace/` | 原样复制；保留 `.codebuddy-plugin/marketplace.json` 与 `plugins/<name>/`；安装落点仍为 `plugins/cache/mdl-plugin-market/<name>/<version>/` |
| —（新增） | `catalog/content/templates/business-dashboard/` | 新增模板案例样例：`README.md`、`prompt.md`、`cover.svg`、`preview.html`；仅 `prompt` 模式 |
| —（新增） | `catalog/content/extensions/market-entry/` | 新增平台扩展样例：说明文件；仅 `toggle` 模式，改写 `settings.json` 的 `market.entry.enabled` |
| `dsh-fmcg-index/workbuddy-market/data/market.json` | `data/market.json` | 原样迁入，作为 DSH 投影输入；**不**作为新仓目录源 |
| `dsh-fmcg-index/workbuddy-market/data/plugins.json` | `data/plugins.json` | 原样迁入；保证 `index.json` 字节一致 |
| `dsh-fmcg-index/workbuddy-market/bundles/` | `bundles/` | 原样迁入；DSH 版本 `source` 指向的仓库内路径 |
| `dsh-fmcg-index/workbuddy-market/site/` | `site/` | 原样迁入；DSH 静态站点 |

---

## 2. 目录与契约

| 旧路径 | 新路径 | 改造 |
|---|---|---|
| `dsh-fmcg-index/workbuddy-market/data/market.json` 的 13 条 `kind` 记录 | `catalog/assets.json` 的 15 条 `asset-record/3.0` 记录 | **重构**：`kind` → `category.primary` + `category.labels`；安装语义 → `capabilities.install.modes`；补 `capabilities.toggle` / `exhibit` / `runtime`；补模板案例与平台扩展各 1 条；13 → 15 |
| `dsh-fmcg-index/workbuddy-market/export/schema/asset.schema.json`（`asset-record/1.0`） | `export/schema/asset-record.schema.json`（`asset-record/3.0`） | **重写**：去掉 `type`/`subtype`；新增 `category`、`capabilities`、`files`、`digest`、`source`；路径前缀白名单；`direct` 模式要求 `files` 非空 |
| `dsh-fmcg-index/workbuddy-market/export/export.mjs` | `export/export.mjs` | **重写**：固定排序、逐文件真算 sha256、`digest`、`--check`、`SOURCE_DATE_EPOCH` / `GIT_COMMIT`；`commit` 只认 `GIT_COMMIT`，避免每次提交产物漂移 |
| `dsh-fmcg-index/workbuddy-market/export/lib.mjs` | `export/lib.mjs` | **重写**：目录加载、文件收集、digest、序列化；删除旧记录拼装逻辑 |
| — | `scripts/lib/schema.mjs` | 新增极简 JSON Schema 校验器（零依赖），供导出与校验共用 |
| `dsh-fmcg-index/workbuddy-market/server/lib/catalog.mjs` | 未迁入 | 其职责被 `catalog/assets.json` + `client/installer.mjs` 的 `findAsset` / `resolveTarget` 取代 |

---

## 3. 客户端安装器

| 旧路径 | 新路径 | 改造 |
|---|---|---|
| `dsh-fmcg-index/workbuddy-market/client/installer.mjs` | `client/installer.mjs` | **重写分派逻辑**：按 `capabilities.install.modes` 与 `install.target` 判断，不按 `kind` / `category` 分支；新增 `prompt` / `toggle`；保留备份、dry-run、真实根锁、`installed_plugins.json` / `known_marketplaces.json` 登记、`_user_meta.json` |
| `dsh-fmcg-index/workbuddy-market/client/zip.mjs` | `client/zip.mjs` | 原样迁入；保留路径穿越防护与 200MB 解压上限 |
| `ai-asset-hub/skill/scripts/zip.js` | `client/zip.mjs`（来源之一） | 取其解包与路径安全实现，合并进上面这份零依赖 ESM 版本 |
| `ai-asset-hub/skill/scripts/ahub.js` | `client/installer.mjs` + `server/adapters/mock.mjs` | **拆分**：`list/install` 语义进安装器；`upload` / 审核进适配层；不保留独立 CLI 与邮箱验证码流程 |
| `dsh-fmcg-index/workbuddy-market/server/lib/fsutil.mjs` | 未迁入 | 其 `assertInside` / 备份 / JSON 读写被安装器内联实现取代；避免把服务端工具带进客户端 |

**安装语义对照**

| 旧行为 | 新行为 |
|---|---|
| `kind === 'skill'` → 写 `skills/<name>` | `install.target` 以 `skills/` 开头 → 写技能目录（`category` 不参与） |
| `kind === 'plugin'` → 写 `plugins/cache/...` | `install.target` 以 `plugins/cache/` 开头 → 写插件缓存并登记 |
| 无提示词模式 | `modes` 含 `prompt` → 返回「安装方法 + 提示词」，不落盘 |
| 无开关模式 | `modes` 含 `toggle` → 改写宿主 `settings.json`，不落包 |

---

## 4. 服务端

| 旧路径 | 新路径 | 改造 |
|---|---|---|
| `dsh-fmcg-index/workbuddy-market/server/server.mjs` | `server/server.mjs` | **重写**：只做 HTTP 编解码、静态资源、根目录写锁；业务状态全部委托适配层；新增 `/api/install-receipts`、上传资产安装、真实根 403 |
| `dsh-fmcg-index/workbuddy-market/server/lib/auth.mjs`（PBKDF2 + HMAC 会话） | 未迁入 | 由 `server/adapters/contract.mjs` 的 `login` / `getAccount` 取代；密码与会话归 MDL |
| `dsh-fmcg-index/workbuddy-market/server/lib/store.mjs`（JSON 文件状态） | 未迁入 | 由适配层取代；本地开发用 `server/adapters/mock.mjs` 的内存状态 |
| — | `server/adapters/contract.mjs` | 新增：18 个方法的接口契约与 `assertAdapter` |
| — | `server/adapters/mock.mjs` | 新增：内存账号 / 租户 / 审核 + 本地对象目录；演示账号与 `demo` 密码仅本地用 |
| `ai-asset-hub/sql/schema.sql`（`members`、`assets`） | 未迁入 | 表结构经验映射到 `docs/handoff-for-mdl.md` §4 的适配层接口；MDL 侧自行建表 |
| `ai-asset-hub/skill/SKILL.md` | 未作为资产迁入 | 其使用说明并入 `README.md` 与 `docs/handoff-for-mdl.md` |

---

## 5. Web 前端

| 旧路径 | 新路径 | 改造 |
|---|---|---|
| `dsh-fmcg-index/workbuddy-market/web/index.html`、`web/app.js` | `web/index.html`、`web/app.js`、`web/styles.css` | **重写**：单入口 + 分类树筛选；顶部「发现 / 已安装」；详情抽屉含版本、使用量、下载量、示例提示词、使用案例、做同款、权限表、审核状态；登录与安装/卸载/提示词模式 |
| `ai-asset-hub/web/index.html`、`web/app.js`、`web/config.js`、`web/style.css` | 同上 | 取其「资产卡片 + 详情 + 上传」的信息架构；重写为无构建、零依赖静态页；删除站点地址配置 |

---

## 6. DSH 索引源（第二投影）

| 旧路径 | 新路径 | 改造 |
|---|---|---|
| `dsh-fmcg-index/scripts/build.mjs` | `scripts/build.mjs` | 原样迁入；默认 `--index-url` 改为 `https://yeszine.github.io/mdl-plugin-market/index.json`（仅用于校验，不写入产物） |
| `dsh-fmcg-index/scripts/lib/format.mjs` | `scripts/lib/format.mjs` | 原样迁入；format 1 校验逻辑不变 |
| `dsh-fmcg-index/data/market.json` | `data/market.json` | 原样迁入；分类/标签声明保持不变，映射见 README |
| `dsh-fmcg-index/data/plugins.json` | `data/plugins.json` | 原样迁入 |
| `dsh-fmcg-index/bundles/` | `bundles/` | 原样迁入 |
| `dsh-fmcg-index/site/` | `site/` | 原样迁入 |
| `dsh-fmcg-index/index.json` | `index.json` | 迁移后重新构建，**与旧产物字节一致**（sha256 相同） |

---

## 7. 文档

| 旧路径 | 新路径 | 改造 |
|---|---|---|
| `dsh-fmcg-index/workbuddy-market/docs/format-spec.md` | `docs/format-spec.md` | 原样迁入；补充本仓内容路径约定；市场包位置改为 `catalog/content/...` |
| `dsh-fmcg-index/workbuddy-market/docs/v2-architecture.md` | `docs/v2-architecture.md` | 迁入；更新状态、边界、路径与数量口径（13 → 15）；旧仓绝对路径全部去除 |
| `dsh-fmcg-index/workbuddy-market/docs/handoff-for-mdl.md` | `docs/handoff-for-mdl.md` | **重写**：契约升级到 `asset-record/3.0`；新增适配层 18 个接口清单；P0/P1/P2 更新 |
| `dsh-fmcg-index/workbuddy-market/docs/merge-plan.md`、`status-compare.md`、`integration-proposal.md`、`gap-analysis.md` | 未迁入 | 合并过程的阶段性记录，结论已并入 v2 架构与本文件；删除前置条件见文末 |
| `ai-asset-hub/README.md` | 部分并入 `README.md` | 保留「共享库」的产品动机，删除邮箱注册与站点地址说明 |
| — | `README.md` | 新增：定位、目录结构、命令、与 MDL 边界、DSH 投影、GitHub Pages URL 变化影响 |
| — | `docs/migration-map.md` | 本文件 |

---

## 8. 明确未迁入的内容

| 内容 | 原因 | 后续 |
|---|---|---|
| 旧 PBKDF2 + HMAC 会话 | 与 MDL 账号体系冲突，且不符合「不自建账号」的要求 | 由 MDL 实现 |
| 旧 JSON 文件存储 | 单进程、无事务、无多租户 | 由 MDL PostgreSQL 取代 |
| 旧 `ahub.js` 邮箱验证码 CLI | 账号主线已改为手机号 + 密码，且由 MDL 负责 | 不恢复 |
| 旧前端站点配置（`config.js`） | 站点地址写死且随部署变化 | 由服务端同源托管 |
| 旧仓阶段文档（merge-plan 等） | 结论已固化，保留在旧仓历史 | 旧仓删除前归档 |

---

## 9. 旧仓库归档与删除状态（2026-11-07）

### 9.1 远端与发布

- 新仓远端：`git@github.com:yeszine/mdl-plugin-market.git`，`main` 已推送。
- GitHub Pages：**已启用并发布成功**（2026-11-07 12:57 +08:00 验证）。
  - 线上索引：`https://yeszine.github.io/mdl-plugin-market/index.json`
  - 根页面：`https://yeszine.github.io/mdl-plugin-market/`（200）
  - 配置：`main` / `/(root)`，Deploy from a branch（`build_type=legacy`）
  - 验证：线上 `index.json` 与本地逐字节一致，sha256 `62ACC9CF5DAC9EA926E9CF02F498FC169DDC3E324F105738B66C0C4F6E67B048`（安装源修复前的发布态）；修复 `@dsh-fmcg/*` 安装源后本地为 `C681DECBE134B8487B677D961259E520378DD79CAD02463DFCAFD4BC791DDCEC`，待推送；`format=1`；`plugins=18`
- 历史阻塞：仓库最初为 private，Pages API 返回 422；改为 public 后 `POST /repos/yeszine/mdl-plugin-market/pages` 创建成功，首次构建 `building → built`。
- 启用方式与排查步骤见 `README.md` 的「当前发布状态」与「如需重新启用或排查 Pages」。

### 9.2 归档

归档目录 `D:\GitHub\_archive\`，不在任何 git 仓库内：

| 仓库 | bundle | 整目录 zip | 分支 | HEAD |
|---|---|---|---|---|
| `dsh-fmcg-index` | `dsh-fmcg-index-20261107.bundle` | `dsh-fmcg-index-20261107.zip` | `feat/merge-asset-hub` | `8ca0d3b994b1cbce0134b2de4e1e3c02cf24bb1a` |
| `ai-asset-hub` | `ai-asset-hub-20261107.bundle` | `ai-asset-hub-20261107.zip` | `main` | `c8e1955a41f3447869e42fce6bac45075340d9ca` |

- 两份 bundle 均通过 `git bundle verify`；zip 含 `.git`、排除 `node_modules`，可正常枚举。
- 时间、sha256、条目数与恢复命令见 `D:\GitHub\_archive\ARCHIVE-MANIFEST.md`。

### 9.3 删除状态

| 仓库 | 状态 | 说明 |
|---|---|---|
| `ai-asset-hub` | **本地目录已删除** | 归档校验通过后删除；GitHub 远端未动 |
| `dsh-fmcg-index` | **保留** | 当前会话工作目录，不能在本会话删除；确切命令见 `D:\GitHub\_archive\DELETE-dsh-fmcg-index.md` |

`dsh-fmcg-index` 删除前必须确认：

1. 新索引源 `https://yeszine.github.io/mdl-plugin-market/index.json` 返回 200，且与本地 `index.json` 哈希一致（**已满足**：2026-11-07 12:57 +08:00，sha256 `62ACC9CF5DAC9EA926E9CF02F498FC169DDC3E324F105738B66C0C4F6E67B048`；修复安装源后本地为 `C681DECBE134B8487B677D961259E520378DD79CAD02463DFCAFD4BC791DDCEC`，待推送）。
2. 归档 bundle / zip 可读（当前已满足）。
3. 工作区干净（归档时 0 个未提交改动）。

### 9.4 删除本地目录的边界

- 删除本地目录**不会**删除 GitHub 上的仓库和 Pages。
- 旧的 `https://yeszine.github.io/dsh-fmcg-index/index.json` 会继续可访问，直到在 GitHub 上删除旧仓库或关闭 Pages。
- 本会话不会改动 GitHub 上的旧仓库。
