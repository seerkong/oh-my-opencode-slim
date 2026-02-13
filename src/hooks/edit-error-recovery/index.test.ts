import { describe, expect, test } from 'bun:test';
import { createEditErrorRecoveryHook } from './index';

describe('edit-error-recovery', () => {
  function makeInput(tool: string, callID?: string) {
    return { tool, sessionID: 'sess-1', callID };
  }

  function makeOutput(output: string) {
    return { title: '', output, metadata: {} };
  }

  test('ignores non-edit tools', async () => {
    const hook = createEditErrorRecoveryHook();
    const output = makeOutput('some output');
    await hook['tool.execute.after'](makeInput('grep'), output);
    expect(output.output).toBe('some output');
  });

  test('ignores successful edit output', async () => {
    const hook = createEditErrorRecoveryHook();
    const output = makeOutput('Edit applied successfully.');
    await hook['tool.execute.after'](makeInput('Edit', 'call-1'), output);
    expect(output.output).toBe('Edit applied successfully.');
  });

  test('appends recovery hint for "oldString not found"', async () => {
    const hook = createEditErrorRecoveryHook();
    const output = makeOutput('Error: oldString not found in content');
    await hook['tool.execute.after'](makeInput('Edit', 'call-2'), output);
    expect(output.output).toContain('Edit Error Recovery');
    expect(output.output).toContain('请重新读取文件');
  });

  test('appends recovery hint for "Found multiple matches"', async () => {
    const hook = createEditErrorRecoveryHook();
    const output = makeOutput(
      'Found multiple matches for oldString. Provide more context.',
    );
    await hook['tool.execute.after'](makeInput('edit', 'call-3'), output);
    expect(output.output).toContain('Edit Error Recovery');
    expect(output.output).toContain('只匹配到一个位置');
  });

  test('appends recovery hint for ENOENT', async () => {
    const hook = createEditErrorRecoveryHook();
    const output = makeOutput('Error: ENOENT: no such file');
    await hook['tool.execute.after'](makeInput('Write', 'call-4'), output);
    expect(output.output).toContain('Edit Error Recovery');
    expect(output.output).toContain('目标文件不存在');
  });

  test('stops retrying after MAX_RETRIES', async () => {
    const hook = createEditErrorRecoveryHook();
    const callID = 'call-max-retry';

    // First failure — retry hint
    const out1 = makeOutput('oldString not found');
    await hook['tool.execute.after'](makeInput('Edit', callID), out1);
    expect(out1.output).toContain('重试第 1/2 次');

    // Second failure — retry hint
    const out2 = makeOutput('oldString not found');
    await hook['tool.execute.after'](makeInput('Edit', callID), out2);
    expect(out2.output).toContain('重试第 2/2 次');

    // Third failure — max reached message
    const out3 = makeOutput('oldString not found');
    await hook['tool.execute.after'](makeInput('Edit', callID), out3);
    expect(out3.output).toContain('已失败 3 次');
    expect(out3.output).toContain('改用其他方法');
  });

  test('handles Write tool the same as Edit', async () => {
    const hook = createEditErrorRecoveryHook();
    const output = makeOutput('Error: EACCES permission denied');
    await hook['tool.execute.after'](makeInput('write', 'call-write'), output);
    expect(output.output).toContain('Edit Error Recovery');
  });
});
