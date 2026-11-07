---
name: docx
description: "处理 .docx 专业文档时使用本技能。覆盖：从零创建新文档；修改既有文档内容且保留原有格式；生成或处理修订（tracked changes）；添加批注；从文档中提取纯文本或结构化内容。只要任务的核心交付物是 Word 文档，或对 Word 文档做任何读写操作，都应触发本技能。"
---

# DOCX 文档处理

## 适用场景

- **新建文档**：报告、合同、说明书等，要求排版规范、可直接交付。
- **编辑既有文档**：改文字、插段落、换图片，同时保留原文件的样式、页眉页脚、编号体系。
- **修订模式**：以 tracked changes 形式提交修改，让审阅者逐条接受或拒绝。
- **批注**：在指定文字上挂评论与回复。
- **内容提取**：把文档转成纯文本或 Markdown 供分析。

## 技术路线

.docx 本质是一个 ZIP 包，内部是 OOXML（`word/document.xml` 等）。按任务选路线：

| 任务 | 推荐路线 |
|------|----------|
| 提取文本 | pandoc（`pandoc file.docx -o out.md`）或直接解包读 XML |
| 新建 / 常规编辑 | python-docx（Python）或 docx（npm 包，Node.js） |
| 修订、批注、精细格式手术 | 解包 → 直接编辑 XML → 重新打包 |
| 旧版 .doc 转换 | 先用 LibreOffice 转格式：`soffice --headless --convert-to docx in.doc` |

依赖即用即装：`python -m pip install python-docx` 或 `npm install docx`。pandoc、LibreOffice 属系统级工具，用当前系统的包管理器安装。

## 关键操作要点

### 用 python-docx 新建与编辑

```python
from docx import Document
from docx.shared import Pt, RGBColor

doc = Document()
doc.add_heading("季度经营回顾", level=1)

p = doc.add_paragraph()
run = p.add_run("本季度营收 ")
run.bold = True
p.add_run("同比增长 12%。")

# 表格
table = doc.add_table(rows=2, cols=2)
table.style = "Light Grid Accent 1"
table.cell(0, 0).text = "指标"
table.cell(1, 0).text = "营收（百万元）"

doc.save("report.docx")
```

编辑既有文件时 `Document("existing.docx")` 打开，原样式与节设置会保留；只改你要改的部分，不要重建全文。

### CJK 字体

中文内容必须为东亚字符单独指定字体，否则在部分机器上显示为方框。python-docx 中需要同时设 `ascii` 与 `eastAsia`：

```python
from docx.oxml.ns import qn

style = doc.styles["Normal"]
style.font.name = "Arial"
style.font.size = Pt(12)
style.element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft YaHei")
```

跨平台优先选 Microsoft YaHei（Windows/Office 普遍可用）；Linux 环境可用 Noto Sans CJK SC。

### 修订与批注（直接操作 XML）

python-docx 不支持修订与批注，需解包后编辑 `word/document.xml`，再打包。流程：

1. 解包：`python -c "import zipfile; zipfile.ZipFile('in.docx').extractall('unpacked')"`（或任何解压工具）。
2. 编辑 `unpacked/word/document.xml`，按 OOXML 规则插入修订/批注标记。
3. 重新打包为 ZIP（保持 `[Content_Types].xml` 在根目录的原始结构），改后缀为 .docx。

**插入修订**（新增内容包在 `w:ins`、删除内容包在 `w:del`，且删除的正文要用 `w:delText` 而不是 `w:t`）：

```xml
<w:p>
  <w:r><w:t>账期为 </w:t></w:r>
  <w:del w:id="1" w:author="助手" w:date="2026-10-26T00:00:00Z">
    <w:r><w:delText>30</w:delText></w:r>
  </w:del>
  <w:ins w:id="2" w:author="助手" w:date="2026-10-26T00:00:00Z">
    <w:r><w:t>60</w:t></w:r>
  </w:ins>
  <w:r><w:t> 天。</w:t></w:r>
</w:p>
```

要点：只标记真正变化的部分（最小化修订）；沿用原 run 的 `w:rPr` 以保留加粗、字号等格式；整段删除时还要在段落的 `w:pPr/w:rPr` 里加 `<w:del/>` 标记段落符号，否则接受修订后会留下空段。

**批注**需要在三处配合：`word/comments.xml` 里登记批注正文，`document.xml` 里用 `w:commentRangeStart` / `w:commentRangeEnd` 圈出锚点范围（它们是 `w:p` 的直接子节点，绝不能塞进 `w:r` 内部），再用带 `CommentReference` 样式的 run 引用批注 id。

## 常见坑

- **重建全文导致格式丢失**：编辑既有文档时最忌"读出来再重新生成"，页眉、节、编号、样式都会变。始终在原文档对象或原 XML 上做最小修改。
- **段落内换行**：OOXML 里 `\n` 不是段落分隔。新起一行要么新建段落，要么用显式换行元素（python-docx 的 `run.add_break()`）。
- **手工插入项目符号**：不要往文本里写 `•` 字符冒充列表，要用编号定义（python-docx 用 `List Bullet` 样式；Node 的 docx 库用 numbering 配置），否则缩进与对齐不可控。
- **CJK 字体只设一半**：只设 `font.name` 不设 `eastAsia`，中文会回落到默认字体。
- **XML 转义**：直接编辑 XML 时，`&` `<` `>` 必须写成实体；弯引号在 XML 里可用 `&#x201C;` 等实体保留。但在 Node 的 docx 库里则相反——它接收的是普通 JS 字符串，写 XML 实体会原样显示成垃圾字符。
- **空 section 产生空白页**：Node 的 docx 库中每个 section 至少渲染一页，全部内容放进单个 section，用分页符分页。
- **表格跨页断裂**：长表格的行可能被切到两页之间，需要时在行属性上禁止拆分（python-docx 可操作 `trPr` 的 `cantSplit`）。
- **图片关系缺失**：手工往 XML 加图片时，图片文件、`document.xml.rels` 关系、`[Content_Types].xml` 类型声明三处缺一都会导致 Word 报损坏。

## 交付前校验

- [ ] **能正常打开**：用 Word 或 LibreOffice 实际打开一次，无"内容有问题"修复提示；有提示说明 XML 结构或关系损坏，必须修复。
- [ ] **格式保留**：编辑场景抽查未改动的段落、页眉页脚、表格样式与原文一致。
- [ ] **修订可用**：交付修订稿时，在 Word 里切换"显示标记/无标记"两种视图各看一遍，接受全部修订后无空段、无残留。
- [ ] **批注锚点正确**：每条批注高亮的文字范围与评论内容对应，回复正确嵌套。
- [ ] **文本提取核对**：用 pandoc 或解包方式提取全文，检查无缺段、无乱码、标题层级正确。
- [ ] **中文显示**：含中文时在目标环境（或 LibreOffice 转 PDF）确认无缺字方框。
