# Agent Note: User-questions concurrent attempt racing

Status: implemented

[English](2026-08-24-user-questions-concurrent-attempt-racing.md) | 中文

## 问题

`'user-questions/ask'` seam 以 Cordis 瀑布派发：监听器按从外到内的顺序执行，注册顺序决定了问题先到达哪个通道。Web GUI 回答者持有自己的 Promise 而不向下委托；Telegram 回答者只有在 Web 通道结算之后才收到问题——而它的长轮询按当时的文档设计忽略中止信号，在提问早已结束之后仍可能继续轮询 30 分钟。seam 文档承诺"跨通道先答者胜"，但机制实际交付的是"监听器顺序者胜"。

## 决策

`UserQuestionService.ask()` 现在采用竞速：它通过事件总线一次性解析出过滤后的监听器（`EventsService.dispatch`，作用域链准入、载体校验、fiber 托管的释放都与之前完全一致），然后用同一个请求和每个派发共享的一个竞速信号并发调用它们。`raceUserQuestionAttempts` 中的同步结算守卫保证无论微任务如何交错，恰好只有一条解析路径获胜；落败的尝试会观察到竞速信号被中止，其原因是说明缘由的 `UserQuestionError`（`SUPERSEDED`，或调用方自己的 `ASK_ABORTED` 错误）。

监听器契约从瀑布改为竞速参与者：

- 以回答 resolve 表示认领；第一个兑现的结算整个提问；
- 以 `undefined` resolve 表示婉拒（通道无法或不愿回答）并释放自己的名额;
- 仅以 `UserQuestionError` reject 报告权威失败——它会让整个提问对所有通道结算；任何其他拒绝等同于婉拒的通道失败。

没有尝试、或全部婉拒或以通道失败告终时，提问照旧以 `NO_ANSWERER` 拒绝。调用方中止仍以 `ASK_ABORTED` 结算并取消所有尝试。Telegram 回答者的长轮询现在诚实地观察取消：信号随每次 curl 运行传递，轮询循环在下一圈停止，排队中被取消的尝试直接跳过而不触碰 Telegram。它的落败清理会尽力通过 Bot API `editMessageText`（沿用相同的环境变量携带 URL 的 curl 模式）编辑每条已发送消息并追加"(answered elsewhere)"——仅在 `SUPERSEDED` 落败时执行；调用方中止时没有任何人回答，绝不追加；也绝不会把异常抛进获胜路径。Web 回答者在落败时以 `undefined` 解决自己的挂起条目，并通过广播 `question/resolved` 撤下 GUI 表面；线上词汇保留既有的 `answered | cancelled` 结果，取代（supersession）借用 `cancelled` 表达。

## 已考虑的替代方案

**保留顺序瀑布，让各通道超时更快。** 否决：缺陷在于顺序而非耐心——不委托的监听器仍会独占问题，超时只会增加延迟而不是消除它。

**用服务自有的尝试注册表替换事件**（在 `ctx.userQuestions` 上提供 `registerAttempt`）。否决：注册表必须重新实现事件总线已拥有的能力：agent 作用域回答者的作用域链准入、fiber 托管的释放，以及 `'user-questions/ask'` 的生成式 scoped-event 主体映射。

**把所有拒绝都视为权威失败。** 否决：单个通道的传输失败会杀死其他所有通道的提问，回退掉如今把 telegram-only 失败固定为 `NO_ANSWERER` 的组合式 fail-closed 行为。

**把所有拒绝都视为婉拒。** 出于镜像原因否决：Web GUI 的"用户已取消"是对问题本身的终态决定。让较慢的通道在用户按下取消之后继续作答，等于允许一个人推翻另一个人，还会破坏计划评审——其驳回必须原样抵达调用方。

## 后果

多通道组合下的提问同时到达每个通道，第一个人类回答不论组合顺序都会获胜，落败者确定性地清理而不是轮询到超时。分类规则赋予错误分类学操作含义：`UserQuestionError` 拒绝对整个提问是终态，外部错误保持通道局部。代价：婉拒通道的诊断不再抵达调用方（只有聚合后的 `NO_ANSWERER` 会）；声明的 `@mode parallel` 描述的是并发调用家族，而非 `ctx.parallel` 的全落定聚合——事件 JSDoc 拥有精确的竞速契约。取代交叉引用：[2026-08-16-user-questions-waterfall-telegram](../../proposed/architecture/2026-08-16-user-questions-waterfall-telegram.zh.md) 中的多通道提案预见了扇出投递，但规定的是顺序链；本笔记替换该派发形态，同时保留其注册与作用域模型。
