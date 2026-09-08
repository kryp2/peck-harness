---
description: "会话的按路由 token 记账：从请求配置与已组装助手消息中折叠出整份日志的用量，形成 usageByRoute 读取模型，面向渲染不受分页与压缩影响的用量的客户端。"
kind: "package-reference"
---

# @deepseek-ai/dsh-session-usage

[English](README.md) | 中文

## 概述

`@deepseek-ai/dsh-session-usage` 是注册 `usageByRoute` 投影单元的函数插件：从最近的请求配置与组装完成的助手消息中折叠出整份日志的按路由 token 用量，并通过 session-projection 接缝（注册表快照、变更流与各投影载体）对外提供。客户端可渲染不受分页与压缩影响的按订阅用量，因为折叠读取的是持久日志，而非它的任何窗口视图。

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

当客户端需要不受分页与压缩影响的按路由用量读取模型时挂载本插件。它在 session-projection 注册表上注册 `usageByRoute` 投影单元；折叠本身由投影定义固定。

### 何时选用

当 UI 或计费面必须展示按路由 token 用量——整个会话中哪个 provider/model 组合花了多少——且无论当前分页载入哪个日志窗口、压缩又摘要掉了什么，都要保持不变时选用本包。没有这类面的装配不要它：本单元只计算面向客户端的读取模型，不改变任何模型可见行为。

### 最小配置

```yaml
- id: session-usage
  name: '@deepseek-ai/dsh-session-usage'
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| （无配置字段） | — | 本包无插件 Config；折叠由投影定义固定 |

注入 `sessionProjections` —— 这是插件的全部用途；在没有注册表的装配中，fiber 保持挂起，不注册任何内容。

### 行为结果

已组合的注册表始终提供该键，因此客户端读取的是值，从不依据键是否存在。`routes` 按输出 token 降序列出日志用过的每个路由一次；`totalCalls` 汇总调用次数。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节 — 点击展开</summary>

本节解释读取模型背后的折叠语义；可观察行为已在[使用本包](#use-this-package)中完整覆盖。

### 折叠语义

- 归属以最近的 `request/header`（config 中的 `provider`/`model`）或 `request/context`（自身的 `provider`/`model`）字段为准。agent-loop 会在请求发出前记录两者，因此每一步的 `assistant/message` 都归属到其组装时当前的路由。
- `calls` 在每条已组装且路由已知的助手消息上递增，即使没有用量报告（一条 max-tokens 的 usage-host 消息仍是一次完成的调用）。
- token 字段（`inputTokens`、`outputTokens`、`cacheReadTokens`、`cacheWriteTokens`、`reasoningTokens`）仅在消息报告有限非负计数时累加；格式错误的报告会像窗口折叠保护节点用量那样被忽略，不产生任何贡献。
- 计数互斥，与 `TokenUsage` 一致：`inputTokens` 是未缓存输入，缓存输入在 cache 字段中，`reasoningTokens` 是输出的一个细分。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`name`/`inject`/`apply`、注册 effect |
| [`src/projection.ts`](src/projection.ts) | `usageByRoute` 投影定义与折叠 |
| [`src/types.ts`](src/types.ts) + [`src/client.ts`](src/client.ts) | 单源投影键类型；宿主（`./types`）与客户端（`./client`）命名空间投影 |
| [`src/invariant.ts`](src/invariant.ts) | 预留包所有权的运行时不变量伴随件 |
| — | 客户端命名空间归属是全仓纪律；这里唯一的 fork 契约是整日志折叠，由投影测试强制保证。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当用量数字出乎意料，或键缺失时阅读这些页面。它们从投影基础设施走向开销侧的姊妹包。

- [session-projection 能力层](../session-projection/README.zh.md) —— 本单元注册其上的投影注册表。
- [Token meter 子系统](../../../docs/subsystems/token-meter.zh.md) —— token 数值如何流入用量读取模型。
- [session-metered-receipt](../session-metered-receipt/README.zh.md) —— 跟踪已验证付费推理收据与聪计费的姊妹单元。

-----

<a id="model-experience"></a>
## 模型体验

无：插件仅为已记录的会话事件计算面向客户端的读取模型，不触碰任何提示、消息、schema、流或工具结果。

#### KV Cache 影响

无；插件从不会组装或发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制说明本用量折叠的边界。它们是当前包约束，不是任务积压。

- **归属是单一指针而非逐步托管** —— 折叠将每条消息归属到最近的请求配置，因此会话中途切换配置后组装的消息归属到新路由；这与循环的顺序一致（配置在其描述的请求之前被记录）。
- **用量由提供方报告且可选** —— 未报告用量的路由仍会累加 `calls`，但 token 为零；token 数值只与适配器报告的完整程度一致。
- **不包含成本、余额或 CLI-agent 聚合** —— 本单元只统计 token 与调用次数；`$` 定价、外部余额（`/credits`）以及 `usage.jsonl`（codex/claude/opencode CLI agent）都属于后续的仪表盘层，不在这里。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
