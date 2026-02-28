/**
 * 会话空闲通知钩子（事件驱动版）。
 *
 * 核心改动：从自造 30s 防抖定时器改为监听原生 `session.idle` 事件，
 * 配合版本化调度器的多重守卫防止误报。
 *
 * 事件流：
 * 1. `session.idle` → 调度通知（1.5s 确认延迟）
 * 2. `session.created` / `message.updated` / `tool.execute.before` /
 *    `tool.execute.after` → 标记活动，取消待发通知
 * 3. `session.deleted` → 完全清理会话状态
 *
 * 参考 oh-my-opencode: src/hooks/session-notification.ts
 */

import { log } from '../../utils/logger';
import {
  createIdleNotificationScheduler,
  type IdleNotificationConfig,
} from './scheduler';

export interface SessionNotificationOptions {
  /** 通知标题（默认: 'OpenCode — 会话空闲'） */
  title?: string;
  /** 通知消息（默认: 'Agent 正在等待输入'） */
  message?: string;
  /** 通知时是否播放声音（默认: true） */
  sound?: boolean;
  /**
   * 收到 idle 信号后的确认延迟（毫秒）。
   * 在此期间如果有新活动，通知会被取消。
   * 默认: 1500
   */
  idleConfirmationDelay?: number;
  /** 连续通知的指数退避倍数（默认: 2） */
  backoffMultiplier?: number;
  /** 指数退避延迟上限（毫秒，默认: 60000） */
  maxIdleConfirmationDelay?: number;
  /** 最大跟踪会话数（默认: 100） */
  maxTrackedSessions?: number;
}

/**
 * 创建会话通知钩子。
 *
 * 监听 `session.idle` 事件触发通知，
 * 监听活动事件（message.updated、tool.execute.*）取消通知。
 * 子代理会话（具有 parentID）不触发通知。
 */
export function createSessionNotificationHook(
  options: SessionNotificationOptions = {},
) {
  const config: IdleNotificationConfig = {
    title: options.title ?? 'OpenCode — 会话空闲',
    message: options.message ?? 'Agent 正在等待输入。',
    sound: options.sound ?? true,
    idleConfirmationDelay: options.idleConfirmationDelay ?? 1500,
    backoffMultiplier: options.backoffMultiplier ?? 2,
    maxIdleConfirmationDelay: options.maxIdleConfirmationDelay ?? 60_000,
    maxTrackedSessions: options.maxTrackedSessions ?? 100,
  };

  const scheduler = createIdleNotificationScheduler(config);

  /** 已知的子代理会话 ID 集合（具有 parentID）。 */
  const subagentSessions = new Set<string>();

  /** 已知的主会话 ID（第一个无 parentID 的会话）。 */
  let mainSessionID: string | undefined;

  return {
    event: (input: {
      event: {
        type: string;
        properties?: Record<string, unknown>;
      };
    }) => {
      const { type, properties } = input.event;
      const props = properties as Record<string, unknown> | undefined;

      // --- session.created: 注册子代理，标记主会话活动 ---
      if (type === 'session.created') {
        const info = props?.info as
          | { id?: string; parentID?: string }
          | undefined;
        const sessionID = info?.id;
        if (!sessionID) return;

        if (info?.parentID) {
          subagentSessions.add(sessionID);
          log('[session-notification] Subagent session registered', {
            sessionID,
            parentID: info.parentID,
          });
          return;
        }

        // 记录主会话 ID
        mainSessionID = sessionID;
        scheduler.markSessionActivity(sessionID);
        return;
      }

      // --- session.idle: 核心空闲信号 → 调度通知 ---
      if (type === 'session.idle') {
        const sessionID = (props?.sessionID as string) ?? undefined;
        if (!sessionID) return;

        // 跳过子代理会话
        if (subagentSessions.has(sessionID)) return;

        // 只为主会话触发通知
        if (mainSessionID && sessionID !== mainSessionID) return;

        scheduler.scheduleIdleNotification(sessionID);
        return;
      }

      // --- message.updated: 活动信号 → 取消待发通知 ---
      if (type === 'message.updated') {
        const info = props?.info as { sessionID?: string } | undefined;
        const sessionID = info?.sessionID;
        if (sessionID) {
          scheduler.markSessionActivity(sessionID);
        }
        return;
      }

      // --- tool.execute.before / tool.execute.after: 活动信号 ---
      if (type === 'tool.execute.before' || type === 'tool.execute.after') {
        const sessionID = (props?.sessionID as string) ?? undefined;
        if (sessionID) {
          scheduler.markSessionActivity(sessionID);
        }
        return;
      }

      // --- session.status: 终态时取消，其他状态标记活动 ---
      if (type === 'session.status') {
        const sessionID = (props?.sessionID as string) ?? undefined;
        if (!sessionID) return;
        if (subagentSessions.has(sessionID)) return;

        const statusType = (props?.status as { type: string } | undefined)
          ?.type;

        if (
          statusType === 'completed' ||
          statusType === 'error' ||
          statusType === 'cancelled'
        ) {
          scheduler.deleteSession(sessionID);
          subagentSessions.delete(sessionID);
          return;
        }

        // busy / retry 等非终态 → 标记活动
        if (statusType && statusType !== 'idle') {
          scheduler.markSessionActivity(sessionID);
        }
        // 注意：status.type === 'idle' 不在这里处理，
        // 由 event multiplexer 合成为 session.idle 后统一处理
        return;
      }

      // --- session.deleted: 完全清理 ---
      if (type === 'session.deleted') {
        const info = props?.info as { id?: string } | undefined;
        if (info?.id) {
          scheduler.deleteSession(info.id);
          subagentSessions.delete(info.id);
          if (info.id === mainSessionID) {
            mainSessionID = undefined;
          }
        }
      }
    },
  };
}
