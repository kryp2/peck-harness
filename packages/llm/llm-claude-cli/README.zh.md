---
description: "harness LLM 服务的 claude --print 子进程适配器：通过本地 Claude Code CLI（OAuth）运行 Claude 模型，面向选择无密钥 Claude 路线的用户与维护者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-llm-claude-cli

[English](README.md) | 中文

> 状态：**V1 原型。** 已针对 Claude Code 2.1.x 测试。生产采用前请先阅读[已知限制与延期工作](#known-limitations-and-deferred-work)。

## 概述

`@deepseek-ai/dsh-llm-claude-cli` 是 harness LLM 服务的 Claude 适配器：它拥有 `claude-cli` provider 路由，把每次请求翻译成一次 `claude --print --output-format json` 子进程调用，再转成 harness stream-chunk 协议。有了它，DSH agent 无需 `ANTHROPIC_API_KEY` 即可运行在 Claude 模型上，因为身份验证走宿主机自己的 Claude 订阅（Pro/Max OAuth）——harness 不携带任何 Anthropic 凭据。它是 `@deepseek-ai/dsh-llm-deepseek` 的无密钥姊妹包：部署已为 Claude Code 付费时选这条路线，持有 DeepSeek key 时选 DeepSeek 的 API 适配器。

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

当组合通过本地安装的 Claude Code CLI 运行 Claude 模型时挂载本插件。它注册唯一的 `claude-cli` 路由，并按请求解析连接事实，因此一个组合条目加可选的用户 settings 区块即可驱动整个适配器。

### 何时选用

当部署的首选模型是 Claude、且宿主机已为 Claude Code 付费时选用本适配器——全链路不配置任何 API key，OAuth 通过 Claude Code 自己的 `/login` 流程解决，归用户负责。当部署持有 DeepSeek API key 时选用 `dsh-llm-deepseek`。为 `claude-cli` 注册任何其他适配器都会以 `DUPLICATE_ADAPTER` 失败。

### 最小配置

```yaml
- id: llm-claude-cli
  name: '@deepseek-ai/dsh-llm-claude-cli'
  config:
    binary: claude                       # PATH-resolvable
    settingsJson: '{"model":"sonnet","effortLevel":"medium"}'
    maxTokens: 32000
    maxSystemPromptChars: 32000
    models:
      - id: sonnet
      - id: haiku
      - id: opus
```

插件注册一条 provider 路由：`claude-cli`。把 DSH `GenerateOptions` 以 `provider: "claude-cli"` 指向它，并使用任一已配置的模型别名。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `binary` | `claude` | 二进制路径；必须在 `$PATH` 上可解析 |
| `settingsJson` | sonnet + medium effort | 原样传给 `--settings` 的 JSON 字符串 |
| `maxTokens` | `32000` | 每次请求的默认输出上限 |
| `maxSystemPromptChars` | `32000` | `--system-prompt` 长度软上限，超限警告并截断 |
| `models` | sonnet + haiku + opus | 发现通道展示的参考目录 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-llm-claude-cli)是全部可接受字段及其 JSDoc 的权威来源。

### 模型目录

| 线上别名 | 底层模型（Claude Code 2.1.x） | 备注 |
|---|---|---|
| `sonnet` | Claude Sonnet 4.5 | 默认；由 `--settings` 模型固定匹配 |
| `haiku` | Claude Haiku 4.5 | 便宜档，适合成本敏感的循环 |
| `opus` | Claude Opus 4.x | 受订阅档位限制；可能不可用 |

桥接看不到底层模型 id；它把 Claude Code 的 `modelUsage` 载荷记入 session log 供诊断。

### 线上协议

```
GenerateOptions
   │
   ▼  buildInvocation()
claude --print --output-format json \
       --model <alias> \
       --settings '<json>' \
       --max-turns 1 \
       --permission-mode plan \
       --allowed-tools "" \
       --system-prompt '<text>'
   │
   ▼  stdin: role-tagged transcript
Claude Code subprocess
   │
   ▼  stdout: { type:"result", result, usage, total_cost_usd, ... }
translate()
   │
   ▼
StreamChunk[]   { block-start, text-delta, block-end, usage, finish }
```

`--max-tokens` 有意不转发。Claude Code CLI 2.1.x 会把它当作未知选项拒绝；需要硬输出上限的部署应在 `--settings` 中固定模型，或依赖 Claude Code 自己的 `max_tokens` 策略。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节 — 点击展开</summary>

本节解释适配器背后的请求/响应翻译；可观察行为已在[使用本包](#use-this-package)中完整覆盖。

### 设计概念

桥接把 `GenerateOptions` 收敛为一次 `claude --print` 调用，再把返回的 JSON 文档解析回 harness `StreamChunk`。`resolveAdapterOptions()` 是从原始配置到已验证连接事实的唯一显式 resolve 步骤，适配器通过 `llm-claude-cli` settings 区块按请求重读这些事实，因此编辑用户 settings 文档无需重启即可影响下一次请求。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`Config` schema、按请求解析、settings 接线 |
| [`src/adapter.ts`](src/adapter.ts) | `ClaudeCliAdapter`：调用构造、子进程执行、空闲超时 |
| [`src/serialize.ts`](src/serialize.ts) | 线上序列化：transcript 角色、`--system-prompt` 组装、目录类型 |
| [`src/translate.ts`](src/translate.ts) | JSON result 翻译为 harness `StreamChunk` 值；围栏 JSON 工具调用检测 |
| — | 不发布运行时不变量伴随件；除 LLM 缝线处强制的契约外，适配器不拥有独立的事件序列或可变数据关系。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级契约不够用时阅读这些页面。它们从服务契约走向姊妹适配器与共享协议。

- [dsh-llm 服务](../llm/README.zh.md) —— 本适配器注册其上的 provider 中立服务。
- [llm-deepseek 适配器](../llm-deepseek/README.zh.md) —— 服务 `deepseek-official` 路由的 API-key 姊妹包。
- [LLM 流式子系统](../../../docs/subsystems/llm-streaming.zh.md) —— `StreamChunk` 协议与适配器契约。

-----

<a id="model-experience"></a>
## 模型体验

### Claude Code CLI 请求

#### 模型看到的内容

每次请求一次 `claude --print` 调用：stdin 上带角色标签的 transcript 加一个 `--system-prompt` 标志，不含适配器撰写的提示词文本。工具调用被禁用（`--allowed-tools ""`、`--max-turns 1`），DSH 工具 loop 保持工具执行的唯一事实来源。

#### Token 影响

计数来自 Claude Code 的 `usage` block，并以标准 harness `TokenUsage` 形状报告：不相交的 `inputTokens` / `outputTokens` 加上可选的 `cacheReadTokens`、`cacheWriteTokens` 和 `reasoningTokens`。适配器不会把 cache reads 算进 input tokens——harness 约定计数互不相交。

#### KV Cache 影响

每次调用都重写 Claude Code 的 prompt cache：短对话的 cache-write 成本可能压过 Anthropic 侧定价（30k token 系统提示词上的 1-token 回复可能报告 `cache_creation_input_tokens ~30000`），而长的多轮会话会摊薄这次重写，直到桥接反超 API。

### Claude Code CLI 响应

#### 模型看到的内容

JSON result 文档中的 `result` 文本成为 harness 分片；检测到的围栏 JSON 工具调用成为带 `id: "claude-cli-<n>"` 的合成块——该 id 对下游代码不透明，且不跨轮稳定。

#### Token 影响

生成 token 遵循 Claude Code 自己的生成策略；CLI 的 `total_cost_usd` 记入 session log，部署方可据此监控真实开销。

#### KV Cache 影响

保留的响应分片通过重建的 transcript 进入后续调用，并只在 Claude Code 自身缓存保留它们的范围内复用；每次调用仍支付一次缓存重写。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制说明本 V1 原型的边界。它们是当前包约束，不是通用 Claude 对比，也不是任务积压。

- **无流式输出。** V1 读取完整 JSON 文档并发出一个 text-delta。线上协议支持 `stream-json`；V2 将启用它。
- **工具调用检测是机会主义的。** 序列化器告诉 Claude Code 不要调用工具（`--allowed-tools ""`、`--max-turns 1`），让 DSH 工具 loop 保持唯一事实来源。Claude 仍可能发出形如 `{"tool":"name","arguments":{...}}` 的围栏 JSON 块；翻译器会扫描它们并呈现为 `tool-call` 块。误报风险：响应中的任何围栏 JSON 都可能命中——只要它的 `tool` 字段恰好命名了某个已注册的工具 schema。V2 应切换到 `--output-format stream-json` 以获得结构化事件。
- **系统提示词上限。** Claude Code 会静默截断超长系统提示词。桥接以 `maxSystemPromptChars`（默认 32 000 字符）显式设限，触发时记录警告。拥有大型 `peck-docs` workspace 的部署应调大该值。
- **缓存写入成本。** 每次调用都重写缓存。短调用比 Anthropic API 更贵；长会话可以摊薄。桥接把 `total_cost_usd` 记入 session log，部署方可据此监控真实开销。
- **无图片输入。** V1 只声明 `inputModalities: ['text']`。Anthropic 图片支持需要原生 Messages API，而 Claude Code 的 `--print` 不暴露它。
- **无原生 Anthropic 工具调用形状。** 桥接发出的合成 tool-call 块带 `id: "claude-cli-<n>"`，因为 Claude Code 在 `--print` 模式下不产生 Anthropic 格式的 call id。DSH 工具 loop 会执行调用并回放结果；合成 id 不跨轮稳定，且对下游代码刻意保持不透明。
- **仅 OAuth 身份验证。** 本包不需要 API key，且若提供也会拒发。失败的 `claude --print` 调用会以 `LlmError('AUTH')` 附 stderr 细节呈现——Claude Code 的 `/login` 流程由用户自行完成。

延期工作：

- `stream-json` 输出，向 harness 提供真正的 SSE 流。
- 通过 Anthropic 格式 image blocks 支持视觉输入。
- 一个小型 `--bare` 模式 sidecar，直接暴露 Claude Code 内部 session 的 Anthropic 格式 HTTP；这将整体替换子进程适配器，无需逐调用重写即可解锁原生工具调用、视觉与 prompt-cache 复用。
- 子进程失败（如 OAuth 端点的瞬时 ECONNRESET）的可配置重试策略。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
