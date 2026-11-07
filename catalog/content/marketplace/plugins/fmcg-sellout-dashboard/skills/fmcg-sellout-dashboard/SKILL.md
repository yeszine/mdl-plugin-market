---
name: fmcg-sellout-dashboard
description: Query patterns for the store sell-out dashboard connector: coverage, OSA, display execution, visit frequency and sales per store
description_zh: 门店动销看板查询规范：覆盖、有货率、陈列、拜访与单店产出
display_name: 门店动销看板
version: 1.0.0
author: DSH FMCG Index
category: 连接器
---

# 门店动销看板

本技能约束连接器 `fmcg-sellout-dashboard` 的调用方式，用于把门店执行数据转成可落地的铺市与拜访动作。

## 指标口径

| 指标 | 定义 | 常见误用 |
|---|---|---|
| 门店覆盖数 | 周期内有进货记录的门店数 | 与「建档门店数」混用 |
| 活跃门店 | 周期内有实际出货的门店 | 用订单数代替出货 |
| 有货率 OSA | 有可售库存的门店 / 在售门店 | 忽略锁定量 |
| 陈列执行率 | 达标门店 / 应执行门店 | 未区分必陈与选陈 |
| 拜访频次 | 周期内有效拜访次数 | 把打卡当有效拜访 |
| 单店产出 | 出货金额 / 活跃门店数 | 未剔除退货 |

## 调用规范

1. 先定周期、区域、渠道与门店类型，再取指标。
2. 覆盖率与活跃率一起看：覆盖高但活跃低，通常铺市质量有问题。
3. 有货率跌破阈值时，联查订单与库存，区分「没订」和「没送到」。
4. 陈列与拜访数据按门店明细下钻，不做无依据的门店排名。
5. 输出必须带数据截止时间与门店样本量。

## 输出建议

- 区域 / 渠道维度先给汇总，再给 Top 与 Bottom 门店。
- 每个异常门店给一条可执行动作：补货、整改陈列、调整拜访频次或暂停合作。
- 不把相关性直接写成因果；需要归因时说明证据来源。
