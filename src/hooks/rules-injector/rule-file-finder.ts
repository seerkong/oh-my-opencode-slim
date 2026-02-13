import { existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  PROJECT_RULE_FILES,
  PROJECT_RULE_SUBDIRS,
  USER_RULE_DIR,
} from './constants';
import { findRuleFilesRecursive, safeRealpathSync } from './rule-file-scanner';
import type { RuleFileCandidate } from './types';

/**
 * Find all rule files for a given context.
 * Searches from currentFile upward to projectRoot for rule directories,
 * then user-level directory (~/.claude/rules).
 */
export function findRuleFiles(
  projectRoot: string | null,
  homeDir: string,
  currentFile: string,
): RuleFileCandidate[] {
  const candidates: RuleFileCandidate[] = [];
  const seenRealPaths = new Set<string>();

  let currentDir = dirname(currentFile);
  let distance = 0;

  while (true) {
    for (const [parent, subdir] of PROJECT_RULE_SUBDIRS) {
      const ruleDir = join(currentDir, parent, subdir);
      const files: string[] = [];
      findRuleFilesRecursive(ruleDir, files);

      for (const filePath of files) {
        const realPath = safeRealpathSync(filePath);
        if (seenRealPaths.has(realPath)) continue;
        seenRealPaths.add(realPath);

        candidates.push({
          path: filePath,
          realPath,
          isGlobal: false,
          distance,
        });
      }
    }

    if (projectRoot && currentDir === projectRoot) break;
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) break;
    currentDir = parentDir;
    distance++;
  }

  // Check for single-file rules at project root
  if (projectRoot) {
    for (const ruleFile of PROJECT_RULE_FILES) {
      const filePath = join(projectRoot, ruleFile);
      if (existsSync(filePath)) {
        try {
          const stat = statSync(filePath);
          if (stat.isFile()) {
            const realPath = safeRealpathSync(filePath);
            if (!seenRealPaths.has(realPath)) {
              seenRealPaths.add(realPath);
              candidates.push({
                path: filePath,
                realPath,
                isGlobal: false,
                distance: 0,
                isSingleFile: true,
              });
            }
          }
        } catch {
          // Skip if file can't be read
        }
      }
    }
  }

  // Search user-level rule directory (~/.claude/rules)
  const userRuleDir = join(homeDir, USER_RULE_DIR);
  const userFiles: string[] = [];
  findRuleFilesRecursive(userRuleDir, userFiles);

  for (const filePath of userFiles) {
    const realPath = safeRealpathSync(filePath);
    if (seenRealPaths.has(realPath)) continue;
    seenRealPaths.add(realPath);

    candidates.push({
      path: filePath,
      realPath,
      isGlobal: true,
      distance: 9999,
    });
  }

  candidates.sort((a, b) => {
    if (a.isGlobal !== b.isGlobal) {
      return a.isGlobal ? 1 : -1;
    }
    return a.distance - b.distance;
  });

  return candidates;
}
