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
  normalizeSessionStatusToIdle,
  pruneRecentIdles,
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

/**
 * 创建事件多路复用器。
 *
 * 增强功能（参考 oh-my-opencode 的 src/plugin/event.ts）：
 * - 将 session.status (type=idle) 合成为 session.idle 事件
 * - 对原生 session.idle 和合成 session.idle 进行 500ms 窗口去重
 * - 顺序分发事件到所有注册的处理器
 */
function createEventMultiplexer(
  handlers: Array<((input: EventInput) => Promise<void> | void) | undefined>,
) {
  // idle 事件去重状态
  const recentSyntheticIdles = new Map<string, number>();
  const recentRealIdles = new Map<string, number>();
  const DEDUP_WINDOW_MS = 500;

  const dispatchToHandlers = async (input: EventInput) => {
    for (const handler of handlers) {
      if (!handler) continue;
      await handler(input);
    }
  };

  return async (input: EventInput) => {
    // 清理过期的去重记录
    pruneRecentIdles({
      recentSyntheticIdles,
      recentRealIdles,
      now: Date.now(),
      dedupWindowMs: DEDUP_WINDOW_MS,
    });

    // 如果是原生 session.idle，检查是否与近期合成 idle 重复
    if (input.event.type === 'session.idle') {
      const sessionID = (
        input.event.properties as Record<string, unknown> | undefined
      )?.sessionID as string | undefined;
      if (sessionID) {
        const emittedAt = recentSyntheticIdles.get(sessionID);
        if (emittedAt && Date.now() - emittedAt < DEDUP_WINDOW_MS) {
          // 已有合成 idle，跳过原生 idle 避免重复
          recentSyntheticIdles.delete(sessionID);
          return;
        }
        recentRealIdles.set(sessionID, Date.now());
      }
    }

    // 分发原始事件到所有处理器
    await dispatchToHandlers(input);

    // 尝试将 session.status (type=idle) 合成为 session.idle
    const syntheticIdle = normalizeSessionStatusToIdle(input);
    if (syntheticIdle) {
      const sessionID = (
        syntheticIdle.event.properties as Record<string, unknown>
      )?.sessionID as string;
      // 检查是否与近期原生 idle 重复
      const emittedAt = recentRealIdles.get(sessionID);
      if (emittedAt && Date.now() - emittedAt < DEDUP_WINDOW_MS) {
        recentRealIdles.delete(sessionID);
        return;
      }
      recentSyntheticIdles.set(sessionID, Date.now());
      // 分发合成的 session.idle 事件
      await dispatchToHandlers(syntheticIdle as EventInput);
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
  const sessionNotificationHook = createSessionNotificationHook(
    config.session_notification ?? {},
  );
  const sessionRecoveryHook = createSessionRecoveryHook();

  const ralphLoop =
    (config.ralph_loop?.enabled ?? true)
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
      // ---------------------------------------------------------------
      // 已注册的功能钩子
      // ---------------------------------------------------------------
      autoUpdateChecker.event,
      rulesInjectorHook.event,
      directoryAgentsInjectorHook.event,
      contextWindowMonitorHook.event,
      sessionNotificationHook.event,
      sessionRecoveryHook.event,
      ralphLoop?.event,

      // ---------------------------------------------------------------
      // 内联事件处理器
      // ---------------------------------------------------------------
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
            properties?: {
              sessionID?: string;
              status?: { type: string };
            };
          },
        );
        await tmuxSessionManager.onSessionStatus(
          input.event as {
            type: string;
            properties?: {
              sessionID?: string;
              status?: { type: string };
            };
          },
        );
      },

      // ---------------------------------------------------------------
      // 全事件类型监听框架（便于后续扩展）
      //
      // 以下覆盖 OpenCode 的所有 16 种事件类型。
      // 当前未使用的事件以注释形式保留，添加功能时取消注释即可。
      // 事件类型定义见 src/types/events.ts
      //
      // 注意：session.status (type=idle) 会被 createEventMultiplexer
      // 自动合成为 session.idle 事件并二次分发，无需手动处理。
      // ---------------------------------------------------------------
      async (input: EventInput) => {
        const { type } = input.event;
        const _props = input.event.properties as
          | Record<string, unknown>
          | undefined;

        switch (type) {
          // === Session 事件 ===

          // session.created — 新会话创建
          // 已由: autoUpdateChecker, sessionNotificationHook,
          //       tmuxSessionManager (上方内联) 处理
          case 'session.created':
            break;

          // session.idle — 会话空闲（agent 完成工作，等待用户输入）
          // 已由: sessionNotificationHook, ralphLoop 处理
          // 注意：也包含从 session.status(idle) 合成的事件
          case 'session.idle':
            break;

          // session.status — 会话状态变更
          // 子类型: idle / busy / retry / completed / error / cancelled
          // 已由: sessionNotificationHook, sessionRecoveryHook,
          //       backgroundManager, tmuxSessionManager (上方内联) 处理
          case 'session.status':
            break;

          // session.updated — 会话更新（通用活动信号）
          // 当前无处理器，预留扩展
          case 'session.updated':
            break;

          // session.error — 会话错误
          // 已由: sessionRecoveryHook, ralphLoop 处理
          case 'session.error':
            break;

          // session.deleted — 会话销毁，用于清理状态
          // 已由: rulesInjectorHook, directoryAgentsInjectorHook,
          //       contextWindowMonitorHook, sessionNotificationHook,
          //       ralphLoop 处理
          case 'session.deleted':
            break;

          // session.compacted — 会话上下文被压缩/摘要化
          // 已由: rulesInjectorHook, directoryAgentsInjectorHook 处理
          case 'session.compacted':
            break;

          // === Message 事件 ===

          // message.updated — 完整消息更新（角色、内容、模型信息）
          // 已由: sessionNotificationHook 处理（作为活动信号）
          case 'message.updated':
            break;

          // message.part.updated — 流式消息片段更新
          // 当前无处理器，预留扩展
          // 可用于：流式输出监控、实时内容分析
          case 'message.part.updated':
            break;

          // === Tool 事件（通过 event handler 接收） ===

          // 注意：tool.execute 和 tool.result 是 CLI 事件流专用，
          // 不会通过插件 event handler 接收，因此不在 switch 中处理。
          // 如需监听工具执行，使用 tool.execute.before / tool.execute.after hook。

          // === 其他事件 ===
          // tool.execute.before / tool.execute.after
          //   → 通过 'tool.execute.before' / 'tool.execute.after' hook 处理
          // chat.params / chat.message
          //   → 通过 'chat.params' / 'chat.message' hook 处理
          // experimental.chat.messages.transform
          //   → 通过 'experimental.chat.messages.transform' hook 处理
          // command.execute.before
          //   → 通过 command hook 处理（当前未实现）
          // experimental.session.compacting
          //   → 通过 experimental hook 处理（当前未实现）

          default:
            break;
        }
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
