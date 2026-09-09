---
description: "Web-app 表层之上的 Peck Harness 产品层：停用官方品牌、Peck 默认 preset 与产品命名，面向组合或定制 profile 的用户。"
kind: "package-bundle"
---

# `@deepseek-ai/dsh-peck`

[English](README.md) | 中文

## 概述

把本层加到 web-app profile 上，表层即成为 Peck Harness：禁用官方品牌行；部署默认 agent preset 指向随发行附带的 `peck` preset；`web-runtime` 行携带 `productName: Peck Harness`。随发行的 Peck 分发已包含本层；自定义 web-app profile 可将其命名为靠后的层。不含本层的 profile 启动的是上游中性的表层。

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

### 安装到 profile

要把 Peck 产品层加到 web-app profile，把 `@deepseek-ai/dsh-peck` 命名为靠后的 bundle；内置 bundle 从 dsh 安装中解析。要移除它，去掉该 bundle 即可，profile 回到上游中性表层。所有 Peck 品牌内容都在这里组合：[`cordis.patch.yml`](cordis.patch.yml) 作为更晚的 profile 层叠加在 [`dsh-web-app`](../web-app/README.zh.md) 之上，禁用 `ui-brand-official` 行，把部署默认 agent preset 指向随发行附带的 `peck` preset，并覆盖 `web-runtime` 行加入 `productName: Peck Harness`（逐键复述 web-app 的配置，因为 patch 替换整个 config）。设计上不存在 Peck 品牌包：产品身份由 preset 默认与产品名称承载，而非 slot 占位者。

manifest 还声明了 `@deepseek-ai/dsh-telegram-answerer` 依赖。这是解析而非组合：可选的 Peck 宿主包必须能被 preset 中的裸行经 profile module fallback 解析到，而是否运行它们属于 agent preset 的选择（`apps/cli/config/agent-presets/peck`，在其中默认禁用）。除 preset 默认与产品命名外，本组合包自身不挂载任何 Peck 行为；钱包、计量路由与回执包在各自的验收关卡通过之前处处保持未组合。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节 — 点击展开</summary>

本包是静态 patch 文档：一组 `insert` 列表施加在 web-app 层之上。它不挂载服务、不发射事件、不持有可变状态；每个插入行的行为与不变量归各自的包所有。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | 本包实质：品牌替换、preset 默认与产品命名行，逐行附注理由 |
| [`src/index.ts`](src/index.ts) | 包入口；不带运行时 API |
| — | 不发布运行时不变量伴随件；本包是静态 patch-list 载体（loader 行的 YAML 文档，行归其他包所有）；不挂载服务、不发射事件、不拥有可检查的可变关系。每行自身包携带该行的不变量。 |
| [`tests/peck.spec.ts`](tests/peck.spec.ts) | manifest 声明与 patch 行检查（品牌替换、产品命名行、无启用的 Peck 包行） |

### 不变量归属

不发布不变量伴随件，因为本包是静态 patch-list 载体：每插入行的包拥有该行的不变量，本包不拥有可检查的可变关系。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

想深入品牌接缝或精确组合时阅读这些页面。

- [web-app 组合包](../web-app/README.zh.md) — 本层叠加其上的表层。
- [官方品牌包](../../client/ui-brand-official/README.zh.md) — 本层停用的侧边栏占位者；设计上不存在 Peck 品牌包。
- [生成的组合图](../../../apps/cli/composition.md) — 每个随发行 profile 使用的精确插件集合（生成的英文参考，中文对应版待定）。

-----

<a id="model-experience"></a>
## 模型体验

通过本 patch 贡献的行间接产生影响：默认的 `peck` preset 决定此部署中每个会话挂载的 persona 与工具集，`productName` 则在 `app:web-surface` 提示词段落和 `DSH_WEB_URL` 变量描述中重命名 GUI。

#### KV Cache 影响

preset 的 persona 位于系统提示词开头，且对每个已挂载 preset 保持稳定；部署在本包默认值与其他 preset 之间切换时，只为之后创建的会话建立不同前缀，绝不使已在运行的会话的缓存失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制说明本层何时需要额外注意、覆盖应写在哪里。它们是当前包约束，不是泛泛比较或任务积压。

- **依赖配套 preset**：发行未附带 `apps/cli/config/agent-presets/peck` 时，`default: peck` 会在第一个会话明确报错；该失败即缺失发行的预期信号。
- **品牌是一组占位者**：要在本层之上的 overlay 里重新启用 `ui-brand-official`，去掉本层的禁用行即可；Peck 没有自己的品牌包与之冲突。
- **Shell 身份保持通用**：浏览器标签标题、favicon 与 PWA manifest 仍是 `apps/web` 的构建时产物，不是运行时组合；未来的分发构建 profile 拥有它们。
- **尚无 keyless 组装输出快照**：随发行的 `apps/web` 快照场景启动默认 profile，见不到本包品牌；录制 peck 组合场景需要一次集成负责人尚未花费的 keyed 快照运行。在此之前由包级套件固定各部件（slot 填充、调色板层、patch 行）。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
