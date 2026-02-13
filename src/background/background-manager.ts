/**
 * 后台任务管理器
 *
 * 管理在独立会话中执行的长时间运行的 AI 代理任务。
 * 后台任务独立于主对话流运行，允许用户在任务异步完成时继续工作。
 *
 * 主要功能：
 * - 即发即忘启动（立即返回 task_id）
 * - 为后台工作创建隔离会话
 * - 通过 session.status 进行事件驱动的完成检测
 * - 具有可配置并发限制的启动队列
 * - 支持任务取消和结果检索
 */

import type { PluginInput } from '@opencode-ai/plugin';
import type { BackgroundTaskConfig, PluginConfig } from '../config';
import {
  FALLBACK_FAILOVER_TIMEOUT_MS,
  SUBAGENT_DELEGATION_RULES,
} from '../config';
import type { TmuxConfig } from '../config/schema';
import { applyAgentVariant, resolveAgentVariant } from '../utils';
import { log } from '../utils/logger';

type PromptBody = {
  messageID?: string;
  model?: { providerID: string; modelID: string };
  agent?: string;
  noReply?: boolean;
  system?: string;
  tools?: { [key: string]: boolean };
  parts: Array<{ type: 'text'; text: string }>;
  variant?: string;
};

type OpencodeClient = PluginInput['client'];

function parseModelReference(model: string): {
  providerID: string;
  modelID: string;
} | null {
  const slashIndex = model.indexOf('/');
  if (slashIndex <= 0 || slashIndex >= model.length - 1) {
    return null;
  }

  return {
    providerID: model.slice(0, slashIndex),
    modelID: model.slice(slashIndex + 1),
  };
}

/**
 * 表示在隔离会话中运行的后台任务。
 * 任务从创建到完成或失败全程被跟踪。
 */
export interface BackgroundTask {
  id: string; // 唯一任务标识符（例如 "bg_abc123"）
  sessionId?: string; // OpenCode 会话 ID（启动时设置）
  description: string; // 人类可读的任务描述
  agent: string; // 处理任务的代理名称
  status:
    | 'pending'
    | 'starting'
    | 'running'
    | 'completed'
    | 'failed'
    | 'cancelled';
  result?: string; // 代理的最终输出（完成时）
  error?: string; // 错误消息（失败时）
  config: BackgroundTaskConfig; // 任务配置
  parentSessionId: string; // 用于通知的父会话 ID
  startedAt: Date; // 任务创建时间戳
  completedAt?: Date; // 任务完成/失败时间戳
  prompt: string; // 初始提示
}

/**
 * 启动新后台任务的选项。
 */
export interface LaunchOptions {
  agent: string; // 处理任务的代理
  prompt: string; // 发送给代理的初始提示
  description: string; // 人类可读的任务描述
  parentSessionId: string; // 用于任务层级的父会话 ID
}

function generateTaskId(): string {
  return `bg_${Math.random().toString(36).substring(2, 10)}`;
}

export class BackgroundTaskManager {
  private tasks = new Map<string, BackgroundTask>();
  private tasksBySessionId = new Map<string, string>();
  // 跟踪每个会话所属的代理类型，用于委派权限检查
  private agentBySessionId = new Map<string, string>();
  private client: OpencodeClient;
  private directory: string;
  private tmuxEnabled: boolean;
  private config?: PluginConfig;
  private backgroundConfig: BackgroundTaskConfig;

  // 启动队列
  private startQueue: BackgroundTask[] = [];
  private activeStarts = 0;
  private maxConcurrentStarts: number;

  // 完成等待
  private completionResolvers = new Map<
    string,
    (task: BackgroundTask) => void
  >();

  constructor(
    ctx: PluginInput,
    tmuxConfig?: TmuxConfig,
    config?: PluginConfig,
  ) {
    this.client = ctx.client;
    this.directory = ctx.directory;
    this.tmuxEnabled = tmuxConfig?.enabled ?? false;
    this.config = config;
    this.backgroundConfig = config?.background ?? {
      maxConcurrentStarts: 10,
    };
    this.maxConcurrentStarts = this.backgroundConfig.maxConcurrentStarts;
  }

  /**
   * 查找代理类型的委派规则。
   * 未知代理类型默认仅有 explorer 访问权限，便于添加新的后台代理类型而无需更新 SUBAGENT_DELEGATION_RULES。
   */
  private getSubagentRules(agentName: string): readonly string[] {
    return (
      SUBAGENT_DELEGATION_RULES[
        agentName as keyof typeof SUBAGENT_DELEGATION_RULES
      ] ?? ['explorer']
    );
  }

  /**
   * 检查父会话是否允许委派给特定代理类型。
   * @param parentSessionId - 父会话的会话 ID
   * @param requestedAgent - 请求的代理类型
   * @returns 允许返回 true，否则返回 false
   */
  isAgentAllowed(parentSessionId: string, requestedAgent: string): boolean {
    // 未跟踪的会话是根编排器（由 OpenCode 创建，而非由我们创建）
    const parentAgentName =
      this.agentBySessionId.get(parentSessionId) ?? 'orchestrator';

    const allowedSubagents = this.getSubagentRules(parentAgentName);

    if (allowedSubagents.length === 0) return false;

    return allowedSubagents.includes(requestedAgent);
  }

  /**
   * 获取父会话允许的子代理列表。
   * @param parentSessionId - 父会话的会话 ID
   * @returns 允许的代理名称数组，无则为空
   */
  getAllowedSubagents(parentSessionId: string): readonly string[] {
    // 未跟踪的会话是根编排器（由 OpenCode 创建，而非由我们创建）
    const parentAgentName =
      this.agentBySessionId.get(parentSessionId) ?? 'orchestrator';

    return this.getSubagentRules(parentAgentName);
  }

  /**
   * 启动新的后台任务（即发即忘）。
   *
   * 阶段 A（同步）：创建任务记录并立即返回。
   * 阶段 B（异步）：会话创建和提示发送在后台进行。
   *
   * @param opts - 任务配置选项
   * @returns 创建的处于待处理状态的后台任务
   */
  launch(opts: LaunchOptions): BackgroundTask {
    const task: BackgroundTask = {
      id: generateTaskId(),
      sessionId: undefined,
      description: opts.description,
      agent: opts.agent,
      status: 'pending',
      startedAt: new Date(),
      config: {
        maxConcurrentStarts: this.maxConcurrentStarts,
      },
      parentSessionId: opts.parentSessionId,
      prompt: opts.prompt,
    };

    this.tasks.set(task.id, task);

    // Queue task for background start
    this.enqueueStart(task);

    log(`[background-manager] task launched: ${task.id}`, {
      agent: opts.agent,
      description: opts.description,
    });

    return task;
  }

  /**
   * 将任务加入后台启动队列。
   */
  private enqueueStart(task: BackgroundTask): void {
    this.startQueue.push(task);
    this.processQueue();
  }

  /**
   * 处理启动队列，遵循并发限制。
   */
  private processQueue(): void {
    while (
      this.activeStarts < this.maxConcurrentStarts &&
      this.startQueue.length > 0
    ) {
      const task = this.startQueue.shift();
      if (!task) break;
      this.startTask(task);
    }
  }

  private resolveFallbackChain(agentName: string): string[] {
    const fallback = this.config?.fallback;
    const chains = fallback?.chains as
      | Record<string, string[] | undefined>
      | undefined;
    const configuredChain = chains?.[agentName] ?? [];
    const primary = this.config?.agents?.[agentName]?.model;

    const chain: string[] = [];
    const seen = new Set<string>();

    for (const model of [primary, ...configuredChain]) {
      if (!model || seen.has(model)) continue;
      seen.add(model);
      chain.push(model);
    }

    return chain;
  }

  private async promptWithTimeout(
    args: Parameters<OpencodeClient['session']['prompt']>[0],
    timeoutMs: number,
  ): Promise<void> {
    await Promise.race([
      this.client.session.prompt(args),
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Prompt timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  }

  /**
   * 计算生成代理基于其自身委派规则的工具权限。
   * 无法委派的代理（叶节点）将完全禁用委派工具，
   * 防止模型看到它们永远无法使用的工具。
   *
   * @param agentName - 正在生成的代理类型
   * @returns 包含 background_task 和 task 启用/禁用状态的工具权限对象
   */
  private calculateToolPermissions(agentName: string): {
    background_task: boolean;
    task: boolean;
  } {
    const allowedSubagents = this.getSubagentRules(agentName);

    // Leaf agents (no delegation rules) get tools hidden entirely
    if (allowedSubagents.length === 0) {
      return { background_task: false, task: false };
    }

    // Agent can delegate - enable the delegation tools
    // The restriction of WHICH specific subagents are allowed is enforced
    // by the background_task tool via isAgentAllowed()
    return { background_task: true, task: true };
  }

  /**
   * 在后台启动任务（阶段 B）。
   */
  private async startTask(task: BackgroundTask): Promise<void> {
    task.status = 'starting';
    this.activeStarts++;

    // Check if cancelled after incrementing activeStarts (to catch race)
    // Use type assertion since cancel() can change status during race condition
    if ((task as BackgroundTask & { status: string }).status === 'cancelled') {
      this.completeTask(task, 'cancelled', 'Task cancelled before start');
      return;
    }

    try {
      // Create session
      const session = await this.client.session.create({
        body: {
          parentID: task.parentSessionId,
          title: `Background: ${task.description}`,
        },
        query: { directory: this.directory },
      });

      if (!session.data?.id) {
        throw new Error('创建后台会话失败');
      }

      task.sessionId = session.data.id;
      this.tasksBySessionId.set(session.data.id, task.id);
      // Track the agent type for this session for delegation checks
      this.agentBySessionId.set(session.data.id, task.agent);
      task.status = 'running';

      // Give TmuxSessionManager time to spawn the pane
      if (this.tmuxEnabled) {
        await new Promise((r) => setTimeout(r, 500));
      }

      // Calculate tool permissions based on the spawned agent's own delegation rules
      const toolPermissions = this.calculateToolPermissions(task.agent);

      // Send prompt
      const promptQuery: Record<string, string> = { directory: this.directory };
      const resolvedVariant = resolveAgentVariant(this.config, task.agent);
      const basePromptBody = applyAgentVariant(resolvedVariant, {
        agent: task.agent,
        tools: toolPermissions,
        parts: [{ type: 'text' as const, text: task.prompt }],
      } as PromptBody) as unknown as PromptBody;

      const timeoutMs =
        this.config?.fallback?.timeoutMs ?? FALLBACK_FAILOVER_TIMEOUT_MS;
      const fallbackEnabled = this.config?.fallback?.enabled ?? true;
      const chain = fallbackEnabled
        ? this.resolveFallbackChain(task.agent)
        : [];
      const attemptModels = chain.length > 0 ? chain : [undefined];

      const errors: string[] = [];
      let succeeded = false;

      for (const model of attemptModels) {
        try {
          const body: PromptBody = {
            ...basePromptBody,
            model: undefined,
          };

          if (model) {
            const ref = parseModelReference(model);
            if (!ref) {
              throw new Error(`无效的备用模型格式：${model}`);
            }
            body.model = ref;
          }

          await this.promptWithTimeout(
            {
              path: { id: session.data.id },
              body,
              query: promptQuery,
            },
            timeoutMs,
          );

          succeeded = true;
          break;
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          if (model) {
            errors.push(`${model}: ${msg}`);
          } else {
            errors.push(`default-model: ${msg}`);
          }
        }
      }

      if (!succeeded) {
        throw new Error(`所有备用模型均失败。${errors.join(' | ')}`);
      }

      log(`[background-manager] task started: ${task.id}`, {
        sessionId: session.data.id,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.completeTask(task, 'failed', errorMessage);
    } finally {
      this.activeStarts--;
      this.processQueue();
    }
  }

  /**
   * 处理 session.status 事件以检测完成。
   * 使用 session.status 替代已弃用的 session.idle。
   */
  async handleSessionStatus(event: {
    type: string;
    properties?: { sessionID?: string; status?: { type: string } };
  }): Promise<void> {
    if (event.type !== 'session.status') return;

    const sessionId = event.properties?.sessionID;
    if (!sessionId) return;

    const taskId = this.tasksBySessionId.get(sessionId);
    if (!taskId) return;

    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'running') return;

    // Check if session is idle (completed)
    if (event.properties?.status?.type === 'idle') {
      await this.extractAndCompleteTask(task);
    }
  }

  /**
   * 提取任务结果并标记为完成。
   */
  private async extractAndCompleteTask(task: BackgroundTask): Promise<void> {
    if (!task.sessionId) return;

    try {
      const messagesResult = await this.client.session.messages({
        path: { id: task.sessionId },
      });
      const messages = (messagesResult.data ?? []) as Array<{
        info?: { role: string };
        parts?: Array<{ type: string; text?: string }>;
      }>;
      const assistantMessages = messages.filter(
        (m) => m.info?.role === 'assistant',
      );

      const extractedContent: string[] = [];
      for (const message of assistantMessages) {
        for (const part of message.parts ?? []) {
          if (
            (part.type === 'text' || part.type === 'reasoning') &&
            part.text
          ) {
            extractedContent.push(part.text);
          }
        }
      }

      const responseText = extractedContent
        .filter((t) => t.length > 0)
        .join('\n\n');

      if (responseText) {
        this.completeTask(task, 'completed', responseText);
      } else {
        this.completeTask(task, 'completed', '（无输出）');
      }
    } catch (error) {
      this.completeTask(
        task,
        'failed',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /**
   * 完成任务并通知等待的调用者。
   */
  private completeTask(
    task: BackgroundTask,
    status: 'completed' | 'failed' | 'cancelled',
    resultOrError: string,
  ): void {
    // Don't check for 'cancelled' here - cancel() may set status before calling
    if (task.status === 'completed' || task.status === 'failed') {
      return; // Already completed
    }

    task.status = status;
    task.completedAt = new Date();

    if (status === 'completed') {
      task.result = resultOrError;
    } else {
      task.error = resultOrError;
    }

    // Clean up session tracking maps to prevent memory leak
    if (task.sessionId) {
      this.tasksBySessionId.delete(task.sessionId);
      this.agentBySessionId.delete(task.sessionId);
    }

    // Send notification to parent session
    if (task.parentSessionId) {
      this.sendCompletionNotification(task).catch((err) => {
        log(`[background-manager] notification failed: ${err}`);
      });
    }

    // Resolve waiting callers
    const resolver = this.completionResolvers.get(task.id);
    if (resolver) {
      resolver(task);
      this.completionResolvers.delete(task.id);
    }

    log(`[background-manager] task ${status}: ${task.id}`, {
      description: task.description,
    });
  }

  /**
   * 向父会话发送完成通知。
   */
  private async sendCompletionNotification(
    task: BackgroundTask,
  ): Promise<void> {
    const message =
      task.status === 'completed'
        ? `[后台任务 "${task.description}" 已完成]`
        : `[后台任务 "${task.description}" 失败：${task.error}]`;

    await this.client.session.prompt({
      path: { id: task.parentSessionId },
      body: {
        parts: [{ type: 'text' as const, text: message }],
      },
    });
  }

  /**
   * 检索后台任务的当前状态。
   *
   * @param taskId - 要检索的任务 ID
   * @returns 任务对象，未找到则返回 null
   */
  getResult(taskId: string): BackgroundTask | null {
    return this.tasks.get(taskId) ?? null;
  }

  /**
   * 等待任务完成。
   *
   * @param taskId - 要等待的任务 ID
   * @param timeout - 最大等待时间（毫秒，0 = 无超时）
   * @returns 已完成的任务，未找到/超时则返回 null
   */
  async waitForCompletion(
    taskId: string,
    timeout = 0,
  ): Promise<BackgroundTask | null> {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    if (
      task.status === 'completed' ||
      task.status === 'failed' ||
      task.status === 'cancelled'
    ) {
      return task;
    }

    return new Promise((resolve) => {
      const resolver = (t: BackgroundTask) => resolve(t);
      this.completionResolvers.set(taskId, resolver);

      if (timeout > 0) {
        setTimeout(() => {
          this.completionResolvers.delete(taskId);
          resolve(this.tasks.get(taskId) ?? null);
        }, timeout);
      }
    });
  }

  /**
   * 取消一个或所有运行中的后台任务。
   *
   * @param taskId - 可选的要取消的任务 ID。如果省略，取消所有待处理/运行中的任务。
   * @returns 已取消的任务数量
   */
  cancel(taskId?: string): number {
    if (taskId) {
      const task = this.tasks.get(taskId);
      if (
        task &&
        (task.status === 'pending' ||
          task.status === 'starting' ||
          task.status === 'running')
      ) {
        // Clean up any waiting resolver
        this.completionResolvers.delete(taskId);

        // Check if in start queue (must check before marking cancelled)
        const inStartQueue = task.status === 'pending';

        // Mark as cancelled FIRST to prevent race with startTask
        // Use type assertion since we're deliberately changing status before completeTask
        (task as BackgroundTask & { status: string }).status = 'cancelled';

        // Remove from start queue if pending
        if (inStartQueue) {
          const idx = this.startQueue.findIndex((t) => t.id === taskId);
          if (idx >= 0) {
            this.startQueue.splice(idx, 1);
          }
        }

        this.completeTask(task, 'cancelled', '被用户取消');
        return 1;
      }
      return 0;
    }

    let count = 0;
    for (const task of this.tasks.values()) {
      if (
        task.status === 'pending' ||
        task.status === 'starting' ||
        task.status === 'running'
      ) {
        // Clean up any waiting resolver
        this.completionResolvers.delete(task.id);

        // Check if in start queue (must check before marking cancelled)
        const inStartQueue = task.status === 'pending';

        // Mark as cancelled FIRST to prevent race with startTask
        // Use type assertion since we're deliberately changing status before completeTask
        (task as BackgroundTask & { status: string }).status = 'cancelled';

        // Remove from start queue if pending
        if (inStartQueue) {
          const idx = this.startQueue.findIndex((t) => t.id === task.id);
          if (idx >= 0) {
            this.startQueue.splice(idx, 1);
          }
        }

        this.completeTask(task, 'cancelled', '被用户取消');
        count++;
      }
    }
    return count;
  }

  /**
   * 清理所有任务。
   */
  cleanup(): void {
    this.startQueue = [];
    this.completionResolvers.clear();
    this.tasks.clear();
    this.tasksBySessionId.clear();
    this.agentBySessionId.clear();
  }
}
