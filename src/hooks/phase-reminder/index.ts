/**
 * 阶段提醒，在每条用户消息前注入。
 * 将工作流指令保持在即时注意力窗口中，
 * 以对抗长上下文中指令遵循能力的退化。
 *
 * 研究："LLMs Get Lost In Multi-Turn Conversation"（arXiv:2505.06120）
 * 表明在没有提醒的情况下，2-3 轮对话后合规率下降约 40%。
 *
 * 使用 experimental.chat.messages.transform，因此不会在 UI 中显示。
 */
const PHASE_REMINDER = `<reminder>⚠️ 强制执行：理解→委派（！根据每个代理规则）→拆分并行化（？）→计划→执行→验证
可用专家：@oracle @librarian @explorer @designer @fixer
</reminder>`;

interface MessageInfo {
  role: string;
  agent?: string;
  sessionID?: string;
}

interface MessagePart {
  type: string;
  text?: string;
  [key: string]: unknown;
}

interface MessageWithParts {
  info: MessageInfo;
  parts: MessagePart[];
}

/**
 * 创建用于阶段提醒注入的 experimental.chat.messages.transform 钩子。
 * 此钩子在发送到 API 之前运行，因此不会影响 UI 显示。
 * 仅为 orchestrator 代理注入。
 */
export function createPhaseReminderHook() {
  return {
    'experimental.chat.messages.transform': async (
      _input: Record<string, never>,
      output: { messages: MessageWithParts[] },
    ): Promise<void> => {
      const { messages } = output;

      if (messages.length === 0) {
        return;
      }

      // Find the last user message
      let lastUserMessageIndex = -1;
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].info.role === 'user') {
          lastUserMessageIndex = i;
          break;
        }
      }

      if (lastUserMessageIndex === -1) {
        return;
      }

      const lastUserMessage = messages[lastUserMessageIndex];

      // Only inject for orchestrator (or if no agent specified = main session)
      const agent = lastUserMessage.info.agent;
      if (agent && agent !== 'orchestrator') {
        return;
      }

      // Find the first text part
      const textPartIndex = lastUserMessage.parts.findIndex(
        (p) => p.type === 'text' && p.text !== undefined,
      );

      if (textPartIndex === -1) {
        return;
      }

      // Prepend the reminder to the existing text
      const originalText = lastUserMessage.parts[textPartIndex].text ?? '';
      lastUserMessage.parts[textPartIndex].text =
        `${PHASE_REMINDER}\n\n---\n\n${originalText}`;
    },
  };
}
