# 设计令牌表（html-report 配套）

规划阶段（Step 1）按下表确定令牌，构建阶段所有 CSS 只允许引用 `var(--*)`，禁止在组件样式里写死色值。

## 1. 颜色令牌（7 个语义变量）

| 变量 | 语义 | 浅色主题示例 | 深色主题示例 |
|---|---|---|---|
| `--bg` | 页面背景 | `#ffffff` | `#111418` |
| `--surface` | 卡片/色块背景 | `#f6f7f9` | `#1b2027` |
| `--ink` | 正文主文字 | `#1a1d21` | `#e8eaed` |
| `--muted` | 次要文字/注释 | `#6b7280` | `#9aa4b0` |
| `--rule` | 分隔线/边框 | `#e5e7eb` | `#2c333c` |
| `--accent` | 主强调色（链接/图表主色/关键高亮） | `#2563eb` | `#6ea8fe` |
| `--accent2` | 次强调色（对比系列/引用块） | `#0d9488` | `#4fd1c5` |

约束：
- `--ink` 对 `--bg` 的对比度 ≥ 4.5:1（WCAG AA），`--muted` 对 `--bg` ≥ 3:1。
- 全页主强调色只有 1 个；图表多系列用 `accent`、`accent2`、`muted` 加透明度变体（如 `accent + '99'`）扩展，禁止彩虹色板。

## 2. 字体令牌

| 用途 | 字体栈 |
|---|---|
| 正文/标题 | `-apple-system,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif` |
| 代码/数字/表格 | `"SF Mono","Cascadia Code",Consolas,"Courier New",monospace` |

- 标题层级靠**字号 × 字重 × 留白**区分（如 H1 34/700、H2 26/650、H3 20/600），不引入第二个字体家族。
- 可用 `letter-spacing` 与全大写做小标题装饰，但每份报告最多一种装饰手法。

## 3. 尺寸与节奏

| 令牌 | 建议值 | 说明 |
|---|---|---|
| `--maxw` | 760–960px | 版心最大宽度，居中 |
| 正文字号 | 15–17px | 不得小于 14px |
| 注释字号 | 12–13px | 图注、脚注 |
| 行高 | 1.6–1.8 | 中文长文取高值 |
| 章节间距 | ≥3rem | H2 之前 |
| `--radius` | 8–12px | 卡片圆角，全页统一 |
| 阴影 | `0 1px 3px rgba(0,0,0,.08)` | 至多一级，克制使用 |

## 4. 常用组件片段（示意，按需改写）

```css
/* 指标卡 */
.metric{background:var(--surface);border-radius:var(--radius);padding:1.25rem}
.metric b{display:block;font-size:2rem;color:var(--accent);font-family:monospace}
.metric span{color:var(--muted);font-size:.85rem}

/* 引用/提示块 */
.callout{border-left:4px solid var(--accent2);background:var(--surface);
  padding:1rem 1.25rem;border-radius:0 var(--radius) var(--radius) 0}

/* 表格（必须包滚动容器） */
.table-wrap{overflow:auto;max-height:600px;border:1px solid var(--rule);border-radius:var(--radius)}
table{width:100%;border-collapse:collapse;font-size:.9rem}
th{background:var(--surface);text-align:left;padding:.6rem .9rem;border-bottom:2px solid var(--rule)}
td{padding:.55rem .9rem;border-bottom:1px solid var(--rule)}

/* 图注 */
figure{margin:2rem 0}
figcaption{font-size:.85rem;color:var(--muted);margin-top:.5rem;text-align:center}

/* 响应式：网格坍缩 */
@media (max-width:768px){
  .grid{grid-template-columns:1fr !important}
  main{padding:2rem 1rem}
}

/* 打印 */
@media print{
  .no-print{display:none}
  h2{page-break-before:always}
  a{color:var(--ink);text-decoration:none}
}
```
