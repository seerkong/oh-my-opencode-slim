export interface FrontmatterResult<T = Record<string, unknown>> {
  data: T;
  body: string;
  hadFrontmatter: boolean;
  parseError: boolean;
}

function coerceYamlValue(raw: string): unknown {
  const value = raw.trim();

  if (value === 'true') return true;
  if (value === 'false') return false;

  if (/^-?\d+(\.\d+)?$/.test(value)) {
    const n = Number(value);
    if (!Number.isNaN(n)) return n;
  }

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function parseSimpleYaml(yamlContent: string): Record<string, unknown> {
  const lines = yamlContent.split(/\r?\n/);
  const result: Record<string, unknown> = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const idx = trimmed.indexOf(':');
    if (idx <= 0) continue;

    const key = trimmed.slice(0, idx).trim();
    const rawValue = trimmed.slice(idx + 1).trim();
    result[key] = coerceYamlValue(rawValue);
  }

  return result;
}

export function parseFrontmatter<T = Record<string, unknown>>(
  content: string,
): FrontmatterResult<T> {
  const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n?---\r?\n([\s\S]*)$/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    return {
      data: {} as T,
      body: content,
      hadFrontmatter: false,
      parseError: false,
    };
  }

  const yamlContent = match[1];
  const body = match[2];

  try {
    const data = parseSimpleYaml(yamlContent) as T;
    return { data, body, hadFrontmatter: true, parseError: false };
  } catch {
    return { data: {} as T, body, hadFrontmatter: true, parseError: true };
  }
}
