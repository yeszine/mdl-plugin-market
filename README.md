# mdl-plugin-market

面向快消经销商的统一资产市场：技能、专家、专家团、连接器、模板案例、平台扩展功能**共用一份资产模型与一个列表入口**。分类只做展示与筛选；能不能安装、怎么安装由能力位决定。

本仓是**内容 + 契约 + 客户端 + 本地演示服务**，不是控制面。账号、租户、可见性、审核、对象存储的权威实现属于 MDL-MCP，见 [handoff-for-mdl.md](docs/handoff-for-mdl.md)。

---

## 1. 定位与边界

| 本仓负责 | MDL-MCP 负责 |
|---|---|
| 资产长什么样：`catalog/assets.json` + JSON Schema | 谁是企业、谁是员工、谁能看 |
| 怎么导出：确定性 `export/assets.json` | 谁审的、审核状态机、跨企业同意 |
| 怎么装：`client/installer.mjs`（直装 / 提示词 / 开关） | 文件存在哪、怎么签名分发 |
| 怎么投影成 DSH 索引：`scripts/build.mjs` → `index.json` | 可选的索引消费方 |
| 本地演示服务：`server/` + 可替换适配层 | 生产账号、会话、审计、对象存储 |

**不要把本仓的 mock 适配器当成 MDL 的服务端来接管。**

---

## 2. 目录结构

```text
mdl-plugin-market/
├─ catalog/
│  ├─ assets.json                   # 唯一资产目录：15 条 + 六类两级分类树
│  └─ content/                      # 资产载荷（导出与安装的唯一来源）
│     ├─ skills/                    # 6 个技能：<slug>/SKILL.md ...
│     ├─ marketplace/               # 7 个插件包：专家 / 专家团 / 连接器
│     ├─ templates/                 # 模板案例：prompt + 样例
│     └─ extensions/                # 平台扩展说明
├─ export/
│  ├─ export.mjs                    # 确定性导出 CLI
│  ├─ lib.mjs                       # 排序、哈希、digest、序列化
│  ├─ assets.json                   # 导出产物（提交入库）
│  └─ schema/asset-record.schema.json
├─ client/
│  ├─ installer.mjs                 # 安装器 + CLI
│  └─ zip.mjs                       # 零依赖 zip 解压
├─ server/
│  ├─ server.mjs                    # 静态市场页 + JSON API + 真实根锁
│  └─ adapters/
│     ├─ contract.mjs               # 18 个方法的适配层契约
│     └─ mock.mjs                   # 本地内存 / 本地对象目录适配器
├─ web/                             # 单页市场（无构建、零依赖）
├─ scripts/
│  ├─ validate.mjs                  # 目录 / schema / 残留扫描
│  ├─ verify.mjs                    # 端到端验证（19 项）
│  ├─ build.mjs                     # DSH 索引构建
│  └─ lib/
│     ├─ schema.mjs                 # 极简 JSON Schema 校验器
│     └─ format.mjs                 # DSH format 1 校验
├─ data/                            # DSH 投影输入（market.json / plugins.json）
├─ bundles/                         # DSH 版本 source 指向的仓库内路径
├─ site/                            # DSH 静态站点
├─ index.json                       # DSH format 1 产物
└─ docs/
   ├─ format-spec.md                # WorkBuddy 真实落盘格式
   ├─ v2-architecture.md            # 单入口 + 分类 + 能力位 + MDL 边界
   ├─ handoff-for-mdl.md            # 给 MDL 项目 AI 的交接说明
   └─ migration-map.md              # 旧仓路径 → 新路径 → 改造内容
```

---

## 3. 命令

要求 Node 18+，零第三方依赖。

```bash
# 静态校验：目录、分类、能力位、安装源、schema、旧路径/凭证扫描
npm run validate

# 确定性导出（默认 export/assets.json）
npm run export

# 只比对，不写盘；有差异退出码 1
node export/export.mjs --check

# 固定生成时间与提交（CI / 发布）
SOURCE_DATE_EPOCH=1794009600 GIT_COMMIT=<sha> node export/export.mjs --generated-at 2026-11-07T00:00:00Z

# 启动本地服务（默认 127.0.0.1:4173；默认根目录是真实 ~/.workbuddy，只读）
node server/server.mjs --root <沙箱目录> --state-dir <状态目录>

# DSH 索引
npm run build:dsh
npm run build:dsh -- --check

# 全量验证（沙箱内跑完导出、安装、DSH、上传审核下载安装闭环）
npm run verify
```

安装器 CLI：

```bash
node client/installer.mjs list
node client/installer.mjs status --root <沙箱目录>
node client/installer.mjs install mdl.skill.xlsx --root <沙箱目录> --dry-run
node client/installer.mjs install mdl.template.business-dashboard --root <沙箱目录>   # 返回提示词
node client/installer.mjs uninstall mdl.expert.fmcg-order-advisor --root <沙箱目录>
```

**真实根目录锁**：根目录解析为 `~/.workbuddy` 时，非 dry-run 的安装/卸载默认拒绝（CLI 退出码 3，HTTP 403 `REAL_ROOT_LOCKED`）。只有显式 `--allow-real` 才会写入。日常开发请始终传 `--root <沙箱目录>`。

本地演示账号（mock 适配器，密码默认 `demo`，可用 `MOCK_PASSWORD` 覆盖）：

| 手机号 | 角色 | 状态 |
|---|---|---|
| 13800000000 | 平台管理员 | active |
| 13900000000 | 企业成员（可上传） | active |
| 13700000000 | 企业成员 | pending |

> 演示账号只存在于内存，不写入磁盘，不是生产账号，也不包含任何真实凭证。

---

## 4. 资产模型（摘要）

一条资产记录的关键字段：

```jsonc
{
  "schema_version": "asset-record/3.0",
  "kind": "asset",
  "asset_id": "mdl.skill.business-ops-analysis",
  "category": { "primary": "skill/analysis", "labels": ["analysis"] },
  "capabilities": {
    "install": {
      "modes": ["direct", "prompt"],
      "target": "skills/{name}",
      "entry": "SKILL.md",
      "source": "catalog/content/skills/business-ops-analysis",
      "dependencies": []
    },
    "toggle": { "supported": false, "key": null },
    "exhibit": { "showcase": false, "same_as": false },
    "runtime": { "client_side": true, "server_side": false }
  }
}
```

- **分类不参与判定**：`category.primary` 只用于展示与筛选；安装器只读 `capabilities.install.modes` 与 `install.target`。
- **三种安装语义**：`direct`（落盘安装）、`prompt`（返回「安装方法 + 提示词」整段文本）、`toggle`（改写宿主设置键）。
- **六类两级分类树**：技能、专家、专家团、连接器、模板案例、平台扩展功能。
- 目录共 15 条：技能 6 / 专家 3 / 专家团 2 / 连接器 2 / 模板案例 1 / 平台扩展 1。

导出不变量：

- 资产按六类顺序 + `asset_id` 排序；文件按 `path` 排序。
- 逐文件真算 `sha256`；`digest = sha256(asset_id + version + 全部 path:sha256)`。
- `generated_at` 优先 `--generated-at`，其次 `SOURCE_DATE_EPOCH`，再次 `marketplace.updated_at`。
- `commit` 只认 `GIT_COMMIT`；未设置时为 `unknown`，避免每次提交后产物漂移。

---

## 5. DSH 索引投影

`data/plugins.json` 是 DSH 的插件清单，`data/market.json` 声明分类与标签；`scripts/build.mjs` 把两者合成 `index.json`（format 1）。它是**同一份目录的第二个投影**，不是第二份资产目录。

`data/market.json` 的 `metadata.categories` / `metadata.labels` 与 v2 分类树的对应关系（仅文档映射，不参与安装判定）：

| DSH category | 对应 v2 分类 |
|---|---|
| `order` | `expert/order`、`team/order-inventory` |
| `inventory` | `expert/inventory`、`team/order-inventory` |
| `store-visit` | `expert/store` |
| `promotion` | `skill/analysis`、`template/dashboard` |
| `receivables` | `skill/analysis`、`template/dashboard` |
| `logistics` | `connector/data` |
| `master-data` | `connector/erp` |
| `reporting` | `skill/report`、`template/dashboard` |
| `documents` | `skill/report` |
| `collaboration` | `team/review` |
| `workforce` | `expert/store`、`team/review` |
| `integration` | `connector/erp` |
| `knowledge` | `skill/analysis` |
| `tools` | `skill/data`、`skill/automation` |
| `other` | `platform-extension/experimental`（兜底） |

| DSH label | 对应 v2 能力位 / 分类 |
|---|---|
| `fs-read` / `fs-write` | `permissions.filesystem` |
| `shell` / `dynamic-code` | `permissions.shell`、`capabilities.runtime` |
| `network` / `wecom` | `permissions.network`、`connector/*` |
| `llm` / `subagent` | `capabilities.runtime` |
| `credentials` | `permissions.credentials`、`secrets_policy` |
| `erp-read` / `erp-write` | `connector/erp` |
| `offline` | `capabilities.runtime.client_side` |
| `internal-only` | `visibility`（企业内） |

**不变量**：迁移后 `node scripts/build.mjs` 产出的 `index.json` 与旧仓产物**字节一致**（sha256 相同，18 个插件）。

### GitHub Pages URL 会随仓库改名变化

DSH 客户端通过一个固定 URL 拉取索引。仓库从 `dsh-fmcg-index` 改名为 `mdl-plugin-market` 后，GitHub Pages 地址会从：

```text
https://<owner>.github.io/dsh-fmcg-index/index.json
```

变为：

```text
https://<owner>.github.io/mdl-plugin-market/index.json
```

本仓 `scripts/build.mjs` 的默认 `--index-url` 已改为 `https://yeszine.github.io/mdl-plugin-market/index.json`。该地址只用于构建时的格式校验，不会写进 `index.json`。

#### 当前发布状态（2026-11-07）

- 远端：`git@github.com:yeszine/mdl-plugin-market.git`，`main` 已推送。
- **GitHub Pages 尚未启用**。调用 Pages API 返回：

  ```text
  422 Your current plan does not support GitHub Pages for this repository.
  ```

  原因是仓库当前为 **private**，账号计划不支持 private 仓库的 GitHub Pages。线上索引 URL 目前返回 404，不能作为已发布源使用。

#### 启用 Pages 的精确操作

先二选一满足前提：

- **方案 A（免费）**：把仓库改为公开。打开 `https://github.com/yeszine/mdl-plugin-market/settings` → 页面底部 **Danger Zone** → **Change repository visibility** → **Change to public**，按提示确认。
- **方案 B（付费）**：升级到支持 private 仓库 Pages 的 GitHub 计划（Pro / Team / Enterprise）。

然后开启 Pages：

1. 打开 `https://github.com/yeszine/mdl-plugin-market/settings/pages`。
2. **Build and deployment** → **Source** 选择 **Deploy from a branch**。
3. **Branch** 选择 `main`，目录选择 `/(root)`，点击 **Save**。
4. 等待 1–3 分钟；首次发布可能更久，但不超过 10 分钟。
5. 验证：

   ```powershell
   (Invoke-WebRequest -UseBasicParsing 'https://yeszine.github.io/mdl-plugin-market/index.json').StatusCode
   (Get-FileHash 'index.json' -Algorithm SHA256).Hash
   # 与线上内容逐字节比对后，应一致；format=1，plugins=18
   ```

其他需要做的事：

- 若使用自定义域名，更新 DNS / CNAME 到新地址。
- 更新所有消费方（DSH 客户端配置、文档、书签、外部引用）中的索引 URL。
- 如果新 URL 与默认值不同，构建时显式传 `--index-url <你的地址>`。
- 删除旧仓库后旧 URL 会失效；删除前确认没有外部系统仍指向旧地址。

---

## 6. 与 MDL 的边界

- 本仓服务端**只依赖** `server/adapters/contract.mjs` 的 18 个方法；本地用 `mock.mjs` 跑通。
- 接 MDL 时新增一个 HTTP 适配器实现同名方法即可，`server/server.mjs` 与 Web 前端不用改。
- 密码、会话、租户、可见性、审核、对象存储、签名密钥全部归 MDL；本仓不存密码、不存真实凭证。
- 导出只含内容事实，不含审核结论与可见性。
- 安装必须在客户端执行；MDL 只发包与收回执。

接口清单与 P0/P1/P2 排期见 [handoff-for-mdl.md](docs/handoff-for-mdl.md)。

---

## 7. 已知限制

- `docs/format-spec.md` 中标注【推测】的条目仍需在真实 WorkBuddy 客户端验证（重启后是否重读登记、发现页是否展示自建市场、连接器 tab 的数据源等）。
- mock 适配器是内存实现，重启即丢失上传与审核状态；对象文件保留在 `runtime/objects/`。
- 签名下载使用本地 HMAC，不是生产方案。
- 平台扩展开关只改写宿主的 `settings.json`，不保证所有宿主版本都识别该键。
- DSH 索引的官方校验器 `@deepseek-ai/dsh-plugin-market-index` 未随本仓安装；`build.mjs` 在缺失时使用内置近似校验，CI 应安装官方校验器。

---

## 8. 验证

```bash
npm run verify
```

覆盖 19 项：目录/schema、导出幂等、仓库产物一致性、四类直装资产装卸、dry-run、提示词、toggle、真实根锁（CLI + HTTP）、DSH 构建、服务启动、目录/详情、登录、上传、审核上架、签名下载哈希、安装回执、卸载、残留扫描。全部在临时沙箱内运行，不写真实 `~/.workbuddy`。

---

## 9. 迁移与旧仓库

本仓由 `dsh-fmcg-index` 与 `ai-asset-hub` 的能力抽取重建，**不携带旧仓库 git 历史**。逐项来源与改造见 [migration-map.md](docs/migration-map.md)。

旧仓库处置状态（2026-11-07）：

| 仓库 | 本地目录 | 归档 | 状态 |
|---|---|---|---|
| `ai-asset-hub` | `ai-asset-hub/`（已删除） | `D:\GitHub\_archive\ai-asset-hub-20261107.{bundle,zip}` | **已删除本地目录**；归档已校验可读；GitHub 远端未动 |
| `dsh-fmcg-index` | `dsh-fmcg-index/`（保留） | `D:\GitHub\_archive\dsh-fmcg-index-20261107.{bundle,zip}` | **保留**；删除命令见 `D:\GitHub\_archive\DELETE-dsh-fmcg-index.md`；GitHub 远端与旧 Pages 未动 |

- 归档时间、HEAD、分支、sha256 与恢复方式见 `D:\GitHub\_archive\ARCHIVE-MANIFEST.md`。
- 归档目录不在任何 git 仓库内。
- 删除本地目录**不会**删除 GitHub 上的仓库或 Pages；旧的 `https://yeszine.github.io/dsh-fmcg-index/index.json` 仍会继续可访问，直到在 GitHub 上删除旧仓库。
