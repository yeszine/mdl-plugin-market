---
name: html-report
description: 创建除幻灯片以外的各类自包含 HTML 交付物——研究报告、白皮书、PRD、经营/数据仪表盘、作品集、简历、邮件模板、数据可视化长页等。当用户需要一份"设计精良、浏览器直接打开、跨平台像素级一致"的 HTML 页面时使用本技能。最终交付物是单一 .html 文件：CSS/JS 全部内联，零外部依赖或仅依赖公共 CDN。
---

# html-report：自包含 HTML 交付物

## 一、何时使用 / 何时不用

**使用**：用户要"报告、白皮书、PRD、dashboard、仪表盘、简历、作品集、邮件模板、可视化页面、HTML 页面"等非幻灯片类视觉交付物。

**不用**：
- 用户要演示文稿 / slides / deck → 交给 html-deck。
- 用户明确要 `.pptx` / `.docx` / `.xlsx` 文件 → 交给对应办公文档技能。
- 纯 Markdown 文档、无视觉设计要求 → 直接写 Markdown，不要用本技能。

## 二、交付物硬性约束（自包含单文件）

1. **最终产物是一个 `.html` 文件**，双击即可在任何现代浏览器（Chrome / Edge / Firefox / Safari）中打开，不依赖宿主环境的任何专有工具或运行时。
2. **全部样式写在 `<style>` 标签内，全部脚本写在 `<script>` 标签内**。禁止引用本地相对路径文件（`./assets/x.png`、`./lib/x.js`、`file:///...`）。
3. **外部依赖二选一**：
   - 首选：**零依赖**——纯 HTML + CSS + 手写 SVG + 原生 JS，离线可用；
   - 次选：**仅公共 CDN**（如 echarts、chart.js 的知名 CDN 地址）。凡走 CDN 的资源必须保证"加载失败时正文内容仍完整可读"，图表区域降级为静态表格或文字摘要。
4. **图片**：优先内联 SVG 插画/图标；位图仅在必要时使用，压缩后以 base64 内联（单图建议 < 150KB，总体积控制在 1MB 内）。禁止在生成图里依赖文字（生成文字易乱码），文字一律用 HTML 元素叠加。
5. **字体**：只使用系统字体栈（见设计规范），不嵌入字体文件、不加载网络字体，保证跨平台像素级一致。
6. 页面根字号、颜色、间距全部由 CSS 变量驱动，便于整体换肤。

## 三、工作流（按顺序执行）

### Step 1：规划（写 HTML 之前必须完成）

即使不落地成文件，也必须在推理中明确以下每一项：

- **元信息**：交付物类型 / 主题 / 目标读者 / 语言（与用户输入语言一致）。
- **设计令牌**：配色 7 变量、字体栈、字号层级、行高、最大页宽、圆角与阴影规格（详见 `references/design-tokens.md`）。
- **页面结构**：章节清单（H2 = 章，H3 = 节），每章一句话概括。
- **视觉清单**：每张图/图表一行——类型（柱/线/饼/流程图/插画）、用途、实现方式（内联 SVG / CDN 图表库 / base64 图）。
- **视觉性格一句话**：例如"暖色杂志风、大量留白、衬线标题"或"冷峻技术文档风、等宽点缀、紧凑排版"。

### Step 2：撰写正文

- 语言与用户输入完全一致；论点有数据或例证支撑；每段都推进论证，不注水。
- 重点强调二选一并全文统一：`<strong>` 加粗（正式/学术风）或 `<mark class="key">` 主题色高亮（现代/视觉风），后者配 CSS：`mark.key{background:none;color:var(--accent);font-weight:600}`。

### Step 3：构建 HTML

骨架示例（自行按需扩展，不要照抄成固定模板）：

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>报告标题</title>
<style>
  :root{
    --bg:#ffffff; --surface:#f6f7f9; --ink:#1a1d21; --muted:#6b7280;
    --rule:#e5e7eb; --accent:#2563eb; --accent2:#0d9488;
    --radius:10px; --maxw:880px;
  }
  *{margin:0;box-sizing:border-box}
  body{background:var(--bg);color:var(--ink);
    font:16px/1.75 -apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
  main{max-width:var(--maxw);margin:0 auto;padding:3rem 1.5rem}
  /* …组件样式全部用 var(--*) 引用，不写死色值… */
</style>
</head>
<body><main>
  <!-- 封面头 / 章节 / 图表 / 表格 / 来源 -->
</main>
<script>/* 交互与图表初始化，全部内联 */</script>
</body>
</html>
```

**图表规则**：
- 每个图表必须有可见标题（`<figure><figcaption>` 或前置小标题），不允许无题图表。
- 简单图形（迷你趋势条、进度环、≤3 个数据点的示意）→ 手写内联 SVG，颜色用 `var(--accent)` 等变量。
- 数据图表（柱/线/饼/雷达/热力等，>3 个数据点或需要坐标轴图例）→ 用 CDN 引入的图表库渲染，颜色从 `getComputedStyle` 读 CSS 变量，不用库默认色板、不用彩虹色图；加 `resize` 监听保证自适应。
- 流程/架构图 → 优先手写 SVG；复杂图可用 CDN 版 mermaid，并在加载失败处留文字说明。

**引用来源（有外部证据时）**：正文用上标 `<sup><a href="#cite-1">[1]</a></sup>`，页脚用 `<ol>` 列来源，每条 `<li id="cite-N">` 带可点击链接；长 URL 加 `word-break:break-all` 防溢出。

### Step 4：自检并交付

逐项过 `references/checklist.md`，全部通过后告知用户：文件路径、打开方式、（如用了 CDN）"离线时图表降级为表格"的说明。**不要**私自起本地服务器或替用户打开浏览器。

## 四、设计规范速记

- **配色**：7 个语义变量（`--bg` 背景 / `--surface` 卡片 / `--ink` 正文 / `--muted` 次要 / `--rule` 分隔线 / `--accent` 主强调 / `--accent2` 次强调），正文与背景对比度 ≥ 4.5:1（WCAG AA）。完整令牌表见 `references/design-tokens.md`。
- **字体**：只用系统字体栈；中文正文 `"PingFang SC","Microsoft YaHei",sans-serif`，代码/数字用等宽栈。层级靠字号+字重+留白区分，不换字体家族。
- **留白与版心**：版心 760–960px 居中，章节间距 ≥ 3rem，正文行高 1.6–1.8，正文字号 ≥ 15px、注释 ≥ 12px。
- **响应式**：多列网格在 ≤768px 一律坍缩为单列；表格必须包 `.table-wrap{overflow:auto;max-height:600px}`，4 列以上表格禁止放进多列布局；图片 `max-width:100%`。
- **打印**：提供 `@media print`——隐藏交互控件、章节前 `page-break-before`、图表保持宽高比。

## 五、参考文件

| 文件 | 何时加载 |
|---|---|
| `references/design-tokens.md` | Step 1 定设计系统时：完整令牌表 + 常用组件样式片段 |
| `references/checklist.md` | Step 4 交付前：逐项检查清单 |
