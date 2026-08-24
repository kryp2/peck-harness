# @deepseek-ai/dsh-client-ui-brand-peck

[English](README.md) | 中文

本包无条件填充 `sidebar.brand.mark`、`sidebar.brand.name` 和 `conversation.hero.brand.mark`：由组合而非构建 profile 决定是否呈现 Peck 表层，因为挂载本包条目的部署就是要 Peck 品牌。它是 [`ui-brand-official`](../ui-brand-official/README.zh.md) 的 Peck 对应物，二者不得共存于同一组合——它们填充的是同一组单占位者 slot，[`dsh-peck` 组合包](../../bundle/peck/README.zh.md) 插入本包时会禁用那一行。

三个占位者通过嵌套的 `slots.inject()` 作为一组声明感知注册安装。因此无论该包的条目先于还是后于侧边栏和会话声明方激活，它都能工作；任一声明折叠时会撤回全部占位者，HMR 期间不会留下混合品牌。鸟形标志与「Peck Harness」字标是私有素材：共享的 primitives 包保留其中立上游品牌图形。

本包还以自身包名为源注册一层主题覆盖（`overrideTokens`），携带 Peck 调色板——重新着色的静态色阶以及产品改指向的全部别名 token——叠加在当前激活主题之上。该层挂在 Cordis effect 上，销毁插件即与 slot 占位者一同移除调色板；未挂载本包的组合中，基础样式表保持原样。

## 模型体验

无，作为仅贡献浏览器呈现的包；这里没有任何内容抵达模型请求。

#### KV Cache 影响

无；本包既不组装也不发送 provider 请求。

## 已知限制与延期工作

- **每个组合一层调色板**：覆盖携带固定值；想要不同强调色的部署应编写另一个客户端包，而不是配置本包。
- **浏览器标题独立**：`DSH_CLIENT_TITLE` 在构建期选择标题文本，不经过 UI slot，因此标签页标题不在本包范围内。
