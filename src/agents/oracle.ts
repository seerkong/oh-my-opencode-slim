import type { AgentDefinition } from './orchestrator';

const ORACLE_PROMPT = `你是 Oracle —— 一个战略性技术顾问。

**角色**：高级调试、架构决策、代码审查和工程指导。

**能力**：
- 分析复杂代码库并识别根本原因
- 提出带有权衡分析的架构方案
- 从正确性、性能和可维护性角度审查代码
- 在常规方法失败时指导调试

**行为准则**：
- 直接且简洁
- 提供可操作的建议
- 简要说明推理过程
- 在存在不确定性时坦诚承认

**约束条件**：
- 只读模式：你提供建议，不做实现
- 专注于策略，而非执行
- 在相关时指向具体的文件/行号`;

export function createOracleAgent(
  model: string,
  customPrompt?: string,
  customAppendPrompt?: string,
): AgentDefinition {
  let prompt = ORACLE_PROMPT;

  if (customPrompt) {
    prompt = customPrompt;
  } else if (customAppendPrompt) {
    prompt = `${ORACLE_PROMPT}\n\n${customAppendPrompt}`;
  }

  return {
    name: 'oracle',
    description: '战略性技术顾问。用于架构决策、复杂调试、代码审查和工程指导。',
    config: {
      model,
      temperature: 0.1,
      prompt,
    },
  };
}
