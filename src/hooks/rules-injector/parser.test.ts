import { describe, expect, it } from 'bun:test';
import { parseRuleFrontmatter } from './parser';

describe('parseRuleFrontmatter', () => {
  describe('applyTo field (GitHub Copilot format)', () => {
    it('should parse applyTo as single string', () => {
      const content = `---
applyTo: "*.ts"
---
Rule content here`;

      const result = parseRuleFrontmatter(content);

      expect(result.metadata.globs).toBe('*.ts');
      expect(result.body).toBe('Rule content here');
    });

    it('should parse applyTo as inline array', () => {
      const content = `---
applyTo: ["*.ts", "*.tsx"]
---
Rule content`;

      const result = parseRuleFrontmatter(content);

      expect(result.metadata.globs).toEqual(['*.ts', '*.tsx']);
    });

    it('should parse applyTo as multi-line array', () => {
      const content = `---
applyTo:
  - "*.ts"
  - "src/**/*.js"
---
Content`;

      const result = parseRuleFrontmatter(content);

      expect(result.metadata.globs).toEqual(['*.ts', 'src/**/*.js']);
    });

    it('should parse applyTo as comma-separated string', () => {
      const content = `---
applyTo: "*.ts, *.js"
---
Content`;

      const result = parseRuleFrontmatter(content);

      expect(result.metadata.globs).toEqual(['*.ts', '*.js']);
    });

    it('should merge applyTo and globs when both present', () => {
      const content = `---
globs: "*.md"
applyTo: "*.ts"
---
Content`;

      const result = parseRuleFrontmatter(content);

      expect(result.metadata.globs).toEqual(['*.md', '*.ts']);
    });

    it('should parse applyTo without quotes', () => {
      const content = `---
applyTo: **/*.py
---
Python rules`;

      const result = parseRuleFrontmatter(content);

      expect(result.metadata.globs).toBe('**/*.py');
    });

    it('should parse applyTo with description', () => {
      const content = `---
applyTo: "**/*.ts,**/*.tsx"
description: "TypeScript coding standards"
---
# TypeScript Guidelines`;

      const result = parseRuleFrontmatter(content);

      expect(result.metadata.globs).toEqual(['**/*.ts', '**/*.tsx']);
      expect(result.metadata.description).toBe('TypeScript coding standards');
    });
  });

  describe('existing globs/paths parsing (backward compatibility)', () => {
    it('should still parse globs field correctly', () => {
      const content = `---
globs: ["*.py", "**/*.ts"]
---
Python/TypeScript rules`;

      const result = parseRuleFrontmatter(content);

      expect(result.metadata.globs).toEqual(['*.py', '**/*.ts']);
    });

    it('should still parse paths field as alias', () => {
      const content = `---
paths: ["src/**"]
---
Source rules`;

      const result = parseRuleFrontmatter(content);

      expect(result.metadata.globs).toEqual(['src/**']);
    });

    it('should parse alwaysApply correctly', () => {
      const content = `---
alwaysApply: true
---
Always apply this rule`;

      const result = parseRuleFrontmatter(content);

      expect(result.metadata.alwaysApply).toBe(true);
    });
  });

  describe('no frontmatter', () => {
    it('should return empty metadata and full body for plain markdown', () => {
      const content = `# Instructions
This is a plain rule file without frontmatter.`;

      const result = parseRuleFrontmatter(content);

      expect(result.metadata).toEqual({});
      expect(result.body).toBe(content);
    });

    it('should handle empty content', () => {
      const content = '';

      const result = parseRuleFrontmatter(content);

      expect(result.metadata).toEqual({});
      expect(result.body).toBe('');
    });
  });

  describe('edge cases', () => {
    it('should handle frontmatter with only applyTo', () => {
      const content = `---
applyTo: "**"
---
Apply to all files`;

      const result = parseRuleFrontmatter(content);

      expect(result.metadata.globs).toBe('**');
      expect(result.body).toBe('Apply to all files');
    });

    it('should handle mixed array formats', () => {
      const content = `---
globs:
  - "*.md"
applyTo: ["*.ts", "*.js"]
---
Mixed format`;

      const result = parseRuleFrontmatter(content);

      expect(result.metadata.globs).toEqual(['*.md', '*.ts', '*.js']);
    });

    it('should handle Windows-style line endings', () => {
      const content = '---\r\napplyTo: "*.ts"\r\n---\r\nWindows content';

      const result = parseRuleFrontmatter(content);

      expect(result.metadata.globs).toBe('*.ts');
      expect(result.body).toBe('Windows content');
    });
  });
});
