# Peck fork 分歧清单

[English](peck-fork.md) | 中文

本参考文档逐路径盘点本 fork 相对上游 `deepseek-ai/deepseek-harness` 的全部改动，并为每类分歧声明：归属方、退役条件，以及当前的正确性验证方式。与之配套的可执行检查是 [scripts/verify-peck-fork.ts](../scripts/verify-peck-fork.ts)，它会拒绝任何未被分组认领的分歧路径。vendored Cordis 的分歧是另一套机制，其清单与同步流程见 [vendor/README.md](../vendor/README.md)；本页覆盖其余一切。

## 基线与执行

分歧相对一个固定的上游合并基线度量：`b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`。该 SHA 的唯一权威存放处是 [scripts/verify-peck-fork.ts](../scripts/verify-peck-fork.ts) 中的 `UPSTREAM_MERGE_BASE` 常量；本页重复它是为了评审便利。

`pnpm run verify-peck-fork`（属于 `doc-sync`）只用本地 git 运行 `git diff --name-only <merge-base>...HEAD`，并要求返回的每一条路径都命中脚本中 `FORK_PATH_GROUPS` 清单里的某个模式。基线 SHA 在历史中缺失时按刷新指引报错；未匹配的路径会同时点名该路径与两处更新位置——脚本中的清单数组和下方的归属表。脚本是执行的权威；这里的表格是其经过评审的人工对应面，因此对分组的修改必须在同一次变更中同时落到两个文件。

## 刷新流程

每次上游同步之后，或门禁报告基线缺失时：

1. 运行 `git fetch upstream && git merge-base upstream/master HEAD`，并在同一次变更中把结果 SHA 记入 [scripts/verify-peck-fork.ts](../scripts/verify-peck-fork.ts) 的 `UPSTREAM_MERGE_BASE` 与上一节。
2. 运行 `git diff --name-only <new-base>...HEAD`，把每条新路径归入既有分组，或新增一行表格并同时补上对应的清单条目。
3. 重新审视每个被触及分组的退役条件：同步正是丢弃「上游已吸收的分歧」的时机。
4. 反复运行 `npx -y pnpm@11.7.0 exec tsx scripts/verify-peck-fork.ts` 直至通过，然后运行 `pnpm run doc-sync`。

## 归属分组

| 分组 | 归属 | 允许路径 | 上游化 / 退役 | 当前验证 |
|---|---|---|---|---|
| Agent Notes（fork 决策记录） | peck | `.agents/notes/**` | 决策保留至归档；通用修复经 GitHub Discussions 提交上游 | `verify-agent-note-classification`、`verify-agent-note-format`、translation pairing |
| fork CI 工作流调整 | peck | `.github/workflows/*.yml`、`.github/AGENTS.md`、`scripts/ci-workflow.spec.ts` | 待上游的触发预算与 runner 标签对本 fork 可用后回退 | `scripts/ci-workflow.spec.ts` |
| fork 手册与状态文档 | peck | `IN_FLIGHT.md`、`PECK_DEPLOYMENT_TRAPS.md`、`PECK_HARNESS_BUILD_PLAN.md` | 发行计划完成、fork 运维与上游文档一致后删除 | Markdown 门禁（`verify-md-links`、`verify-md-wrap`） |
| 仓库安全元数据 | peck | `.gitleaksignore` | 被标记的误报消失后删除对应条目 | gitleaks 扫描 |
| 再生成的参考与成对译文 | upstream-shared | `THIRD_PARTY_NOTICES.md`、`docs/config-catalog.*`、`docs/event-producer-consumer.*`、`docs/module-graph.*`、`docs/persistence-catalog.*`、`docs/subsystems/extensions.*`、`docs/subsystems/user-questions.*`、`packages/core/scope/src/scoped-events.generated.ts` | 不单独退役；生成器随分歧源重新推导这些文件 | `doc-sync` 内的目录新鲜度门禁；依赖变更时 lefthook 再生成 notices |
| peck 自有包 | peck | `packages/interaction/telegram-answerer/**`、`packages/llm/llm-claude-cli/**`、`packages/session/session-metered-receipt/**`、`packages/session/session-usage/**` | 若上游采纳则整包经 GitHub Discussions 上游化；否则作为 fork 永久载荷 | `pnpm run test` 下各包 vitest 套件；README 配对门禁 |
| 上游共享包上的功能开发 | upstream-shared | `packages/core/agent/**`、`packages/core/session/src/known-event-types.ts`、`packages/client/ui-agent-preset/**`、`packages/extensions/cordis-host-runner/**`、`packages/extensions/tool-cordis/**`、`packages/host/apiproxy/**`、`packages/interaction/README.*`、`packages/interaction/tool-ask-user/**`、`packages/interaction/user-questions/**`、`packages/plan/plan-mode/tests/plan-mode.spec.ts`、`packages/session/README.*` | 通用改动经 GitHub Discussions 上游化，其余在每次同步时刻意重放 | 各包 vitest 套件；受影响的 `doc-sync` 门禁 |
| fork 命名与视觉识别 | upstream-shared | `apps/cli/config/agent-presets/cordis/agent.cordis.yml`、`apps/web/index.html`、`apps/web/public/**`、`apps/web/tests/**`、`packages/bundle/web-app/**`、`packages/client/ui-brand-official/**`、`packages/client/ui-conversation/**`、`packages/client/ui-primitives/**`、`packages/client/ui-theme/**`、`packages/core/system-prompt/src/index.ts`、`scripts/client-build-environment.client.spec.ts`、`scripts/client-build-environment.ts` | 产品以 Peck 之名运行期间绝不上游化；每次同步重放 | client vitest 规格、web 快照期望、品牌 e2e 测试 |
| peck 包的工作区注册 | upstream-shared | `pnpm-lock.yaml`、`tsconfig.base.json`、`tsconfig.host.json`、`scripts/gen-cordis-catalog.ts`、`scripts/verify-package-readme-model-experience.ts` | 随 peck 包成员变化再生成或重放；绝不单独上游化 | `constraints`、`verify-runtime-closure`、目录新鲜度门禁 |
| fork 清单门禁及其注册 | peck | `docs/peck-fork.i18n.yaml`、`docs/peck-fork.md`、`docs/peck-fork.zh.md`、`package.json`、`scripts/run-gates.ts`、`scripts/verify-peck-fork.spec.ts`、`scripts/verify-peck-fork.ts` | fork 的永久管道；其退役意味着上游采纳了分歧门禁本身 | `verify-peck-fork` 与 `run-gates.spec.ts` |

## 职责

fork 变更的每位作者负责保持清单完整：凡新增、移动或删除分歧路径的 PR，都在同一次变更中扩展对应的清单条目与表格行；门禁注册之后，任何遗漏都不可能在无人察觉的情况下合并。

执行上游同步的集成负责人拥有三件事：刷新基线、为新暴露的路径重新分类、以及对「上游已吸收的分歧」做退役决定。负责人通过把刷新后的基线与清单并入同步变更本身来记录结果，使 `master` 从不携带未分类分歧的窗口期。
