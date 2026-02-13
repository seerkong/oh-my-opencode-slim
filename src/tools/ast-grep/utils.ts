import type { CliLanguage, SgResult } from './types';

export function formatSearchResult(result: SgResult): string {
  if (result.error) {
    return `Error: ${result.error}`;
  }

  if (result.matches.length === 0) {
    return '未找到匹配项。';
  }

  const lines: string[] = [];

  // Group matches by file
  const byFile = new Map<string, typeof result.matches>();
  for (const match of result.matches) {
    const existing = byFile.get(match.file) || [];
    existing.push(match);
    byFile.set(match.file, existing);
  }

  for (const [file, matches] of byFile) {
    lines.push(`\n${file}:`);
    for (const match of matches) {
      const startLine = match.range.start.line + 1;
      const text =
        match.text.length > 100
          ? `${match.text.substring(0, 100)}...`
          : match.text;
      lines.push(`  ${startLine}: ${text.replace(/\n/g, '\\n')}`);
    }
  }

  const fileCount = byFile.size;
  const summary = `在 ${fileCount} 个文件中找到 ${result.totalMatches} 个匹配项`;
  if (result.truncated) {
    lines.push(`\n${summary}（输出已截断：${result.truncatedReason}）`);
  } else {
    lines.push(`\n${summary}`);
  }

  return lines.join('\n');
}

export function formatReplaceResult(
  result: SgResult,
  isDryRun: boolean,
): string {
  if (result.error) {
    return `Error: ${result.error}`;
  }

  if (result.matches.length === 0) {
    return '未找到需要替换的匹配项。';
  }

  const lines: string[] = [];
  const mode = isDryRun ? '[试运行]' : '[已应用]';

  // Group by file
  const byFile = new Map<string, typeof result.matches>();
  for (const match of result.matches) {
    const existing = byFile.get(match.file) || [];
    existing.push(match);
    byFile.set(match.file, existing);
  }

  for (const [file, matches] of byFile) {
    lines.push(`\n${file}:`);
    for (const match of matches) {
      const startLine = match.range.start.line + 1;
      const original =
        match.text.length > 60
          ? `${match.text.substring(0, 60)}...`
          : match.text;
      const replacement = match.replacement
        ? match.replacement.length > 60
          ? `${match.replacement.substring(0, 60)}...`
          : match.replacement
        : '[无替换内容]';
      lines.push(
        `  ${startLine}: "${original.replace(/\n/g, '\\n')}" → "${replacement.replace(/\n/g, '\\n')}"`,
      );
    }
  }

  const fileCount = byFile.size;
  lines.push(
    `\n${mode} 在 ${fileCount} 个文件中进行了 ${result.totalMatches} 处替换`,
  );

  if (isDryRun) {
    lines.push('\n要应用更改，请使用 dryRun=false 运行');
  }

  return lines.join('\n');
}

export function getEmptyResultHint(
  pattern: string,
  lang: CliLanguage,
): string | null {
  const src = pattern.trim();

  if (lang === 'python') {
    if (src.startsWith('class ') && src.endsWith(':')) {
      const withoutColon = src.slice(0, -1);
      return `提示：移除末尾冒号。尝试："${withoutColon}"`;
    }
    if (
      (src.startsWith('def ') || src.startsWith('async def ')) &&
      src.endsWith(':')
    ) {
      const withoutColon = src.slice(0, -1);
      return `提示：移除末尾冒号。尝试："${withoutColon}"`;
    }
  }

  if (['javascript', 'typescript', 'tsx'].includes(lang)) {
    if (/^(export\s+)?(async\s+)?function\s+\$[A-Z_]+\s*$/i.test(src)) {
      return `提示：函数模式需要参数和函数体。尝试 "function $NAME($$$) { $$$ }"`;
    }
  }

  return null;
}
