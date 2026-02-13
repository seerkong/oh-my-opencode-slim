import type { PluginInput } from '@opencode-ai/plugin';
import { log } from '../../utils/logger';
import { invalidatePackage } from './cache';
import {
  extractChannel,
  findPluginEntry,
  getCachedVersion,
  getLatestVersion,
  getLocalDevVersion,
  updatePinnedVersion,
} from './checker';
import { PACKAGE_NAME } from './constants';
import type { AutoUpdateCheckerOptions } from './types';

/**
 * 创建一个 OpenCode 钩子，在新会话创建时检查插件更新。
 * @param ctx 插件输入上下文。
 * @param options 更新检查器的配置选项。
 * @returns 用于 session.created 事件的钩子对象。
 */
export function createAutoUpdateCheckerHook(
  ctx: PluginInput,
  options: AutoUpdateCheckerOptions = {},
) {
  const { showStartupToast = true, autoUpdate = true } = options;

  let hasChecked = false;

  return {
    event: ({ event }: { event: { type: string; properties?: unknown } }) => {
      if (event.type !== 'session.created') return;
      if (hasChecked) return;

      const props = event.properties as
        | { info?: { parentID?: string } }
        | undefined;
      if (props?.info?.parentID) return;

      hasChecked = true;

      setTimeout(async () => {
        const cachedVersion = getCachedVersion();
        const localDevVersion = getLocalDevVersion(ctx.directory);
        const displayVersion = localDevVersion ?? cachedVersion;

        if (localDevVersion) {
          if (showStartupToast) {
            showToast(
              ctx,
              `OMO-Slim ${displayVersion} (dev)`,
              '正在本地开发模式下运行。',
              'info',
            );
          }
          log('[auto-update-checker] Local development mode');
          return;
        }

        if (showStartupToast) {
          showToast(
            ctx,
            `OMO-Slim ${displayVersion ?? 'unknown'}`,
            'oh-my-opencode-slim 已激活。',
            'info',
          );
        }

        runBackgroundUpdateCheck(ctx, autoUpdate).catch((err) => {
          log('[auto-update-checker] Background update check failed:', err);
        });
      }, 0);
    },
  };
}

/**
 * 在后台协调版本比较和更新流程。
 * @param ctx 插件输入上下文。
 * @param autoUpdate 是否自动安装更新。
 */
async function runBackgroundUpdateCheck(
  ctx: PluginInput,
  autoUpdate: boolean,
): Promise<void> {
  const pluginInfo = findPluginEntry(ctx.directory);
  if (!pluginInfo) {
    log('[auto-update-checker] Plugin not found in config');
    return;
  }

  const cachedVersion = getCachedVersion();
  const currentVersion = cachedVersion ?? pluginInfo.pinnedVersion;
  if (!currentVersion) {
    log('[auto-update-checker] No version found (cached or pinned)');
    return;
  }

  const channel = extractChannel(pluginInfo.pinnedVersion ?? currentVersion);
  const latestVersion = await getLatestVersion(channel);
  if (!latestVersion) {
    log(
      '[auto-update-checker] Failed to fetch latest version for channel:',
      channel,
    );
    return;
  }

  if (currentVersion === latestVersion) {
    log(
      '[auto-update-checker] Already on latest version for channel:',
      channel,
    );
    return;
  }

  log(
    `[auto-update-checker] Update available (${channel}): ${currentVersion} → ${latestVersion}`,
  );

  if (!autoUpdate) {
    showToast(
      ctx,
      `OMO-Slim ${latestVersion}`,
      `v${latestVersion} 可用。重启以应用更新。`,
      'info',
      8000,
    );
    log('[auto-update-checker] Auto-update disabled, notification only');
    return;
  }

  if (pluginInfo.isPinned) {
    const updated = updatePinnedVersion(
      pluginInfo.configPath,
      pluginInfo.entry,
      latestVersion,
    );
    if (!updated) {
      showToast(
        ctx,
        `OMO-Slim ${latestVersion}`,
        `v${latestVersion} 可用。重启以应用更新。`,
        'info',
        8000,
      );
      log('[auto-update-checker] Failed to update pinned version in config');
      return;
    }
    log(
      `[auto-update-checker] Config updated: ${pluginInfo.entry} → ${PACKAGE_NAME}@${latestVersion}`,
    );
  }

  invalidatePackage(PACKAGE_NAME);

  const installSuccess = await runBunInstallSafe(ctx);

  if (installSuccess) {
    showToast(
      ctx,
      'OMO-Slim 已更新！',
      `v${currentVersion} → v${latestVersion}\n重启 OpenCode 以应用更新。`,
      'success',
      8000,
    );
    log(
      `[auto-update-checker] Update installed: ${currentVersion} → ${latestVersion}`,
    );
  } else {
    showToast(
      ctx,
      `OMO-Slim ${latestVersion}`,
      `v${latestVersion} 可用。重启以应用更新。`,
      'info',
      8000,
    );
    log('[auto-update-checker] bun install failed; update not installed');
  }
}

/**
 * 启动后台进程运行 'bun install'。
 * 包含 60 秒超时以防止阻塞 OpenCode。
 * @param ctx 插件输入上下文。
 * @returns 如果安装在超时内成功则返回 true。
 */
async function runBunInstallSafe(ctx: PluginInput): Promise<boolean> {
  try {
    const proc = Bun.spawn(['bun', 'install'], {
      cwd: ctx.directory,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const timeoutPromise = new Promise<'timeout'>((resolve) =>
      setTimeout(() => resolve('timeout'), 60_000),
    );
    const exitPromise = proc.exited.then(() => 'completed' as const);
    const result = await Promise.race([exitPromise, timeoutPromise]);

    if (result === 'timeout') {
      try {
        proc.kill();
      } catch {
        /* empty */
      }
      return false;
    }

    return proc.exitCode === 0;
  } catch (err) {
    log('[auto-update-checker] bun install error:', err);
    return false;
  }
}

/**
 * 在 OpenCode TUI 中显示 toast 通知的辅助函数。
 * @param ctx 插件输入上下文。
 * @param title toast 标题。
 * @param message toast 消息。
 * @param variant toast 的视觉样式。
 * @param duration toast 显示时长（毫秒）。
 */
function showToast(
  ctx: PluginInput,
  title: string,
  message: string,
  variant: 'info' | 'success' | 'error' = 'info',
  duration = 3000,
): void {
  ctx.client.tui
    .showToast({
      body: { title, message, variant, duration },
    })
    .catch(() => {});
}

export type { AutoUpdateCheckerOptions } from './types';
