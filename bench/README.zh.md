# Peck Bench

[English](README.md) | 中文

Peck Bench 通过同一套 DeepSeek Harness 组合来比较模型。每次运行都会获得同一 fixture（测试前置数据）、提示、工具、超时和评分器的全新副本；只有提供方路由和模型不同。隐藏的评分器代码位于复制给模型的工作区之外。

`coding-v1` 套件涵盖分页边界、经过验证的 JSON Lines 聚合、HTTP 重试策略，以及不修改输入的递归配置合并。这些用例覆盖不同的实现与验证行为，而不是重复同一种缺陷。

## 运行

运行 `pnpm install` 后安装当前检出版本的 SDK，在不调用 API 的情况下验证配置，然后运行配对比较。在 Harness 检出目录内，运行器使用源码 JSON-RPC 运行时；在该目录外，则使用 SDK 自带的运行时。

```sh
python -m pip install -e python/sdk
python bench/peck_bench.py validate
export OPENCODE_GO_API_KEY=...
python bench/peck_bench.py run --repetitions 3
```

使用 `--model omen-alpha` 只选择一个模型，使用 `--output DIR` 更改运行产物位置。每次运行都会保留复制的工作区、Harness 会话日志、评分器输出和结果 JSON。每次尝试完成后，套件都会写入 `summary.json` 和 `summary.md`。

Fixture 不得包含 secret（密钥）或生产配置。Harness 工具从复制的 fixture 开始运行，但此 MVP 并非操作系统 sandbox（沙箱）。不要将其用于不受信任的模型或敏感的主机状态。确定性评分器决定通过或失败。缺失的提供方用量保持未知，而不会被估算；路由决策需要多次重复运行。
