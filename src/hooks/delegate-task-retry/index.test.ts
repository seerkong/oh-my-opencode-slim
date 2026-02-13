import { describe, expect, test } from 'bun:test';
import { createDelegateTaskRetryHook } from './index';

describe('delegate-task-retry', () => {
  function makeInput(tool: string, callID?: string) {
    return { tool, sessionID: 'sess-1', callID };
  }

  function makeOutput(output: string) {
    return { title: '', output, metadata: {} };
  }

  test('ignores non-task tools', async () => {
    const hook = createDelegateTaskRetryHook();
    const output = makeOutput('some output');
    await hook['tool.execute.after'](makeInput('grep'), output);
    expect(output.output).toBe('some output');
  });

  test('ignores successful task output', async () => {
    const hook = createDelegateTaskRetryHook();
    const output = makeOutput('Task completed successfully.');
    await hook['tool.execute.after'](
      makeInput('background_task', 'task-ok'),
      output,
    );
    expect(output.output).toBe('Task completed successfully.');
  });

  test('appends retry hint for "task failed"', async () => {
    const hook = createDelegateTaskRetryHook();
    const output = makeOutput('Error: task failed with exit code 1');
    await hook['tool.execute.after'](
      makeInput('background_task', 'task-fail-1'),
      output,
    );
    expect(output.output).toContain('Delegate Task Retry');
    expect(output.output).toContain('task failed');
  });

  test('appends retry hint for "task timed out"', async () => {
    const hook = createDelegateTaskRetryHook();
    const output = makeOutput('task timed out after 120s');
    await hook['tool.execute.after'](makeInput('Task', 'task-timeout'), output);
    expect(output.output).toContain('Delegate Task Retry');
  });

  test('appends retry hint for "rate limit"', async () => {
    const hook = createDelegateTaskRetryHook();
    const output = makeOutput('rate limit exceeded, try again later');
    await hook['tool.execute.after'](
      makeInput('background_output', 'task-rate'),
      output,
    );
    expect(output.output).toContain('Delegate Task Retry');
  });

  test('stops retrying after MAX_TASK_RETRIES', async () => {
    const hook = createDelegateTaskRetryHook();
    const callID = 'task-max-retry';

    // First failure — retry hint
    const out1 = makeOutput('task failed');
    await hook['tool.execute.after'](
      makeInput('background_task', callID),
      out1,
    );
    expect(out1.output).toContain('重试第 1/1 次');

    // Second failure — max reached
    const out2 = makeOutput('task failed');
    await hook['tool.execute.after'](
      makeInput('background_task', callID),
      out2,
    );
    expect(out2.output).toContain('次尝试后仍然失败');
    expect(out2.output).toContain('切换到其他专家');
  });

  test('handles task tool variant', async () => {
    const hook = createDelegateTaskRetryHook();
    const output = makeOutput('agent error: context too large');
    await hook['tool.execute.after'](makeInput('task', 'task-variant'), output);
    expect(output.output).toContain('Delegate Task Retry');
  });
});
