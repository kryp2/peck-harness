---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-09-26-peck-metered-receipt

[English](2026-09-26-peck-metered-receipt.md) | 中文

## 概述

记录 fork 自有的 peck/metered-receipt 会话事件，由 Peck 的 session-metered-receipt 包为网关回执注册。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-09-26-peck-metered-receipt
baseline: false
changes:
  - root: "event:peck/metered-receipt"
    previous: null
    after: "ca3d456b6414950bcc2e0bf19b81ef7225dd1495cce3bcf6bc7046f43a040dc5"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

该根在本历史中是新增的：此前写入的日志不含此类事件，且该包默认不在任何地方组合，因此现有会话按原样重放。

<a id="verification"></a>
## 验证

session-metered-receipt 包的测试会解析并投影带类型的回执向量，持久化目录在包含该 fork 包的情况下已重新生成。

<a id="dev-note"></a>
## 开发备注

无。
