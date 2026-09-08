---
description: "Peck 计量模型推理的跨语言收据 Schema、规范序列化与签名验证：证明一次付费模型调用花了多少，面向通过 BSV 支付通道结算推理的部署。"
kind: "package-reference"
---

# @deepseek-ai/dsh-session-metered-receipt

[English](README.md) | 中文

## 概述

`@deepseek-ai/dsh-session-metered-receipt` 是 Peck 计量模型推理的收据契约：它为经由 `llm.peck.to` 后端 BSV / BRC-104 支付通道提供资金的推理调用定义标准收据规范与加密验证工具。收据字节刻意保持规范——TypeScript 适配器、Go `llm-gateway` 与 sCrypt 结算合约共享同一 ASCII 序列化——因此任何一方签名的收据在各方都能验证。本包注册 `meteredReceipts` 会话投影，在日志上聚合已验证的签名收据与累计聪计费，供计费面读取。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当部署通过 Peck 支付通道结算模型推理开销时挂载本插件。它注册 `meteredReceipts` 投影，并导出每次付费请求中推理路径调用的 schema、规范化与验证工具。

### 何时选用

当推理调用通过 BSV / BRC-104 支付通道提供资金、且计费需要可验证的逐调用收据时选用本包——schema 版本 `peck/v1/inference-receipt`、确定性规范字节、签名验证。从不触碰计量推理的部署不要它：投影无可聚合，工具也无调用者。

### 最小配置

```yaml
- name: '@deepseek-ai/dsh-session-metered-receipt'
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| （无配置字段） | — | 本包无插件 Config；行为由收据 schema 版本固定 |

### 行为结果

已验证的签名收据以 JSON-wire 摘要形式累积进 `meteredReceipts` 投影——`totalChargedSats`、收据数与收据列表——因此计费与 UI 面可直接从会话状态读取累计开销，无需重扫日志。跨语言黄金向量提交在 `vectors/receipt-vectors.json` 中，并由测试套件断言，保证 TypeScript 规范化与 Go、sCrypt 逐字节一致。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节 — 点击展开</summary>

本节解释本包背后的规范化与验证；可观察行为已在[使用本包](#use-this-package)中完整覆盖。

### 设计概念

只有各方哈希同一字节，计量收据才有用。`canonicalizeReceipt` 固定收据字段的行分隔 ASCII 表示；`hashReceipt` 与 `parseSignedReceipt` 再恰好对这些字节签名与验证。投影只应用 `data` 能解析为签名收据的 `peck/metered-receipt` 事件，因此畸形或伪造的事件永远进不了计费总额。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | Schema 定义、规范化、验证、`meteredReceipts` 投影、插件入口 |
| [`src/types.ts`](src/types.ts) | 收据与摘要的 TypeScript 类型 |
| [`vectors/receipt-vectors.json`](vectors/receipt-vectors.json) | 测试套件断言的跨语言黄金向量 |
| [`src/invariant.ts`](src/invariant.ts) | 预留包所有权的运行时不变量伴随件 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当收据验证失败，或计费总额出乎意料时阅读这些页面。它们从投影基础设施走向计量推理的开销侧。

- [session-projection 能力层](../session-projection/README.zh.md) —— 本包注册其上的投影注册表。
- [Persistence 子系统](../../../docs/subsystems/persistence.zh.md) —— `peck/metered-receipt` 事件如何到达投影读取的日志。

-----

<a id="model-experience"></a>
## 模型体验

### 计量收据投影

#### 模型看到的内容

什么都不看到。`peck/metered-receipt` 仅记录日志，从不进入会话表面、`deriveMessages()`、系统提示词、工具 schema 或请求前缀。

#### Token 影响

零。已验证的收据只追加到日志，不给任何模型请求增加 token；累计聪计费通过投影与 UI 呈现，不进入模型上下文。

#### KV Cache 影响

无。收据事件不改变任何请求的重建内容或缓存键。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制说明本 V1 收据契约的边界。它们是当前包约束，不是任务积压。

- V1 假设通道状态通过 `amount_spent_new_sats` 单调累加跟踪；单个轮次内多通道路由留待后续里程碑实现。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
