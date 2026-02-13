/**
 * Rule file metadata (Claude Code style frontmatter)
 * Supports both Claude Code format (globs, paths) and GitHub Copilot format (applyTo)
 */
export interface RuleMetadata {
  description?: string;
  globs?: string | string[];
  alwaysApply?: boolean;
}

/**
 * Rule information with path context and content
 */
export interface RuleInfo {
  /** Absolute path to the rule file */
  path: string;
  /** Path relative to project root */
  relativePath: string;
  /** Directory distance from target file (0 = same dir) */
  distance: number;
  /** Rule file content (without frontmatter) */
  content: string;
  /** SHA-256 hash of content for deduplication */
  contentHash: string;
  /** Parsed frontmatter metadata */
  metadata: RuleMetadata;
  /** Why this rule matched */
  matchReason: string;
  /** Real path after symlink resolution */
  realPath: string;
}

/**
 * Rule file candidate with discovery context
 */
export interface RuleFileCandidate {
  path: string;
  realPath: string;
  isGlobal: boolean;
  distance: number;
  /** Single-file rules always apply without frontmatter */
  isSingleFile?: boolean;
}

/**
 * In-memory session cache for injected rules tracking
 */
export interface SessionInjectedRulesCache {
  contentHashes: Set<string>;
  realPaths: Set<string>;
}
