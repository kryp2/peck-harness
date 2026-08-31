# @deepseek-ai/dsh-guard-deployment-refusal

[English](README.md) | 中文

一个基于显式部署事实声明的启动门禁，而非运行时守卫：当操作者的声明同时组合了非回环可达性、缺失的应用认证以及 `danger-full-access` 权限预设时，它会在任何就绪副作用之前令 harness 启动失败。这些事实只从配置读取——绝无探测。`dsh web` 进程绑定回环接口，而外部 socat 桥、反向代理或端口转发才制造了实际可达性，因此套接字与接口检查无法推断暴露面；本插件只对声明内容作出拒绝判定。`trustedHosts`/Host/Origin 校验属于浏览器信任围栏，不是应用认证，永远不能满足 `authKind`。

## Plugin (namespace: `deployment-refusal`)

函数插件（`name` / `inject` / `Config` / `apply`），不注册任何服务、事件或工具：它的全部契约就是激活时的同步求值，因此没有需要释放的资源，HMR 重载会在新 fiber 上重新执行同一求值。

```yaml
- id: deployment-refusal
  name: '@deepseek-ai/dsh-guard-deployment-refusal'
  config:
    exposure: remote-declared   # default 'loopback-only'; who can reach this socket through bridges included
    authKind: none              # default 'none'; 'token' = real application authentication composed
```

对于由 socat/WireGuard、代理或任何外部转发器前置的回环绑定进程，`exposure: 'remote-declared'` 才是诚实的声明。`authKind: 'none'` 同样适用于只靠 `trustedHosts` 作为请求围栏的部署。

有效权限预设不在此配置：插件从其属主服务读取 `ctx.sandboxPolicy.defaultMode`——与执行时所解析的每会话覆盖之下的同一部署默认值。请将该行挂载在靠前位置（服务器/就绪行之前），使拒绝能在任何就绪宣告之前中止启动。

## Refusal rule

| `exposure` | `authKind` | 有效预设 | 结果 |
|---|---|---|---|
| `loopback-only` | 任意 | 任意 | 启动 |
| `remote-declared` | `token` | 任意 | 启动 |
| `remote-declared` | `none` | 低于 `danger-full-access` | 启动 |
| `remote-declared` | `none` | `danger-full-access` | **就绪前拒绝** |

配置错误会响亮失败：`remote-declared` 的 profile 若未组合 `ctx.sandboxPolicy` 服务，将以"缺失事实"错误拒绝，而非猜测。拒绝错误会点名全部三项事实，且以下任一补救即可改变结果：

- 当没有任何桥接将此套接字延伸到回环主机之外时，声明 `exposure: 'loopback-only'`；
- 组合真实的应用认证并将 `authKind` 设为其类别（如 `'token'`）——`trustedHosts`/Host/Origin 校验不是认证；
- 将有效权限预设降到 `danger-full-access` 以下（`sandboxPolicy` 配置的 `mode`，如 `read-only` 或 `workspace-write`）。

本插件未被任何 shipped profile 组合：安装此包不会改变任何 shipped profile 的配置。部署通过在自己的组合中加入该行来选择启用。

## Model Experience

### Startup evaluation

#### What the model sees

无。`deployment-refusal` 插件不注册任何 prompt section、工具 schema、会话事件或其他模型可见上下文；被拒绝时进程在任何就绪之前失败，根本不存在可供模型加入的会话。

#### Token effect

所有情况下均为零 token：求值发生在插件激活时、针对配置值进行，从不触及请求或历史。

#### KV Cache effect

无。插件不为任何请求前缀或缓存键贡献内容。

## Known Limitations and Deferred Work

- **仅限部署默认值范围** — 守卫只在启动时校验 `ctx.sandboxPolicy.defaultMode`；运行期间后续切换的每会话 `sandbox/mode` 覆盖不会被重新评估。
- **只认声明的事实，刻意为之** — 实际可达远端但声明 `exposure: 'loopback-only'` 的部署得不到保护；探测机制与本包赖以成立的声明式契约相悖。
- **`authKind` 是声明而非强制** — 设置 `'token'` 并不会安装任何认证代理；它只记录已组合这一事实，因此虚假的声明会让守卫沉默。
- **只查阅预设中 sandbox 一半** — approval-policy 旋钮（`ask`/`never`）不在拒绝谓词之内；仅 `danger-full-access` 即可触发。
