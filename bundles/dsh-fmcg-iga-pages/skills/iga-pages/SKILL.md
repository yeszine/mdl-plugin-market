---
name: iga-pages
description: 将前端、全栈与 AI Agent 项目部署到 IGA Pages。涉及 IGA Pages 部署、Pages Functions、日志排查、@iga-pages/agent 或 @iga-pages/blob SDK 时使用本技能；与 IGA Pages 无关的后端工作不要使用。
---

# IGA Pages 部署与开发指南

本技能分两条主线：**命令行工具 `iga`**（登录、创建/关联项目、本地开发、构建、部署、环境变量、日志查看）和**项目内开发**（Pages Functions、Agent SDK、Blob SDK）。

任何子命令的完整参数都可以通过 `iga <命令> -h` 查看。

## 何时使用

- 把静态站点、前端框架项目、带服务端逻辑的全栈项目或 AI Agent 应用发布到 IGA Pages。
- 在 IGA Pages 项目中编写 `api/` 下的 Serverless Functions，或使用 `@iga-pages/agent`、`@iga-pages/blob`。
- 查询部署状态、构建日志、线上运行时日志，管理项目级环境变量。

不适用：与 IGA Pages 平台无关的通用后端开发、自建服务器部署等场景。

## 前置条件

- Node.js 版本 **不低于 20**。
- CLI 包为 `@iga-pages/cli`，版本 **不低于 1.1.9**。用 `iga --version` 检查，缺失或过旧时执行：

```bash
npm i -g @iga-pages/cli@latest
```

- 受支持的框架：Next.js、Vite、Vue CLI、Create React App、Angular、Hexo、Docusaurus、VitePress、VuePress、Astro、Nuxt。不在名单内的框架（如 Remix）不受支持，应先告知用户再决定下一步。纯 HTML/JS/CSS 静态资源也可以直接部署，默认把项目根目录作为产物目录。

## 登录与鉴权

凡是需要访问远端资源的命令（`init`、`link`、`list`、`deploy`、`preview`、`inspect`、`logs`、`env`、`integration` 等），都先执行 `iga whoami` 确认当前登录状态。`whoami` 成功就直接复用已有凭据；只有确认凭据缺失、过期或被拒绝时才执行 `iga login`。网络抖动或服务端报错不要一律当成需要重新登录。

按运行环境选择登录方式：

- 本地桌面环境（能弹出浏览器）：`iga login`，等待用户在浏览器里完成授权。
- 远程交互终端（SSH、云开发容器等，无法打开本地浏览器）：`iga login --remote`，终端会给出验证地址和短码，用户在任意浏览器完成授权。
- 无人值守的自动化（CI/CD）：`iga login --accessKey <AK> --secretKey <SK>`，AK/SK 从火山引擎 IAM 控制台获取。

判断原则：终端打不开浏览器但有人能配合授权就用 `--remote`；完全无人参与才用 AK/SK；其余情况默认浏览器登录。`--remote` 与 AK/SK 互斥。

## 工作目录

`pages link`、`pages dev`、`pages build`、`pages deploy` 这类面向项目的命令**必须在项目根目录内执行**。脚手架工具（`create-next-app`、`npm create vite` 等）会生成子目录，务必先 `cd` 进去：

```bash
npx create-next-app@latest my-app --yes
cd my-app && iga pages deploy --name my-app
```

## 部署流程

### 纯静态站点

静态项目无需 Functions，直接在项目根目录部署即可：

```bash
iga pages deploy --name <项目名>   # 首次部署会自动创建项目
iga pages deploy                   # 已关联过的项目直接部署
```

### 关联项目

```bash
iga pages link                     # 创建或关联 Pages 项目（只关联，不部署）
iga pages link --format=json       # 以 JSON 列出可选项，不改动状态
iga pages link --yes --format=json # 自动关联/创建并以 JSON 返回结果
```

关联成功后 CLI 会写入 `.iga/project.json`。`env` 和 `integration` 系列命令都要求先完成关联。

### Pages Functions（服务端接口）

在项目根目录建 `api/` 目录，其中每个 `.js` / `.ts` 文件自动映射为 HTTP 路由：

```
api/
├── index.js              → /api
├── hello.js              → /api/hello
├── users/[id].js         → /api/users/:id      （动态段）
└── [[default]].js        → /api/:default*      （兜底）
```

路由优先级：静态 > 动态 > 兜底。处理器遵循 Web 标准 `Request` → `Response` 约定，支持按方法具名导出（`GET`、`POST`、`PUT`、`PATCH`、`DELETE`、`HEAD`、`OPTIONS`），未支持的方法自动返回 405：

```js
// api/users/[id].js
export function GET(request) {
  const { id } = request.params; // 动态路由参数挂在 request.params 上
  return Response.json({ id });
}
```

也可以默认导出 Express / Koa 应用，但文件必须命名为 `[[default]].js`，且**不要**调用 `app.listen()`。注意整个应用挂载在 `/api` 前缀下：框架内写 `app.get("/users")` 对外就是 `/api/users`，路由里不要再带 `/api` 前缀。

### 全栈项目（含 SSR 框架）

- 本地开发统一用 `iga pages dev`。只要项目里存在 `api/`，就必须用它启动——它会把框架 dev server 和 `/api/*` 一起提供服务；直接用 `next dev` / `vite` 等命令启动会导致 Functions 不可用。
- `iga pages build` 产出生产构建，Functions 或 SSR 产物会一并打包。
- 部署同样走 `iga pages deploy`：新项目优先使用已授权的 GitHub 远程做 Git 部署，否则退化为上传部署；已关联的项目沿用原配置，且只支持 GitHub 作为 Git 来源。
- SSR 项目的服务端逻辑应放在框架自带的服务端路由里；存在 SSR 入口时，生产环境会忽略根目录的 `api/` 路由。
- Agent 项目与其他全栈项目共用同一套 `dev` / `build` / `deploy` 流程，没有单独的 Agent 部署命令。可以用 `iga pages init --type agent --list --json` 查看模板，再用 `iga pages init <目录> --type agent --template <ID>` 创建。

部署输出里如果带有形如 `?iga_token=...&iga_time=...` 的预览 URL，分享时必须**连同 query 一起**给出，少了参数可能打不开。

## 环境变量

`env` 系列命令操作的是**远端项目配置**，要求目录已关联项目：

```bash
iga pages env list                 # 只列 KEY 名，永不显示值
iga pages env add <NAME>           # 交互式输入值（隐藏输入）
iga pages env add <NAME> --value <v> --yes   # 非交互，适合 CI
iga pages env update <NAME> --value <v> --yes
iga pages env remove <NAME> --yes
iga pages env pull                 # 把项目全部环境变量写入本地 .env.local
```

要点：`add`/`update`/`remove` 只改远端，且在**下一次部署**时才生效，不会改本地文件；本地开发想要最新值就执行 `env pull` 刷新 `.env.local`（该文件属敏感文件，不要提交）。由 Supabase 集成管理的变量是只读的，增删要走 `iga pages integration link/unlink supabase`。

## 日志与排查

按信息来源选命令，两类日志不能互相替代：

| 目的 | 命令 |
| --- | --- |
| 边部署边看构建输出 | `iga pages deploy --logs` |
| 查看某次部署的概要（状态、预览地址等） | `iga pages inspect <DEPLOYMENT_ID>` |
| 查看某次部署的构建日志 | `iga pages inspect <DEPLOYMENT_ID> --logs` |
| 查询线上应用 `console` 输出 | `iga pages logs [DEPLOYMENT_ID]` |

`pages logs` 是历史查询而非实时流：默认查最近 24 小时、最新在前、上限 100 条；`--since`/`--until` 接受 ISO 时间或 `30m`、`1h`、`7d` 这类相对时长（跨度不超过 7 天）；`--content` 按内容过滤、`--level` 按级别过滤；`--json` 输出逐行 JSON。`--wait` 可配合 `inspect` 等待终态，`--timeout 3m` 控制等待时长。

注意：平台不会帮你脱敏，应用代码写进日志的凭据、请求体、个人信息都会原样出现；本地 `iga pages dev` 保持原生文本输出，不要指望看到线上那种结构化 JSON 日志。

## @iga-pages/agent（服务端 Agent SDK）

**只在 Pages Functions 或全栈框架的服务端处理器里可用**；浏览器 bundle、客户端组件、纯静态站点、普通 Node 进程里都用不了。安装为项目直接依赖：

```bash
npm install @iga-pages/agent
```

按需求从对应子路径导入，不要从包根或 `/host` 子路径导入：

- `@iga-pages/agent/store` —— 会话与消息存取：`createConversation`、`appendMessage(s)`、`listMessages` 等。
- `@iga-pages/agent/store/openai` —— OpenAI Agents 会话适配（`createSession`）。
- `@iga-pages/agent/store/langgraph` —— LangGraph checkpoint 持久化（`createCheckpointer`）。
- `@iga-pages/agent/store/claude` —— Claude Agent 会话存储（`createSessionStore`）。
- `@iga-pages/agent/sandbox` —— 沙箱生命周期：`getConversationSandbox(id)` 复用会话沙箱、`createSandbox()` 建独立沙箱、`connectSandbox(id)` 重连。
- `@iga-pages/agent/tools` 及各框架子路径 —— 面向模型的工具集，`getTools(sandbox)` 后按名挑选（`shell_exec`、`files_read`、`code_run`、`browser_fetch` 等共九项）。

典型用法：

```ts
import { store } from "@iga-pages/agent/store";

const { conversationId } = await store.createConversation({
  metadata: { title: "调研会话" },
});
await store.appendMessage({
  conversationId,
  role: "user",
  type: "message",
  payload: { content: "总结一下这份报告" },
});
```

行为约定：不传 `conversationId` 会自动生成 UUID；向不存在的会话追加消息会自动建会话；`appendMessages` 一批 1–100 条、原子写入；列表分页游标按不透明值处理；沙箱文件是临时的，需要持久化的产物要显式写入 `@iga-pages/blob`。错误方面：Store 失败抛 `StoreError`，沙箱生命周期失败抛 `SandboxError`，用 `isAbortError` 识别取消。SDK 不负责鉴权——调用方必须先认证用户、校验会话/沙箱/Blob 前缀的归属，资源 ID 只是标识符不是凭据；不要把 SDK 原始报错、签名 URL、运行时凭据透传或写进日志。

## @iga-pages/blob（服务端对象存储）

提供项目级持久化对象存储，同样**仅限服务端使用**。浏览器端要么调用服务端接口，要么用服务端签发的上传凭证。

```bash
npm install @iga-pages/blob
```

```ts
import { blob, BlobError } from "@iga-pages/blob";

await blob.set("reports/a.json", JSON.stringify(data));       // 写入（默认覆盖）
await blob.setJSON("reports/a.json", data, { onlyIfNew: true });
const text = await blob.get("reports/a.json");                 // 默认按文本读取
const obj  = await blob.get("reports/a.json", { format: "json" });
const meta = await blob.info("reports/a.json");
await blob.delete("reports/a.json");                           // 幂等
const page = await blob.list({ prefix: "reports/" });
```

要点：

- key 是项目内相对路径，要拒绝绝对路径、反斜杠、空段、`.` 和 `..`；key 按项目隔离，围绕已认证的用户/租户/会话设计前缀。
- `get` 对不存在的 key 一律返回 `null`；`onlyIfNew: true` 遇到已存在的 key 会冲突报错。
- `list` 默认自动翻完所有页；`paginate: false` 之外无需自己处理游标。加 `directories: true` 可只列直接子目录名。
- 浏览器直传：`blob.createUploadUrl(key, { onlyIfNew: true })` 得到临时 `PUT` 凭证（`{ key, url, method, expiresAt }`）。签发前必须先认证用户并授权到具体 key；URL 在过期前按敏感信息处理，不要写日志；该凭证不限制大小和 Content-Type，相关约束要在应用层自己校验。
- 每个操作都可传 `abortSignal` 做请求级取消；取消不会回滚已完成的写入。
- 沙箱产物要持久化就显式写 Blob，恢复前同样要校验资源归属。Blob 走平台数据面，不需要为它去接 Supabase 集成，也不要往环境变量里贴 Supabase 凭据。

## 常见坑

- 在脚手架生成的子目录外面执行 `iga pages` 命令 → 先 `cd` 进项目根目录。
- 未登录就部署 → 先 `iga whoami`，失败了再 `iga login`，不要动不动就重新登录。
- 把 `.iga/` 提交进版本库 → 它应被 `.gitignore` 排除（link/deploy 会尽力自动加，但需自查）。
- 项目里有 `api/` 却用 `npm run dev` / `next dev` 启动 → Functions 不会生效，必须用 `iga pages dev`。
- 把 `package.json` 的 `scripts.dev` 写成 `iga pages dev` → 死循环（`iga pages dev` 内部会调用 `dev` 脚本），该脚本应保持框架自己的开发命令。
- 未 `link` 就执行 `env` / `integration` → 先 `iga pages link`。
- 以为 `env add/update/remove` 会立即生效或改本地文件 → 只改远端、下次部署生效；本地用 `env pull`。
- 手动把 Supabase 密钥贴进 `env add` → 有集成可用时应走 `iga pages integration link supabase`。
- 在浏览器代码或任意 Node 进程里 import `@iga-pages/agent` / `@iga-pages/blob` → 两个 SDK 只能在 IGA Pages Functions 或全栈框架的服务端处理器里使用。
- Express/Koa 路由里写 `/api/xxx` → 应用已挂在 `/api` 前缀下，会变成 `/api/api/xxx`。
- 把 SDK 原始错误、上传凭证 URL、运行时凭据直接返回给客户端或写进日志 → 一律在应用层包装、脱敏。
