# Agent Note: 检查注册表通过仍然挂载的持有者执行查询

Status: implemented

[English](2026-08-22-inspect-registry-live-holder.md) | 中文

## Problem

Host Cordis 检查注册表通过保存第一个挂载的注册并对同一 id 的后续挂载计数来跨 preset 挂载去重 provider id。当第一个挂载的 preset 卸载而另一个持有者仍然挂载时，共享条目带着正引用计数存活，但其查询处理函数仍闭包引用已销毁 preset 的 context，因此检查查询会在已死的 context 上执行。既有回归测试只断言 disposal 后 id 仍在列表中，从未调用幸存的处理器。

## Decision

`register()` 现在把每个挂载的注册追加到按 id 分组的列表中。每个挂载的 disposer 只移除自己的条目，最后一个条目消失时该 id 才被驱逐。Host 查询和 `list()` 视图解析到最近注册且仍存活的条目，并在较新的持有者销毁时回退到更早的条目，因此每个被执行的处理器都属于仍然挂载的 context。

## Alternatives considered

**拒绝冲突的同 id 注册。** 不采用，因为今天的静态 provider 从每个 preset 副本注册完全相同的 manifest，硬性失败会重新引入共享 id 本要避免的会话创建故障，同时对已销毁闭包这一危险本身毫无帮助。

**保留 first-wins 存储，在 disposal 时重绑存储的处理器。** 不采用，因为这会把可变的重绑逻辑移进查询路径；有序的按 id 列表使归属显式，disposal 以常数代价移除一个条目。

**把静态 provider 改为 host 持有的单例并按活动 agent 解析。** 不采用，这需要跨越 `tool-cordis` 与 preset 组合的更大重构；按持有者分组的列表无需改变注册方即可修复该危险。

## Verification

`inspect-registry.spec.ts` 在第一个持有者销毁后执行查询并断言由幸存处理器应答；断言多持有者存活时 newest-wins、最新者销毁后回退；覆盖未注册 Host provider id 的拒绝路径；并以两种顺序（先 splice 后复用、先驱逐后复用）验证重复 disposal 是无操作。

## Consequences

共享的 provider id 总是路由到已挂载的 context。last-registration-wins 也意味着两个持有者在同一 id 下注册不同 manifest 时以最新的为准 —— 这正是动态插件替换所需要的行为 —— 而相同的静态 manifest 不受影响。每次挂载的 disposal 保持常数时间，引用计数映射已删除。
