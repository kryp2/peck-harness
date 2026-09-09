# Agent Note: Deployment refusal guard over declared facts

Status: implemented

[English](2026-08-24-deployment-refusal-guard.md) | 中文

## Problem

审计中的 P0 问题：一个 harness 部署可能在无应用认证、且权限预设为 `danger-full-access` 的状态下变得可从宿主之外访问——即远程无认证代码执行。运行时无法仅凭进程自身检测到这一状态：`dsh web` 按设计绑定回环接口（命令行拒绝 `--host 0.0.0.0`），而外部经 WireGuard 的 socat 桥才制造出实际可达性。因此套接字与接口检查无法推断暴露面，且 `trustedHosts`/Host/Origin 围栏属于浏览器信任强制，不是认证（[载体级浏览器信任边界的 Agent Note](2026-07-28-api-browser-trust-boundary.zh.md) 拥有该围栏，并将远程部署认证记为延后事项）。基于检测的守卫要么误读所有部署，要么要求本仓库并不拥有的基础设施变更。

## Decision

`packages/guard/deployment-refusal`（`@deepseek-ai/dsh-guard-deployment-refusal`）是一个函数插件，其激活时对三项显式声明的事实求值，并在它们危险组合时在任何就绪副作用之前抛出：

1. **可达性** — `exposure: 'loopback-only' | 'remote-declared'`，由守卫自身的 `Config` 持有的新显式声明。对于被 socat/WireGuard 或任何外部转发器前置的回环绑定进程，`'remote-declared'` 才是诚实的取值；本地绑定地址不改变其含义。
2. **应用认证** — `authKind: 'none' | 'token'`，同样在守卫的 `Config` 中声明，故障安全默认值为 `'none'`。宿主技术栈目前不存在任何应用认证机制，因此 `'none'` 是唯一真实的默认值；`'token'` 记录部署已组合了某种认证。
3. **有效权限预设** — 从属主服务读取 `ctx.sandboxPolicy.defaultMode`，绝不复制进守卫配置。该服务本已拥有执行所解析的文件效果模式（位于每会话覆盖之下），因此守卫校验的正是执行所使用的值。预设表中的 `danger-full-access` 条目捆绑 sandbox 模式 `danger-full-access`；sandbox 模式才是操作性事实，谓词以它为准。

规则仅在"声明为远程 AND 认证为 `'none'` AND 有效模式为 `'danger-full-access'`"时拒绝；loopback-only 声明从不查阅其余事实。权限属主缺失的 `remote-declared` profile 会以缺失事实错误响亮失败而非猜测（misconfiguration-fails-loud 规则）。插件不注册任何服务、事件或工具——拒绝是 Loader 树启动内的同步抛出，按构造先于任何后续就绪行（URL 行与浏览器拉起都等待 Loader 结算）。它未被任何地方组合：任何 shipped profile 的行为都不改变；部署通过自己组合中的行选择启用，并应挂载在靠前位置。

## Alternatives considered

**以套接字/接口检查推断暴露面。** 因对本产品不成立而否决：进程绑定回环，而外部桥制造可达性，所以每次推断都在危险方向上出错（一个完全暴露的部署会被读作回环安全）。当操作者移动桥时，检测还会悄然改变语义——对一个安全门禁而言，这是本设计最不能承受的。

**把 `trustedHosts` 的存在当作认证。** 直接否决：Host/Origin 围栏保护浏览器表面免受 DNS 重绑定与跨站请求之害；它不对任何客户端进行认证，且对非浏览器调用方而言轻易不存在。拒绝消息明确点名这一点，以免有人通过添加信任条目来"补救"。

**从 `permission-presets` 配置读取权限事实。** 否决，因为 preset 服务只是旋钮之上的可选用户面层，并非属主：没有它的部署仍在 `ctx.sandboxPolicy.defaultMode` 下执行，而把 preset 表知识复制进守卫会造成第二处可能漂移的位置。

**改为在请求时强制执行。** 否决此缓解类别：逐请求拦截无法给出审计所要求的启动即失败属性，会在每次工具调用上运行，并且仍留有一个"已就绪但危险"的部署正在服务流量的窗口。

## Consequences

危险组合现在会在启动时响亮失败，点名全部三项事实与单步补救措施，而所有安全组合照常启动；最小权限或经过认证的远程部署仍然可以表达。显式事实的代价是双向的：实际可达远端却声明 `loopback-only` 的部署得不到保护，声明 `token` 却未真正组合认证会让守卫沉默——两者都是文档化限制而非可修复缺陷，因为任何启发式都会重新引入显式事实契约所消除的不成立性。启动后的运行时 `sandbox/mode` 切换不在范围内；守卫钉住的是部署默认值，而非每会话策略。验证位于包测试套件中：八种组合的真值表、消息内容断言、缺失属主失败，以及一次真实 Loader 组合——证明拒绝会中止启动，而同一棵树在 loopback-only 声明下正常启动。
