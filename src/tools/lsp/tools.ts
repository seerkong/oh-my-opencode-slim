// LSP Tools - 4 essential tools only

import { type ToolDefinition, tool } from '@opencode-ai/plugin/tool';
import { DEFAULT_MAX_DIAGNOSTICS, DEFAULT_MAX_REFERENCES } from './constants';
import type {
  Diagnostic,
  Location,
  LocationLink,
  WorkspaceEdit,
} from './types';
import {
  applyWorkspaceEdit,
  filterDiagnosticsBySeverity,
  formatApplyResult,
  formatDiagnostic,
  formatLocation,
  withLspClient,
} from './utils';

const formatError = (e: unknown): string =>
  `Error: ${e instanceof Error ? e.message : String(e)}`;

export const lsp_goto_definition: ToolDefinition = tool({
  description: '跳转到符号定义。查找符号的定义位置。',
  args: {
    filePath: tool.schema.string().describe('文件的绝对路径'),
    line: tool.schema.number().min(1).describe('基于 1 的行号'),
    character: tool.schema.number().min(0).describe('基于 0 的字符偏移量'),
  },
  execute: async (args) => {
    try {
      const result = await withLspClient(args.filePath, async (client) => {
        return (await client.definition(
          args.filePath,
          args.line,
          args.character,
        )) as Location | Location[] | LocationLink[] | null;
      });

      if (!result) {
        return '未找到定义';
      }

      const locations = Array.isArray(result) ? result : [result];
      if (locations.length === 0) {
        return '未找到定义';
      }

      return locations.map(formatLocation).join('\n');
    } catch (e) {
      return formatError(e);
    }
  },
});

export const lsp_find_references: ToolDefinition = tool({
  description: '查找符号在整个工作区中的所有用法/引用。',
  args: {
    filePath: tool.schema.string().describe('文件的绝对路径'),
    line: tool.schema.number().min(1).describe('基于 1 的行号'),
    character: tool.schema.number().min(0).describe('基于 0 的字符偏移量'),
    includeDeclaration: tool.schema
      .boolean()
      .optional()
      .describe('包含声明本身'),
  },
  execute: async (args) => {
    try {
      const result = await withLspClient(args.filePath, async (client) => {
        return (await client.references(
          args.filePath,
          args.line,
          args.character,
          args.includeDeclaration ?? true,
        )) as Location[] | null;
      });

      if (!result || result.length === 0) {
        return '未找到引用';
      }

      const total = result.length;
      const truncated = total > DEFAULT_MAX_REFERENCES;
      const limited = truncated
        ? result.slice(0, DEFAULT_MAX_REFERENCES)
        : result;
      const lines = limited.map(formatLocation);
      if (truncated) {
        lines.unshift(
          `找到 ${total} 个引用（显示前 ${DEFAULT_MAX_REFERENCES} 个）：`,
        );
      }
      return lines.join('\n');
    } catch (e) {
      return formatError(e);
    }
  },
});

export const lsp_diagnostics: ToolDefinition = tool({
  description: '在运行构建之前从语言服务器获取错误、警告和提示。',
  args: {
    filePath: tool.schema.string().describe('文件的绝对路径'),
    severity: tool.schema
      .enum(['error', 'warning', 'information', 'hint', 'all'])
      .optional()
      .describe('按严重级别过滤'),
  },
  execute: async (args) => {
    try {
      const result = await withLspClient(args.filePath, async (client) => {
        return (await client.diagnostics(args.filePath)) as
          | { items?: Diagnostic[] }
          | Diagnostic[]
          | null;
      });

      let diagnostics: Diagnostic[] = [];
      if (result) {
        if (Array.isArray(result)) {
          diagnostics = result;
        } else if (result.items) {
          diagnostics = result.items;
        }
      }

      diagnostics = filterDiagnosticsBySeverity(diagnostics, args.severity);

      if (diagnostics.length === 0) {
        return '未找到诊断信息';
      }

      const total = diagnostics.length;
      const truncated = total > DEFAULT_MAX_DIAGNOSTICS;
      const limited = truncated
        ? diagnostics.slice(0, DEFAULT_MAX_DIAGNOSTICS)
        : diagnostics;
      const lines = limited.map(formatDiagnostic);
      if (truncated) {
        lines.unshift(
          `找到 ${total} 条诊断信息（显示前 ${DEFAULT_MAX_DIAGNOSTICS} 条）：`,
        );
      }
      return lines.join('\n');
    } catch (e) {
      return formatError(e);
    }
  },
});

export const lsp_rename: ToolDefinition = tool({
  description: '在整个工作区中重命名符号。将更改应用到所有文件。',
  args: {
    filePath: tool.schema.string().describe('文件的绝对路径'),
    line: tool.schema.number().min(1).describe('基于 1 的行号'),
    character: tool.schema.number().min(0).describe('基于 0 的字符偏移量'),
    newName: tool.schema.string().describe('新的符号名称'),
  },
  execute: async (args) => {
    try {
      const edit = await withLspClient(args.filePath, async (client) => {
        return (await client.rename(
          args.filePath,
          args.line,
          args.character,
          args.newName,
        )) as WorkspaceEdit | null;
      });
      const result = applyWorkspaceEdit(edit);
      return formatApplyResult(result);
    } catch (e) {
      return formatError(e);
    }
  },
});
