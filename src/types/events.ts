/**
 * OpenCode 插件事件类型定义。
 *
 * 完整覆盖 oh-my-opencode 中使用的所有 16 种事件类型，
 * 按类别分组：session / message / tool / chat / command / experimental。
 * 即使当前未使用的事件也已定义，便于后续扩展。
 */

// ---------------------------------------------------------------------------
// 1. Session 事件 — 会话生命周期
// ---------------------------------------------------------------------------

/** 新会话创建。包含会话 ID、父会话 ID（子代理）、标题等。 */
export interface SessionCreatedEvent {
  type: 'session.created';
  properties?: {
    info?: {
      id?: string;
      parentID?: string;
      title?: string;
    };
  };
}

/**
 * 会话进入空闲状态（agent 完成工作，等待用户输入）。
 *
 * 这是通知用户的核心信号。注意：OpenCode 同时通过
 * `session.status` (type=idle) 和原生 `session.idle` 两种方式
 * 发出空闲信号，需要去重处理。
 */
export interface SessionIdleEvent {
  type: 'session.idle';
  properties?: {
    sessionID?: string;
  };
}

/**
 * 会话状态变更。子类型包括：
 * - `idle`: agent 空闲（可合成为 session.idle）
 * - `busy`: agent 正在工作
 * - `retry`: 正在重试
 * - `completed`: 会话完成
 * - `error`: 会话出错
 * - `cancelled`: 会话取消
 */
export interface SessionStatusEvent {
  type: 'session.status';
  properties?: {
    sessionID?: string;
    status?: {
      type: string;
    };
  };
}

/** 会话更新（通用活动信号）。 */
export interface SessionUpdatedEvent {
  type: 'session.updated';
  properties?: {
    sessionID?: string;
  };
}

/** 会话发生错误。 */
export interface SessionErrorEvent {
  type: 'session.error';
  properties?: {
    sessionID?: string;
    messageID?: string;
    error?: unknown;
  };
}

/** 会话被删除/销毁。用于清理状态。 */
export interface SessionDeletedEvent {
  type: 'session.deleted';
  properties?: {
    info?: {
      id?: string;
    };
  };
}

/** 会话上下文被压缩/摘要化。用于重新注入必要上下文。 */
export interface SessionCompactedEvent {
  type: 'session.compacted';
  properties?: {
    sessionID?: string;
  };
}

// ---------------------------------------------------------------------------
// 2. Message 事件 — 消息更新
// ---------------------------------------------------------------------------

/** 完整消息更新（包含角色、内容、模型信息等）。 */
export interface MessageUpdatedEvent {
  type: 'message.updated';
  properties?: {
    info?: {
      id?: string;
      sessionID?: string;
      role?: string;
      agent?: string;
      model?: string;
      content?: unknown;
    };
  };
}

/** 流式消息片段更新（文本块、工具调用等）。 */
export interface MessagePartUpdatedEvent {
  type: 'message.part.updated';
  properties?: {
    info?: {
      sessionID?: string;
      messageID?: string;
      part?: unknown;
    };
  };
}

// ---------------------------------------------------------------------------
// 3. Tool 事件 — 工具执行
// ---------------------------------------------------------------------------

/** 工具执行前（可修改输入、阻止执行）。通过 tool.execute.before hook 处理。 */
export interface ToolExecuteBeforeEvent {
  type: 'tool.execute.before';
  properties?: {
    sessionID?: string;
    tool?: string;
    callID?: string;
    input?: unknown;
  };
}

/** 工具执行后（可修改输出、注入上下文）。通过 tool.execute.after hook 处理。 */
export interface ToolExecuteAfterEvent {
  type: 'tool.execute.after';
  properties?: {
    sessionID?: string;
    tool?: string;
    callID?: string;
    output?: unknown;
  };
}

/** 工具执行事件（CLI 事件流，合并 before/after 用于显示）。 */
export interface ToolExecuteEvent {
  type: 'tool.execute';
  properties?: {
    sessionID?: string;
    tool?: string;
    args?: unknown;
  };
}

/** 工具结果返回（CLI 事件流）。 */
export interface ToolResultEvent {
  type: 'tool.result';
  properties?: {
    sessionID?: string;
    tool?: string;
    result?: unknown;
  };
}

// ---------------------------------------------------------------------------
// 4. Chat 事件 — 聊天/消息组合
// ---------------------------------------------------------------------------

/** 修改聊天参数（模型、effort level、thinking 等）。通过 chat.params hook 处理。 */
export interface ChatParamsEvent {
  type: 'chat.params';
  properties?: Record<string, unknown>;
}

/** 拦截/修改用户消息（发送前）。通过 chat.message hook 处理。 */
export interface ChatMessageEvent {
  type: 'chat.message';
  properties?: {
    sessionID?: string;
    parts?: unknown[];
  };
}

/** 转换完整消息数组（API 调用前）。通过 experimental.chat.messages.transform hook 处理。 */
export interface ExperimentalChatMessagesTransformEvent {
  type: 'experimental.chat.messages.transform';
  properties?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// 5. Command 事件 — 斜杠命令
// ---------------------------------------------------------------------------

/** 斜杠命令执行前（可注入模板）。 */
export interface CommandExecuteBeforeEvent {
  type: 'command.execute.before';
  properties?: {
    command?: string;
    args?: unknown;
  };
}

// ---------------------------------------------------------------------------
// 6. Experimental 事件
// ---------------------------------------------------------------------------

/** 会话压缩/摘要化处理器（PreCompact）。 */
export interface ExperimentalSessionCompactingEvent {
  type: 'experimental.session.compacting';
  properties?: {
    sessionID?: string;
  };
}

// ---------------------------------------------------------------------------
// 联合类型
// ---------------------------------------------------------------------------

/** 所有 OpenCode 事件类型的联合。 */
export type OpenCodeEvent =
  // session
  | SessionCreatedEvent
  | SessionIdleEvent
  | SessionStatusEvent
  | SessionUpdatedEvent
  | SessionErrorEvent
  | SessionDeletedEvent
  | SessionCompactedEvent
  // message
  | MessageUpdatedEvent
  | MessagePartUpdatedEvent
  // tool
  | ToolExecuteBeforeEvent
  | ToolExecuteAfterEvent
  | ToolExecuteEvent
  | ToolResultEvent
  // chat
  | ChatParamsEvent
  | ChatMessageEvent
  | ExperimentalChatMessagesTransformEvent
  // command
  | CommandExecuteBeforeEvent
  // experimental
  | ExperimentalSessionCompactingEvent;

/** 所有事件类型字符串的联合。 */
export type OpenCodeEventType = OpenCodeEvent['type'];

/**
 * 事件类型字符串常量，便于在代码中引用而非硬编码字符串。
 */
export const EVENT_TYPES = {
  // session
  SESSION_CREATED: 'session.created',
  SESSION_IDLE: 'session.idle',
  SESSION_STATUS: 'session.status',
  SESSION_UPDATED: 'session.updated',
  SESSION_ERROR: 'session.error',
  SESSION_DELETED: 'session.deleted',
  SESSION_COMPACTED: 'session.compacted',
  // message
  MESSAGE_UPDATED: 'message.updated',
  MESSAGE_PART_UPDATED: 'message.part.updated',
  // tool
  TOOL_EXECUTE_BEFORE: 'tool.execute.before',
  TOOL_EXECUTE_AFTER: 'tool.execute.after',
  TOOL_EXECUTE: 'tool.execute',
  TOOL_RESULT: 'tool.result',
  // chat
  CHAT_PARAMS: 'chat.params',
  CHAT_MESSAGE: 'chat.message',
  EXPERIMENTAL_CHAT_MESSAGES_TRANSFORM: 'experimental.chat.messages.transform',
  // command
  COMMAND_EXECUTE_BEFORE: 'command.execute.before',
  // experimental
  EXPERIMENTAL_SESSION_COMPACTING: 'experimental.session.compacting',
} as const;
