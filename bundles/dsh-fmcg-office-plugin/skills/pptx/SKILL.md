---
name: pptx
description: "处理演示文稿（.pptx 文件）时使用本技能。覆盖：从零创建新演示文稿；在既有模板上修改内容；使用与调整版式（layout）；添加批注与演讲者备注；提取幻灯片文本用于分析。只要任务的核心交付物是 PowerPoint 文件，或需要对 .pptx 做读写操作，都应触发本技能。"
---

# PPTX 演示文稿处理

## 适用场景

- **从零创建**：根据主题生成结构完整、排版规范的演示文稿。
- **模板编辑**：在用户提供的模板上替换内容，保持原设计风格。
- **版式操作**：增删幻灯片、切换 layout、调整占位符内容。
- **批注与备注**：给指定幻灯片加批注，或为每页撰写演讲者备注。
- **内容提取**：抽出全部文字用于审阅、翻译或归档。

## 技术路线

| 任务 | 推荐路线 |
|------|----------|
| 创建 / 编辑 / 备注 / 版式 | python-pptx（Python） |
| Node.js 环境从零生成 | pptxgenjs |
| 文本提取 | python-pptx 遍历 shape；或 markitdown 类工具 |
| 批注（comments） | python-pptx 支持有限，需直接操作 OOXML（pptx 同样是 ZIP 包） |
| 版式渲染核对 | LibreOffice 转 PDF/图片后目视检查 |

依赖即用即装：`python -m pip install python-pptx` 或 `npm install pptxgenjs`。

## 关键操作要点

### 用 python-pptx 创建与编辑

```python
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor

prs = Presentation()
prs.slide_width = Inches(13.333)   # 16:9
prs.slide_height = Inches(7.5)

# 用版式（layout）添加幻灯片，而不是手摆文本框
title_layout = prs.slide_layouts[0]   # 封面版式
slide = prs.slides.add_slide(title_layout)
slide.shapes.title.text = "2026 年度经营回顾"
slide.placeholders[1].text = "市场部"

# 内容页
body_layout = prs.slide_layouts[1]    # 标题+正文版式
s2 = prs.slides.add_slide(body_layout)
s2.shapes.title.text = "核心结论"
body = s2.placeholders[1].text_frame
body.text = "营收同比增长 12%"
body.add_paragraph().text = "毛利率稳定在 34%"

prs.save("review.pptx")
```

编辑既有文件时 `Presentation("template.pptx")` 打开后直接在原对象上改，母版、主题、版式都会保留。

### 版式（layout）使用原则

- **优先用版式占位符**：`slide.placeholders` 里的标题、正文、图片占位符继承了母版的位置与样式，比手动摆文本框更稳、风格更统一。
- **选版式先看母版**：`for i, layout in enumerate(prs.slide_layouts): print(i, layout.name)` 列出可用版式再选。
- **增删幻灯片**：新增用 `slides.add_slide(layout)`；删除需操作内部 XML 元素（`prs.slides._sldIdLst`），删除后注意清理孤立的 slide part。

### 演讲者备注

```python
slide = prs.slides[0]
notes = slide.notes_slide           # 不存在时自动创建
notes.notes_text_frame.text = "开场 30 秒：先抛出本季度最关键的一个数字。"
```

每页备注写"讲什么、怎么过渡"，不是把页面文字再抄一遍。

### 批注

批注（comments）存储在 `ppt/comments/` 下的独立 XML 部件中，需要：在对应 slide 的 rels 里登记关系、`[Content_Types].xml` 里声明类型、批注 XML 里写好作者与文本。直接操作 OOXML 时按此三处配套修改，缺一不可，否则 PowerPoint 打开会报修复。

### 从零生成的版式纪律（python-pptx 与 pptxgenjs 通用）

- **先定画布常量再摆元素**：把幻灯片宽高、页边距、内容区宽高定义为常量，所有元素坐标基于常量计算，保证不越界。
- **必备结构**：封面 → 目录 → 按目录顺序的内容页 → 结尾页。不允许出现只有背景没有任何元素的空白页。
- **每页至少一个视觉元素**：图表、图片、色块、图标任选，纯文字页观感最差。
- **设计统一**：一套配色（1 主色 + 1-2 辅助色 + 1 强调色）、两种字体（标题/正文）贯穿全稿；标题建议用衬线字体（中文如宋体系、西文如 Georgia）。
- **文本防溢出**：文本框给足高度并开启自动缩排（python-pptx 的 `text_frame.word_wrap = True` 配合固定框高；pptxgenjs 的 `fit: "shrink"`）；长文本拆页而不是塞进一页。
- **图表与配图配色一致**：用 matplotlib 等外部工具生成插图时，把演示文稿的色板定义为常量传入绘图脚本，避免两套色系。插图涉及中文时先配置 matplotlib 中文字体。

### 文本提取（QA 用）

```python
from pptx import Presentation

prs = Presentation("out.pptx")
for i, slide in enumerate(prs.slides, 1):
    for shape in slide.shapes:
        if shape.has_text_frame:
            for para in shape.text_frame.paragraphs:
                text = "".join(run.text for run in para.runs)
                if text.strip():
                    print(f"[{i}] {text}")
```

## 常见坑

- **占位符索引想当然**：不同版式的占位符编号不同，写代码前先打印 `[(ph.placeholder_format.idx, ph.name) for ph in slide.placeholders]` 确认。
- **标题丢失**：直接往 slide 上加文本框而不是用 title 占位符，大纲视图里看不到标题，导航与可访问性都受影响。
- **改完版式没刷新**：切换 `slide.slide_layout` 只换版式引用，已有元素位置不变，可能需要重新摆放。
- **图片变形**：插入图片只设 `width` 或只设 `height`，让另一边按比例自动算；两边都写死会拉伸变形。
- **单位混淆**：python-pptx 用 EMU，务必用 `Inches()` / `Pt()` / `Cm()` 构造，不要直接传裸数字。
- **字体只设西文**：中文 run 需要单独指定东亚字体（操作 run 的 `rPr` 里 `ea` 字体），否则跨机器可能变默认字体。
- **超链接/媒体残留**：删除含媒体或链接的幻灯片时只删了 sldIdLst，遗留 part 会让文件变大甚至打不开。
- **备注当正文**：用户要"备注"时写进了页面正文，或要"批注"时写进了备注——两者是不同功能，交付前确认需求。

## 交付前校验

- [ ] **能正常打开**：用 PowerPoint 或 LibreOffice 打开无修复提示；转成 PDF 或缩略图目视过一遍每一页。
- [ ] **无空白页、无溢出**：逐页检查没有空幻灯片；文本没有超出文本框或被裁切；元素没有越出画布。
- [ ] **结构完整**：封面、目录、内容页顺序与目录一致、有结尾页；标题均在标题占位符中。
- [ ] **内容正确**：提取全文通读，无错别字、无模板残留的占位文字（如 "Click to add title"）、数据与来源一致。
- [ ] **模板一致性**：编辑场景抽查未改动页面与改动页面的字体、配色、页脚是否协调。
- [ ] **备注与批注在位**：逐页确认演讲者备注已写入且对应正确页；批注显示在目标幻灯片的目标元素上，作者与日期正确。
- [ ] **字体兼容**：含中文时在目标播放环境（或转 PDF）确认无缺字方框；非常用字体提醒用户嵌入或替换。
