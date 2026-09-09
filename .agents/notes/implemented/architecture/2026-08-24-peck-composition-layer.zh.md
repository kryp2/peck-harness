# Agent Note：Peck 组合层

Status: implemented

[English](2026-08-24-peck-composition-layer.md) | 中文

## 问题

审计 P1：Peck 的品牌与 persona 直接打在 GENERIC 的上游自有表层上——system-prompt 回退身份行、随发行附带的 `cordis` agent preset 的 persona、web 组合包的表层上下文字符串与 CLI 描述、共享 primitives 中的品牌图形（`PeckLogo` 与被重写的 `BrandWordmark`）、会话状态文案（「Pecking...」）、共享主题调色板的值、应用 shell 标题/favicon/manifest，以及 official 构建环境标题。这些文件全部归上游所有，因此每次上游同步都要重新解决同样的冲突，而且 fork 的结构本身没有说明产品身份被允许住在哪里。发行计划的组合章节（[发行计划 proposed Agent Note](../../proposed/architecture/2026-08-18-peck-distribution-and-metered-routing.zh.md)）要求一个持有产品行为的 `peck` 组合 bundle，同时通用默认值回归上游中性；本 note 实现其中的宿主与客户端切片。

## 决策

产品身份只在两处组合，且两处均为新建；所有通用表层恢复到与上游逐字节一致的内容。

**宿主侧：`peck` agent preset**（`apps/cli/config/agent-presets/peck/`）。它是随发行的 `standard` 工具集的完整副本，其 persona 行携带 Peck Harness 身份，另加一个可选 Peck 宿主包块——`telegram-answerer` 以禁用状态随行，部署删除 `disabled` 并提供凭据后启用。deployment-refusal guard 在任何地方都保持未组合（[它自己的 Agent Note](2026-08-24-deployment-refusal-guard.zh.md) 使其在评审通过前保持可选），计量回执/路由包在各自验收关卡通过之前保持未组合。通用的 `cordis` 与 `standard` preset 不携带任何 Peck 文本。

**组合侧：`dsh-peck` bundle**（`packages/bundle/peck/`，与 `dsh-base` 同类的纯 patch 包）。其 patch 层叠加在 `dsh-web-app` 之上，做四件事：禁用 `ui-brand-official` 行，插入无条件的 Peck 品牌客户端包，用 `productName: Peck Harness` 覆盖 `web-runtime` 行（逐键复述 web-app 配置，因为 patch 替换整个 config），并把部署默认 preset 指向 `peck`。其 manifest 声明 `telegram-answerer` 为依赖，使 preset 中的裸行能经 profile module fallback 解析——这是解析而非组合；是否运行可选包的选择留在 preset 里。

**客户端侧：`@deepseek-ai/dsh-client-ui-brand-peck`** 无条件填充既有的通用品牌 slot（`sidebar.brand.mark`、`sidebar.brand.name`、`conversation.hero.brand.mark`）。由组合决定品牌——挂载该行的部署就是要 Peck 表层——因此这条路径上不存在构建 profile 门禁；上游在 `ui-brand-official` 上的 `DSH_CLIENT_BUILD_PROFILE=official` 门禁原样保留、照常工作。两个包填充的是单占位者 slot，这正是 bundle 插入其一时禁用另一者的原因。鸟形标志与字标为本包私有，Peck 调色板作为一层 `overrideTokens`（以包名为源）叠加在激活主题之上，挂在 Cordis effect 上，销毁时与占位者一同移除。共享 primitives 保留其上游鲸鱼图形，共享样式表保留其上游蓝色值。

**让宿主中性成为可能的通用旋钮：** `dsh-web-app` 的运行时粘合插件新增经校验的 `productName` 配置字段（默认 `DeepSeek Harness`，空白在激活时报错），用于 `app:web-surface` 提示词段落和 `DSH_WEB_URL` 描述。该字段是符合「无硬编码可调项」规则、可上游化的功能；只有 peck bundle 的 patch 把它设为 `Peck Harness`。

**fork 清单：** 分歧门禁为三个新路径空间新增完全 peck 自有的 `peck-composition` 分组，而遗留的 `fork-branding` 分组的退役语义改为「通过重置退役」：本变更落地后，其路径在下一次合并基线刷新时移除，因为它们的内容再次与上游一致。在此之前清单保留遗留模式，因为门禁度量的是已提交的分歧。

## 已考虑的替代方案

**继续通过构建 profile 填充品牌。** 作为主路径被否决：`DSH_CLIENT_BUILD_PROFILE=official` 是构建期事实，Peck 部署无法从配置中组合、审计或移除自己的品牌，且通用 `ui-brand-official` 将永远处于分歧状态。该门禁为它真正的受众（上游 official 构建产物）保留；bundle 让它在 Peck 场景下变得多余。

**把 `ui-brand-official` 的行 id 重指到 Peck 包，而不是禁用加插入。** 被否决：这会隐藏哪个实现运行在一个名字听起来很通用的行后面，而且在 overlay 中重新启用官方品牌将意味着编辑 peck 层而非添加一行。

**用裸注入的 `<style>` 覆盖调色板 token。** 被否决：`ThemeRuntime.overrideTokens` 已经提供按源分层、light/dark 成对、seq 叠序、检查导出与 effect 级销毁；手写 style 标签会在 presenter 的撤回集合之外重复这一切。

**在 system-prompt 回退里按环境携带 persona。** 直接否决：`dsh-system-prompt` 内任何身份分支都会重建本次变更恰好移除的耦合；persona slot 的存在意义正是让 preset 能按会话遮蔽它。

## 后果

原生 profile 启动的即是逐字节的上游表层——DeepSeek 身份、鲸鱼字标、蓝色调色板、「Deep diving...」状态——并且所涉每个文件都可以无冲突地从上游合并。Peck 部署叠加 `peck` bundle（及其随行 preset）后得到鸟形标志与字标品牌、叠加任一配色方案的琥珀色调色板、以 Peck 命名的模型可见表层上下文，以及默认使用 Peck persona、可选 Telegram 应答的会话。诚实的缺口已记录在 bundle README 中：浏览器标签页标题、favicon 与 PWA manifest 仍是 `apps/web` 的构建期产物，在发行构建 profile 接管之前保持上游通用；流式状态文案没有组合接缝，保持上游文本。验证：每个被触及包的聚焦套件（bundle patch 断言、含无条件填充与调色板销毁契约的品牌插件 jsdom 规格、含空白名失败的 `productName` 行为）、与固定合并基线逐字节一致的已重置表层确认，以及对完整提交树分类的分歧门禁。
