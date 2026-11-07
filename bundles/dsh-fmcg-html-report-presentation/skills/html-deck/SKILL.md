---
name: html-deck
description: 从零创建动画丰富、视觉讲究的 HTML 幻灯片。当用户说"演示文稿 / presentation / slides / deck"而未明确要求 PPT 文件时使用；用户明确说"PPT / ppt / .pptx"时，改用 pptx 类办公文档技能交付真正的 PowerPoint 文件。本技能产出单一自包含 .html 文件——CSS/JS 全部内联、零外部依赖或仅公共 CDN，任意现代浏览器打开即可全屏放映，跨平台像素级一致。
---

# html-deck：自包含 HTML 幻灯片

## 一、路由规则（先判断，再动手）

| 用户说 | 交付 |
|---|---|
| "做个演示文稿 / slides / deck / 讲稿配套页" | 本技能 → 单一 `.html` |
| "做个 PPT / ppt / PowerPoint / 要 .pptx 文件" | **停**，改用 pptx 类技能 |
| "把这份 Markdown/文档做成幻灯片" | 本技能（无既有 .pptx 参与） |

## 二、交付物硬性约束（自包含单文件）

1. 最终产物是**一个 `.html` 文件**，双击即可放映；不依赖宿主环境专有工具。
2. 全部 CSS 内联于 `<style>`、全部 JS 内联于 `<script>`；禁止本地相对路径与 `file:///` 引用。
3. 外部依赖：首选零依赖（原生 JS 实现翻页与动画）；数据图表确需图表库时仅走公共 CDN，且加载失败时该页降级为静态表格/要点列表。
4. 图片：优先内联 SVG；位图压缩后 base64 内联（单图 < 150KB，整文件建议 < 2MB）。图中不要依赖生成的文字。
5. 字体只用系统字体栈；颜色、字号、间距全部由 CSS 变量驱动。
6. 逻辑画布固定 **1920×1080**，用 `transform: scale()` 适配任意窗口，保证"跨平台像素级一致"。

## 三、工作流（5 步，未完成 1–3 步不得写 HTML）

### Step 1：内容规划——叙事弧线表

每行 = 一页幻灯片，规划期就锁定版式与动画：

```
| # | 标题 | 角色 | 内容要点 | 视觉 | 版式 | 动画 |
|---|------|------|----------|------|------|------|
| 1 | … | 封面 | 主标题+副标语 | 无 | cover | blur-in |
| 2 | 议程 | 目录 | 4 个章节 | 无 | toc | stagger |
| 3 | … | 章节页 | 第一章分隔 | 无 | section | rise-in |
| 4 | … | 正文 | 3 个关键数据 | 柱状图 | chart-bar | fade-up |
| … | | | | | | |
| N | 谢谢 | 结尾 | 一句收束语 | 无 | thanks | — |
```

规划铁律：
- **一页一个核心信息**；一句话概括不出就拆页。
- **固定开销**：封面 1 + 目录 1 + 结尾 1 = 至少 3 页，正文另计。
- **封面/结尾必须极简**：封面只放标题、副标题、演讲者、日期（可选）；结尾只放一句收束语。禁止在封面堆 KPI 卡片、在结尾堆功能列表。
- **正文 ≥ 6 页时必须插章节分隔页**，帮助观众跟上结构；分隔页计入总页数。
- 只看每页标题应能串出完整故事线。
- 每页动画 ≤ 2 种，默认 `fade-up`，戏剧性效果点到为止。

### Step 2：选主题

按受众定基调，全套视觉只用 CSS 变量表达（令牌表见 `references/layouts-and-themes.md`）：

- 技术/工程师 → 深色低亮度底 + 高亮强调色（如深蓝黑 + 青绿）
- 管理层/正式汇报 → 白/浅灰底 + 藏青或深灰强调，衬线标题可选
- 产品发布/路演 → 深色底 + 高饱和强调色 + 大图
- 消费/品牌 → 暖色或马卡龙浅色底
- 学术/培训 → 纸感浅色底 + 学者蓝绿

避免千篇一律的"AI 味"：不用烂大街的紫渐变白底、不堆同质化卡片网格；不同任务之间主动变换明暗方向、字重节奏与装饰母题。

### Step 3：素材获取

- 视觉清单逐条落实：内联 SVG 图标/示意图优先；确需位图时压缩后 base64。
- 数据图表：CDN 图表库（SVG 渲染以保证清晰）或手写 SVG；配色从 CSS 变量读取。
- 每张图对应清单里的一行，不把多图合并成一张。

### Step 4：构建 HTML

页面骨架（自研最小实现，可按需扩展）：

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>演示标题</title>
<style>
:root{ --bg:#0f1420; --ink:#eef1f6; --muted:#97a1b3;
       --accent:#3fd0c9; --accent2:#f2c14e; }
*{margin:0;box-sizing:border-box}
body{background:#000;overflow:hidden;font-family:-apple-system,"Segoe UI",
  "PingFang SC","Microsoft YaHei",sans-serif;color:var(--ink)}
#stage{position:fixed;top:50%;left:50%;width:1920px;height:1080px;
  transform-origin:center;background:var(--bg)}
.slide{position:absolute;inset:0;display:none;padding:96px 120px}
.slide.active{display:flex;flex-direction:column;justify-content:center}
.notes{display:none}          /* 演讲者备注，不上屏 */
[data-anim]{animation:fade-up .7s ease both}
@keyframes fade-up{from{opacity:0;transform:translateY(28px)}to{opacity:1}}
</style>
</head>
<body>
<div id="stage">
  <section class="slide active" data-label="封面">
    <h1>主标题</h1><p>副标语</p>
    <div class="notes">开场 30 秒：自我介绍 + 一句话点题。</div>
  </section>
  <!-- 更多 .slide … -->
</div>
<script>
(function(){
  var slides=[].slice.call(document.querySelectorAll('.slide')), i=0;
  var stage=document.getElementById('stage');
  function fit(){var s=Math.min(innerWidth/1920,innerHeight/1080);
    stage.style.transform='translate(-50%,-50%) scale('+s+')';}
  function show(n){i=Math.max(0,Math.min(slides.length-1,n));
    slides.forEach(function(s,k){s.classList.toggle('active',k===i);});}
  addEventListener('keydown',function(e){
    if(['ArrowRight',' ','Enter','PageDown'].indexOf(e.key)>-1) show(i+1);
    if(['ArrowLeft','PageUp'].indexOf(e.key)>-1) show(i-1);
    if(e.key==='f'||e.key==='F11'){e.preventDefault();
      document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen();}
  });
  addEventListener('resize',fit); fit(); show(0);
})();
</script>
</body>
</html>
```

构建规则：
- 每页是一个 `<section class="slide" data-label="页面标题">`，`data-label` 必填，便于结构识别。
- 演讲者备注放进 `.notes`，**讲者提示文字绝不上屏**。
- 版式从速查表选取组合（`references/layouts-and-themes.md`），不要每页重造结构。
- 动画用 `data-anim` + CSS `@keyframes` 实现；最多每页 2 种。
- 图表初始化用 SVG 渲染模式并加 `resize` 监听；重设画布后图表需随 `fit()` 刷新。

### Step 5：交付

不启动本地服务器、不替用户打开浏览器。告知用户：
- 文件绝对路径与入口文件名；
- 键盘操作：`→` / `空格` / `Enter` 下一页，`←` 上一页，`F` 或 `F11` 全屏；
- 建议全屏放映体验最佳；若用了 CDN，说明断网降级行为。

## 四、设计规范速记

- **配色**：`--bg / --ink / --muted / --accent / --accent2` 五变量起步，正文对比度 ≥ 4.5:1；深色底放映厅可视性优先。
- **字体**：系统字体栈；标题 64–120px、页标题 44–56px、正文 ≥ 28px（投影距离阅读），单页文字宁少勿多。
- **留白**：页边距 ≥ 5% 画布宽；元素分组之间留白大于组内留白。
- **响应式**：画布固定 1920×1080 + 整体缩放，不做流式重排；保证任意窗口等比显示、不变形。

## 五、参考文件

| 文件 | 何时加载 |
|---|---|
| `references/layouts-and-themes.md` | Step 1–2：版式目录、动画名录、主题令牌速查 |
| `references/checklist.md` | Step 5 前：交付前逐项检查 |
