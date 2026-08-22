# Agent Note：fork CI 触发预算收敛到发布 tag 与手动 dispatch

Status: implemented

[English](2026-08-22-fork-ci-trigger-budget.md) | 中文

## Problem

本 fork 的托管 Actions 分钟数来自个人预算。六个工作流会自动触发——`ci.yml`、`ci-master.yml`、`release.yml`、`release-vendor.yml`、`sandbox.yml` 和 `e2e.yml`——因此一次普通的 push 或 pull request 就会在两个完整的打包证明、OS×runner 沙箱矩阵、以及同时消耗 DeepSeek API 额度的真实 API e2e 套件上花费分钟数。八月尚未过半，账户的包含配额就被耗尽，GitHub 完全停止了启动新的 job。

## Decision

自动触发按「只有自动化才能证明的事」来分配预算；其余一切移到 tag 或手动 dispatch。

- `release.yml` 与 `release-vendor.yml` 只从各自的发布 tag（`dsh-v*`、`vendor-*`）或 `workflow_dispatch` 打包。打包证明恰好在裁剪发布的那一刻运行——也就是它的结论能够影响决策的时刻——而不是在每次变更上运行。
- `sandbox.yml` 只保留 `workflow_dispatch`。按照设计它是 pull-request 结论之外的参考信号（[理由](../../implemented/process/2026-07-21-serial-cross-platform-ci-reference.zh.md)）；dispatch 使它在需要时仍然可用，而不必在每次 push 上付费。
- `e2e.yml` 只保留 `workflow_dispatch` 并移除了每夜 schedule。它除分钟数外还消耗真实 API 额度；当被测对象是 provider 行为时由维护者手动 dispatch。
- `scripts/ci-workflow.spec.ts` 钉住上述每一个形状，以及 `e2e.yml` 与 `sandbox.yml` 的仅手动状态，使日后的工作流编辑无法悄悄重新引入自动花费。

同一个 PR 还修复了既有漂移：提交 `e76268ce7e` 删除了 `issue-lifecycle.yml` 与 `issue-policy.yml` 却留下了它们的断言，导致该 spec 自那时起在 master 上一直失败。

## Consequences

每月的 Actions 花费大约会下降此前账单中打包证明、沙箱与每夜 e2e 所占的份额，代价是反馈变晚：损坏的打包要在裁剪发布时才会被发现，而真实 API 的漂移只有在有人手动 dispatch 该套件时才会暴露。`.gitleaksignore` 条目是按行记录的，i18n sidecar 的记录重新分组时必须同步刷新。

## Alternatives considered

为打包工作流添加路径过滤被否决：与打包相邻的变更足够常见，预算仍会被烧掉，而且证明到达的时机未必是发布决策依赖它的时机。自托管 runner 被推迟：边际分钟成本为零，但在更简单的触发修复被证明不够之前，它先给个人 VM 增加了 runner 维护负担。只依赖 `cancel-in-progress`（`ci.yml` 已具备）被否决：它约束的是并发数，而不是付费启动的次数。
