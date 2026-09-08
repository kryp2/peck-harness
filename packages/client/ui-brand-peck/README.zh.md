---
description: "Peck Harness 品牌占位：侧边栏与会话 hero，挂载即生效；面向选择或替换品牌呈现的用户与维护者。"
kind: "package-reference"
---

# `@deepseek-ai/dsh-client-ui-brand-peck`

[English](README.md) | 中文

## 概述

本包无条件填充 `sidebar.brand.mark`、`sidebar.brand.name` 和 `conversation.hero.brand.mark`：由组合而非构建 profile 决定是否呈现 Peck 表层，因为挂载本包条目的部署就是要 Peck 品牌。它是 [`ui-brand-official`](../ui-brand-official/README.zh.md) 的 Peck 对应物，二者不得共存于同一组合——它们填充的是同一组单占位者 slot，[`dsh-peck` 组合包](../../bundle/peck/README.zh.md) 插入本包时会禁用那一行。它不保留运行时状态，不向模型请求贡献任何内容。

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

在身份为 Peck 的部署的浏览器 roster 中挂载本插件。占位者不受构建 profile 门控：条目激活即注册。

### 替换品牌

拥有自有身份的部署去掉本包，另行组合占据侧边栏 slot 的包——以及本包无条件填充的 hero slot（这点不同于官方对应物）。占据 slot 是唯一的组合途径；此处没有品牌配置面。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节 — 点击展开</summary>

三个占位者通过嵌套的 `slots.inject()` 作为一组声明感知注册安装。因此无论该包的条目先于还是后于侧边栏和会话声明方激活，它都能工作；任一声明折叠时会撤回全部占位者，HMR 期间不会留下混合品牌。鸟形标志与「Peck Harness」字标是私有素材：共享的 primitives 包保留其中立上游品牌图形。

本包还以自身包名为源注册一层主题覆盖（`overrideTokens`），携带 Peck 调色板——重新着色的静态色阶以及产品改指向的全部别名 token——叠加在当前激活主题之上。该层挂在 Cordis effect 上，销毁插件即与 slot 占位者一同移除调色板；未挂载本包的组合中，基础样式表保持原样。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

品牌表层不够用时阅读这些页面。从本包占据的 slot 通向渲染它们的外壳。

- [ui-sidebar](../ui-sidebar/README.zh.md) — 声明 `sidebar.brand.mark` 与 `sidebar.brand.name` 并渲染其 fallback。
- [ui-conversation](../ui-conversation/README.zh.md) — 在 hero 中声明 `conversation.hero.brand.mark`。
- [dsh-peck 组合包](../../bundle/peck/README.zh.md) — 插入本包并禁用官方行的层。

-----

<a id="model-experience"></a>
## 模型体验

无，作为仅贡献浏览器呈现的包；这里没有任何内容抵达模型请求。

#### KV Cache 影响

无；本包既不组装也不发送 provider 请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制说明品牌呈现如何供给。它们是当前包约束，不是品牌设计比较或任务积压。

- **每个组合一层调色板**：覆盖携带固定值；想要不同强调色的部署应编写另一个客户端包，而不是配置本包。
- **浏览器标题独立**：`DSH_CLIENT_TITLE` 在构建期选择标题文本，不经过 UI slot，因此标签页标题不在本包范围内。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>

**运行时不变量：** 不发布伴随件。本包不保留可变状态，其 slot 占位者与调色板层经由同一个事务性 effect 安装与移除。
