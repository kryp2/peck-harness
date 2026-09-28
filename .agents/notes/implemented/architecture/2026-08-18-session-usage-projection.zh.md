# Agent Note: 按路由用量投影，用于计量式提供方核算

Status: implemented

[English](2026-08-18-session-usage-projection.md) | 中文

## Problem

Peck Harness 允许一个 agent 会话在个人订阅、用户自有 API 密钥与计量式网关调用之间切换，各自拥有不同的计费与用量上报规则。用户需要按提供方路由查看自己消耗了多少，而不必登录每家提供方的控制台。Harness 已经在 `assistant/message` 事件上记录了每次调用的 token 用量，在 `request/header` 与 `request/context` 事件上记录了每次调用的 `provider`/`model`，但没有任何东西把这些事实折叠成按路由的总量；`session-stats` 只汇总输出 token，并不把它们归属到具体路由。

## Decision

新增包 `@deepseek-ai/dsh-session-usage`，在 `ctx.sessionProjections` 上注册一个 `usageByRoute` 投影单元。该单元把整份持久化日志折叠成一张按路由的表，以 `(provider, model)` 为键，并以 `{ routes, totalCalls }` 形式对外暴露。

归属依据最近的 `request/header.header.config` 或 `request/context` 中的 `provider`/`model` 字段。agent-loop 在请求发出前记录两者，因此每一步的 `assistant/message` 归属到其组装时当前的路由。折叠只维护一个 `lastRoute` 指针，而不是逐步托管；这与循环的顺序一致，也让状态保持为纯 JSON 表。

- 对于路由已知的每一条已组装助手消息，`calls` 都会递增，即使没有用量报告。
- token 字段只从有限、非负的提供方报告累加，防护方式与窗口折叠保护节点用量一致。
- `routes` 按输出 token 降序排列；日志使用过的每个路由恰好出现一次。

成本、外部余额与 CLI-agent 聚合被有意排除在本单元之外：本单元只统计 token 与调用次数，这些都是稳定且与提供方无关的事实。`$` 价格表、OpenRouter 的 `/credits` 获取以及 `usage.jsonl`（codex/claude/opencode CLI agent）都属于后续的仪表盘层。

## Alternatives considered

**扩展 `session-stats` 而不是新增一个单元。** 现有单元的视图是扁平的墙钟时间/token 汇总；把以路由为键的表折叠进去会混入两种不同的读取形态，并迫使每个现有消费者增长。独立的 `usageByRoute` 键让每个单元的 schema 自包含，并使仪表盘无需依赖墙钟时间字段即可消费用量。

**通过解析助手消息自身的 source 来做归属。** 消息 source 携带 provider/model，但它记录的是产生该消息的路由，而非请求配置，而循环的权威路由身份是 `request/header`/`request/context` 配置。以已记录的请求配置为键可以复现被固定的路由，并在重放时保持正确。

**在投影中内嵌价格表。** 价格由所有者策展、按提供方计划变化，并且每个执行类别都不同；把货币折叠进经过 schema 校验的 wire 值就要求每逢价格变化都重新记录该单元。token 是持久的度量；成本是后续单独拥有的映射。

## Consequences

- 已组合的注册表总是提供 `usageByRoute` 键，因此消费者读取的是值，从不依据键是否存在；稍后挂载插件会惰性地折叠内存日志，卸载会移除该键（HMR 安全），与其他投影单元一致。
- 归属是单一指针，因此会话中途切换路由后组装的消息会计入新路由——这与循环「配置先于请求」的顺序一致，但不是逐步托管。没有前置请求配置的消息会被跳过，而不是猜进一个合成路由。
- 用量数值只与提供方报告一样完整：未上报用量的路由仍会累加 `calls`，但 token 为零。

本单元是 [Peck 分发与计量式路由提案](../../proposed/architecture/2026-08-18-peck-distribution-and-metered-routing.zh.md) 中「Harness 验证并展示提供方上报的用量」所指的核算基石；路由、定价与收据结算将在后续改动中构建于其上。
