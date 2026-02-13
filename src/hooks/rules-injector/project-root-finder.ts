import { existsSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { PROJECT_MARKERS } from './constants';

/**
 * Find project root by walking up from startPath.
 * Checks for PROJECT_MARKERS (.git, pyproject.toml, package.json, etc.)
 */
export function findProjectRoot(startPath: string): string | null {
  let current: string;

  try {
    const stat = statSync(startPath);
    current = stat.isDirectory() ? startPath : dirname(startPath);
  } catch {
    current = dirname(startPath);
  }

  while (true) {
    for (const marker of PROJECT_MARKERS) {
      const markerPath = join(current, marker);
      if (existsSync(markerPath)) {
        return current;
      }
    }

    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

/**
 * Calculate directory distance between a rule file and current file.
 */
export function calculateDistance(
  rulePath: string,
  currentFile: string,
  projectRoot: string | null,
): number {
  if (!projectRoot) {
    return 9999;
  }

  try {
    const ruleDir = dirname(rulePath);
    const currentDir = dirname(currentFile);

    const ruleRel = relative(projectRoot, ruleDir);
    const currentRel = relative(projectRoot, currentDir);

    if (ruleRel.startsWith('..') || currentRel.startsWith('..')) {
      return 9999;
    }

    const ruleParts = ruleRel ? ruleRel.split(/[/\\]/) : [];
    const currentParts = currentRel ? currentRel.split(/[/\\]/) : [];

    let common = 0;
    for (let i = 0; i < Math.min(ruleParts.length, currentParts.length); i++) {
      if (ruleParts[i] === currentParts[i]) {
        common++;
      } else {
        break;
      }
    }

    return currentParts.length - common;
  } catch {
    return 9999;
  }
}
