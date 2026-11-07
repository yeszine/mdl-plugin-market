---
name: pdf
description: "处理 PDF 文件时使用本技能。覆盖：从 PDF 提取文本与表格、从零生成新 PDF、合并与拆分、页面旋转、加解密、填写 PDF 表单、扫描件 OCR。只要任务涉及批量或以编程方式处理、生成、分析 PDF 文档，都应触发本技能。"
---

# PDF 处理

## 适用场景

- **内容提取**：把 PDF 的正文、表格、元数据抽出来用于分析或喂给下游任务。
- **生成**：把数据、图表、排版好的内容输出为正式 PDF 报告。
- **组装与拆分**：多文件合并、按页拆分、旋转页面、加水印、加解密。
- **表单**：读取表单字段、程序化填写并保存。
- **扫描件**：图像型 PDF 走 OCR 提取文字。

## 技术路线

| 任务 | 推荐工具 |
|------|----------|
| 基础读写（合并/拆分/旋转/加密） | pypdf（Python）；Node 环境用 pdf-lib |
| 文本与表格提取 | pdfplumber（布局与表格识别较好）；PyMuPDF（fitz，速度快） |
| 从零生成排版文档 | reportlab（Python）；Node 环境用 pdf-lib 或 pdfmake |
| 命令行快操 | poppler 工具集（pdftotext / pdfimages）、qpdf |
| 表单填写 | pypdf 读写 AcroForm 字段；pdf-lib 的 `PDFForm` |
| OCR | pdf2image 转图 + pytesseract |

依赖即用即装：`python -m pip install pypdf pdfplumber reportlab`。poppler、qpdf、tesseract 属系统工具，用系统包管理器安装。

## 关键操作要点

### 提取文本与表格

```python
import pdfplumber

with pdfplumber.open("report.pdf") as pdf:
    page = pdf.pages[0]
    print(page.extract_text())          # 带基本布局的文本
    for table in page.extract_tables(): # 表格为二维列表
        for row in table:
            print(row)
```

**长文档检索策略**：不要一次性把整本 PDF 读进上下文。先按页抽成独立文本文件（`pages/page_0001.txt` ……），再用关键词或正则检索命中页，只把命中页（必要时带前后相邻页）作为上下文。命中页首 5 行或末 5 行出现关键词时，把相邻页一并纳入，避免截断语义。检索无结果时再退回顺序通读。

### 合并与拆分

```python
from pypdf import PdfReader, PdfWriter

# 合并
writer = PdfWriter()
for name in ["a.pdf", "b.pdf"]:
    for page in PdfReader(name).pages:
        writer.add_page(page)
with open("merged.pdf", "wb") as f:
    writer.write(f)

# 拆分：逐页输出
for i, page in enumerate(PdfReader("big.pdf").pages):
    w = PdfWriter()
    w.add_page(page)
    with open(f"page_{i+1}.pdf", "wb") as f:
        w.write(f)
```

### 生成 PDF（reportlab）

用 Platypus（文档流）而不是 Canvas 逐坐标绘制，内容可自动分页：

```python
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.colors import HexColor
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer

styles = {
    "h1": ParagraphStyle("h1", fontName="CJK", fontSize=20, leading=26,
                         textColor=HexColor("#1a365d"), spaceBefore=18, spaceAfter=10),
    "body": ParagraphStyle("body", fontName="CJK", fontSize=11, leading=17,
                           spaceAfter=8, wordWrap="CJK"),
}

doc = SimpleDocTemplate("out.pdf", pagesize=A4)
story = [Paragraph("第一章 概览", styles["h1"]),
         Paragraph("正文段落……", styles["body"]),
         Spacer(1, 12)]
doc.build(story)
```

**中文必须注册 CJK 字体**，否则输出方框或报错：

```python
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
import os, platform

candidates = {
    "Windows": ["C:/Windows/Fonts/msyh.ttc", "C:/Windows/Fonts/simsun.ttc"],
    "Darwin": ["/System/Library/Fonts/PingFang.ttc"],
    "Linux": ["/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"],
}[platform.system()]
for path in candidates:
    if os.path.exists(path):
        pdfmetrics.registerFont(TTFont("CJK", path, subfontIndex=0))
        break
```

**分页原则**：让内容自然流动。只在封面后用一个显式 `PageBreak`；标题和段落直接 append，不要包 `KeepTogether`（容易造成半页空白）；图片加图注、小表格可以包；超长表格用 `LongTable` 并设 `repeatRows=1` 让表头跨页重复。

### 表单填写

```python
from pypdf import PdfReader, PdfWriter

reader = PdfReader("form.pdf")
writer = PdfWriter()
writer.append(reader)
writer.update_page_form_field_values(writer.pages[0], {"姓名": "张三", "日期": "2026-10-26"})
with open("filled.pdf", "wb") as f:
    writer.write(f)
```

先用 `reader.get_fields()` 列出字段名与类型再填，字段名以 PDF 内部定义为准，不是页面上看到的标签。部分查看器需要 `NeedAppearances` 标志才能显示填入的值，pypdf 可通过 `writer.set_need_appearances_writer(True)` 设置。

## 常见坑

- **加密/损坏文件**：`PdfReader` 打开失败先检查是否加密（`reader.is_encrypted`，用 `reader.decrypt(pwd)`）；损坏文件可尝试 qpdf 修复：`qpdf --replace-input in.pdf`。
- **提取出的乱码 token**：部分 PDF 字体缺少 ToUnicode 映射，提取结果出现 `(cid:123)` 或方块，这是源文件问题，换一个提取引擎（PyMuPDF）或走 OCR。
- **英文单词粘连**：某些提取模式下空格丢失，表现为超长粘连 token；切换按词提取模式或换库。
- **表格识别失败**：无线框的表格靠文本对齐识别，参数不对会整页识别成一个"表格"；可先 `page.debug_tablefinder()` 看识别结果再调 `table_settings`。
- **reportlab 中文断行**：段落样式必须设 `wordWrap="CJK"`，否则中文按西文规则断行导致溢出。
- **图表中文乱码**：matplotlib 生成插图前要设中文字体（如 `plt.rcParams["font.sans-serif"] = ["Microsoft YaHei"]` 并 `axes.unicode_minus = False`），否则标签变方框、负号变方块。
- **过度分页**：每章前都插 `PageBreak` 会产生大量半空白页；只保留封面后的那一个。
- **表单字段名陷阱**：同名字段在多个页面会联动填充；不需要联动时先展平（flatten）或逐字段处理。
- **扫描件当文本件**：图像型 PDF 提取出来是空白，先抽一页看有无文本再决定是否走 OCR，别浪费时间调参数。

## 交付前校验

- [ ] **页数与顺序**：合并/拆分后核对页数等于各来源之和、页面顺序正确；随机抽 3 页目视确认。
- [ ] **可打开**：用至少一个主流查看器（或浏览器）打开无报错；文件头为 `%PDF`、非零字节。
- [ ] **文本可提取**：生成的 PDF 用 pdftotext 或 pdfplumber 回读，确认文字可选中可复制（而非图片），中文无乱码。
- [ ] **表格还原度**：提取场景抽查 2-3 个表格，与原文逐格对照数字与表头。
- [ ] **表单回读**：填表后重新打开读取字段值，与预期一致；在查看器里确认可见。
- [ ] **分页观感**：生成的 PDF 无大面积空白页、无孤行标题（标题独占一页底部）。
