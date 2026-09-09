---
description: "基于显式部署事实声明的启动门禁：在远端可达 + 无应用认证 + danger-full-access 组合下于就绪前拒绝启动，面向加固桥接部署的操作者与维护者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-guard-deployment-refusal

[English](README.md) | 中文

## 概述

回环绑定的进程说明不了谁真正能连上它：外部 socat 桥、反向代理或端口转发会制造出套接字自己看不见的远端可达性。当操作者的声明同时组合了非回环可达性、缺失的应用认证以及 `danger-full-access` 权限预设时，`dsh-guard-deployment-refusal` 会在任何就绪副作用之前令 harness 启动失败。这些事实只从配置读取——绝无探测。常见用法是靠前挂载一行；拒绝错误会点名全部三项事实，且只需一项补救即可改变结果。

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

常见路径是在组合中靠前挂载一行——服务器/就绪行之前——使拒绝能在任何就绪宣告之前中止启动。没有远端桥接的部署无需声明：默认值描述的就是回环套接字，守卫无需读取权限属主即通过。

### 何时选用

当部署的套接字经由任何桥接（socat/WireGuard、反向代理或任何外部转发器）可从回环主机之外到达，且希望由启动本身拒绝危险组合而非依赖运行时检查时，选用本包。纯本地开发且无桥接时不必选用：默认值已通过，该行不增加任何保护。

### 最小配置

```yaml
- id: deployment-refusal
  name: '@deepseek-ai/dsh-guard-deployment-refusal'
  config:
    exposure: remote-declared   # default 'loopback-only'; who can reach this socket through bridges included
    authKind: none              # default 'none'; 'token' = real application authentication composed
```

对于由 socat/WireGuard、代理或任何外部转发器前置的回环绑定进程，`exposure: 'remote-declared'` 才是诚实的声明。`authKind: 'none'` 同样适用于只靠 `trustedHosts` 作为请求围栏的部署——浏览器信任围栏不是应用认证，永远不能满足 `authKind`。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `exposure` | `'loopback-only'` | 本套接字的声明可达性，含桥接在内 |
| `authKind` | `'none'` | API 表层前置组合的应用认证机制 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-guard-deployment-refusal)是全部可接受字段及其 JSDoc 的权威来源。

### 行为结果

有效权限预设不在此配置：插件从其属主服务读取 `ctx.sandboxPolicy.defaultMode`——与执行时所解析的每会话覆盖之下的同一部署默认值。`remote-declared` 的 profile 若未组合 `ctx.sandboxPolicy` 服务，将以"缺失事实"错误拒绝，而非猜测。本插件未被任何 shipped profile 组合：安装此包不会改变任何 shipped profile 的配置；部署通过在自己的组合中加入该行来选择启用。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节 — 点击展开</summary>

本节解释拒绝谓词及每项事实的来源；可观察行为已在[使用本包](#use-this-package)中完整覆盖。

### 拒绝规则

| `exposure` | `authKind` | 有效预设 | 结果 |
|---|---|---|---|
| `loopback-only` | 任意 | 任意 | 启动 |
| `remote-declared` | `token` | 任意 | 启动 |
| `remote-declared` | `none` | 低于 `danger-full-access` | 启动 |
| `remote-declared` | `none` | `danger-full-access` | **就绪前拒绝** |

权限读取刻意保持可选（`ctx.get('sandboxPolicy')`）：回环声明永远不需要属主；而声明注入会让该行在缺失 provider 时永远等待，而不是在远端声明下响亮失败。

拒绝错误会点名全部三项事实，且以下任一补救即可改变结果：

- 当没有任何桥接将此套接字延伸到回环主机之外时，声明 `exposure: 'loopback-only'`；
- 组合真实的应用认证并将 `authKind` 设为其类别（如 `'token'`）——`trustedHosts`/Host/Origin 校验不是认证；
- 将有效权限预设降到 `danger-full-access` 以下（`sandboxPolicy` 配置的 `mode`，如 `read-only` 或 `workspace-write`）。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`name`/`inject`/`Config`/`apply`、声明事实的解析与拒绝规则 |
| — | 不发布运行时不变量伴随件；守卫不注册任何服务、事件或副作用，也不拥有可变数据——其全部契约就是激活时的同步求值，由包级测试强制保证。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当守卫拦截了某次部署，或拒绝谓词不够用时阅读这些页面。它们从权限属主服务走向策略词汇与分组地图。

- [Sandbox policy](../../../packages/sandbox/sandbox-policy/README.zh.md) — `ctx.sandboxPolicy.defaultMode` 背后的属主服务。
- [Sandbox 子系统](../../../docs/subsystems/sandbox.zh.md) — 权限模式词汇与每会话覆盖。
- [guard 分组地图](../README.zh.md) — 同组守卫包与 loop-hygiene 家族。

-----

<a id="model-experience"></a>
## 模型体验

### 启动期求值

#### 模型所见

无。`deployment-refusal` 插件不注册任何 prompt section、工具 schema、会话事件或其他模型可见上下文；被拒绝时进程在任何就绪之前失败，根本不存在可供模型加入的会话。

#### Token 影响

所有情况下均为零 token：求值发生在插件激活时、针对配置值进行，从不触及请求或历史。

#### KV Cache 影响

无。插件不为任何请求前缀或缓存键贡献内容。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制说明本守卫何时不适用。它们是当前包约束，不是任务积压。

- **仅限部署默认值范围** — 守卫只在启动时校验 `ctx.sandboxPolicy.defaultMode`；运行期间后续切换的每会话 `sandbox/mode` 覆盖不会被重新评估。
- **只认声明的事实，刻意为之** — 实际可达远端但声明 `exposure: 'loopback-only'` 的部署得不到保护；探测机制与本包赖以成立的声明式契约相悖。
- **`authKind` 是声明而非强制** — 设置 `'token'` 并不会安装任何认证代理；它只记录已组合这一事实，因此虚假的声明会让守卫沉默。
- **只查阅预设中 sandbox 一半** — approval-policy 旋钮（`ask`/`never`）不在拒绝谓词之内；仅 `danger-full-access` 即可触发。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
