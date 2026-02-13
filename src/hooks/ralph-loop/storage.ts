import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { parseFrontmatter } from '../../utils/frontmatter';
import {
  DEFAULT_COMPLETION_PROMISE,
  DEFAULT_MAX_ITERATIONS,
  DEFAULT_STATE_FILE,
  DEFAULT_YIELD_PROMISE,
} from './constants';
import type { RalphLoopState } from './types';

export function getStateFilePath(
  directory: string,
  customPath?: string,
): string {
  return customPath
    ? join(directory, customPath)
    : join(directory, DEFAULT_STATE_FILE);
}

export function readState(
  directory: string,
  customPath?: string,
): RalphLoopState | null {
  const filePath = getStateFilePath(directory, customPath);

  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    const { data, body } = parseFrontmatter<Record<string, unknown>>(content);

    const active = data.active;
    const iteration = data.iteration;

    if (active === undefined || iteration === undefined) {
      return null;
    }

    const isActive = active === true || active === 'true';
    const iterationNum =
      typeof iteration === 'number' ? iteration : Number(iteration);

    if (Number.isNaN(iterationNum)) {
      return null;
    }

    const stripQuotes = (val: unknown): string => {
      const str = String(val ?? '');
      return str.replace(/^["']|["']$/g, '');
    };

    const status = stripQuotes(data.status);

    return {
      active: isActive,
      iteration: iterationNum,
      max_iterations: Number(data.max_iterations) || DEFAULT_MAX_ITERATIONS,
      completion_promise:
        stripQuotes(data.completion_promise) || DEFAULT_COMPLETION_PROMISE,
      yield_promise: stripQuotes(data.yield_promise) || DEFAULT_YIELD_PROMISE,
      started_at: stripQuotes(data.started_at) || new Date().toISOString(),
      prompt: body.trim(),
      session_id: data.session_id ? stripQuotes(data.session_id) : undefined,
      ultrawork:
        data.ultrawork === true || data.ultrawork === 'true' ? true : undefined,
      status: status === 'suspended' ? 'suspended' : 'running',
      suspended_at: data.suspended_at
        ? stripQuotes(data.suspended_at)
        : undefined,
      resume_mode: data.resume_mode ? stripQuotes(data.resume_mode) : undefined,
      resume_file: data.resume_file ? stripQuotes(data.resume_file) : undefined,
      last_resume_payload: data.last_resume_payload
        ? stripQuotes(data.last_resume_payload).replace(/\\n/g, '\n')
        : undefined,
      next_poll_at: data.next_poll_at
        ? stripQuotes(data.next_poll_at)
        : undefined,
    };
  } catch {
    return null;
  }
}

export function writeState(
  directory: string,
  state: RalphLoopState,
  customPath?: string,
): boolean {
  const filePath = getStateFilePath(directory, customPath);

  try {
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const sessionIdLine = state.session_id
      ? `session_id: "${state.session_id}"\n`
      : '';
    const ultraworkLine =
      state.ultrawork !== undefined ? `ultrawork: ${state.ultrawork}\n` : '';
    const statusLine = state.status ? `status: "${state.status}"\n` : '';
    const yieldPromiseLine = state.yield_promise
      ? `yield_promise: "${state.yield_promise}"\n`
      : '';
    const suspendedAtLine = state.suspended_at
      ? `suspended_at: "${state.suspended_at}"\n`
      : '';
    const resumeModeLine = state.resume_mode
      ? `resume_mode: "${state.resume_mode}"\n`
      : '';
    const resumeFileLine = state.resume_file
      ? `resume_file: "${state.resume_file}"\n`
      : '';
    const lastResumePayloadLine = state.last_resume_payload
      ? `last_resume_payload: "${state.last_resume_payload.replace(/\n/g, '\\\\n')}"\n`
      : '';
    const nextPollAtLine = state.next_poll_at
      ? `next_poll_at: "${state.next_poll_at}"\n`
      : '';

    const content = `---
active: ${state.active}
iteration: ${state.iteration}
max_iterations: ${state.max_iterations}
completion_promise: "${state.completion_promise}"
started_at: "${state.started_at}"
${sessionIdLine}${ultraworkLine}${statusLine}${yieldPromiseLine}${suspendedAtLine}${resumeModeLine}${resumeFileLine}${lastResumePayloadLine}${nextPollAtLine}---
${state.prompt}
`;

    writeFileSync(filePath, content, 'utf-8');
    return true;
  } catch {
    return false;
  }
}

export function clearState(directory: string, customPath?: string): boolean {
  const filePath = getStateFilePath(directory, customPath);

  try {
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
    return true;
  } catch {
    return false;
  }
}

export function incrementIteration(
  directory: string,
  customPath?: string,
): RalphLoopState | null {
  const state = readState(directory, customPath);
  if (!state) return null;

  state.iteration += 1;
  if (writeState(directory, state, customPath)) {
    return state;
  }
  return null;
}
