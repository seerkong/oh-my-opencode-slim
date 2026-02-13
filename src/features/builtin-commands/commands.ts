import {
  CANCEL_RALPH_TEMPLATE,
  RALPH_LOOP_TEMPLATE,
  RALPH_RESUME_TEMPLATE,
} from './templates/ralph-loop';
import type { BuiltinCommandDefinition } from './types';

export const BUILTIN_RALPH_COMMANDS: BuiltinCommandDefinition[] = [
  {
    name: 'ralph-loop',
    description: '（内置）启动自引用开发循环',
    template: `<command-instruction>\n${RALPH_LOOP_TEMPLATE}\n</command-instruction>\n\n<user-task>\n$ARGUMENTS\n</user-task>`,
    argumentHint:
      '"task description" [--completion-promise=TEXT] [--yield-promise=TEXT] [--resume-mode=user,file] [--resume-file=PATH] [--max-iterations=N]',
  },
  {
    name: 'ulw-loop',
    description: '（内置）启动 ultrawork 循环模式',
    template: `<command-instruction>\n${RALPH_LOOP_TEMPLATE}\n</command-instruction>\n\n<user-task>\n$ARGUMENTS\n</user-task>`,
    argumentHint:
      '"task description" [--completion-promise=TEXT] [--yield-promise=TEXT] [--resume-mode=user,file] [--resume-file=PATH] [--max-iterations=N]',
  },
  {
    name: 'cancel-ralph',
    description: '（内置）取消活跃的 Ralph 循环',
    template: `<command-instruction>\n${CANCEL_RALPH_TEMPLATE}\n</command-instruction>`,
  },
  {
    name: 'ralph-resume',
    description: '（内置）恢复已暂停的 Ralph 循环',
    template: `<command-instruction>\n${RALPH_RESUME_TEMPLATE}\n</command-instruction>\n\n<resume-args>\n$ARGUMENTS\n</resume-args>`,
    argumentHint: '"payload" [--resume-file=PATH]',
  },
];

/**
 * Load builtin commands as a Record compatible with OpenCode's config.command.
 * Mirrors oh-my-opencode's loadBuiltinCommands() — injects commands in-memory
 * via the plugin config hook so no .md files need to be written to disk.
 */
export function loadBuiltinCommands(): Record<
  string,
  { name: string; description: string; template: string }
> {
  const commands: Record<
    string,
    { name: string; description: string; template: string }
  > = {};
  for (const cmd of BUILTIN_RALPH_COMMANDS) {
    commands[cmd.name] = {
      name: cmd.name,
      description: cmd.description,
      template: cmd.template,
    };
  }
  return commands;
}
