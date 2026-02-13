import type { PluginInput } from '@opencode-ai/plugin';
import { createDynamicTruncator } from '../../utils/dynamic-truncator';

const DEFAULT_MAX_TOKENS = 50_000;
const WEBFETCH_MAX_TOKENS = 10_000;

const TRUNCATABLE_TOOLS = [
  'grep',
  'Grep',
  'safe_grep',
  'glob',
  'Glob',
  'safe_glob',
  'lsp_diagnostics',
  'ast_grep_search',
  'interactive_bash',
  'skill_mcp',
  'webfetch',
  'WebFetch',
];

const TOOL_SPECIFIC_MAX_TOKENS: Record<string, number> = {
  webfetch: WEBFETCH_MAX_TOKENS,
  WebFetch: WEBFETCH_MAX_TOKENS,
};

export interface ToolOutputTruncatorOptions {
  truncateAll?: boolean;
}

export function createToolOutputTruncatorHook(
  ctx: PluginInput,
  options?: ToolOutputTruncatorOptions,
) {
  const truncator = createDynamicTruncator(ctx);
  const truncateAll = options?.truncateAll ?? false;

  return {
    'tool.execute.after': async (
      input: { tool: string; sessionID: string; callID: string },
      output: { title: string; output: string; metadata: unknown },
    ) => {
      if (!truncateAll && !TRUNCATABLE_TOOLS.includes(input.tool)) return;

      try {
        const targetMaxTokens =
          TOOL_SPECIFIC_MAX_TOKENS[input.tool] ?? DEFAULT_MAX_TOKENS;
        const { result, truncated } = await truncator.truncate(
          input.sessionID,
          output.output,
          { targetMaxTokens },
        );
        if (truncated) {
          output.output = result;
        }
      } catch {
        // 优雅降级
      }
    },
  };
}
