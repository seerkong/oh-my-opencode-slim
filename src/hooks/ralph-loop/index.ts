import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import type { PluginInput } from '@opencode-ai/plugin';
import { parseFrontmatter } from '../../utils/frontmatter';
import { log } from '../../utils/logger';
import {
  DEFAULT_COMPLETION_PROMISE,
  DEFAULT_MAX_ITERATIONS,
  DEFAULT_RESUME_FILE,
  DEFAULT_RESUME_MODE,
  DEFAULT_YIELD_PROMISE,
  HOOK_NAME,
} from './constants';
import {
  clearState,
  incrementIteration,
  readState,
  writeState,
} from './storage';
import type { RalphLoopOptions, RalphLoopState } from './types';

export * from './constants';
export {
  clearState,
  incrementIteration,
  readState,
  writeState,
} from './storage';
export * from './types';

interface SessionState {
  isRecovering?: boolean;
}

interface OpenCodeSessionMessage {
  info?: {
    role?: string;
  };
  parts?: Array<{
    type: string;
    text?: string;
    [key: string]: unknown;
  }>;
}

const CONTINUATION_PROMPT = `[系统指令：OH-MY-OPENCODE - RALPH LOOP {{ITERATION}}/{{MAX}}]

预检（强制执行）：
在开始任何工作之前，判断你是否被外部输入阻塞。

你处于阻塞状态，如果：
- 你需要澄清/确认/审查，而用户尚未回复
- 你提出了问题但尚未收到回答
- 你处于必须等待批准才能继续的节点

如果阻塞：
- 提出 1-3 个精确的问题（优先使用 A/B/C 选项）
- 然后输出：<promise>{{YIELD_PROMISE}}</promise>
- 立即停止。不要运行工具。不要继续工作。

如果未阻塞：
- 回顾你目前的进展
- 从上次中断的地方继续
- 当完全完成时，输出：<promise>{{PROMISE}}</promise>

原始任务：
{{PROMPT}}`;

const RESUME_PROMPT = `[RALPH LOOP - 恢复]

你之前因等待外部输入而被挂起。

恢复载荷：
<resume-payload>
{{PAYLOAD}}
</resume-payload>

继续原始任务：
{{PROMPT}}`;

const DEFAULT_API_TIMEOUT = 3000;

type ResumeMode = 'user' | 'file';

function parseResumeModes(raw: string | undefined): Set<ResumeMode> {
  const modes = new Set<ResumeMode>();
  const parts = (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const p of parts) {
    if (p === 'user' || p === 'file') modes.add(p);
  }
  return modes;
}

function getLastPromiseValue(text: string): string | null {
  const regex = /<promise>([\s\S]*?)<\/promise>/gi;
  let m: RegExpExecArray | null = null;
  let last: string | null = null;
  // biome-ignore lint/suspicious/noAssignInExpressions: intentional regex iteration
  while ((m = regex.exec(text)) !== null) {
    last = (m[1] ?? '').trim();
  }
  return last;
}

function ensureDirForFile(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function writeDefaultResumeTemplate(
  workspaceDir: string,
  resumeFile: string,
  sessionId: string | undefined,
): void {
  const filePath = join(workspaceDir, resumeFile);
  if (existsSync(filePath)) return;

  ensureDirForFile(filePath);

  const sessionIdLine = sessionId ? `session_id: "${sessionId}"\n` : '';
  const template = `---
schema: ralph-resume-v1
status: pending
${sessionIdLine}strict_session_id: false
not_before: ""
delete_on_consume: true
payload_format: text
---
# Write your resume payload below, then set status: ready\n`;

  writeFileSync(filePath, template, 'utf-8');
}

function readResumeFile(
  workspaceDir: string,
  resumeFile: string,
): { data: Record<string, unknown>; body: string } | null {
  const filePath = join(workspaceDir, resumeFile);
  if (!existsSync(filePath)) return null;

  try {
    const content = readFileSync(filePath, 'utf-8');
    const { data, body } = parseFrontmatter<Record<string, unknown>>(content);
    return { data, body };
  } catch {
    return null;
  }
}

function shouldConsumeResume(
  state: RalphLoopState,
  data: Record<string, unknown>,
): { ok: boolean; reason?: string } {
  const schema = String(data.schema ?? '');
  if (schema && schema !== 'ralph-resume-v1') {
    return { ok: false, reason: 'schema_mismatch' };
  }

  const strict =
    data.strict_session_id === true || data.strict_session_id === 'true';
  const fileSessionId = String(data.session_id ?? '').trim();

  if (strict) {
    if (!fileSessionId) return { ok: false, reason: 'missing_session_id' };
    if (!state.session_id) {
      return { ok: false, reason: 'state_missing_session_id' };
    }
    if (fileSessionId !== state.session_id) {
      return { ok: false, reason: 'session_id_mismatch' };
    }
  } else if (
    fileSessionId &&
    state.session_id &&
    fileSessionId !== state.session_id
  ) {
    return { ok: false, reason: 'session_id_mismatch' };
  }

  const notBefore = String(data.not_before ?? data.next_check_at ?? '').trim();
  if (notBefore) {
    const t = Date.parse(notBefore);
    if (!Number.isNaN(t) && Date.now() < t) {
      return { ok: false, reason: 'not_before' };
    }
  }

  const status = String(data.status ?? '');
  if (status && status !== 'ready') {
    return { ok: false, reason: 'not_ready' };
  }

  return { ok: true };
}

function consumeResumeFile(
  workspaceDir: string,
  resumeFile: string,
  data: Record<string, unknown>,
): void {
  const filePath = join(workspaceDir, resumeFile);
  const deleteOnConsume =
    data.delete_on_consume !== false && data.delete_on_consume !== 'false';
  if (deleteOnConsume) {
    try {
      unlinkSync(filePath);
    } catch {
      // noop
    }
    return;
  }

  try {
    const next = {
      ...data,
      status: 'consumed',
      consumed_at: new Date().toISOString(),
    };
    const content = `---\n${Object.entries(next)
      .map(
        ([k, v]) =>
          `${k}: ${typeof v === 'string' ? JSON.stringify(v) : String(v)}`,
      )
      .join('\n')}\n---\n`;
    writeFileSync(filePath, content, 'utf-8');
  } catch {
    // noop
  }
}

async function getLatestUserMessageText(
  ctx: PluginInput,
  sessionID: string,
): Promise<string | null> {
  try {
    const response = await ctx.client.session.messages({
      path: { id: sessionID },
    });

    const messages = (response as { data?: unknown[] }).data ?? [];
    if (!Array.isArray(messages)) return null;

    const userMessages = (messages as OpenCodeSessionMessage[]).filter(
      (msg) => msg.info?.role === 'user',
    );
    const lastUser = userMessages[userMessages.length - 1];
    if (!lastUser?.parts) return null;

    const responseText = lastUser.parts
      .filter((p) => p.type === 'text')
      .map((p) => p.text ?? '')
      .join('\n')
      .trim();

    return responseText || null;
  } catch {
    return null;
  }
}

async function getLastAssistantText(
  ctx: PluginInput,
  sessionID: string,
  apiTimeout: number,
): Promise<string | null> {
  try {
    const response = await Promise.race([
      ctx.client.session.messages({
        path: { id: sessionID },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('API timeout')), apiTimeout),
      ),
    ]);

    const messages = (response as { data?: unknown[] }).data ?? [];
    if (!Array.isArray(messages)) return null;

    const assistantMessages = (messages as OpenCodeSessionMessage[]).filter(
      (msg) => msg.info?.role === 'assistant',
    );
    const lastAssistant = assistantMessages[assistantMessages.length - 1];
    if (!lastAssistant?.parts) return null;

    const responseText = lastAssistant.parts
      .filter((p) => p.type === 'text')
      .map((p) => p.text ?? '')
      .join('\n');

    return responseText;
  } catch (err) {
    log(`[${HOOK_NAME}] Session messages check failed`, {
      sessionID,
      error: String(err),
    });
    return null;
  }
}

export interface RalphLoopHook {
  event: (input: {
    event: { type: string; properties?: unknown };
  }) => Promise<void>;
  startLoop: (
    sessionID: string,
    prompt: string,
    options?: {
      maxIterations?: number;
      completionPromise?: string;
      yieldPromise?: string;
      resumeMode?: string;
      resumeFile?: string;
      ultrawork?: boolean;
    },
  ) => boolean;
  resumeLoop: (
    sessionID: string,
    payload: string,
    options?: { resumeFile?: string },
  ) => Promise<boolean>;
  cancelLoop: (sessionID: string) => boolean;
  getState: () => RalphLoopState | null;
}

export function createRalphLoopHook(
  ctx: PluginInput,
  options?: RalphLoopOptions,
): RalphLoopHook {
  const sessions = new Map<string, SessionState>();
  const config = options?.config;
  const stateDir = config?.state_dir;
  const apiTimeout = options?.apiTimeout ?? DEFAULT_API_TIMEOUT;
  const checkSessionExists = options?.checkSessionExists;

  function getSessionState(sessionID: string): SessionState {
    let state = sessions.get(sessionID);
    if (!state) {
      state = {};
      sessions.set(sessionID, state);
    }
    return state;
  }

  const startLoop = (
    sessionID: string,
    prompt: string,
    loopOptions?: {
      maxIterations?: number;
      completionPromise?: string;
      yieldPromise?: string;
      resumeMode?: string;
      resumeFile?: string;
      ultrawork?: boolean;
    },
  ): boolean => {
    const state: RalphLoopState = {
      active: true,
      iteration: 1,
      max_iterations:
        loopOptions?.maxIterations ??
        config?.default_max_iterations ??
        DEFAULT_MAX_ITERATIONS,
      completion_promise:
        loopOptions?.completionPromise ?? DEFAULT_COMPLETION_PROMISE,
      yield_promise: loopOptions?.yieldPromise ?? DEFAULT_YIELD_PROMISE,
      ultrawork: loopOptions?.ultrawork,
      started_at: new Date().toISOString(),
      prompt,
      session_id: sessionID,
      status: 'running',
      resume_mode: loopOptions?.resumeMode ?? DEFAULT_RESUME_MODE,
      resume_file: loopOptions?.resumeFile ?? DEFAULT_RESUME_FILE,
    };

    const success = writeState(ctx.directory, state, stateDir);
    if (success) {
      log(`[${HOOK_NAME}] Loop started`, {
        sessionID,
        maxIterations: state.max_iterations,
        completionPromise: state.completion_promise,
        yieldPromise: state.yield_promise,
        resumeMode: state.resume_mode,
        resumeFile: state.resume_file,
      });
    }
    return success;
  };

  const resumeLoop = async (
    sessionID: string,
    payload: string,
    resumeOptions?: { resumeFile?: string },
  ): Promise<boolean> => {
    const state = readState(ctx.directory, stateDir);
    if (!state || !state.active) return false;
    if (state.session_id && state.session_id !== sessionID) return false;
    if (state.status !== 'suspended') return false;

    const resumeFile =
      resumeOptions?.resumeFile ?? state.resume_file ?? DEFAULT_RESUME_FILE;

    let resolvedPayload = payload.trim();
    let failureReason: string | undefined;

    if (!resolvedPayload) {
      writeDefaultResumeTemplate(ctx.directory, resumeFile, state.session_id);

      const resume = readResumeFile(ctx.directory, resumeFile);
      if (!resume) {
        failureReason = 'resume_file_missing';
      } else {
        const ok = shouldConsumeResume(state, resume.data);
        if (!ok.ok) {
          failureReason = ok.reason ?? 'resume_file_not_consumable';
        } else {
          const fromFile = resume.body.trim();
          if (!fromFile) {
            failureReason = 'resume_payload_empty';
          } else {
            consumeResumeFile(ctx.directory, resumeFile, resume.data);
            resolvedPayload = fromFile;
          }
        }
      }
    }

    if (!resolvedPayload) {
      await ctx.client.tui
        .showToast({
          body: {
            title: 'Ralph 循环恢复',
            message: failureReason
              ? `无法恢复（${failureReason}）：${resumeFile}`
              : `无法恢复：${resumeFile}`,
            variant: 'warning',
            duration: 5000,
          },
        })
        .catch(() => {});
      return false;
    }

    state.status = 'running';
    state.last_resume_payload = resolvedPayload;
    state.suspended_at = undefined;
    state.next_poll_at = undefined;

    if (resumeOptions?.resumeFile) {
      state.resume_file = resumeOptions.resumeFile;
    }

    if (!writeState(ctx.directory, state, stateDir)) return false;

    const resumePrompt = RESUME_PROMPT.replace(
      '{{PAYLOAD}}',
      resolvedPayload,
    ).replace('{{PROMPT}}', state.prompt);

    try {
      await ctx.client.session.prompt({
        path: { id: sessionID },
        body: {
          parts: [{ type: 'text', text: resumePrompt }],
        },
      });
      return true;
    } catch (err) {
      log(`[${HOOK_NAME}] Failed to inject resume`, {
        sessionID,
        error: String(err),
      });
      return false;
    }
  };

  const cancelLoop = (sessionID: string): boolean => {
    const state = readState(ctx.directory, stateDir);
    if (!state || state.session_id !== sessionID) {
      return false;
    }

    const success = clearState(ctx.directory, stateDir);
    if (success) {
      log(`[${HOOK_NAME}] Loop cancelled`, {
        sessionID,
        iteration: state.iteration,
      });
    }
    return success;
  };

  const getState = (): RalphLoopState | null => {
    return readState(ctx.directory, stateDir);
  };

  const event = async ({
    event,
  }: {
    event: { type: string; properties?: unknown };
  }): Promise<void> => {
    const props = event.properties as Record<string, unknown> | undefined;
    const sessionID = props?.sessionID as string | undefined;

    const isIdleEvent =
      event.type === 'session.idle' ||
      (event.type === 'session.status' &&
        (props?.status as { type?: string } | undefined)?.type === 'idle');

    if (isIdleEvent) {
      if (!sessionID) return;

      const sessionState = getSessionState(sessionID);
      if (sessionState.isRecovering) {
        log(`[${HOOK_NAME}] Skipped: in recovery`, { sessionID });
        return;
      }

      const state = readState(ctx.directory, stateDir);
      if (!state || !state.active) {
        return;
      }

      if (state.session_id && state.session_id !== sessionID) {
        if (checkSessionExists) {
          try {
            const originalSessionExists = await checkSessionExists(
              state.session_id,
            );
            if (!originalSessionExists) {
              clearState(ctx.directory, stateDir);
              log(
                `[${HOOK_NAME}] Cleared orphaned state from deleted session`,
                {
                  orphanedSessionId: state.session_id,
                  currentSessionId: sessionID,
                },
              );
              return;
            }
          } catch (err) {
            log(`[${HOOK_NAME}] Failed to check session existence`, {
              sessionId: state.session_id,
              error: String(err),
            });
          }
        }
        return;
      }

      const resumeModes = parseResumeModes(
        state.resume_mode ?? DEFAULT_RESUME_MODE,
      );
      const resumeFile = state.resume_file ?? DEFAULT_RESUME_FILE;

      if (state.status === 'suspended') {
        writeDefaultResumeTemplate(ctx.directory, resumeFile, state.session_id);

        if (resumeModes.has('file')) {
          const resume = readResumeFile(ctx.directory, resumeFile);
          if (resume) {
            const ok = shouldConsumeResume(state, resume.data);
            if (ok.ok) {
              const payload = resume.body.trim();
              if (payload) {
                consumeResumeFile(ctx.directory, resumeFile, resume.data);
                await resumeLoop(sessionID, payload, { resumeFile });
                return;
              }
            }
          }
        }

        if (resumeModes.has('user')) {
          const userText = await getLatestUserMessageText(ctx, sessionID);
          if (userText && userText !== state.last_resume_payload) {
            await resumeLoop(sessionID, userText, { resumeFile });
            return;
          }
        }

        return;
      }

      const lastAssistantText = await getLastAssistantText(
        ctx,
        sessionID,
        apiTimeout,
      );
      if (lastAssistantText) {
        const lastPromise = getLastPromiseValue(lastAssistantText);
        if (lastPromise) {
          const completion = state.completion_promise;
          const yieldPromise = state.yield_promise ?? DEFAULT_YIELD_PROMISE;

          if (lastPromise.trim() === completion) {
            log(`[${HOOK_NAME}] Completion detected!`, {
              sessionID,
              iteration: state.iteration,
              promise: completion,
              detectedVia: 'session_messages_api',
            });
            clearState(ctx.directory, stateDir);

            const title = state.ultrawork
              ? 'ULTRAWORK 循环完成！'
              : 'Ralph 循环完成！';
            const message = state.ultrawork
              ? `ULW ULW！任务在 ${state.iteration} 次迭代后完成`
              : `任务在 ${state.iteration} 次迭代后完成`;

            await ctx.client.tui
              .showToast({
                body: {
                  title,
                  message,
                  variant: 'success',
                  duration: 5000,
                },
              })
              .catch(() => {});

            return;
          }

          if (lastPromise.trim() === yieldPromise) {
            state.status = 'suspended';
            state.suspended_at = new Date().toISOString();
            state.next_poll_at = undefined;

            writeDefaultResumeTemplate(
              ctx.directory,
              resumeFile,
              state.session_id,
            );
            writeState(ctx.directory, state, stateDir);

            await ctx.client.tui
              .showToast({
                body: {
                  title: 'Ralph 循环已挂起',
                  message: `等待恢复（${resumeFile}）`,
                  variant: 'info',
                  duration: 5000,
                },
              })
              .catch(() => {});

            return;
          }
        }
      }

      if (state.iteration >= state.max_iterations) {
        log(`[${HOOK_NAME}] Max iterations reached`, {
          sessionID,
          iteration: state.iteration,
          max: state.max_iterations,
        });
        clearState(ctx.directory, stateDir);

        await ctx.client.tui
          .showToast({
            body: {
              title: 'Ralph 循环已停止',
              message: `已达到最大迭代次数（${state.max_iterations}），任务未完成`,
              variant: 'warning',
              duration: 5000,
            },
          })
          .catch(() => {});

        return;
      }

      const newState = incrementIteration(ctx.directory, stateDir);
      if (!newState) {
        log(`[${HOOK_NAME}] Failed to increment iteration`, { sessionID });
        return;
      }

      log(`[${HOOK_NAME}] Continuing loop`, {
        sessionID,
        iteration: newState.iteration,
        max: newState.max_iterations,
      });

      const continuationPrompt = CONTINUATION_PROMPT.replace(
        '{{ITERATION}}',
        String(newState.iteration),
      )
        .replace('{{MAX}}', String(newState.max_iterations))
        .replace('{{PROMISE}}', newState.completion_promise)
        .replace(
          '{{YIELD_PROMISE}}',
          newState.yield_promise ?? DEFAULT_YIELD_PROMISE,
        )
        .replace('{{PROMPT}}', newState.prompt);

      const finalPrompt = newState.ultrawork
        ? `ultrawork ${continuationPrompt}`
        : continuationPrompt;

      await ctx.client.tui
        .showToast({
          body: {
            title: 'Ralph 循环',
            message: `迭代 ${newState.iteration}/${newState.max_iterations}`,
            variant: 'info',
            duration: 2000,
          },
        })
        .catch(() => {});

      try {
        await ctx.client.session.prompt({
          path: { id: sessionID },
          body: {
            parts: [{ type: 'text', text: finalPrompt }],
          },
        });
      } catch (err) {
        log(`[${HOOK_NAME}] Failed to inject continuation`, {
          sessionID,
          error: String(err),
        });
      }
    }

    if (event.type === 'session.deleted') {
      const sessionInfo = props?.info as { id?: string } | undefined;
      if (sessionInfo?.id) {
        const state = readState(ctx.directory, stateDir);
        if (state?.session_id === sessionInfo.id) {
          clearState(ctx.directory, stateDir);
          log(`[${HOOK_NAME}] Session deleted, loop cleared`, {
            sessionID: sessionInfo.id,
          });
        }
        sessions.delete(sessionInfo.id);
      }
    }

    if (event.type === 'session.error') {
      const error = props?.error as { name?: string } | undefined;

      if (error?.name === 'MessageAbortedError') {
        if (sessionID) {
          const state = readState(ctx.directory, stateDir);
          if (state?.session_id === sessionID) {
            clearState(ctx.directory, stateDir);
            log(`[${HOOK_NAME}] User aborted, loop cleared`, { sessionID });
          }
          sessions.delete(sessionID);
        }
        return;
      }

      if (sessionID) {
        const sessionState = getSessionState(sessionID);
        sessionState.isRecovering = true;
        setTimeout(() => {
          sessionState.isRecovering = false;
        }, 5000);
      }
    }
  };

  return {
    event,
    startLoop,
    resumeLoop,
    cancelLoop,
    getState,
  };
}
