# Agent Note: 可执行的 fork 分歧清单门禁

Status: implemented

[English](2026-08-24-peck-fork-divergence-inventory-gate.md) | 中文

## Problem

fork 的改动散布在上游共享文件中——packages、scripts、工作流、品牌资产——而 peck 完全自有的新增物在旁边不断生长。此前没有任何机制拒绝「触碰了上游自有路径却不记录 fork 为何拥有该分歧」的变更，于是分歧路径集合只能靠一次次的临时审计计数获知（先后约为 148、172、173 条），每一条数字在写下的瞬间就已过期。因此，上游同步时没有任何机械保证能让新暴露的路径先完成分类再落到 fork 主干上，也没有任何单一位置声明哪些分歧意在 upstreaming、哪些要永远重放。

## Decision

[docs/peck-fork.md](../../../../docs/peck-fork.zh.md) 是 fork 相对上游的归属清单，[scripts/verify-peck-fork.ts](../../../../scripts/verify-peck-fork.ts) 是它的可执行半边，以 `verify-peck-fork` 门禁注册进 `doc-sync` 的叶子列表（`scripts/run-gates.ts`、根 `package.json`）。该门禁固定一个上游合并基线 SHA，仅通过本地 git 运行 `git diff --name-only <merge-base>...HEAD`，并要求返回的每条路径命中内嵌 `FORK_PATH_GROUPS` 清单中的模式。基线缺失时按刷新命令报错；未匹配路径会同时点名该路径与两处更新位置——脚本中的清单数组与清单表格。清单把当前分歧归为十组：peck 自有决策记录、CI 调整、运维手册、安全元数据、再生成参考、peck 自有包、上游共享包上的功能、命名与视觉识别、工作区注册，以及门禁本身。

分类器是纯函数：glob 匹配、diff 解析和分组指派都是导出函数，git 边界是可注入的 runner，因此 [scripts/verify-peck-fork.spec.ts](../../../../scripts/verify-peck-fork.spec.ts) 用合成列表覆盖通过、未分类、基线缺失与模式边界情形，不依赖真实仓库或网络。清单内嵌在脚本中而不是存成 JSON 或从文档反向解析：脚本是执行的权威，文档表格是其经过评审的对应面；内嵌让模式列表与退役条件共居一个类型化常量，遵循 `scripts/coverage-exempt.ts` 的成员规则先例。仅存在于工作树的改动按设计不可见——门禁度量的是相对固定基线的已提交分歧，而这正是上游同步消费的状态。

## Alternatives considered

**脚本旁放一份 JSON 清单。** 否决：它增加了一个唯一消费者就是同一个门禁的第二文件，带来导入路径与类型漂移的风险，却没有换来任何隔离收益。

**从 docs/peck-fork.md 反向解析模式。** 否决：让执行依赖受评审散文的格式，会把每一次文档编辑都变成潜在的门禁破坏，而且颠倒了权威——文档为评审陈述事实，代码执行事实。

**针对真实 git 状态做测试。** 按测试策略对可变外部状态的回避予以否决；注入 runner 的设计确定性地证明了完全相同的失败输出。

## Consequences

今后每条新的分歧路径都会让 `doc-sync` 失败，直到被分类，清单因此不会再像审计计数那样无声腐化；代价是每出现一类真正新的分歧就要编辑一次清单与表格。上游同步从此有了明确的负责人流程——刷新固定 SHA、重新分类、退役已被吸收的分歧——记录在清单的刷新一节。门禁检查的是分类完备性，而非各组声明的正确性：归错组的路径依然会通过，这由评审负责。本门禁服务的 fork 工作流是 [fork 工作流 note](2026-08-18-agent-workflow-in-the-peck-fork.zh.md) 中的既定指令。
