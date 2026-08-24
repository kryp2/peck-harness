# `@deepseek-ai/dsh-peck`

[English](README.md) | 中文

Peck Harness 产品组合包。[`cordis.patch.yml`](cordis.patch.yml) 作为更晚的 profile 层叠加在 [`dsh-web-app`](../web-app/README.zh.md) 之上：禁用 `ui-brand-official` 行，插入无条件的 Peck 品牌包（[`dsh-client-ui-brand-peck`](../../client/ui-brand-peck/README.zh.md)，slot 填充加调色板覆盖），把部署默认 agent preset 指向随发行附带的 `peck` preset，并覆盖 `web-runtime` 行加入 `productName: Peck Harness`（逐键复述 web-app 的配置，因为 patch 替换整个 config）。所有 Peck 品牌内容都在这里组合，因此不含本层的 profile 启动的是上游中性的表层。

manifest 还声明了 `@deepseek-ai/dsh-telegram-answerer` 依赖。这是解析而非组合：可选的 Peck 宿主包必须能被 preset 中的裸行经 profile module fallback 解析到，而是否运行它们属于 agent preset 的选择（`apps/cli/config/agent-presets/peck`，在其中默认禁用）。除品牌与产品命名外，本组合包自身不挂载任何 Peck 行为；钱包、计量路由与回执包在各自的验收关卡通过之前处处保持未组合。

## 模型体验

通过本 patch 贡献的行间接产生影响：默认的 `peck` preset 决定此部署中每个会话挂载的 persona 与工具集，`productName` 则在 `app:web-surface` 提示词段落和 `DSH_WEB_URL` 变量描述中重命名 GUI。

#### KV Cache 影响

preset 的 persona 位于系统提示词开头，且对每个已挂载 preset 保持稳定；部署在本包默认值与其他 preset 之间切换时，只为之后创建的会话建立不同前缀，绝不使已在运行的会话的缓存失效。

## 已知限制与延期工作

- **依赖配套 preset**：发行未附带 `apps/cli/config/agent-presets/peck` 时，`default: peck` 会在第一个会话明确报错；该失败即缺失发行的预期信号。
- **品牌是一组占位者**：要在本层之上的 overlay 里重新启用 `ui-brand-official`，必须同时移除 `ui-brand-peck` 插入行；二者填充同一组单占位者 slot。
- **Shell 身份保持通用**：浏览器标签页标题、favicon 与 PWA manifest 仍是 `apps/web` 的构建期产物，不属于运行时组合；未来的发行构建 profile 负责它们。
- **尚无无密钥的装配输出快照**：随发行的 `apps/web` 快照场景以默认 profile 启动，看不到本组合包的品牌；录制一个 peck 组合场景需要一次带密钥的快照录制，集成负责人尚未花费。在此之前，由各包套件钉住组成部分（slot 填充、调色板层、patch 行）。
