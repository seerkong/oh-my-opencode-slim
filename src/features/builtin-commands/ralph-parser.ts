export interface ChatPart {
  type: string;
  text?: string;
}

export interface RalphStartCommand {
  type: 'start';
  prompt: string;
  ultrawork?: boolean;
  maxIterations?: number;
  completionPromise?: string;
  yieldPromise?: string;
  resumeMode?: string;
  resumeFile?: string;
}

export interface RalphResumeCommand {
  type: 'resume';
  payload: string;
  resumeFile?: string;
}

export interface RalphCancelCommand {
  type: 'cancel';
}

export type RalphCommand =
  | RalphStartCommand
  | RalphResumeCommand
  | RalphCancelCommand;

export function parseRalphStartArgs(
  rawArgs: string,
  ultrawork?: boolean,
): RalphStartCommand {
  const taskMatch = rawArgs.match(/^(?:"|')([\s\S]*?)(?:"|')/);
  const prompt =
    taskMatch?.[1] ||
    rawArgs.split(/\s+--/)[0]?.trim() ||
    'Complete the task as instructed';

  const maxIterMatch = rawArgs.match(/--max-iterations=(\d+)/i);
  const completionMatch = rawArgs.match(
    /--completion-promise=["']?([^"'\s]+)["']?/i,
  );
  const yieldMatch = rawArgs.match(/--yield-promise=["']?([^"'\s]+)["']?/i);
  const resumeModeMatch = rawArgs.match(/--resume-mode=["']?([^"'\s]+)["']?/i);
  const resumeFileMatch = rawArgs.match(/--resume-file=["']?([^"'\s]+)["']?/i);

  return {
    type: 'start',
    ultrawork,
    prompt,
    maxIterations: maxIterMatch
      ? Number.parseInt(maxIterMatch[1], 10)
      : undefined,
    completionPromise: completionMatch?.[1],
    yieldPromise: yieldMatch?.[1],
    resumeMode: resumeModeMatch?.[1],
    resumeFile: resumeFileMatch?.[1],
  };
}

function parseResumeArgs(rawArgs: string): RalphResumeCommand {
  const resumeFileMatch = rawArgs.match(/--resume-file=["']?([^"'\s]+)["']?/i);
  const payloadRaw = rawArgs
    .replace(/--resume-file=["']?([^"'\s]+)["']?/i, '')
    .trim();
  const quotedPayloadMatch = payloadRaw.match(/^(?:"|')([\s\S]*)(?:"|')$/);
  const payload = quotedPayloadMatch ? quotedPayloadMatch[1] : payloadRaw;

  return {
    type: 'resume',
    payload,
    resumeFile: resumeFileMatch?.[1],
  };
}

export function parseRalphCommand(text: string): RalphCommand | null {
  const trimmed = text.trim();

  const isRalphLoopTemplate =
    trimmed.includes('You are starting a Ralph Loop') &&
    trimmed.includes('<user-task>');
  if (isRalphLoopTemplate) {
    const taskMatch = trimmed.match(
      /<user-task>\s*([\s\S]*?)\s*<\/user-task>/i,
    );
    const rawTask = taskMatch?.[1]?.trim() ?? '';
    return parseRalphStartArgs(rawTask);
  }

  const isCancelRalphTemplate = trimmed.includes(
    'Cancel the currently active Ralph Loop',
  );
  if (isCancelRalphTemplate) {
    return { type: 'cancel' };
  }

  const isResumeRalphTemplate =
    trimmed.includes('Resume a suspended Ralph Loop') &&
    trimmed.includes('<resume-args>');
  if (isResumeRalphTemplate) {
    const resumeArgsMatch = trimmed.match(
      /<resume-args>\s*([\s\S]*?)\s*<\/resume-args>/i,
    );
    const rawArgs = resumeArgsMatch?.[1]?.trim() ?? '';
    return parseResumeArgs(rawArgs);
  }

  const startMatch = trimmed.match(/^\/?(ralph-loop)\s*([\s\S]*)$/i);
  if (startMatch) {
    return parseRalphStartArgs(startMatch[2] ?? '');
  }

  const cancelMatch = trimmed.match(/^\/?(cancel-ralph)\b/i);
  if (cancelMatch) {
    return { type: 'cancel' };
  }

  const resumeMatch = trimmed.match(/^\/?(ralph-resume)\s*([\s\S]*)$/i);
  if (resumeMatch) {
    const rawArgs = resumeMatch[2] ?? '';
    return parseResumeArgs(rawArgs);
  }

  const ulwMatch = trimmed.match(/^\/?(ulw-loop)\s*([\s\S]*)$/i);
  if (ulwMatch) {
    return parseRalphStartArgs(ulwMatch[2] ?? '', true);
  }

  return null;
}

export function getTextFromChatParts(parts: ChatPart[] | undefined): string {
  if (!parts || parts.length === 0) return '';
  return parts
    .filter((part) => part.type === 'text' && part.text)
    .map((part) => part.text)
    .join('\n')
    .trim();
}
