---
name: xlsx
description: "当任务的主要输入或产出是电子表格文件（.xlsx / .xlsm / .csv / .tsv）时使用本技能。典型场景：读取或修改现有表格（增删列、写公式、调格式、做图表）、从零创建新工作簿、清洗结构混乱的表格数据（表头错位、垃圾行、合并单元格残留）、在表格类文件格式之间互转。即使用户只是随口提到某个表格文件并要求处理它，也应触发本技能。最终交付物必须是真实的表格文件——若交付物是 Word 文档、HTML 报告或独立脚本，即使过程中处理了表格数据也不要触发。"
---

# XLSX 电子表格处理

## 适用场景

- **读取与分析**：汇总现有工作簿的数据、多 sheet 合并、统计与透视。
- **新建工作簿**：从数据源（CSV、数据库导出、用户提供的数据）生成带格式、公式、图表的成品表格。
- **编辑现有文件**：追加行列、更新公式、套用既有模板风格。修改模板时必须沿用原文件的格式约定，不要强推新样式。
- **数据清洗**：把错位表头、空行、混入说明文字的数据区整理成规范表格。

## 技术路线

| 任务 | 推荐库 | 说明 |
|------|--------|------|
| 数据分析、批量读写 | pandas（Python） | `read_excel` / `to_excel`，大文件用 `usecols` 限定列 |
| 公式、样式、图表、模板编辑 | openpyxl（Python） | 保留原文件结构的唯一实用选择 |
| Node.js 环境 | ExcelJS | 支持流式写大文件、样式与公式 |
| 公式重算 | LibreOffice（headless） | 程序库只写公式不计算，需用 `soffice` 重算后才能看到值 |

依赖按需安装、即用即装：`python -m pip install openpyxl pandas` 或 `npm install exceljs`。不要一次性预装全部依赖。

## 关键操作要点

### 动手前先出方案

写代码之前，先读完全部输入文件，然后输出一份简短方案：sheet 数量与命名、每个 sheet 的字段与取值来源（原始数据 / 公式 / 查找）、表头与数据区样式。输入不完整时在方案里写明假设。

### 公式优先，禁止硬编码计算结果

在 Python 里算好结果再写死进单元格是最常见的错误。应写入 Excel 公式，让表格在源数据变化时可自动重算：

```python
from openpyxl import Workbook

wb = Workbook()
ws = wb.active
ws.append(["月份", "销售额", "累计"])
ws.append(["1月", 120, "=B2"])
ws.append(["2月", 135, "=C2+B3"])

# 正确：写公式字符串
ws["B5"] = "=SUM(B2:B3)"
# 错误：ws["B5"] = 255  ← 数据更新后不会跟随

wb.save("report.xlsx")
```

### 公式重算

openpyxl 只把公式存为字符串，缓存的计算值为空。交付含公式的文件前必须重算，否则用户打开前很多读取工具（包括 `data_only=True` 的 openpyxl）会读到 None。通用做法：

```bash
soffice --headless --convert-to xlsx --outdir recalc_tmp report.xlsx
```

再用重算后的文件替换交付。没有 LibreOffice 时，至少用公式求值库（如 formulas）或手工抽查方式确认公式无误。

### 样式规范（新建表格默认遵守）

- 字体统一（如 Arial / 微软雅黑），全簿一致。
- 数据区做斑马纹：相邻行交替使用 `#FFFFFF` 与低对比度浅色（如 `#F7F9FC`），表头与合计行不参与。
- 边框宁轻勿重：外框 + 行间细分隔线（如 `#D9DEE7`），合计行用加粗或上边框强调，不要给每个单元格套粗框。
- 财务模型的行业惯例：蓝色字 = 手工输入的假设；黑色字 = 公式；绿色字 = 跨 sheet 引用；负数用括号 `(123)` 表示；年份按文本存（避免显示成 2,024）；表头必须带单位（如「收入（百万元）」）。

### 图表

openpyxl 可直接生成原生图表（用户可在 Excel 里继续编辑），优先于贴图片：

```python
from openpyxl.chart import BarChart, Reference

chart = BarChart()
chart.title = "月度销售额"
data = Reference(ws, min_col=2, min_row=1, max_row=13)  # 含表头
cats = Reference(ws, min_col=1, min_row=2, max_row=13)
chart.add_data(data, titles_from_data=True)
chart.set_categories(cats)
ws.add_chart(chart, "E2")
```

## 常见坑

- **索引错位**：openpyxl 行号从 1 开始且有表头偏移；pandas 的 DataFrame 第 5 行对应 Excel 第 7 行（1 行表头 + 0 基索引）。写完抽查 2-3 个单元格对照。
- **`data_only=True` 陷阱**：用它读公式缓存值很方便，但一旦以该模式保存，所有公式被永久替换为静态值。读和写要分开打开文件。
- **NaN 与空值**：pandas 读入的空单元格是 NaN，直接写回会变成 `nan` 字符串，写入前用 `pd.notna()` 判断。
- **除零与坏引用**：写 `/` 公式前确认分母不为零列；插入/删除行列后既有引用可能变成 `#REF!`，改结构后要全簿扫一遍错误值。
- **跨 sheet 引用格式**：`Sheet1!A1`，sheet 名含空格或特殊字符时要加单引号 `'明细表'!A1`。
- **大文件性能**：超过几十万行时，openpyxl 用 `read_only=True` 读、`write_only=True` 写，pandas 用 `usecols` 只取需要的列。
- **合并单元格**：清洗来的源文件常有合并单元格，读取时只有左上角有值；拆解后再处理。
- **CSV 编码**：中文 CSV 常见 GBK/GB18030 编码，pandas 需显式 `encoding="gbk"`，否则乱码。

## 交付前校验

- [ ] **零公式错误**：重算后全簿扫描，不得出现 `#REF!`、`#DIV/0!`、`#VALUE!`、`#N/A`、`#NAME?`。
- [ ] **公式抽查**：随机取 2-3 个公式单元格，手工核对其引用的源单元格与结果。
- [ ] **交付物是真实表格文件**：用 Excel 或 LibreOffice 实际打开一次确认无损坏提示；不得用 Markdown 表格或截图冒充。
- [ ] **模板一致性**：修改既有文件时，抽查新旧区域的字号、边框、数字格式是否一致。
- [ ] **数据完整性**：行数、合计与源数据对得上；清洗场景要说明丢弃/修正了哪些行。
- [ ] **硬编码值有出处**：必须写死的数字（假设、外部数据）在相邻单元格或批注里注明来源与日期。
