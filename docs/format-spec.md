# WorkBuddy 技能 / 专家 / 专家团 / 连接器格式说明

本文件记录对 WorkBuddy 桌面客户端（本机 `%LOCALAPPDATA%\Programs\WorkBuddy`，用户数据根目录 `%USERPROFILE%\.workbuddy`）的逆向结论，用于让本市场打包的条目以真实格式落盘并被客户端识别。

本仓路径约定：技能内容在 `catalog/content/skills/`，插件包（专家 / 专家团 / 连接器）在 `catalog/content/marketplace/`，模板案例在 `catalog/content/templates/`，平台扩展说明在 `catalog/content/extensions/`；目录元数据在 `catalog/assets.json`。下文的 `data/skills/`、`marketplaces/<mkt>/plugins/` 是旧仓路径，已在迁移时替换。

标注约定：

- **【已验证】**：直接读取到本机真实文件，或在 `app.asar` 中找到对应实现字符串。
- **【推测】**：由已观察到的样本归纳，未在客户端中实际触发验证。

逆向日期：2026-11-06。

---

## 1. 逆向范围与方法

读取对象：

| 位置 | 用途 |
|---|---|
| `~/.workbuddy/plugins/installed_plugins.json` | 已安装插件登记 |
| `~/.workbuddy/plugins/known_marketplaces.json` | 已注册市场 |
| `~/.workbuddy/plugins/configured-plugins.json` | 内置市场插件配置 |
| `~/.workbuddy/plugins/marketplaces/experts/` | 专家 / 专家团市场样本（66 个专家包） |
| `~/.workbuddy/plugins/cache/experts/ai-content-creator-team/1.0.0/` | 已安装专家团包的真实落盘结构 |
| `~/.workbuddy/skills/<name>/` | 用户技能与市场安装技能 |
| `~/.workbuddy/skills/h3-prompt-writing/_skillhub_meta.json` | 市场来源技能的元数据 |
| `~/.workbuddy/.skill-list-cache.json` | 技能扫描缓存 |
| `~/.workbuddy/teams/ai-content-creator-xhs-launch/` | 专家团结办（启动）后的实例结构 |
| `~/.workbuddy/plugin-marketplace-state-new/` | 市场状态与缓存 |
| `~/.workbuddy/buddy-skill-store/` | 技能安装/更新状态 |
| `~/.workbuddy/extension-registry/` | 扩展目录与受众索引 |
| `~/.workbuddy/connectors/` | 连接器状态、企业注册表与市场元数据 |
| `~/.workbuddy/connectors-marketplace/` | 旧版（legacy）连接器市场包与索引 |
| `~/.workbuddy/plugins/marketplaces/workbuddy-connector-plugins-official/` | 新版连接器插件市场包 |
| `~/.workbuddy/plugins/cache/workbuddy-connector-plugins-official/` | 已安装连接器插件的真实落盘结构 |
| `~/.workbuddy/mcp.json` / `mcp-tool-list.json` / `mcp-tool-policy.json` | MCP 运行时配置、工具缓存与禁用策略 |
| `~/.workbuddy/cache/acc-product-config-*.json` | 产品配置：内置市场、连接器市场与远程端点 |
| `~/.workbuddy/cache/update-endpoint.json` | 客户端更新端点 |
| `resources/app.asar.unpacked/resources/extensions/community/` | 「发现应用」路由落点（社区扩展）与市场加载逻辑 |
| `~/.workbuddy/settings.json` | 插件启用开关等配置 |
| `app.asar`（字符串检索） | 目录解析、技能扫描、专家包校验的真实逻辑 |

asar 中与本文直接相关的实现线索：

- 插件目录解析顺序：先读 `installed_plugins.json` 的 `plugins["<plugin>@<marketplace>"]`，按 `lastUpdated` / `installedAt` 取最新且 `installPath` 存在的版本；找不到再回落到 `known_marketplaces.json` 的 `installLocation` + `.codebuddy-plugin/marketplace.json`。**【已验证】**
- 技能根目录为用户设置目录（`~/.workbuddy`）下的 `skills` 与 `skills-marketplace`。**【已验证】**
- 技能扫描会排除元数据文件：`_skillhub_meta.json`、`_marketplace_meta.json`、`_knot_meta.json`、`_builtin_market_meta.json`、`_user_meta.json`。**【已验证】**
- 安装技能时按名称创建目录、写入 `SKILL.md` 与元数据；元数据 `source` 取值包含 `userImport` 与市场来源。**【已验证（代码字符串）】**

---

## 2. 根目录总览

```
~/.workbuddy/
├─ settings.json                       # 全局设置（含 enabledPlugins）
├─ .skill-list-cache.json              # 技能列表扫描缓存（可重建）
├─ skills/                             # 用户技能 / 市场技能（每个子目录 = 一个技能）
│  └─ <skill-slug>/
│     ├─ SKILL.md                      # 必需
│     ├─ _user_meta.json               # 用户导入时写入（可选）
│     ├─ _skillhub_meta.json           # 市场来源时写入（可选）
│     └─ references/ scripts/ assets/  # 附属目录约定
├─ skills-marketplace/                 # 市场技能目录（扫描源之一，样本机为空）
├─ teams/
│  └─ <team-instance>/                 # 专家团“启动后”的实例，不是安装产物
│     ├─ config.json
│     └─ runtime.json
├─ plugins/
│  ├─ installed_plugins.json           # 已安装插件总登记
│  ├─ known_marketplaces.json          # 已注册市场
│  ├─ configured-plugins.json          # 内置市场插件配置
│  ├─ marketplaces/
│  │  └─ <marketplace-id>/
│  │     ├─ .codebuddy-plugin/marketplace.json
│  │     └─ plugins/<plugin-name>/     # 插件包（专家 / 专家团）
│  └─ cache/
│     └─ <marketplace-id>/<plugin-name>/<version>/
│        ├─ .codebuddy-plugin/plugin.json
│        ├─ agents/*.md
│        ├─ skills/*/SKILL.md
│        ├─ avatars/*.png
│        ├─ .downloaded_at
│        └─ .in_use/<pid>
└─ buddy-skill-store/ extension-registry/ plugin-marketplace-state-new/   # 客户端运行时状态
```

**【已验证】** 以上目录均在本机存在（`skills-marketplace/` 仅出现在扫描配置中，样本机未创建）。

---

## 3. 四类条目对照

| 维度 | 技能 | 专家 | 专家团 | 连接器 |
|---|---|---|---|---|
| 本质 | 单个 `SKILL.md` 目录 | 单 agent 插件包 | 多 agent 插件包 | 带 `ai.workbuddy` 扩展的插件包（MCP / CLI） |
| 市场包位置 | `catalog/content/skills/<slug>/` | `catalog/content/marketplace/plugins/<name>/` | 同左 | 同左（官方为独立的连接器市场） |
| 清单文件 | `SKILL.md` frontmatter | `.codebuddy-plugin/plugin.json` | `.codebuddy-plugin/plugin.json` | `.codebuddy-plugin/plugin.json` + `mcp.json` 或 `ai.workbuddy/cli.json` |
| 类型标记 | 无 | `expertType: "agent"` | `expertType: "team"` | `extensions["ai.workbuddy"]` |
| 安装落点 | `~/.workbuddy/skills/<slug>/` | `~/.workbuddy/plugins/cache/<mkt>/<name>/<version>/` | 同左 | 同左 |
| 全局登记 | 无（靠目录扫描） | `installed_plugins.json` | `installed_plugins.json` | `installed_plugins.json`（键 `<name>@<mkt>`） |
| 卸载 | 删除技能目录 | 删除缓存目录 + 删除登记 | 同左 | 同左 |

**【已验证】** 技能、专家、专家团的落盘结构来自本机真实包；连接器的插件包结构来自本机已安装连接器（见第 11 节）。

---

## 4. 技能格式

### 4.1 目录与文件

```
<root>/skills/<skill-slug>/
├─ SKILL.md          # 必需，YAML frontmatter + Markdown 正文
├─ references/       # 可选，按主题拆分的参考文档
├─ scripts/          # 可选，可执行脚本
└─ assets/           # 可选，模板与素材
```

**【已验证】** 本机 75 个技能均为此结构；`SKILL.md` 缺失或无法解析 frontmatter 的目录不会出现在技能列表缓存中。

### 4.2 frontmatter 字段

样本中实际出现的字段：

| 字段 | 必填 | 说明 |
|---|---|---|
| `name` | 是 | 技能唯一标识，kebab-case，与目录名一致 |
| `description` | 是 | 供模型判断何时调用，英文优先 |
| `description_zh` / `description_en` | 否 | 本地化描述 |
| `display_name` / `display_name_en` | 否 | 展示名 |
| `version` | 否 | 建议 SemVer |
| `author` | 否 | 作者或组织 |
| `category` | 否 | 分类文本 |
| `compatibility` | 否 | 兼容性说明 |
| `license` | 否 | 许可证 |

**【推测】** 客户端扫描的最低要求是 `name` + `description`（样本中所有技能都具备）；其余字段用于展示，缺失不影响加载。

### 4.3 元数据文件

| 文件 | 出现场景 | 关键字段 |
|---|---|---|
| `_user_meta.json` | 用户导入技能 | `name`、`installedAt`（毫秒时间戳）、`source: "userImport"` |
| `_skillhub_meta.json` | 市场来源技能 | `name`（展示名）、`installedAt`、`source: "marketplace"`、`version`、`skillId`、`description_zh`、`description_en`、`iconSource` 等 |

**【已验证】** 两者均在真实目录中出现；客户端扫描时会跳过这些元数据文件。

### 4.4 扫描与缓存

`<root>/.skill-list-cache.json` 结构：

```json
{
  "scopeKey": "...|C:\\Users\\User\\.workbuddy\\skills-marketplace|...",
  "savedAt": 1793900000000,
  "signature": "...",
  "watch": { "...": "..." },
  "results": [
    { "name": "MiniMax H3 提示词编写", "description": "...", "filePath": "...SKILL.md", ... }
  ]
}
```

**【已验证】** 该文件是缓存，不是权威数据源；技能目录变化后应由客户端重新扫描（是否需要重启见第 10 节）。

---

## 5. 专家包格式

### 5.1 目录结构

```
plugins/<plugin-name>/
├─ .codebuddy-plugin/plugin.json    # 必需
├─ agents/<agent-name>.md           # 必需，至少 1 个
├─ skills/<skill-slug>/SKILL.md     # 可选，随插件加载的技能
├─ avatars/*.png                    # 必需（头像与成员头像）
└─ README.md                        # 可选
```

**【已验证】** `marketplaces/experts/plugins/*` 与 `cache/experts/ai-content-creator-team/1.0.0/` 均为此结构。

### 5.2 plugin.json 字段

专家（`expertType: "agent"`）：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | string | 是 | kebab-case，与目录名一致 |
| `version` | string | 是 | SemVer |
| `description` | string | 是 | 英文描述 |
| `expertType` | string | 是 | 固定 `"agent"` |
| `agentName` | string | 是 | 主 agent 的 `name` |
| `agents` | string[] | 是 | `./agents/<x>.md` 相对路径 |
| `skills` | string[] | 否 | `./skills/<x>` 相对路径 |
| `displayName` | `{en, zh}` | 是 | 展示名 |
| `profession` | `{en, zh}` | 是 | 职业抬头 |
| `displayDescription` | `{en, zh}` | 是 | 一句话介绍 |
| `avatar` | string | 是 | `avatars/expert.png` |
| `categoryId` | string | 是 | 见 5.4 |
| `defaultInitPrompt` | `{en, zh}` | 否 | 首次对话预填 |
| `tags` | `{en, zh}[]` | 否 | 标签 |
| `quickPrompts` | `{en, zh}[]` | 否 | 快捷提问 |
| `author` | object | 否 | 25 个专家包与 4 个专家团包携带，非必需 |

**【已验证】** 字段集合来自 66 个专家包的 plugin.json 实际键名。

### 5.3 agent markdown

```markdown
---
name: fmcg-order-advisor
description: 供调度器判断该 agent 能力的一句话
displayName:
  en: "Lu Zhi - Order Advisor"
  zh: "订货顾问 - 陆致"
profession:
  en: "FMCG Order Advisor"
  zh: "订货顾问"
maxTurns: 40
color: green      # 可选
emoji: 📦        # 可选
vibe: 一句话人设   # 可选
---

# 正文：系统提示词
```

**【已验证】** `name`、`description`、`displayName`、`profession`、`maxTurns` 为样本中稳定出现的字段；`color` / `emoji` / `vibe` 为可选。

### 5.4 categoryId 取值

从 66 个专家包归纳出的枚举：

```
01-ProductDesign   02-Engineering    03-GameSpatial     04-DataAI
05-MarketingGrowth 06-ContentCreative 07-SalesCommerce  08-FinanceInvestment
09-OperationsHR    10-ProjectQuality 12-IndustryConsultant
13-TencentZone
```

**【已验证】** 11 号在样本中未出现，可能为空缺或未使用。

---

## 6. 专家团包格式

专家团与专家共用插件包结构，差异在 `plugin.json` 与成员定义。

### 6.1 额外字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `expertType` | string | 固定 `"team"` |
| `agentName` | string | 主理人 agent 的 `name` |
| `teamInfo.leadAgent` | string | 主理人 agent |
| `teamInfo.memberAgents` | string[] | 成员 agent 列表（不含主理人） |
| `members` | object[] | 成员展示信息：`id`、`name{en,zh}`、`profession{en,zh}`、`avatar`、`role`（`lead` / `member`） |

**【已验证】** 来自 `ai-content-creator-team` 的 `plugin.json`；`members[].role` 取值为 `lead` 与 `member`。

### 6.2 成员 agent 文件

`agents/<member>.md`，frontmatter 与专家 agent 一致；主理人额外承担调度职责，其 `maxTurns` 通常高于成员（样本主理人 120，成员 40-50）。

---

## 7. 市场清单与全局登记

### 7.1 市场清单

`<marketplace>/.codebuddy-plugin/marketplace.json`：

```json
{
  "name": "workbuddy-fmcg",
  "description": "市场描述",
  "plugins": [
    { "name": "fmcg-order-advisor", "source": "./plugins/fmcg-order-advisor", "description": "..." }
  ]
}
```

**【已验证】** `experts` 市场即为此结构，`source` 为相对市场根目录的路径。

### 7.2 known_marketplaces.json

```json
{
  "workbuddy-fmcg": {
    "manifestName": "workbuddy-fmcg",
    "type": "directory",
    "source": { "source": "directory", "path": "<绝对路径>" },
    "installLocation": "<绝对路径>",
    "description": "...",
    "lastUpdated": "2026-11-06T04:58:24.577Z",
    "autoUpdate": false,
    "isBuiltIn": false
  }
}
```

**【已验证】** 8 个已注册市场均为 `type: "directory"`；`manifest` 字段只有 `experts` 携带（内联的市场清单副本），其余市场没有，说明该字段可选。

### 7.3 installed_plugins.json

```json
{
  "version": 2,
  "plugins": {
    "fmcg-order-advisor@workbuddy-fmcg": [
      {
        "scope": "user",
        "installPath": "C:\\Users\\User\\.workbuddy\\plugins\\cache\\workbuddy-fmcg\\fmcg-order-advisor\\1.0.0",
        "version": "1.0.0",
        "installedAt": "2026-11-06T04:58:24.571Z",
        "lastUpdated": "2026-11-06T04:58:24.571Z"
      }
    ]
  }
}
```

**【已验证】** 键名为 `<plugin>@<marketplace>`，值为数组，每个元素对应一个已下载版本；数组长度可大于 1（保留历史版本）。

### 7.4 其他登记文件

| 文件 | 与专家/专家团的关系 |
|---|---|
| `plugins/configured-plugins.json` | 只登记内置市场插件（`builtInMarketPlugins`），样本中无任何专家条目 **【已验证】** |
| `settings.json` 的 `enabledPlugins` | 样本中只包含内置与连接器插件，专家/专家团未出现 **【已验证】** |
| `extension-registry/*.json` | 扩展目录与受众索引，与专家安装无直接对应 **【推测】** |

---

## 8. 安装与卸载的落盘动作

### 8.1 安装技能

1. 在 `<root>/skills/<slug>/` 创建目录。
2. 复制 `SKILL.md` 及 `references/`、`scripts/`、`assets/`。
3. 可选写入 `_user_meta.json`（`source: "userImport"`）或 `_skillhub_meta.json`（市场来源）。
4. 客户端重新扫描技能目录后出现在技能列表。

**【已验证】** 目录与 `SKILL.md` 是识别所需的最小集合；**【推测】** 元数据只影响来源标记与图标展示。

### 8.2 安装专家 / 专家团

1. 确保市场已注册到 `known_marketplaces.json`。
2. 复制包到 `<root>/plugins/cache/<marketplace>/<name>/<version>/`。
3. 写入 `.downloaded_at`（ISO 时间）。
4. 在 `installed_plugins.json` 的 `plugins["<name>@<marketplace>"]` 中追加一条记录。
5. 客户端运行时会创建 `.in_use/<pid>` 标记（安装阶段不需要手写）。

**【已验证】** 步骤 2-4 与真实已安装包一致；`.in_use` 由客户端进程写入。

### 8.3 启动专家团

安装 ≠ 启动。启动后会生成 `<root>/teams/<team-instance>/`：

- `config.json`：`name`、`description`、`createdAt`（毫秒）、`leadAgentId`（`team-lead@<instance>`）、`leadSessionId`、`members[]`（`agentId`、`agentType`、`cwd`、`prompt` 等）。
- `runtime.json`：`version`、`teamName`、`leadSessionId`、`status`、`members[]`（`backendType`、`prompt` 等）。

**【已验证】** 来自 `teams/ai-content-creator-xhs-launch/`。该目录属于运行实例，不属于可安装内容。

### 8.4 卸载

| 类型 | 必须清理 |
|---|---|
| 技能 | `<root>/skills/<slug>/` |
| 专家 / 专家团 | `installed_plugins.json` 中对应 `plugins["<name>@<mkt>"]`；`<root>/plugins/cache/<mkt>/<name>/` |
| 市场 | 若市场内已无任何插件，可从 `known_marketplaces.json` 删除该市场条目（可选） |

**【推测】** 已启动的专家团实例目录（`teams/<instance>/`）是否随插件卸载删除，样本中无法验证；本实现默认不触碰。

---

## 9. 命名与版本规则

| 对象 | 规则 | 依据 |
|---|---|---|
| 技能目录 / `name` | kebab-case，小写字母数字与 `-` | 样本全部符合 |
| 插件 `name` | kebab-case，与目录名一致 | 样本全部符合 |
| 市场 id | kebab-case，同时作为 `known_marketplaces.json` 键 | 样本：`experts`、`workbuddy-builtin` |
| 版本 | SemVer `MAJOR.MINOR.PATCH` | 样本：`1.0.0`、`5.9.3-wb...`（内置包带构建后缀） |
| 登记键 | `<plugin>@<marketplace>` | 已验证 |
| 团队实例 | 启动时生成，样本为 `<plugin>-<主题>` | 样本：`ai-content-creator-xhs-launch` |
| agent 标识 | `<agent>@<team-instance>` | 已验证 |

---

## 10. 已验证 vs 推测待确认

### 已验证

- 四类条目的目录层级、清单文件名与字段集合（来自真实安装包、66 个专家包与已安装连接器包）。
- 技能安装落点 `~/.workbuddy/skills/<slug>/` 与最小识别条件（`SKILL.md`）。
- 专家 / 专家团 / 连接器安装落点 `plugins/cache/<mkt>/<name>/<version>/`。
- `installed_plugins.json`、`known_marketplaces.json` 的条目结构。
- `expertType` 取值 `agent` / `team`，团队 `teamInfo`、`members` 结构。
- 技能扫描会排除 `_*_meta.json` 元数据文件。
- 专家包目录解析优先读 `installed_plugins.json`，回落到市场目录。
- `.in_use/<pid>` 由客户端运行时创建。
- 连接器的新版插件包结构（`extensions["ai.workbuddy"]` + `mcp.json` / `ai.workbuddy/cli.json`）与旧版索引结构（`connectors.json` 283 条）。
- 连接器按插件流程安装：`plugins/cache/<mkt>/<name>/<version>/` + `installed_plugins.json` 登记。
- 连接器运行态文件：`connector-states.json`（v4，加密）、`enterprise-registry.json`、`mcp-tool-list.json`、`mcp-tool-policy.json`。
- 「发现应用」页路由落点为社区扩展；专家/技能/连接器默认走远端市场接口。
- 专家分组标题来自远端分类树，本地 `plugin.json` 只有 `categoryId`。
- 专家团成员内嵌在团队包内（`agents/*.md` + `members[]`），安装时不产生成员条目。

### 推测待确认

1. **客户端是否在启动时重新读取 `known_marketplaces.json` 与 `installed_plugins.json`**，还是只在安装流程内更新缓存。→ 需要真实安装后重启客户端验证。
2. **技能安装后是否需要重启**才能出现在技能列表。`.skill-list-cache.json` 带 `watch` 字段，推测支持热更新，但未验证。
3. **自建市场是否能出现在客户端的市场/专家界面**。本实现只在登记文件中注册，客户端 UI 是否展示取决于其市场类型判断。
4. **`members[].role` 之外的成员字段是否必需**；本实现补了 `profession` 与 `avatar`。
5. **专家包是否强制校验头像尺寸与格式**。样本均为 PNG，推测存在尺寸校验但阈值未知。
6. **卸载后是否需要清理 `settings.json` 的 `enabledPlugins`**。样本中专家不写入该项，本实现也不写。
7. **专家团结办实例是否随插件卸载清理**。本实现不清理。
8. **`categoryId` 的完整枚举与是否影响展示分组**。11 号缺失，推测存在未使用的分类位。
9. **仅注册本地目录市场，条目是否出现在「发现应用」页**。默认链路走远端接口，推测不会出现；需要产品配置或远端返回。
10. **本地连接器包是否进入客户端「连接器」tab**。官方连接器市场同样以目录市场登记，但该 tab 可能只读远端 connector-market。
11. **连接器包的 `policy.visible_in` 是否会按渠道过滤自建条目**。样本均包含四个渠道，未验证过滤行为。
12. **卸载连接器时是否清理 `connector-states` 的 `enabled` 标记**。本实现不触碰运行态状态。
13. **任意自定义分组名是否能在客户端生效**。本市场页使用自有 `group` 字段展示，客户端分组仍由 `categoryId` / 远端分类决定。

以上待确认项在 `README.md` 的「已知限制」中同步列出，需要用户决定是否在真实环境中验证。

---

## 11. 连接器格式

### 11.1 两种并存形态

**A. 新版：连接器插件包（plugin 格式）【已验证】**

市场目录：`~/.workbuddy/plugins/marketplaces/workbuddy-connector-plugins-official/connectors/<name>/`

```
<name>/
├─ .codebuddy-plugin/plugin.json
├─ mcp.json                      # MCP 型连接器
│  或 ai.workbuddy/cli.json      # CLI 型连接器
├─ ai.workbuddy/assets/icon.svg
└─ skills/<name>/SKILL.md        # 可选，连接器自带的用法技能
```

`plugin.json`（不是 `expertType`，而是扩展声明）：

```json
{
  "name": "westock-mcp",
  "version": "0.0.0+wb.xxxx",
  "description": "...",
  "keywords": ["mcp", "skills"],
  "extensions": {
    "ai.workbuddy": {
      "schemaVersion": "1.0.0",
      "display": {
        "name": "…",
        "name_zh": "…",
        "name_en": "…",
        "description_zh": "…",
        "description_en": "…",
        "examples_zh": ["…"],
        "examples_en": ["…"]
      },
      "policy": {
        "visible_in": ["internal", "iOA", "cloudhosted", "selfhosted"],
        "mcpServers": { "<server>": { "timeout": 20000 } }
      }
    }
  }
}
```

`mcp.json`：

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
  "mcpServers": {
    "<server>": { "type": "streamable-http", "url": "https://…/mcp" }
  }
}
```

**【已验证】** 来自 `plugins/cache/workbuddy-connector-plugins-official/` 下 `westock-mcp`、`sensors-data-cli`、`zsxq`、`wecom` 等真实已安装包。
**【已验证】** 旧版 `connectors-marketplace/connectors/gongxie-erp/mcp.json` 使用 `"type": "streamableHttp"`（camelCase），新版插件包使用 `"streamable-http"`（kebab-case）。

**B. 旧版：连接器市场索引（legacy 格式）【已验证】**

```
~/.workbuddy/connectors-marketplace/
├─ .codebuddy-connector/connectors.json
├─ connectors/<id>/mcp.json
├─ connectors/<id>/token-schema.json
├─ connectors/<id>/skills/<id>/SKILL.md
└─ icons/
```

`connectors.json` 顶层：`name`、`description`、`owner`、`auth_injection_rules`、`connectors[]`。单条连接器字段：

| 字段 | 说明 |
|---|---|
| `id` | 连接器 id，与 `source` 通常一致 |
| `name` / `name_en` | 展示名 |
| `description` / `description_zh` / `description_en` | 描述 |
| `source` | 包目录名 |
| `auth_mode` | 如 `server-side` |
| `type` | 如 `mcp` |
| `examples_zh` / `examples_en` | 示例问法 |
| `visible_in` | 渠道可见性 |

**【已验证】** 索引共 283 条（如 `tdx-connector` 通达信）；`auth_injection_rules` 用于在 MCP 请求中注入认证头；`mcp.json` 可用 `${ERP_TOKEN}` 之类占位符引用凭证。
**【推测】** `token-schema.json` 描述该连接器需要用户填写的凭证字段，客户端据此渲染认证表单；本次未逐字段展开。
**【推测】** 客户端在 legacy 模式下读取该目录；新版是否仍会回落到 `connectors-marketplace/` 未验证。asar 中的市场格式探测逻辑同时识别 `.codebuddy-connector/connectors.json`（legacy）与 `.codebuddy-plugin` / `.workbuddy-plugin` / `.claude-plugin` 的 `marketplace.json`（plugin）。

### 11.2 安装方式与登记

连接器按**插件安装流程**落盘，不是把 MCP 配置写进 `mcp.json`：

1. 复制到 `~/.workbuddy/plugins/cache/<marketplace>/<name>/<version>/`。
2. 写 `.downloaded_at`；客户端运行时再写 `.in_use/<pid>`。
3. 在 `installed_plugins.json` 写入 `plugins["<name>@<marketplace>"]`。
4. 连接器市场本身登记在 `known_marketplaces.json`（`type: "directory"`）。

**【已验证】** 本机 `installed_plugins.json` 中存在 `zsxq@workbuddy-connector-plugins-official` 等记录；`known_marketplaces.json` 中 `workbuddy-connector-plugins-official` 为 directory 类型。
**【已验证】** 远端连接器市场接口为 `/v2/enterprises/{id}/connector-market/list` 与 `/connector-market/search`（asar 字符串检索）；市场 API 链支持按需下载，旧版 zip 链支持整包下载。

### 11.3 运行态、认证与禁用

| 文件 | 作用 | 结论 |
|---|---|---|
| `connectors/default/connector-states.json` | 未登录基线状态 | **【已验证】** 含 `enabled[]`、`userDisabled[]`、`headerOverrides`、`envOverrides`、`disabledToolsOverrides`、`accountIdentityKey: "default\|\|enterprise"` |
| `connectors/<accountIdentityKey>/connector-states.json` | 登录账号的连接器状态 | **【已验证】** 含 `version: 4`、`encryption{scheme:"aes-256-gcm",kdf:"hkdf-sha256",salt,userIdCheck,keyCheck}`、`connectors{}` |
| `connectors/<accountIdentityKey>/connector-states.v3.json` | 旧版状态 | **【已验证】** 存在；v4 为主 |
| `connectors/<accountIdentityKey>/.master.key` | 状态解密密钥 | **【已验证】** 32 字节文件存在 |
| `connectors/enterprise-registry.json` | 企业连接器注册表缓存 | **【已验证】** `{version:4, enterpriseId, fetchedAt, entries:[]}`；**【推测】** 由企业策略下发的连接器白名单/注册表 |
| `connectors/marketplace-meta/*.json` | 市场包指纹/元数据 | **【已验证】** 目录存在；结构未展开 |
| `mcp.json` | 全局 MCP server 配置 | **【已验证】** `{mcpServers:{<name>:{url}}}`，与连接器包内的 `mcp.json` 不同层 |
| `mcp-tool-list.json` | 各 MCP server 的工具缓存 | **【已验证】** `{version:1, entries:{<serverHash>:[{name,description}]}}` |
| `mcp-tool-policy.json` | 工具禁用策略 | **【已验证】** `{version:1, disabledTools:{}}` |

**卸载**：删除 `installed_plugins.json` 中的 `<name>@<marketplace>` 键与 `plugins/cache/<marketplace>/<name>/`；运行态 `connector-states` 中的 `enabled` 标记是否随之清理 **【推测】**，本实现不触碰。

### 11.4 连接器与技能的绑定

**【已验证】** 连接器包可在 `skills/<name>/SKILL.md` 内置用法技能（如 `gongxie-erp`、`westock-mcp`、`sensors-data-cli`）。技能 frontmatter 的 `name` 与连接器/MCP server 同名，正文直接引用该连接器的工具与调用顺序。
**【推测】** 没有独立的 binding 字段；绑定关系由「同一包内 + 同名 + 正文引用」表达。技能 tab 中是否单独列出连接器技能，取决于客户端是否把包内技能并入技能列表。

---

## 12. 客户端「发现应用」页的数据源

### 12.1 路由落点【已验证】

- `renderer/assets/discover-*.js`：`/discover` 路由渲染 `DiscoverPage`，随后重定向到 `/extension/community`。
- 对应本机目录：`resources/app.asar.unpacked/resources/extensions/community/`（扩展名「灵感社区」）。
- 页面入口脚本：`ui/assets/__federation_expose_Main-*.js`。

### 12.2 数据来源【已验证 + 推测】

| Tab | 加载逻辑 | 数据源 | 结论 |
|---|---|---|---|
| 专家 | 社区扩展内 `wb.experts.list({ source: "builtin", … })` | **远端**专家市场 API：`POST /enterprises/{id}/expert-market/list` | 已验证 |
| 专家分组 | 社区扩展内 `wb.experts.market…categories` | **远端**分类树：`{tag_id, sub_type, children[], name_zh, name_en}` | 已验证 |
| 技能 | 社区扩展内 `wb.skills.marketplace.builtin` → `skillhub` → `wb.skills.installed()` | **远端技能市场**，失败时回落本地已安装技能 | 已验证 |
| 连接器 | 主进程 `ConnectorService` / `wb.connectors.*` | 远端 `/v2/enterprises/{id}/connector-market/list`、`/connector-market/search`；桌面链路读取本地连接器包 | 接口已验证；「连接器」tab 的渲染位置未在社区扩展中找到 |

**【推测待确认】** 截图中的「发现应用」三段式页面若与本机 `/discover` 为同一路由，则专家/技能数据来自上述远端接口；由于本机 bundle 中未找到「专家 · 技能 · 连接器」导航与「连接器」tab 文案，不能排除该页面由远端下发模板渲染。无论哪种情况，卡片主数据都指向远端市场接口，而不是本地 `marketplace.json`。

补充证据：
- `resources/app.asar.unpacked/resources/builtin-expert-recommendations/` 是内置推荐清单（`experts/*.json` 与 `skills.json`），属于编辑精选，不是分组主数据。
- `~/.workbuddy/cache/acc-product-config-*.json` 含 `builtInMarketplaces`、`builtInSkillMarketplaces`、内置市场插件与端点；本机未见 `builtInConnectorMarketplaces` 字段，但 asar 会读取该键。
- `~/.workbuddy/cache/update-endpoint.json` 只影响客户端更新，不影响发现页内容。
- `~/.workbuddy/plugin-marketplace-state-new/.marketplace-version-*` 只是市场版本标记文件（内容为 UUID），不是内容数据源。
- `~/.workbuddy/extension-registry/catalog-empty-stable.json` 为扩展目录快照，与专家/技能/连接器卡片无对应字段。

### 12.3 自建市场要出现在「发现应用」还需要什么

**【已验证】** 自建目录市场（`known_marketplaces.json` + `.codebuddy-plugin/marketplace.json`）能被客户端的**插件市场/已安装**链路读取，因为官方连接器市场也是这样登记的。

**【推测待确认】** 「发现应用」页的三类 tab 默认走远端市场接口，因此仅注册本地目录市场**不足以**让卡片出现在该页。要出现，需要满足其一：
1. 远端市场接口（专家/技能/连接器）返回自建条目；
2. 通过产品配置的 `builtInMarketplaces` / `builtInConnectorMarketplaces` 指向自建市场地址；
3. 客户端存在本地市场聚合开关（本次未在 asar 中找到明确证据）。

本实现因此把页面定位为「本地可安装市场」：安装后条目进入客户端的已安装/插件链路，但不保证出现在远端驱动的「发现应用」信息流。

---

## 13. 专家分组

**【已验证】** 本地专家包 `plugin.json` 只有 `categoryId`（如 `05-MarketingGrowth`），没有 `group` / `category` 字段；66 个样本包均如此。

**【已验证】** 「发现应用」页的分组标题（电商运营、内容创作、投资分析、法律咨询等）来自远端分类接口，不是 `marketplace.json` 的字段。远端专家条目携带 `categoryId` 与 `categoryName`；分类树由 `tag_id` / `sub_type` / `children` / `name_zh` 组成。

**【已验证】** 自定义专家使用 `categoryId: "custom"`（asar 中的 `updateCustomExpertMarketplaceManifest` 逻辑）。

**【推测待确认】** 自建专家能否自定义分组：若走本地插件链路，客户端最多按 `categoryId` 命中内置/远端分类；任意新分组名不会自动出现。若走远端市场，分组由服务端分类决定。本市场页额外使用自有 `group` 字段做本地分组展示，`plugin.json` 同步写入 `categoryName` 作为兜底展示，二者都不保证改变客户端「发现应用」的分组。

---

## 14. 专家团与成员关系

**【已验证】** 成员专家**内嵌在专家团包内**，不是引用独立专家包：

```
<team>/
├─ .codebuddy-plugin/plugin.json     # teamInfo.leadAgent / memberAgents / members[]
├─ agents/lead.md
├─ agents/<member>.md                # 每个成员的完整 agent 定义
├─ avatars/*.png                     # 主理人与成员头像
└─ skills/<x>/SKILL.md               # 可选，团队共享技能
```

- `teamInfo.leadAgent` 指向主理人 agent，`teamInfo.memberAgents[]` 列出成员 agent。
- `members[]` 是展示层：`id`、`name{en,zh}`、`profession{en,zh}`、`avatar`、`role`（`lead` / `member`）。
- 安装团队时只安装团队包本身；成员 agent 随包落地，不会在 `installed_plugins.json` 中生成成员条目。
- 启动团队后生成 `~/.workbuddy/teams/<instance>/`，`config.json` 的 `members[].agentId` 形如 `<agent>@<instance>`，这是运行实例，不是安装产物。

**【已验证】** 样本：`plugins/marketplaces/experts/plugins/ai-content-creator-team/` 与 `plugins/cache/experts/ai-content-creator-team/1.0.0/`；`teams/ai-content-creator-xhs-launch/` 为启动实例。
**【推测待确认】** 团队包是否可以引用外部独立专家（而非内嵌）：66 个样本中未发现引用式写法，按内嵌处理。
