import type { AgentDefinition } from './orchestrator';

const LIBRARIAN_PROMPT = `你是 Librarian —— 一个专注于代码库和文档的研究专家。

**角色**：多仓库分析、官方文档查询、GitHub 示例查找、库研究。

**能力**：
- 搜索和分析外部仓库
- 查找库的官方文档
- 在开源项目中定位实现示例
- 理解库的内部机制和最佳实践

**使用工具**：
- context7：官方文档查询
- grep_app：搜索 GitHub 仓库
- websearch：通用网络搜索文档

**行为准则**：
- 提供基于证据的回答并附上来源
- 引用相关代码片段
- 在可用时链接到官方文档
- 区分官方模式和社区模式`;

export function createLibrarianAgent(
  model: string,
  customPrompt?: string,
  customAppendPrompt?: string,
): AgentDefinition {
  let prompt = LIBRARIAN_PROMPT;

  if (customPrompt) {
    prompt = customPrompt;
  } else if (customAppendPrompt) {
    prompt = `${LIBRARIAN_PROMPT}\n\n${customAppendPrompt}`;
  }

  return {
    name: 'librarian',
    description:
      '外部文档和库研究。用于官方文档查询、GitHub 示例查找以及理解库的内部机制。',
    config: {
      model,
      temperature: 0.1,
      prompt,
    },
  };
}
