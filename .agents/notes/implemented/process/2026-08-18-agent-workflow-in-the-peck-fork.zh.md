# Agent Note：agent 如何在 Peck Harness fork 中构建

Status: implemented

[English](2026-08-18-agent-workflow-in-the-peck-fork.md) | 中文

## 问题

agent——无论是 harness 会话还是外部 CLI agent——都在 [分发计划](../../proposed/architecture/2026-08-18-peck-distribution-and-metered-routing.zh.md) 之下于 `kryp2/deepseek-harness` 内部构建 Peck 分发，但 fork 的机制与仓库文档所假定的上游工作流并不相同。fork 无法承载指向自身的 pull request；本地工具链与 manifest 所钉住的 pnpm 版本已经漂移；会话中途的 preset 风暴又可能悄无声息地把一个会话重组到错误的组装之下（[过期的暂存](../bug-fix/2026-08-18-agent-preset-stage-expires.zh.md)）。一个仅凭上游文档推断工作流的 agent，会打开根本不存在的 PR，会在运行中的 web 服务器底下触发 node_modules 清除，或者在过期的 master 上构建。

## 决定

fork 中工作的常设规则：

**基线。** `master` 以快进方式跟踪经过评审的上游基线（当时为 dsh-0.1.0-rc.7）。Peck 工作从基线切出分支；上游同步以 owner 对 master 的快进落地，绝不混入内容。

**fork 内没有 PR，upstream 也没有 PR。** GitHub fork 不承载指向自身的 pull request，而 upstream 当前完全不接受外部 pull request（见其 CONTRIBUTING）。变更以推送到 origin 的具名分支落地，并在检查通过后合入 fork 主干；值得与上游分享的通用修复，以 GitHub Discussions  bug 报告的形式附上修复方案提交；Peck 行为保持在插件与 `peck` bundle 之中——这也正是分发计划的形态。

**检查阶梯。** pre-push 钩子运行增量 typecheck；GUI 变更运行 `test:gui`；每个被触碰的包自证其聚焦覆盖率；文档运行 `doc-sync`；组装后的浏览器输出运行 `DSH_SNAPSHOT=replay` `test:web`。三个 web e2e 文件在本机上无论有无变更都以完全相同的方式失败——`agent-preset-selection`、`skill-invocation-policy`、`skill-user-invoke`——这是既有的本地 skill 发现环境故障，不是回归；变更对照该基线评判，而不是对照一个绿色的幻想。

**工具链。** 本 checkout 的 node_modules 由 pnpm 9.15.9 构建，而 manifest 钉住 11.7.0。在运行中的 `dsh web` 服务器还在从本 checkout 提供服务时，pnpm 不得尝试清除 modules 目录；把安装对齐到 manifest 所钉版本是一次刻意的维护窗口，绝不是其他任务的副作用。

**署名。** 机器全局的 `prepare-commit-msg` 钩子会在每个 agent 提交上写入 `Co-authored-by: peck-harness/<model> <peck-harness+<model>@agents.peck.to>`，并清除 agent 手写的任何署名；`pre-push` 会拒绝缺少该尾注的推送。因此 agent 完全不写署名——提交信息或其他任何地方，都不写 `Co-authored-by:` 行，也不写 `Agent:` 行。此前要求手写署名的规定，正是导致整个 monorepo 出现八个不同的臆造邮箱地址的原因，其中一个被 GitHub 归并到作者本人，使 agent 从该提交中彻底消失。harness 身份是 `peck-harness/<model>`；`dsh-peck` 只是 `agent-id` 会归一化掉的别名，而 session id 永远不是模型名。

**Preset。** 会话按用户设置的默认值从 Peck.to preset 组装；PTC code 模式只服务于 code-mode 工作。可能在会话进行中重组会话的阶段风暴已被修复；新会话以其创建者所选的 preset 启动。

**协调。** fork 上的一个 issue 是跨仓库依赖图的 epic；每个工作项指明一个仓库、一个基 commit、允许的路径与一个稳定的 agent 身份，leaf agent 交回源码变更加生成指令，而不是在共享产物上竞速。

## 考虑过的替代方案

**把混合的通用与 Peck 分支原样合入。** 被分发计划拒绝：每一次上游同步都会变成产品专属的冲突解决。

**在 fork 内部承载评审。** 不可能——GitHub fork 不接受指向自身的 PR；上述「分支加目标」流程是唯一存在的路径。

**让每个 agent 靠失败自行发现机制。** 这类失败代价高昂（清除会杀死运行中的服务器，过期的 master 会污染每一份 diff），而这些知识是稳定的；一份 note 比反复发现便宜。

## 后果

开始 fork 工作的 agent 读一份 note，而不是从上游文档推断机制。epic issue 跨仓库追踪工作项，基线快进让每一份 Peck diff 都相对上游保持可读。与上游分享通用修复意味着一篇 Discussions 帖子而不是一个 PR——记录于此，免得某个 agent 花掉一整个会话去发现 OAuth 的边界或那扇关着的 PR 之门。
