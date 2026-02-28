/**
 * 版本化空闲通知调度器。
 *
 * 参考 oh-my-opencode 的 session-notification-scheduler.ts 实现，
 * 提供多重守卫防止误报：
 * - 版本化防抖：每次取消都递增版本号，过期回调自动失效
 * - 执行锁：防止并发通知
 * - 活动追踪：idle 后有活动则取消通知
 * - 指数退避：连续 idle 通知间隔按指数增长，减少重复打扰
 */

import { log } from '../../utils/logger';
import { type NotifyOptions, sendNotification } from './notify';

export interface IdleNotificationConfig {
  /** 通知标题 */
  title: string;
  /** 通知消息 */
  message: string;
  /** 是否播放声音 */
  sound: boolean;
  /**
   * 收到 idle 信号后的确认延迟（毫秒）。
   * 在此期间如果有新活动，通知会被取消。
   * 默认: 1500
   */
  idleConfirmationDelay: number;
  /** 连续通知的指数退避倍数（默认: 2） */
  backoffMultiplier: number;
  /** 指数退避延迟上限（毫秒，默认: 60000） */
  maxIdleConfirmationDelay: number;
  /** 最大跟踪会话数，超出后清理旧记录（默认: 100） */
  maxTrackedSessions: number;
}

export function createIdleNotificationScheduler(
  config: IdleNotificationConfig,
) {
  /** 每个会话连续通知次数（用于指数退避） */
  const notificationCounts = new Map<string, number>();
  /** 待执行的定时器 */
  const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** idle 后有活动的会话（用于取消待发通知） */
  const sessionActivitySinceIdle = new Set<string>();
  /** 每个会话的通知版本号（每次取消递增，过期回调自动失效） */
  const notificationVersions = new Map<string, number>();
  /** 正在执行通知的会话（执行锁） */
  const executingNotifications = new Set<string>();

  /** 清理超出上限的旧会话记录 */
  function cleanupOldSessions(): void {
    const max = config.maxTrackedSessions;
    for (const set of [sessionActivitySinceIdle, executingNotifications]) {
      if (set.size > max) {
        const toRemove = Array.from(set).slice(0, set.size - max);
        for (const id of toRemove) set.delete(id);
      }
    }
    for (const map of [notificationCounts, notificationVersions]) {
      if (map.size > max) {
        const toRemove = Array.from(map.keys()).slice(0, map.size - max);
        for (const id of toRemove) map.delete(id);
      }
    }
  }

  /** 取消待发通知并递增版本号 */
  function cancelPendingNotification(sessionID: string): void {
    const timer = pendingTimers.get(sessionID);
    if (timer) {
      clearTimeout(timer);
      pendingTimers.delete(sessionID);
    }
    sessionActivitySinceIdle.add(sessionID);
    notificationVersions.set(
      sessionID,
      (notificationVersions.get(sessionID) ?? 0) + 1,
    );
  }

  /**
   * 标记会话有活动。
   * 取消待发通知，并重置指数退避状态。
   */
  function markSessionActivity(sessionID: string): void {
    cancelPendingNotification(sessionID);
    notificationCounts.delete(sessionID);
  }

  /** 执行通知（带多重守卫） */
  async function executeNotification(
    sessionID: string,
    version: number,
  ): Promise<void> {
    // 守卫 1: 执行锁
    if (executingNotifications.has(sessionID)) {
      pendingTimers.delete(sessionID);
      return;
    }

    // 守卫 2: 版本号过期
    if (notificationVersions.get(sessionID) !== version) {
      pendingTimers.delete(sessionID);
      return;
    }

    // 守卫 3: idle 后有新活动
    if (sessionActivitySinceIdle.has(sessionID)) {
      sessionActivitySinceIdle.delete(sessionID);
      pendingTimers.delete(sessionID);
      return;
    }

    executingNotifications.add(sessionID);
    try {
      // 再次检查版本号（异步操作期间可能变化）
      if (notificationVersions.get(sessionID) !== version) return;
      if (sessionActivitySinceIdle.has(sessionID)) {
        sessionActivitySinceIdle.delete(sessionID);
        return;
      }

      const opts: NotifyOptions = {
        title: config.title,
        message: config.message,
        sound: config.sound,
      };

      log('[session-notification] Firing idle notification', { sessionID });
      await sendNotification(opts);
      notificationCounts.set(
        sessionID,
        (notificationCounts.get(sessionID) ?? 0) + 1,
      );
    } finally {
      executingNotifications.delete(sessionID);
      pendingTimers.delete(sessionID);
      // 如果执行期间有新活动，重置指数退避状态
      if (sessionActivitySinceIdle.has(sessionID)) {
        notificationCounts.delete(sessionID);
        sessionActivitySinceIdle.delete(sessionID);
      }
    }
  }

  /**
   * 调度空闲通知。
   * 收到 idle 信号后，延迟一段时间再发送：
   * - 首次: idleConfirmationDelay
   * - 连续 idle: idleConfirmationDelay * backoffMultiplier^n
   * 并受 maxIdleConfirmationDelay 限制。
   * 期间如果有新活动则自动取消。
   */
  function scheduleIdleNotification(sessionID: string): void {
    if (pendingTimers.has(sessionID)) return;
    if (executingNotifications.has(sessionID)) return;

    sessionActivitySinceIdle.delete(sessionID);

    const currentVersion = (notificationVersions.get(sessionID) ?? 0) + 1;
    notificationVersions.set(sessionID, currentVersion);

    const notifyCount = notificationCounts.get(sessionID) ?? 0;
    const backoffMultiplier =
      config.backoffMultiplier > 1 ? config.backoffMultiplier : 2;
    const delay = Math.min(
      Math.round(
        config.idleConfirmationDelay * backoffMultiplier ** notifyCount,
      ),
      config.maxIdleConfirmationDelay,
    );

    const timer = setTimeout(() => {
      executeNotification(sessionID, currentVersion);
    }, delay);

    pendingTimers.set(sessionID, timer);
    cleanupOldSessions();
  }

  /** 完全清理会话的所有状态 */
  function deleteSession(sessionID: string): void {
    cancelPendingNotification(sessionID);
    notificationCounts.delete(sessionID);
    sessionActivitySinceIdle.delete(sessionID);
    notificationVersions.delete(sessionID);
    executingNotifications.delete(sessionID);
  }

  return {
    markSessionActivity,
    scheduleIdleNotification,
    deleteSession,
  };
}
