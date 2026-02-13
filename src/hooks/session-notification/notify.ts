import * as fs from 'node:fs';
import * as os from 'node:os';
import { log } from '../../utils/logger';

export interface NotifyOptions {
  title: string;
  message: string;
  sound?: boolean;
}

interface NotifyBackend {
  name: string;
  available: () => boolean;
  send: (opts: NotifyOptions) => Promise<boolean>;
}

/** Cached probe result: null = not yet probed */
let cachedBackend: NotifyBackend | null | undefined;

/**
 * Probe for osascript (macOS).
 */
function probeOsascript(): NotifyBackend | null {
  const bin = '/usr/bin/osascript';
  if (!fs.existsSync(bin)) return null;
  return {
    name: 'osascript',
    available: () => true,
    send: async (opts) => {
      const soundClause = opts.sound ? ' sound name "Glass"' : '';
      const script =
        `display notification "${escapeAppleScript(opts.message)}"` +
        ` with title "${escapeAppleScript(opts.title)}"` +
        soundClause;
      return runCmd([bin, '-e', script]);
    },
  };
}

/**
 * Probe for notify-send (Linux).
 */
function probeNotifySend(): NotifyBackend | null {
  const paths = ['/usr/bin/notify-send', '/usr/local/bin/notify-send'];
  const bin = paths.find((p) => fs.existsSync(p));
  if (!bin) return null;
  return {
    name: 'notify-send',
    available: () => true,
    send: async (opts) => runCmd([bin, opts.title, opts.message]),
  };
}

/**
 * Probe for PowerShell (Windows).
 */
function probePowershell(): NotifyBackend | null {
  if (os.platform() !== 'win32') return null;
  return {
    name: 'powershell',
    available: () => true,
    send: async (opts) => {
      const ps = [
        '[System.Reflection.Assembly]::LoadWithPartialName("System.Windows.Forms") | Out-Null;',
        `$n = New-Object System.Windows.Forms.NotifyIcon;`,
        '$n.Icon = [System.Drawing.SystemIcons]::Information;',
        '$n.Visible = $true;',
        `$n.ShowBalloonTip(5000, "${escapePowershell(opts.title)}", "${escapePowershell(opts.message)}", "Info");`,
      ].join(' ');
      return runCmd(['powershell', '-NoProfile', '-Command', ps]);
    },
  };
}

/**
 * Probe the system for a notification backend, caching the result.
 */
export function probeNotifyBackend(): NotifyBackend | null {
  if (cachedBackend !== undefined) return cachedBackend;
  cachedBackend =
    probeOsascript() ?? probeNotifySend() ?? probePowershell() ?? null;
  if (cachedBackend) {
    log(`[session-notification] Using backend: ${cachedBackend.name}`);
  } else {
    log('[session-notification] No notification backend found');
  }
  return cachedBackend;
}

/**
 * Reset cached backend (for testing).
 */
export function resetNotifyBackendCache(): void {
  cachedBackend = undefined;
}

/**
 * Send a desktop notification using the probed backend.
 * Returns false if no backend or send failed.
 */
export async function sendNotification(opts: NotifyOptions): Promise<boolean> {
  const backend = probeNotifyBackend();
  if (!backend) return false;
  try {
    return await backend.send(opts);
  } catch (err) {
    log('[session-notification] Send failed:', err);
    return false;
  }
}

// --- helpers ---

function escapeAppleScript(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function escapePowershell(s: string): string {
  return s.replace(/"/g, '`"').replace(/\$/g, '`$');
}

async function runCmd(args: string[]): Promise<boolean> {
  try {
    const proc = Bun.spawn(args, {
      stdout: 'ignore',
      stderr: 'ignore',
    });
    const timeout = new Promise<'timeout'>((r) =>
      setTimeout(() => r('timeout'), 5_000),
    );
    const result = await Promise.race([
      proc.exited.then(() => 'done' as const),
      timeout,
    ]);
    if (result === 'timeout') {
      try {
        proc.kill();
      } catch {
        /* empty */
      }
      return false;
    }
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}
