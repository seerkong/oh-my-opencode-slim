import type { GrepResult } from './types';

export function formatGrepResult(result: GrepResult): string {
  if (result.error) {
    return `Error: ${result.error}`;
  }

  if (result.matches.length === 0) {
    return '未找到匹配项。';
  }

  const lines: string[] = [];

  // Group matches by file
  const byFile = new Map<string, { line: number; text: string }[]>();
  for (const match of result.matches) {
    const existing = byFile.get(match.file) || [];
    existing.push({ line: match.line, text: match.text });
    byFile.set(match.file, existing);
  }

  for (const [file, matches] of byFile) {
    lines.push(`\n${file}:`);
    for (const match of matches) {
      lines.push(`  ${match.line}: ${match.text}`);
    }
  }

  const summary = `在 ${result.filesSearched} 个文件中找到 ${result.totalMatches} 个匹配项`;
  if (result.truncated) {
    lines.push(`\n${summary}（输出已截断）`);
  } else {
    lines.push(`\n${summary}`);
  }

  return lines.join('\n');
}
