const MAX_TASK_RETRIES = 1;

const TASK_TOOLS = new Set([
  'task',
  'background_task',
  'background_output',
  'delegate_task',
]);

const ERROR_PATTERNS: Array<{ pattern: string; hint: string }> = [
  {
    pattern: 'task failed',
    hint: '委派的任务失败了。请使用更明确的约束条件重试。',
  },
  {
    pattern: 'timed out',
    hint: '委派的任务超时了。请缩小范围后重试。',
  },
  {
    pattern: 'rate limit',
    hint: '触发了速率限制。请等待后重试或使用其他专家。',
  },
  {
    pattern: 'context too large',
    hint: '上下文过大。请减少提示词大小后重试。',
  },
];

export interface DetectedError {
  hint: string;
}

export function detectDelegateTaskError(output: string): DetectedError | null {
  const lower = output.toLowerCase();
  for (const item of ERROR_PATTERNS) {
    if (lower.includes(item.pattern)) {
      return { hint: item.hint };
    }
  }
  return null;
}

export function buildRetryGuidance(
  errorInfo: DetectedError,
  attempt: number,
): string {
  return (
    '[Delegate Task Retry]\n' +
    `${errorInfo.hint}\n` +
    `重试第 ${attempt}/${MAX_TASK_RETRIES} 次。`
  );
}

export function createDelegateTaskRetryHook() {
  const retryCounts = new Map<string, number>();

  return {
    'tool.execute.after': async (
      input: { tool: string; sessionID: string; callID: string },
      output: { title: string; output: string; metadata: unknown },
    ) => {
      if (!TASK_TOOLS.has(input.tool.toLowerCase())) return;

      const errorInfo = detectDelegateTaskError(output.output);
      if (!errorInfo) return;

      const key =
        input.callID || `${input.sessionID}:${input.tool.toLowerCase()}`;
      const attempt = (retryCounts.get(key) ?? 0) + 1;
      retryCounts.set(key, attempt);

      if (attempt <= MAX_TASK_RETRIES) {
        output.output += `\n\n${buildRetryGuidance(errorInfo, attempt)}`;
        return;
      }

      output.output +=
        '\n\n[Delegate Task Retry]\n' +
        `此任务在 ${attempt} 次尝试后仍然失败。` +
        '请切换到其他专家。';
    },
  };
}
