const MAX_RETRIES = 2;

const TOOL_NAMES = new Set(['edit', 'write']);

const ERROR_PATTERNS = {
  notFound: ['oldstring not found'],
  multipleMatches: ['found multiple matches', 'oldstring found multiple times'],
  fileMissing: ['enoent', 'no such file'],
  permission: ['eacces', 'permission denied'],
};

function detectErrorType(
  text: string,
): 'notFound' | 'multipleMatches' | 'fileMissing' | 'permission' | null {
  const lower = text.toLowerCase();

  if (ERROR_PATTERNS.notFound.some((p) => lower.includes(p))) {
    return 'notFound';
  }
  if (ERROR_PATTERNS.multipleMatches.some((p) => lower.includes(p))) {
    return 'multipleMatches';
  }
  if (ERROR_PATTERNS.fileMissing.some((p) => lower.includes(p))) {
    return 'fileMissing';
  }
  if (ERROR_PATTERNS.permission.some((p) => lower.includes(p))) {
    return 'permission';
  }

  return null;
}

function buildGuidance(
  errorType: NonNullable<ReturnType<typeof detectErrorType>>,
) {
  if (errorType === 'notFound') {
    return '请重新读取文件，复制当前的准确文本后再重试。';
  }
  if (errorType === 'multipleMatches') {
    return '请添加更多上下文，确保只匹配到一个位置。';
  }
  if (errorType === 'fileMissing') {
    return '目标文件不存在。请确认路径或先创建该文件。';
  }
  return '权限被拒绝。请使用可写路径或调整文件权限。';
}

export function createEditErrorRecoveryHook() {
  const retryCounts = new Map<string, number>();

  return {
    'tool.execute.after': async (
      input: { tool: string; sessionID: string; callID: string },
      output: { title: string; output: string; metadata: unknown },
    ) => {
      const tool = input.tool.toLowerCase();
      if (!TOOL_NAMES.has(tool)) return;

      const errorType = detectErrorType(output.output);
      if (!errorType) return;

      const key = input.callID || `${input.sessionID}:${tool}`;
      const attempt = (retryCounts.get(key) ?? 0) + 1;
      retryCounts.set(key, attempt);

      if (attempt <= MAX_RETRIES) {
        output.output += `\n\n[Edit Error Recovery]\n${buildGuidance(errorType)}\n重试第 ${attempt}/${MAX_RETRIES} 次。`;
        return;
      }

      output.output +=
        `\n\n[Edit Error Recovery]\n此编辑已失败 ${attempt} 次。` +
        '请停止重试，改用其他方法。';
    },
  };
}
