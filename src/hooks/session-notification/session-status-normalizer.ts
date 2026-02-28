/**
 * 将 session.status (type=idle) 标准化为合成的 session.idle 事件。
 *
 * OpenCode 通过两种方式发出空闲信号：
 * 1. 原生 `session.idle` 事件
 * 2. `session.status` 事件，其中 status.type === 'idle'
 *
 * 本模块将第 2 种转换为与第 1 种相同的格式，
 * 配合去重逻辑避免同一次空闲被处理两次。
 *
 * 参考 oh-my-opencode: src/plugin/session-status-normalizer.ts
 */

type EventInput = {
  event: { type: string; properties?: Record<string, unknown> };
};

type SessionStatus = { type: string };

/**
 * 如果输入是 session.status (type=idle)，返回合成的 session.idle 事件。
 * 否则返回 null。
 */
export function normalizeSessionStatusToIdle(
  input: EventInput,
): EventInput | null {
  if (input.event.type !== 'session.status') return null;

  const props = input.event.properties;
  if (!props) return null;

  const status = props.status as SessionStatus | undefined;
  if (!status || status.type !== 'idle') return null;

  const sessionID = props.sessionID as string | undefined;
  if (!sessionID) return null;

  return {
    event: {
      type: 'session.idle',
      properties: { sessionID },
    },
  };
}

/**
 * 清理过期的合成 idle 去重记录。
 *
 * 参考 oh-my-opencode: src/plugin/recent-synthetic-idles.ts
 */
export function pruneRecentIdles(args: {
  recentSyntheticIdles: Map<string, number>;
  recentRealIdles: Map<string, number>;
  now: number;
  dedupWindowMs: number;
}): void {
  const { recentSyntheticIdles, recentRealIdles, now, dedupWindowMs } = args;

  for (const [sessionID, emittedAt] of recentSyntheticIdles) {
    if (now - emittedAt >= dedupWindowMs) {
      recentSyntheticIdles.delete(sessionID);
    }
  }

  for (const [sessionID, emittedAt] of recentRealIdles) {
    if (now - emittedAt >= dedupWindowMs) {
      recentRealIdles.delete(sessionID);
    }
  }
}
