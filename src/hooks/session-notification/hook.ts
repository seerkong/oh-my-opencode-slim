import { log } from '../../utils/logger';
import { type NotifyOptions, sendNotification } from './notify';

export interface SessionNotificationOptions {
  /** 空闲超时时间（毫秒），超时后发送通知（默认: 30_000） */
  idleTimeoutMs?: number;
  /** 通知时是否播放声音（默认: true） */
  sound?: boolean;
}

const DEFAULT_IDLE_TIMEOUT_MS = 30_000;

/**
 * 创建会话通知钩子。
 *
 * 通过会话事件跟踪活动状态。当会话空闲
 * （在 `idleTimeoutMs` 时间内无事件）时，触发桌面通知。
 * 子代理会话（具有 parentID 的会话）会被跟踪，但不会
 * 触发自己的通知——只有根会话才会触发。
 */
export function createSessionNotificationHook(
  options: SessionNotificationOptions = {},
) {
  const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  const sound = options.sound ?? true;

  /** 已知的子代理会话 ID 集合（具有 parentID）。 */
  const subagentSessions = new Set<string>();

  /** 每个根会话的防抖定时器句柄。 */
  const idleTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /** 取消会话的待处理空闲定时器。 */
  function cancelIdle(sessionID: string): void {
    const existing = idleTimers.get(sessionID);
    if (existing) {
      clearTimeout(existing);
      idleTimers.delete(sessionID);
    }
  }

  /** 为根会话安排空闲通知。 */
  function scheduleIdle(sessionID: string): void {
    cancelIdle(sessionID);
    const timer = setTimeout(() => {
      idleTimers.delete(sessionID);
      fireNotification(sessionID);
    }, idleTimeoutMs);
    idleTimers.set(sessionID, timer);
  }

  async function fireNotification(sessionID: string): Promise<void> {
    const opts: NotifyOptions = {
      title: 'OpenCode — 会话空闲',
      message: `会话 ${sessionID.slice(0, 8)} 正在等待输入。`,
      sound,
    };
    log('[session-notification] Firing idle notification', {
      sessionID,
    });
    await sendNotification(opts);
  }

  return {
    event: (input: {
      event: {
        type: string;
        properties?: Record<string, unknown>;
      };
    }) => {
      const { type, properties } = input.event;

      // --- session.created: 注册子代理，为根会话启动空闲计时 ---
      if (type === 'session.created') {
        const info = (
          properties as { info?: { id?: string; parentID?: string } }
        )?.info;
        const sessionID = info?.id;
        if (!sessionID) return;

        if (info?.parentID) {
          subagentSessions.add(sessionID);
          log('[session-notification] Subagent session registered', {
            sessionID,
            parentID: info.parentID,
          });
          return; // 跳过子代理的空闲调度
        }

        scheduleIdle(sessionID);
        return;
      }

      // --- session.status: 活动信号或完成 ---
      if (type === 'session.status') {
        const sessionID = (properties as { sessionID?: string })?.sessionID;
        if (!sessionID) return;

        // 跳过子代理会话
        if (subagentSessions.has(sessionID)) return;

        const statusType = (properties as { status?: { type: string } })?.status
          ?.type;

        if (
          statusType === 'completed' ||
          statusType === 'error' ||
          statusType === 'cancelled'
        ) {
          cancelIdle(sessionID);
          subagentSessions.delete(sessionID); // cleanup
          return;
        }

        // 其他状态均为活动信号——重置防抖
        scheduleIdle(sessionID);
        return;
      }

      // --- session.updated: 活动信号 ---
      if (type === 'session.updated') {
        const sessionID = (properties as { sessionID?: string })?.sessionID;
        if (!sessionID) return;
        if (subagentSessions.has(sessionID)) return;
        scheduleIdle(sessionID);
      }
    },
  };
}
