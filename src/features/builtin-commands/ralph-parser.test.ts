import { describe, expect, test } from 'bun:test';
import { getTextFromChatParts, parseRalphCommand } from './ralph-parser';

describe('ralph-parser', () => {
  test('parses slash ralph-loop command with options', () => {
    const cmd = parseRalphCommand(
      '/ralph-loop "Build auth flow" --max-iterations=12 --completion-promise=FIN --yield-promise=WAIT --resume-mode=file --resume-file=.sisyphus/custom.md',
    );

    expect(cmd?.type).toBe('start');
    if (cmd?.type !== 'start') return;
    expect(cmd.prompt).toBe('Build auth flow');
    expect(cmd.maxIterations).toBe(12);
    expect(cmd.completionPromise).toBe('FIN');
    expect(cmd.yieldPromise).toBe('WAIT');
    expect(cmd.resumeMode).toBe('file');
    expect(cmd.resumeFile).toBe('.sisyphus/custom.md');
  });

  test('parses slash ulw-loop command', () => {
    const cmd = parseRalphCommand(
      '/ulw-loop "Ship release" --max-iterations=3',
    );

    expect(cmd?.type).toBe('start');
    if (cmd?.type !== 'start') return;
    expect(cmd.ultrawork).toBe(true);
    expect(cmd.prompt).toBe('Ship release');
    expect(cmd.maxIterations).toBe(3);
  });

  test('parses cancel command', () => {
    const cmd = parseRalphCommand('/cancel-ralph');
    expect(cmd).toEqual({ type: 'cancel' });
  });

  test('parses resume command with payload and file', () => {
    const cmd = parseRalphCommand(
      '/ralph-resume "approved, proceed" --resume-file=.sisyphus/next.md',
    );

    expect(cmd?.type).toBe('resume');
    if (cmd?.type !== 'resume') return;
    expect(cmd.payload).toBe('approved, proceed');
    expect(cmd.resumeFile).toBe('.sisyphus/next.md');
  });

  test('parses ralph-loop template payload', () => {
    const input = `You are starting a Ralph Loop - a self-referential development loop that runs until task completion.
<user-task>
"Implement retries" --max-iterations=5
</user-task>`;

    const cmd = parseRalphCommand(input);
    expect(cmd?.type).toBe('start');
    if (cmd?.type !== 'start') return;
    expect(cmd.prompt).toBe('Implement retries');
    expect(cmd.maxIterations).toBe(5);
  });

  test('parses cancel template payload', () => {
    const input = 'Cancel the currently active Ralph Loop.\nPlease proceed.';
    const cmd = parseRalphCommand(input);
    expect(cmd).toEqual({ type: 'cancel' });
  });

  test('parses resume template payload', () => {
    const input = `Resume a suspended Ralph Loop.
<resume-args>
"continue with reviewer feedback" --resume-file=.sisyphus/ralph-resume.md
</resume-args>`;

    const cmd = parseRalphCommand(input);
    expect(cmd?.type).toBe('resume');
    if (cmd?.type !== 'resume') return;
    expect(cmd.payload).toBe('continue with reviewer feedback');
    expect(cmd.resumeFile).toBe('.sisyphus/ralph-resume.md');
  });

  test('returns null for unrelated text', () => {
    expect(parseRalphCommand('hello world')).toBeNull();
  });

  test('extracts text from chat parts', () => {
    const text = getTextFromChatParts([
      { type: 'tool', text: 'ignore' },
      { type: 'text', text: 'first line' },
      { type: 'text', text: 'second line' },
    ]);
    expect(text).toBe('first line\nsecond line');
  });
});
