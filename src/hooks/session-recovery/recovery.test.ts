import { describe, expect, test } from 'bun:test';
import { detectErrorType, recoverToolResultMissing } from './recovery';

describe('detectErrorType', () => {
  test('detects tool_result_missing from Anthropic-style error', () => {
    expect(
      detectErrorType(
        'tool_use block with id toolu_123 has no matching tool_result',
      ),
    ).toBe('tool_result_missing');
  });

  test('detects tool_result_missing from literal string', () => {
    expect(detectErrorType('tool_result_missing')).toBe('tool_result_missing');
  });

  test('detects tool_result_missing from descriptive message', () => {
    expect(
      detectErrorType('Each tool_use must have a corresponding tool result'),
    ).toBe('tool_result_missing');
  });

  test('detects tool_result_missing from missing tool result', () => {
    expect(detectErrorType('Error: missing tool result for call abc')).toBe(
      'tool_result_missing',
    );
  });

  test('detects tool_result_missing from expected tool_result', () => {
    expect(detectErrorType('expected tool_result after tool_use')).toBe(
      'tool_result_missing',
    );
  });

  test('detects context_window_exceeded', () => {
    expect(
      detectErrorType('This request exceeds the context window limit'),
    ).toBe('context_window_exceeded');
  });

  test('detects context_window_exceeded from token limit', () => {
    expect(detectErrorType('Request has too many tokens (150000)')).toBe(
      'context_window_exceeded',
    );
  });

  test('detects context_window_exceeded from max_tokens', () => {
    expect(detectErrorType('max_tokens exceeded for this model')).toBe(
      'context_window_exceeded',
    );
  });

  test('detects rate_limit', () => {
    expect(detectErrorType('Rate limit exceeded, please retry')).toBe(
      'rate_limit',
    );
  });

  test('detects rate_limit from 429', () => {
    expect(detectErrorType('HTTP 429 Too Many Requests')).toBe('rate_limit');
  });

  test('detects api_error from 500', () => {
    expect(detectErrorType('500 Internal Server Error')).toBe('api_error');
  });

  test('detects api_error from overloaded', () => {
    expect(detectErrorType('The API is currently overloaded')).toBe(
      'api_error',
    );
  });

  test('detects api_error from 502 bad gateway', () => {
    expect(detectErrorType('502 Bad Gateway')).toBe('api_error');
  });

  test('returns unknown for unrecognized errors', () => {
    expect(detectErrorType('Something completely different happened')).toBe(
      'unknown',
    );
  });

  test('returns unknown for empty string', () => {
    expect(detectErrorType('')).toBe('unknown');
  });
});

describe('recoverToolResultMissing', () => {
  test('returns null when no orphaned tool_use blocks', () => {
    const messages = [
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tool_1', name: 'read' }],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tool_1',
            content: 'file contents',
          },
        ],
      },
    ];
    expect(recoverToolResultMissing(messages)).toBeNull();
  });

  test('injects stub for orphaned tool_use', () => {
    const messages = [
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tool_1', name: 'read' }],
      },
    ];
    const result = recoverToolResultMissing(messages);
    expect(result).not.toBeNull();
    if (!result) throw new Error('expected recovery result');
    expect(result.length).toBe(2);
    expect(result[1].role).toBe('user');

    const parts = result[1].content as Array<{
      type: string;
      tool_use_id: string;
    }>;
    expect(parts[0].type).toBe('tool_result');
    expect(parts[0].tool_use_id).toBe('tool_1');
  });

  test('handles multiple orphaned tool_use in one message', () => {
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'tool_1', name: 'read' },
          { type: 'tool_use', id: 'tool_2', name: 'write' },
        ],
      },
    ];
    const result = recoverToolResultMissing(messages);
    expect(result).not.toBeNull();
    if (!result) throw new Error('expected recovery result');

    const parts = result[1].content as Array<{
      type: string;
      tool_use_id: string;
    }>;
    expect(parts.length).toBe(2);
    expect(parts[0].tool_use_id).toBe('tool_1');
    expect(parts[1].tool_use_id).toBe('tool_2');
  });

  test('only patches orphaned, not already-matched tool_use', () => {
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'tool_1', name: 'read' },
          { type: 'tool_use', id: 'tool_2', name: 'write' },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tool_1',
            content: 'ok',
          },
        ],
      },
    ];
    const result = recoverToolResultMissing(messages);
    expect(result).not.toBeNull();
    if (!result) throw new Error('expected recovery result');
    // Original 2 messages + 1 injected stub message
    expect(result.length).toBe(3);

    // The injected message should only have tool_2
    const injected = result[1]; // injected after assistant msg
    const parts = injected.content as Array<{
      type: string;
      tool_use_id: string;
    }>;
    expect(parts.length).toBe(1);
    expect(parts[0].tool_use_id).toBe('tool_2');
  });

  test('handles string content messages gracefully', () => {
    const messages = [
      { role: 'user', content: 'Hello' },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tool_1', name: 'read' }],
      },
    ];
    const result = recoverToolResultMissing(messages);
    expect(result).not.toBeNull();
    if (!result) throw new Error('expected recovery result');
    expect(result.length).toBe(3);
  });

  test('does not mutate original messages', () => {
    const messages = [
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tool_1', name: 'read' }],
      },
    ];
    const original = JSON.stringify(messages);
    recoverToolResultMissing(messages);
    expect(JSON.stringify(messages)).toBe(original);
  });
});
