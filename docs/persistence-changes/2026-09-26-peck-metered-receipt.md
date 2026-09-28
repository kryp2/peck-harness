---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-09-26-peck-metered-receipt

English | [中文](2026-09-26-peck-metered-receipt.zh.md)

## Summary

Record the fork-owned peck/metered-receipt session event, which the Peck session-metered-receipt package registers for gateway receipts.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

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
## Compatibility

The root is new to this history: logs written before it carry no such events, and the package is composed nowhere by default, so existing sessions replay unchanged.

<a id="verification"></a>
## Verification

The session-metered-receipt package specs parse and project typed receipt vectors, and the persistence catalog regenerated with the fork package present.

<a id="dev-note"></a>
## Dev Note

None.
