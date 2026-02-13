import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { relative, resolve } from 'node:path';
import { findProjectRoot, findRuleFiles } from './finder';
import {
  createContentHash,
  isDuplicateByContentHash,
  isDuplicateByRealPath,
  shouldApplyRule,
} from './matcher';
import { parseRuleFrontmatter } from './parser';
import type { SessionInjectedRulesCache } from './types';

type ToolExecuteOutput = {
  title: string;
  output: string;
  metadata: unknown;
};

type RuleToInject = {
  relativePath: string;
  matchReason: string;
  content: string;
  distance: number;
};

function resolveFilePath(
  workspaceDirectory: string,
  path: string,
): string | null {
  if (!path) return null;
  if (path.startsWith('/')) return path;
  return resolve(workspaceDirectory, path);
}

export function createRuleInjectionProcessor(deps: {
  workspaceDirectory: string;
  getSessionCache: (sessionID: string) => SessionInjectedRulesCache;
}): {
  processFilePathForInjection: (
    filePath: string,
    sessionID: string,
    output: ToolExecuteOutput,
  ) => Promise<void>;
} {
  const { workspaceDirectory, getSessionCache } = deps;

  async function processFilePathForInjection(
    filePath: string,
    sessionID: string,
    output: ToolExecuteOutput,
  ): Promise<void> {
    const resolved = resolveFilePath(workspaceDirectory, filePath);
    if (!resolved) return;

    const projectRoot = findProjectRoot(resolved);
    const cache = getSessionCache(sessionID);
    const home = homedir();

    const ruleFileCandidates = findRuleFiles(projectRoot, home, resolved);
    const toInject: RuleToInject[] = [];

    for (const candidate of ruleFileCandidates) {
      if (isDuplicateByRealPath(candidate.realPath, cache.realPaths)) continue;

      try {
        const rawContent = readFileSync(candidate.path, 'utf-8');
        const { metadata, body } = parseRuleFrontmatter(rawContent);

        let matchReason: string;
        if (candidate.isSingleFile) {
          matchReason = 'copilot-instructions（始终应用）';
        } else {
          const matchResult = shouldApplyRule(metadata, resolved, projectRoot);
          if (!matchResult.applies) continue;
          matchReason = matchResult.reason ?? 'matched';
        }

        const contentHash = createContentHash(body);
        if (isDuplicateByContentHash(contentHash, cache.contentHashes))
          continue;

        const relativePath = projectRoot
          ? relative(projectRoot, candidate.path)
          : candidate.path;

        toInject.push({
          relativePath,
          matchReason,
          content: body,
          distance: candidate.distance,
        });

        cache.realPaths.add(candidate.realPath);
        cache.contentHashes.add(contentHash);
      } catch {
        // 跳过无法读取的文件
      }
    }

    if (toInject.length === 0) return;

    toInject.sort((a, b) => a.distance - b.distance);

    for (const rule of toInject) {
      output.output += `\n\n[规则: ${rule.relativePath}]\n[匹配: ${rule.matchReason}]\n${rule.content}`;
    }
  }

  return { processFilePathForInjection };
}
