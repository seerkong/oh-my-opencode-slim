import { log } from '../../utils/logger';

/**
 * 恢复钩子可以检测到的已知错误类型。
 */
export type ErrorType =
  | 'tool_result_missing'
  | 'context_window_exceeded'
  | 'rate_limit'
  | 'api_error'
  | 'unknown';

/**
 * 从错误消息或 API 响应中检测错误类型。
 *
 * 处理常见的 LLM API 错误模式：
 * - tool_result_missing: tool_use 块没有匹配的 tool_result
 * - context_window_exceeded: token/上下文限制错误
 * - rate_limit: 429 / 速率限制错误
 * - api_error: 通用 5xx / 服务器错误
 */
export function detectErrorType(errorMessage: string): ErrorType {
  if (!errorMessage) return 'unknown';

  const lower = errorMessage.toLowerCase();

  // tool_result_missing: Anthropic 风格的错误，当 tool_use 没有对应结果时
  if (lower.includes('tool_use') && lower.includes('tool_result')) {
    return 'tool_result_missing';
  }
  if (lower.includes('tool_result_missing')) {
    return 'tool_result_missing';
  }
  if (
    lower.includes('must have a corresponding tool result') ||
    lower.includes('missing tool result') ||
    lower.includes('expected tool_result')
  ) {
    return 'tool_result_missing';
  }

  // 上下文窗口超出限制
  if (
    lower.includes('context window') ||
    lower.includes('context length') ||
    lower.includes('maximum context') ||
    lower.includes('token limit') ||
    lower.includes('max_tokens') ||
    lower.includes('too many tokens')
  ) {
    return 'context_window_exceeded';
  }

  // 速率限制
  if (
    lower.includes('rate limit') ||
    lower.includes('rate_limit') ||
    lower.includes('429') ||
    lower.includes('too many requests')
  ) {
    return 'rate_limit';
  }

  // API 错误（通用服务器错误）
  if (
    lower.includes('500') ||
    lower.includes('502') ||
    lower.includes('503') ||
    lower.includes('internal server error') ||
    lower.includes('service unavailable') ||
    lower.includes('bad gateway') ||
    lower.includes('overloaded')
  ) {
    return 'api_error';
  }

  return 'unknown';
}

/**
 * 表示 API 对话中的单个消息部分。
 */
interface MessagePart {
  type: string;
  id?: string;
  tool_use_id?: string;
  name?: string;
  content?: unknown;
  [key: string]: unknown;
}

/**
 * 表示 API 对话中的一条消息。
 */
interface ApiMessage {
  role: string;
  content: string | MessagePart[];
}

/**
 * 尝试通过为孤立的 tool_use 块注入存根 tool_result 部分
 * 来恢复 tool_result_missing 错误。
 *
 * 此操作仅在消息数组上进行（不涉及文件系统操作）。
 * 返回修补后的消息，如果无法恢复则返回 null。
 */
export function recoverToolResultMissing(
  messages: ApiMessage[],
): ApiMessage[] | null {
  // 收集所有 tool_use ID 和 tool_result ID
  const toolUseIds = new Set<string>();
  const toolResultIds = new Set<string>();

  for (const msg of messages) {
    if (typeof msg.content === 'string') continue;
    if (!Array.isArray(msg.content)) continue;

    for (const part of msg.content) {
      if (part.type === 'tool_use' && part.id) {
        toolUseIds.add(part.id);
      }
      if (part.type === 'tool_result' && part.tool_use_id) {
        toolResultIds.add(part.tool_use_id);
      }
    }
  }

  // 查找孤立的 tool_use ID（没有匹配的 tool_result）
  const orphanedIds: string[] = [];
  for (const id of toolUseIds) {
    if (!toolResultIds.has(id)) {
      orphanedIds.push(id);
    }
  }

  if (orphanedIds.length === 0) return null;

  log('[session-recovery] Found orphaned tool_use blocks', {
    count: orphanedIds.length,
    ids: orphanedIds,
  });

  // 深拷贝消息以避免修改原始数据
  const patched: ApiMessage[] = JSON.parse(JSON.stringify(messages));

  // 对于每个孤立的 tool_use，找到包含它的 assistant 消息
  // 并在其后注入一条带有存根 tool_result 的 user 消息
  const result: ApiMessage[] = [];

  for (const msg of patched) {
    result.push(msg);

    if (msg.role !== 'assistant') continue;
    if (typeof msg.content === 'string') continue;
    if (!Array.isArray(msg.content)) continue;

    const orphansInMsg = msg.content
      .filter(
        (p) => p.type === 'tool_use' && p.id && orphanedIds.includes(p.id),
      )
      .map((p) => p.id as string);

    if (orphansInMsg.length === 0) continue;

    // 检查下一条消息是否已经提供了这些结果
    // （可能部分已存在）
    const stubParts: MessagePart[] = orphansInMsg.map((id) => ({
      type: 'tool_result',
      tool_use_id: id,
      content: '[Recovery] 工具执行被中断。结果不可用。',
    }));

    result.push({
      role: 'user',
      content: stubParts,
    });

    log('[session-recovery] Injected stub tool_results', {
      ids: orphansInMsg,
    });
  }

  return result;
}
