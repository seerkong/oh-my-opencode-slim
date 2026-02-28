# Task Plan: 修复空闲通知误报 + 完善事件类型系统

## Goal
1. 重写 session-notification hook，从自造 30s 定时器改为监听原生 `session.idle` 事件驱动，参考 oh-my-opencode 实现
2. 在 event multiplexer 中添加所有 OpenCode 事件类型的监听代码（含注释），便于后续扩展
3. 添加完整的事件类型定义

## Phases

### Phase 1: 添加事件类型定义 `[pending]`
- 创建 `src/types/events.ts`，定义所有 16 种 OpenCode 事件类型
- 包含 session.*, message.*, tool.*, chat.*, command.*, experimental.* 全部类型

### Phase 2: 重写 session-notification hook `[pending]`
- **scheduler**: 新建 `src/hooks/session-notification/scheduler.ts`，实现版本化防抖 + 执行锁 + 活动追踪
- **hook**: 重写 `hook.ts`，改为监听 `session.idle` 事件 + `message.updated` / `tool.execute.before/after` 活动信号
- **normalizer**: 新建 `src/hooks/session-notification/session-status-normalizer.ts`，将 `session.status(idle)` 转为合成 `session.idle`
- 保留现有 `notify.ts` 不变

### Phase 3: 更新 event multiplexer `[pending]`
- 在 `src/index.ts` 的 event handler 中添加所有事件类型的监听框架
- 添加 session.idle 合成 + 去重逻辑
- 每个事件类型加注释说明用途

### Phase 4: 验证 `[pending]`
- typecheck
- lint
- test

## Files to Create
- `src/types/events.ts` — 事件类型定义
- `src/hooks/session-notification/scheduler.ts` — 版本化调度器
- `src/hooks/session-notification/session-status-normalizer.ts` — 状态标准化

## Files to Modify
- `src/hooks/session-notification/hook.ts` — 重写为事件驱动
- `src/hooks/session-notification/index.ts` — 更新导出
- `src/index.ts` — 更新 event multiplexer + 类型导入
