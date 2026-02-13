import type { Hooks, Plugin } from '@opencode-ai/plugin';
import { getAgentConfigs } from './agents';
import { BackgroundTaskManager, TmuxSessionManager } from './background';
import { loadPluginConfig, type TmuxConfig } from './config';
import { parseList } from './config/agent-mcps';
import { loadBuiltinCommands } from './features/builtin-commands';
import {
  type ChatPart,
  getTextFromChatParts,
  parseRalphCommand,
} from './features/builtin-commands/ralph-parser';
import {
  createAutoUpdateCheckerHook,
  createContextWindowMonitorHook,
  createDelegateTaskRetryHook,
  createDirectoryAgentsInjectorHook,
  createEditErrorRecoveryHook,
  createPhaseReminderHook,
  createPostReadNudgeHook,
  createRalphLoopHook,
  createRulesInjectorHook,
  createSessionNotificationHook,
  createSessionRecoveryHook,
  createToolOutputTruncatorHook,
} from './hooks';
import { createBuiltinMcps } from './mcp';
import {
  ast_grep_replace,
  ast_grep_search,
  createBackgroundTools,
  grep,
  lsp_diagnostics,
  lsp_find_references,
  lsp_goto_definition,
  lsp_rename,
} from './tools';
import { startTmuxCheck } from './utils';
import { log } from './utils/logger';

type EventHandler = NonNullable<Hooks['event']>;
type ToolBeforeHandler = NonNullable<Hooks['tool.execute.before']>;
type ToolAfterHandler = NonNullable<Hooks['tool.execute.after']>;
type ChatMessagesTransformHandler = NonNullable<
  Hooks['experimental.chat.messages.transform']
>;

type EventInput = Parameters<EventHandler>[0];
type ToolBeforeInput = Parameters<ToolBeforeHandler>[0];
type ToolBeforeOutput = Parameters<ToolBeforeHandler>[1];
type ToolAfterInput = Parameters<ToolAfterHandler>[0];
type ToolAfterOutput = Parameters<ToolAfterHandler>[1];
type ChatMessagesTransformOutput = Parameters<ChatMessagesTransformHandler>[1];

function createEventMultiplexer(
  handlers: Array<((input: EventInput) => Promise<void> | void) | undefined>,
) {
  return async (input: EventInput) => {
    for (const handler of handlers) {
      if (!handler) continue;
      await handler(input);
    }
  };
}

function createToolBeforeMultiplexer(
  handlers: Array<
    | ((
        input: ToolBeforeInput,
        output: ToolBeforeOutput,
      ) => Promise<void> | void)
    | undefined
  >,
) {
  return async (input: ToolBeforeInput, output: ToolBeforeOutput) => {
    for (const handler of handlers) {
      if (!handler) continue;
      await handler(input, output);
    }
  };
}

function createToolAfterMultiplexer(
  handlers: Array<
    | ((input: ToolAfterInput, output: ToolAfterOutput) => Promise<void> | void)
    | undefined
  >,
) {
  return async (input: ToolAfterInput, output: ToolAfterOutput) => {
    for (const handler of handlers) {
      if (!handler) continue;
      await handler(input, output);
    }
  };
}

function createChatMessagesTransformMultiplexer(
  handlers: Array<
    | ((
        input: Record<string, never>,
        output: ChatMessagesTransformOutput,
      ) => Promise<void> | void)
    | undefined
  >,
) {
  return async (
    input: Record<string, never>,
    output: ChatMessagesTransformOutput,
  ) => {
    for (const handler of handlers) {
      if (!handler) continue;
      await handler(input, output);
    }
  };
}

const OhMyOpenCodeLite: Plugin = async (ctx) => {
  const config = loadPluginConfig(ctx.directory);
  const agents = getAgentConfigs(config);

  // Parse tmux config with defaults
  const tmuxConfig: TmuxConfig = {
    enabled: config.tmux?.enabled ?? false,
    layout: config.tmux?.layout ?? 'main-vertical',
    main_pane_size: config.tmux?.main_pane_size ?? 60,
  };

  log('[plugin] initialized with tmux config', {
    tmuxConfig,
    rawTmuxConfig: config.tmux,
    directory: ctx.directory,
  });

  // Start background tmux check if enabled
  if (tmuxConfig.enabled) {
    startTmuxCheck();
  }

  const backgroundManager = new BackgroundTaskManager(ctx, tmuxConfig, config);
  const backgroundTools = createBackgroundTools(
    ctx,
    backgroundManager,
    tmuxConfig,
    config,
  );
  const mcps = createBuiltinMcps(config.disabled_mcps);

  // Initialize TmuxSessionManager to handle OpenCode's built-in Task tool sessions
  const tmuxSessionManager = new TmuxSessionManager(ctx, tmuxConfig);

  // Initialize auto-update checker hook
  const autoUpdateChecker = createAutoUpdateCheckerHook(ctx, {
    showStartupToast: true,
    autoUpdate: true,
  });

  // Initialize phase reminder hook for workflow compliance
  const phaseReminderHook = createPhaseReminderHook();

  // Initialize post-read nudge hook
  const postReadNudgeHook = createPostReadNudgeHook();

  // Phase 1 migrated hooks
  const rulesInjectorHook = createRulesInjectorHook(ctx.directory);
  const directoryAgentsInjectorHook = createDirectoryAgentsInjectorHook(
    ctx.directory,
  );
  const toolOutputTruncatorHook = createToolOutputTruncatorHook(ctx);
  const editErrorRecoveryHook = createEditErrorRecoveryHook();
  const delegateTaskRetryHook = createDelegateTaskRetryHook();
  const contextWindowMonitorHook = createContextWindowMonitorHook(ctx);
  const sessionNotificationHook = createSessionNotificationHook();
  const sessionRecoveryHook = createSessionRecoveryHook();

  const ralphLoop = config.ralph_loop?.enabled
    ? createRalphLoopHook(ctx, {
        config: config.ralph_loop,
      })
    : null;

  return {
    name: 'oh-my-opencode-slim',

    agent: agents,

    tool: {
      ...backgroundTools,
      lsp_goto_definition,
      lsp_find_references,
      lsp_diagnostics,
      lsp_rename,
      grep,
      ast_grep_search,
      ast_grep_replace,
    },

    mcp: mcps,

    config: async (opencodeConfig: Record<string, unknown>) => {
      (opencodeConfig as { default_agent?: string }).default_agent =
        'orchestrator';

      // Merge Agent configs
      if (!opencodeConfig.agent) {
        opencodeConfig.agent = { ...agents };
      } else {
        Object.assign(opencodeConfig.agent, agents);
      }
      const configAgent = opencodeConfig.agent as Record<string, unknown>;

      // Merge builtin commands into config.command
      const builtinCommands = loadBuiltinCommands();
      const existingCommands =
        (opencodeConfig.command as Record<string, unknown>) ?? {};
      opencodeConfig.command = { ...builtinCommands, ...existingCommands };

      // Merge MCP configs
      const configMcp = opencodeConfig.mcp as
        | Record<string, unknown>
        | undefined;
      if (!configMcp) {
        opencodeConfig.mcp = { ...mcps };
      } else {
        Object.assign(configMcp, mcps);
      }

      // Get all MCP names from our config
      const allMcpNames = Object.keys(mcps);

      // For each agent, create permission rules based on their mcps list
      for (const [agentName, agentConfig] of Object.entries(agents)) {
        const agentMcps = (agentConfig as { mcps?: string[] })?.mcps;
        if (!agentMcps) continue;

        // Get or create agent permission config
        if (!configAgent[agentName]) {
          configAgent[agentName] = { ...agentConfig };
        }
        const agentConfigEntry = configAgent[agentName] as Record<
          string,
          unknown
        >;
        const agentPermission = (agentConfigEntry.permission ?? {}) as Record<
          string,
          unknown
        >;

        // Parse mcps list with wildcard and exclusion support
        const allowedMcps = parseList(agentMcps, allMcpNames);

        // Create permission rules for each MCP
        // MCP tools are named as <server>_<tool>, so we use <server>_*
        for (const mcpName of allMcpNames) {
          const sanitizedMcpName = mcpName.replace(/[^a-zA-Z0-9_-]/g, '_');
          const permissionKey = `${sanitizedMcpName}_*`;
          const action = allowedMcps.includes(mcpName) ? 'allow' : 'deny';

          // Only set if not already defined by user
          if (!(permissionKey in agentPermission)) {
            agentPermission[permissionKey] = action;
          }
        }

        // Update agent config with permissions
        agentConfigEntry.permission = agentPermission;
      }
    },

    event: createEventMultiplexer([
      autoUpdateChecker.event,
      rulesInjectorHook.event,
      directoryAgentsInjectorHook.event,
      contextWindowMonitorHook.event,
      sessionNotificationHook.event,
      sessionRecoveryHook.event,
      ralphLoop?.event,
      async (input: EventInput) => {
        // Handle tmux pane spawning for OpenCode's built-in Task tool sessions
        await tmuxSessionManager.onSessionCreated(
          input.event as {
            type: string;
            properties?: {
              info?: { id?: string; parentID?: string; title?: string };
            };
          },
        );
      },
      async (input: EventInput) => {
        // Handle session.status events for:
        // 1. BackgroundTaskManager: completion detection
        // 2. TmuxSessionManager: pane cleanup
        await backgroundManager.handleSessionStatus(
          input.event as {
            type: string;
            properties?: { sessionID?: string; status?: { type: string } };
          },
        );
        await tmuxSessionManager.onSessionStatus(
          input.event as {
            type: string;
            properties?: { sessionID?: string; status?: { type: string } };
          },
        );
      },
    ]),

    'chat.message': async (
      input: { sessionID: string },
      output: { parts: ChatPart[] },
    ) => {
      if (!ralphLoop) return;

      const promptText = getTextFromChatParts(output.parts);
      const command = parseRalphCommand(promptText);
      if (!command) return;

      if (command.type === 'start') {
        log('[ralph-loop] Starting loop from chat.message', {
          sessionID: input.sessionID,
          prompt: command.prompt,
        });
        ralphLoop.startLoop(input.sessionID, command.prompt, {
          ultrawork: command.ultrawork,
          maxIterations: command.maxIterations,
          completionPromise: command.completionPromise,
          yieldPromise: command.yieldPromise,
          resumeMode: command.resumeMode,
          resumeFile: command.resumeFile,
        });
        return;
      }

      if (command.type === 'cancel') {
        log('[ralph-loop] Cancelling loop from chat.message', {
          sessionID: input.sessionID,
        });
        ralphLoop.cancelLoop(input.sessionID);
        return;
      }

      await ralphLoop.resumeLoop(input.sessionID, command.payload, {
        resumeFile: command.resumeFile,
      });
    },

    'tool.execute.before': createToolBeforeMultiplexer([
      rulesInjectorHook['tool.execute.before'],
      directoryAgentsInjectorHook['tool.execute.before'],
      async (
        input: { tool: string; sessionID: string; callID: string },
        output: { args: unknown },
      ) => {
        if (!ralphLoop || input.tool !== 'slashcommand') return;

        const args = output.args as { command?: string } | undefined;
        const commandText = args?.command;
        if (!commandText) return;

        const command = parseRalphCommand(commandText);
        if (!command) return;

        if (command.type === 'start') {
          log('[ralph-loop] Starting loop from slashcommand', {
            sessionID: input.sessionID,
            prompt: command.prompt,
          });
          ralphLoop.startLoop(input.sessionID, command.prompt, {
            ultrawork: command.ultrawork,
            maxIterations: command.maxIterations,
            completionPromise: command.completionPromise,
            yieldPromise: command.yieldPromise,
            resumeMode: command.resumeMode,
            resumeFile: command.resumeFile,
          });
          return;
        }

        if (command.type === 'cancel') {
          log('[ralph-loop] Cancelling loop from slashcommand', {
            sessionID: input.sessionID,
          });
          ralphLoop.cancelLoop(input.sessionID);
          return;
        }

        await ralphLoop.resumeLoop(input.sessionID, command.payload, {
          resumeFile: command.resumeFile,
        });
      },
    ]),

    // Inject phase reminder before sending to API (doesn't show in UI)
    'experimental.chat.messages.transform':
      createChatMessagesTransformMultiplexer([
        phaseReminderHook['experimental.chat.messages.transform'],
      ]),

    'tool.execute.after': createToolAfterMultiplexer([
      rulesInjectorHook['tool.execute.after'],
      directoryAgentsInjectorHook['tool.execute.after'],
      editErrorRecoveryHook['tool.execute.after'],
      delegateTaskRetryHook['tool.execute.after'],
      contextWindowMonitorHook['tool.execute.after'],
      toolOutputTruncatorHook['tool.execute.after'],
      postReadNudgeHook['tool.execute.after'],
    ]),
  };
};

export default OhMyOpenCodeLite;

export type {
  AgentName,
  AgentOverrideConfig,
  McpName,
  PluginConfig,
  TmuxConfig,
  TmuxLayout,
} from './config';
export type { RemoteMcpConfig } from './mcp';
