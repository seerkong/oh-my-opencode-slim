import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findProjectRoot, findRuleFiles } from './finder';

describe('findRuleFiles', () => {
  const TEST_DIR = join(tmpdir(), `rules-injector-test-${Date.now()}`);
  const homeDir = join(TEST_DIR, 'home');

  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    mkdirSync(homeDir, { recursive: true });
    mkdirSync(join(TEST_DIR, '.git'), { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe('.github/instructions/ discovery', () => {
    it('should discover .github/instructions/*.instructions.md files', () => {
      const instructionsDir = join(TEST_DIR, '.github', 'instructions');
      mkdirSync(instructionsDir, { recursive: true });
      writeFileSync(
        join(instructionsDir, 'typescript.instructions.md'),
        'TS rules',
      );
      writeFileSync(
        join(instructionsDir, 'python.instructions.md'),
        'PY rules',
      );

      const srcDir = join(TEST_DIR, 'src');
      mkdirSync(srcDir, { recursive: true });
      const currentFile = join(srcDir, 'index.ts');
      writeFileSync(currentFile, 'code');

      const candidates = findRuleFiles(TEST_DIR, homeDir, currentFile);

      const paths = candidates.map((c) => c.path);
      expect(paths.some((p) => p.includes('typescript.instructions.md'))).toBe(
        true,
      );
      expect(paths.some((p) => p.includes('python.instructions.md'))).toBe(
        true,
      );
    });

    it('should ignore non-.instructions.md files in .github/instructions/', () => {
      const instructionsDir = join(TEST_DIR, '.github', 'instructions');
      mkdirSync(instructionsDir, { recursive: true });
      writeFileSync(join(instructionsDir, 'valid.instructions.md'), 'valid');
      writeFileSync(join(instructionsDir, 'invalid.md'), 'invalid');
      writeFileSync(join(instructionsDir, 'readme.txt'), 'readme');

      const currentFile = join(TEST_DIR, 'index.ts');
      writeFileSync(currentFile, 'code');

      const candidates = findRuleFiles(TEST_DIR, homeDir, currentFile);

      const paths = candidates.map((c) => c.path);
      expect(paths.some((p) => p.includes('valid.instructions.md'))).toBe(true);
      expect(paths.some((p) => p.endsWith('invalid.md'))).toBe(false);
      expect(paths.some((p) => p.includes('readme.txt'))).toBe(false);
    });

    it('should discover nested .instructions.md files in subdirectories', () => {
      const instructionsDir = join(TEST_DIR, '.github', 'instructions');
      const frontendDir = join(instructionsDir, 'frontend');
      mkdirSync(frontendDir, { recursive: true });
      writeFileSync(join(frontendDir, 'react.instructions.md'), 'React rules');

      const currentFile = join(TEST_DIR, 'app.tsx');
      writeFileSync(currentFile, 'code');

      const candidates = findRuleFiles(TEST_DIR, homeDir, currentFile);

      const paths = candidates.map((c) => c.path);
      expect(paths.some((p) => p.includes('react.instructions.md'))).toBe(true);
    });
  });

  describe('.github/copilot-instructions.md (single file)', () => {
    it('should discover copilot-instructions.md at project root', () => {
      const githubDir = join(TEST_DIR, '.github');
      mkdirSync(githubDir, { recursive: true });
      writeFileSync(
        join(githubDir, 'copilot-instructions.md'),
        'Global instructions',
      );

      const currentFile = join(TEST_DIR, 'index.ts');
      writeFileSync(currentFile, 'code');

      const candidates = findRuleFiles(TEST_DIR, homeDir, currentFile);

      const singleFile = candidates.find((c) =>
        c.path.includes('copilot-instructions.md'),
      );
      expect(singleFile).toBeDefined();
      expect(singleFile?.isSingleFile).toBe(true);
    });

    it('should mark single file rules with isSingleFile: true', () => {
      const githubDir = join(TEST_DIR, '.github');
      mkdirSync(githubDir, { recursive: true });
      writeFileSync(join(githubDir, 'copilot-instructions.md'), 'Instructions');

      const currentFile = join(TEST_DIR, 'file.ts');
      writeFileSync(currentFile, 'code');

      const candidates = findRuleFiles(TEST_DIR, homeDir, currentFile);

      const copilotFile = candidates.find((c) => c.isSingleFile);
      expect(copilotFile).toBeDefined();
      expect(copilotFile?.path).toContain('copilot-instructions.md');
    });

    it('should set distance to 0 for single file rules', () => {
      const githubDir = join(TEST_DIR, '.github');
      mkdirSync(githubDir, { recursive: true });
      writeFileSync(join(githubDir, 'copilot-instructions.md'), 'Instructions');

      const srcDir = join(TEST_DIR, 'src', 'deep', 'nested');
      mkdirSync(srcDir, { recursive: true });
      const currentFile = join(srcDir, 'file.ts');
      writeFileSync(currentFile, 'code');

      const candidates = findRuleFiles(TEST_DIR, homeDir, currentFile);

      const copilotFile = candidates.find((c) => c.isSingleFile);
      expect(copilotFile?.distance).toBe(0);
    });
  });

  describe('backward compatibility', () => {
    it('should still discover .claude/rules/ files', () => {
      const rulesDir = join(TEST_DIR, '.claude', 'rules');
      mkdirSync(rulesDir, { recursive: true });
      writeFileSync(join(rulesDir, 'typescript.md'), 'TS rules');

      const currentFile = join(TEST_DIR, 'index.ts');
      writeFileSync(currentFile, 'code');

      const candidates = findRuleFiles(TEST_DIR, homeDir, currentFile);

      const paths = candidates.map((c) => c.path);
      expect(paths.some((p) => p.includes('.claude/rules/'))).toBe(true);
    });

    it('should still discover .cursor/rules/ files', () => {
      const rulesDir = join(TEST_DIR, '.cursor', 'rules');
      mkdirSync(rulesDir, { recursive: true });
      writeFileSync(join(rulesDir, 'python.md'), 'PY rules');

      const currentFile = join(TEST_DIR, 'main.py');
      writeFileSync(currentFile, 'code');

      const candidates = findRuleFiles(TEST_DIR, homeDir, currentFile);

      const paths = candidates.map((c) => c.path);
      expect(paths.some((p) => p.includes('.cursor/rules/'))).toBe(true);
    });

    it('should discover .mdc files in rule directories', () => {
      const rulesDir = join(TEST_DIR, '.claude', 'rules');
      mkdirSync(rulesDir, { recursive: true });
      writeFileSync(join(rulesDir, 'advanced.mdc'), 'MDC rules');

      const currentFile = join(TEST_DIR, 'app.ts');
      writeFileSync(currentFile, 'code');

      const candidates = findRuleFiles(TEST_DIR, homeDir, currentFile);

      const paths = candidates.map((c) => c.path);
      expect(paths.some((p) => p.endsWith('advanced.mdc'))).toBe(true);
    });
  });

  describe('mixed sources', () => {
    it('should discover rules from all sources', () => {
      const claudeRules = join(TEST_DIR, '.claude', 'rules');
      const cursorRules = join(TEST_DIR, '.cursor', 'rules');
      const githubInstructions = join(TEST_DIR, '.github', 'instructions');
      const githubDir = join(TEST_DIR, '.github');

      mkdirSync(claudeRules, { recursive: true });
      mkdirSync(cursorRules, { recursive: true });
      mkdirSync(githubInstructions, { recursive: true });

      writeFileSync(join(claudeRules, 'claude.md'), 'claude');
      writeFileSync(join(cursorRules, 'cursor.md'), 'cursor');
      writeFileSync(
        join(githubInstructions, 'copilot.instructions.md'),
        'copilot',
      );
      writeFileSync(join(githubDir, 'copilot-instructions.md'), 'global');

      const currentFile = join(TEST_DIR, 'index.ts');
      writeFileSync(currentFile, 'code');

      const candidates = findRuleFiles(TEST_DIR, homeDir, currentFile);

      expect(candidates.length).toBeGreaterThanOrEqual(4);
      const paths = candidates.map((c) => c.path);
      expect(paths.some((p) => p.includes('.claude/rules/'))).toBe(true);
      expect(paths.some((p) => p.includes('.cursor/rules/'))).toBe(true);
      expect(paths.some((p) => p.includes('.github/instructions/'))).toBe(true);
      expect(paths.some((p) => p.includes('copilot-instructions.md'))).toBe(
        true,
      );
    });

    it('should not duplicate single file rules', () => {
      const githubDir = join(TEST_DIR, '.github');
      mkdirSync(githubDir, { recursive: true });
      writeFileSync(join(githubDir, 'copilot-instructions.md'), 'Instructions');

      const currentFile = join(TEST_DIR, 'file.ts');
      writeFileSync(currentFile, 'code');

      const candidates = findRuleFiles(TEST_DIR, homeDir, currentFile);

      const copilotFiles = candidates.filter((c) =>
        c.path.includes('copilot-instructions.md'),
      );
      expect(copilotFiles.length).toBe(1);
    });
  });

  describe('user-level rules', () => {
    it('should discover user-level .claude/rules/ files', () => {
      const userRulesDir = join(homeDir, '.claude', 'rules');
      mkdirSync(userRulesDir, { recursive: true });
      writeFileSync(join(userRulesDir, 'global.md'), 'Global user rules');

      const currentFile = join(TEST_DIR, 'app.ts');
      writeFileSync(currentFile, 'code');

      const candidates = findRuleFiles(TEST_DIR, homeDir, currentFile);

      const userRule = candidates.find((c) => c.isGlobal);
      expect(userRule).toBeDefined();
      expect(userRule?.path).toContain('global.md');
    });

    it('should mark user-level rules as isGlobal: true', () => {
      const userRulesDir = join(homeDir, '.claude', 'rules');
      mkdirSync(userRulesDir, { recursive: true });
      writeFileSync(join(userRulesDir, 'user.md'), 'User rules');

      const currentFile = join(TEST_DIR, 'app.ts');
      writeFileSync(currentFile, 'code');

      const candidates = findRuleFiles(TEST_DIR, homeDir, currentFile);

      const userRule = candidates.find((c) => c.path.includes('user.md'));
      expect(userRule?.isGlobal).toBe(true);
      expect(userRule?.distance).toBe(9999);
    });
  });
});

describe('findProjectRoot', () => {
  const TEST_DIR = join(tmpdir(), `project-root-test-${Date.now()}`);

  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it('should find project root with .git directory', () => {
    mkdirSync(join(TEST_DIR, '.git'), { recursive: true });
    const nestedFile = join(TEST_DIR, 'src', 'components', 'Button.tsx');
    mkdirSync(join(TEST_DIR, 'src', 'components'), {
      recursive: true,
    });
    writeFileSync(nestedFile, 'code');

    const root = findProjectRoot(nestedFile);

    expect(root).toBe(TEST_DIR);
  });

  it('should find project root with package.json', () => {
    writeFileSync(join(TEST_DIR, 'package.json'), '{}');
    const nestedFile = join(TEST_DIR, 'lib', 'index.js');
    mkdirSync(join(TEST_DIR, 'lib'), { recursive: true });
    writeFileSync(nestedFile, 'code');

    const root = findProjectRoot(nestedFile);

    expect(root).toBe(TEST_DIR);
  });

  it('should return null when no project markers found', () => {
    const isolatedDir = join(TEST_DIR, 'isolated');
    mkdirSync(isolatedDir, { recursive: true });
    const file = join(isolatedDir, 'file.txt');
    writeFileSync(file, 'content');

    const root = findProjectRoot(file);

    expect(root).toBeNull();
  });
});
