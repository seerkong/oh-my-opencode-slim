import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { findAgentsMdUp, resolveFilePath } from './finder';

interface ToolExecuteOutput {
  title: string;
  output: string;
  metadata: unknown;
}

function getSessionCache(
  sessionCaches: Map<string, Set<string>>,
  sessionID: string,
): Set<string> {
  let cache = sessionCaches.get(sessionID);
  if (!cache) {
    cache = new Set();
    sessionCaches.set(sessionID, cache);
  }
  return cache;
}

export async function processFilePathForAgentsInjection(input: {
  directory: string;
  sessionCaches: Map<string, Set<string>>;
  filePath: string;
  sessionID: string;
  output: ToolExecuteOutput;
}): Promise<void> {
  const resolved = resolveFilePath(input.directory, input.filePath);
  if (!resolved) return;

  const dir = dirname(resolved);
  const cache = getSessionCache(input.sessionCaches, input.sessionID);
  const agentsPaths = findAgentsMdUp({
    startDir: dir,
    rootDir: input.directory,
  });

  for (const agentsPath of agentsPaths) {
    const agentsDir = dirname(agentsPath);
    if (cache.has(agentsDir)) continue;

    try {
      const content = readFileSync(agentsPath, 'utf-8');
      input.output.output += `\n\n[目录上下文: ${agentsPath}]\n${content}`;
      cache.add(agentsDir);
    } catch {
      // 跳过无法读取的文件
    }
  }
}
