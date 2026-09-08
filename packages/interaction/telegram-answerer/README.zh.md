---
description: "通过 Telegram 向人类提问的可选 user-questions 回答者：与其他通道竞速，先答者结算提问，面向组合该通道的部署。"
kind: "package-reference"
---

# @deepseek-ai/dsh-telegram-answerer

[English](README.md) | 中文

## 概述

在 `ctx.userQuestions` 的 `'user-questions/ask'` 事件上竞速的可选回答者，通过 Telegram 向人类提问。与 Web GUI 回答者一起组合时，同一个 `ask_user_question` 会同时投递给每个通道；人类谁先回答谁结算提问，当其他通道获胜时，本尝试会通过竞速信号被取消。

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

常见路径是在该预设之外显式组合该回答者：`peck` 预设默认禁用它，通过其裸行由 profile module fallback 解析。当问题带有选项时使用可点内联按钮，否则使用自由文本；第一条来自授权会话的回复认领该问题。

### 何时选用

当操作者在 Telegram 上、而提问必须可达他们时选用本包；问题在它与 Web GUI 回答者之间并行竞速。仅限浏览器操作的部署不要它——新传输面只会增加攻击面而没有收益。

### 最小配置

```yaml
- name: '@deepseek-ai/dsh-telegram-answerer'
```

凭据在每次操作时从凭据提供者读取，使用两个引用：

- `TELEGRAM_BOT_TOKEN` —— 来自 BotFather 的机器人令牌。
- `TELEGRAM_CHAT_ID` —— 授权的会话 id；回复仅接受来自该会话的内容。

| 字段 | 默认值 | 含义 |
|---|---|---|
| （无配置字段） | — | 包只读两个凭据引用，无插件 Config |

传输通过 `ctx.shell`（curl）访问 Telegram Bot API。带令牌的 API URL 通过每次运行的环境条目传给 curl，绝不经过命令行，因此令牌不会出现在 argv 中。当 shell 或凭据缺失时，该回答者退化为空操作（婉拒）。

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-telegram-answerer)是全部可接受字段及其 JSDoc 的权威来源。

### 行为结果

通道内部失败（凭据未配置、传输错误、期限届满仍无回复）以 resolve `undefined` 婉拒竞速，让其他通道继续；只有当组合中没有任何通道认领时才产生 fail-closed 的 `NO_ANSWERER`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节 — 点击展开</summary>

本节解释回复关联与落败清理；可观察行为已在[使用本包](#use-this-package)中完整覆盖。

### 回复关联

回复与它所回答的问题绑定。在询问触碰 Telegram 之前，回答者会通过探测机器人最新的 `update_id` 清空所有已挂起的更新，因此早于问题的历史更新不可能在轮询期间到达，且更新游标跨询问持久保存。内联按钮按下只有在引用本次询问发送的消息时才被接受（每次按下携带每问题一次的 nonce）；问题发出后，授权会话中的自由文本回复即被接受。询问在一个队列上串行执行，并发的问题不会交错地对同一会话发送和轮询；当某个尝试的竞速信号在轮到它之前已经触发，它会直接跳过而不触碰 Telegram。

### 落败清理

`ask()` 的竞速信号会被及时观察：它随每次 curl 运行传递，因此被取消的尝试会杀死在途的长轮询，而不是等满传输超时，轮询循环也会在下一圈停止。当落败原因是 `SUPERSEDED`——其他通道已回答——每条已发送的消息会以尽力而为的方式（`editMessageText`）追加"(answered elsewhere)"。任何其他取消（调用方中止、宿主拆除）意味着没有任何人回答，因此发出的消息保持原样，而不会谎称发生了并未发生的回答。该编辑绝不会把异常抛进获胜路径：编辑失败只会安静地留下旧消息。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`user-questions/ask` 监听器、串行队列、长轮询与竞速信号处理 |
| — | 不发布运行时不变量伴随件；回答者只消费竞速通道，不拥有可检查的可变关系。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当某个提问无人认领，或竞速行为不符合预期时阅读这些页面。它们从能力层契约走向展示它的预设与工具。

- [user-questions 能力层](../user-questions/README.zh.md) — 回答者注册的竞速通道与 fail-closed 语义。
- [peck 预设](../../../apps/cli/config/agent-presets/peck) — 默认禁用本包的 bare 行。
- [dsh-tool-ask-user](../tool-ask-user/README.zh.md) — 拥有问题流程模型可见面的工具。

-----

<a id="model-experience"></a>
## 模型体验

无，因为该回答者观察模型调用的 `ask_user_question` 流程，不注册提示、工具或会话事件；`dsh-tool-ask-user` 拥有问题流程中的所有模型可见效果。

#### KV Cache 影响

无直接影响。组合或移除该回答者都不会改变组装后的系统提示。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制说明本通道何时不适用。它们是当前包约束，不是任务积压。

- 回复通过轮询 `getUpdates` 收集，因此不支持常驻中继（webhook）；只使用原始 Bot API。
- 内联按钮按下不会以 `answerCallbackQuery` 确认，因此按钮可能在解答完成前显示短暂的加载旋转动画。
- 包含多个问题的批次会按顺序逐个回答；没有每个问题的超时，只有整个询问的上限。
- 询问串行执行：第二个并发询问必须等前一个落定后才会发送任何内容，因此在并发下它的 Telegram 投递会被推迟（Web GUI 回答者不受影响）。
- 自由文本回复靠新鲜度（清空加游标）约束，而非消息身份 —— 只有按钮按下要求关联到确切发出的消息。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
