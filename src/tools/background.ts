import {
  type PluginInput,
  type ToolDefinition,
  tool,
} from '@opencode-ai/plugin';
import type { BackgroundTaskManager } from '../background';
import type { PluginConfig } from '../config';
import { SUBAGENT_NAMES } from '../config';
import type { TmuxConfig } from '../config/schema';

const z = tool.schema;

/**
 * 为插件创建后台任务管理工具。
 * @param _ctx - 插件输入上下文
 * @param manager - 用于启动和跟踪任务的后台任务管理器
 * @param _tmuxConfig - 可选的 tmux 会话管理配置
 * @param _pluginConfig - 可选的插件代理变体配置
 * @returns 包含 background_task、background_output 和 background_cancel 工具的对象
 */
export function createBackgroundTools(
  _ctx: PluginInput,
  manager: BackgroundTaskManager,
  _tmuxConfig?: TmuxConfig,
  _pluginConfig?: PluginConfig,
): Record<string, ToolDefinition> {
  const agentNames = SUBAGENT_NAMES.join(', ');

  // Tool for launching agent tasks (fire-and-forget)
  const background_task = tool({
    description: `启动后台代理任务。立即返回 task_id。

流程：启动 → 等待任务完成时的自动通知。

关键行为：
- 即发即忘：约 1ms 内返回 task_id
- 并行：最多 10 个并发任务
- 自动通知：任务完成时父会话收到结果`,

    args: {
      description: z.string().describe('任务的简短描述（5-10 个词）'),
      prompt: z.string().describe('发送给代理的任务提示'),
      agent: z.string().describe(`使用的代理：${agentNames}`),
    },
    async execute(args, toolContext) {
      if (
        !toolContext ||
        typeof toolContext !== 'object' ||
        !('sessionID' in toolContext)
      ) {
        throw new Error('无效的 toolContext：缺少 sessionID');
      }

      const agent = String(args.agent);
      const prompt = String(args.prompt);
      const description = String(args.description);
      const parentSessionId = (toolContext as { sessionID: string }).sessionID;

      // Validate agent against delegation rules
      if (!manager.isAgentAllowed(parentSessionId, agent)) {
        const allowed = manager.getAllowedSubagents(parentSessionId);
        return `不允许使用代理 '${agent}'。允许的代理：${allowed.join(', ')}`;
      }

      // Fire-and-forget launch
      const task = manager.launch({
        agent,
        prompt,
        description,
        parentSessionId,
      });

      return `后台任务已启动。

任务 ID：${task.id}
代理：${agent}
状态：${task.status}

使用 \`background_output\` 并传入 task_id="${task.id}" 获取结果。`;
    },
  });

  // Tool for retrieving output from background tasks
  const background_output = tool({
    description: `获取后台任务完成通知后的结果。

timeout=0：立即返回状态（不等待）
timeout=N：最多等待 N 毫秒直到完成

返回：已完成则返回结果，失败则返回错误，运行中则返回状态。`,

    args: {
      task_id: z.string().describe('来自 background_task 的任务 ID'),
      timeout: z
        .number()
        .optional()
        .describe('等待完成（毫秒，0=不等待，默认：0）'),
    },
    async execute(args) {
      const taskId = String(args.task_id);
      const timeout =
        typeof args.timeout === 'number' && args.timeout > 0 ? args.timeout : 0;

      let task = manager.getResult(taskId);

      // Wait for completion if timeout specified
      if (
        task &&
        timeout > 0 &&
        task.status !== 'completed' &&
        task.status !== 'failed' &&
        task.status !== 'cancelled'
      ) {
        task = await manager.waitForCompletion(taskId, timeout);
      }

      if (!task) {
        return `未找到任务：${taskId}`;
      }

      // Calculate task duration
      const duration = task.completedAt
        ? `${Math.floor((task.completedAt.getTime() - task.startedAt.getTime()) / 1000)}s`
        : `${Math.floor((Date.now() - task.startedAt.getTime()) / 1000)}s`;

      let output = `Task: ${task.id}
 Description: ${task.description}
 Status: ${task.status}
 Duration: ${duration}

 ---

 `;

      // Include task result or error based on status
      if (task.status === 'completed' && task.result != null) {
        output += task.result;
      } else if (task.status === 'failed') {
        output += `Error: ${task.error}`;
      } else if (task.status === 'cancelled') {
        output += '（任务已取消）';
      } else {
        output += '（任务仍在运行）';
      }

      return output;
    },
  });

  // Tool for canceling running background tasks
  const background_cancel = tool({
    description: `取消后台任务。

task_id：取消指定任务
all=true：取消所有运行中的任务

仅取消待处理/启动中/运行中的任务。`,
    args: {
      task_id: z.string().optional().describe('要取消的指定任务'),
      all: z.boolean().optional().describe('取消所有运行中的任务'),
    },
    async execute(args) {
      // Cancel all running tasks if requested
      if (args.all === true) {
        const count = manager.cancel();
        return `已取消 ${count} 个任务。`;
      }

      // Cancel specific task if task_id provided
      if (typeof args.task_id === 'string') {
        const count = manager.cancel(args.task_id);
        return count > 0
          ? `已取消任务 ${args.task_id}。`
          : `任务 ${args.task_id} 未找到或未在运行。`;
      }

      return '请指定 task_id 或使用 all=true。';
    },
  });

  return { background_task, background_output, background_cancel };
}
