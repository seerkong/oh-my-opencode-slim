# AI 代理编码指南

本文档为在此仓库中运行的 AI 代理提供指南。

## 项目概述

**oh-my-opencode-slim** - 一个轻量级的 OpenCode 代理编排插件，是 oh-my-opencode 的精简分支。使用 TypeScript、Bun 和 Biome 构建。

## 命令

| 命令 | 描述 |
|---------|-------------|
| `bun run build` | 将 TypeScript 构建到 `dist/`（包括 index.ts 和 cli/index.ts） |
| `bun run typecheck` | 运行 TypeScript 类型检查（不输出文件） |
| `bun test` | 使用 Bun 运行所有测试 |
| `bun run lint` | 对整个代码库运行 Biome 代码检查 |
| `bun run format` | 使用 Biome 格式化整个代码库 |
| `bun run check` | 运行 Biome 检查并自动修复（代码检查 + 格式化 + 整理导入） |
| `bun run check:ci` | 运行 Biome 检查但不自动修复（CI 模式） |
| `bun run dev` | 构建并使用 OpenCode 运行 |

**运行单个测试：** 使用 Bun 的测试过滤功能配合 `-t` 标志：
```bash
bun test -t "test-name-pattern"
```

## 代码风格

### 通用规则
- **格式化/代码检查工具：** Biome（在 `biome.json` 中配置）
- **行宽：** 80 个字符
- **缩进：** 2 个空格
- **换行符：** LF（Unix）
- **引号：** JavaScript/TypeScript 中使用单引号
- **尾随逗号：** 始终启用

### TypeScript 指南
- **严格模式：** 在 `tsconfig.json` 中启用
- **禁止显式 `any`：** 会产生代码检查警告（测试文件中已禁用此规则）
- **模块解析：** `bundler` 策略
- **声明文件：** 在 `dist/` 中生成 `.d.ts` 文件

### 导入
- Biome 在保存时自动整理导入（`organizeImports: "on"`）
- 让格式化工具处理导入排序
- 如果存在 TypeScript 配置中定义的路径别名，请使用它们

### 命名约定
- **变量/函数：** camelCase
- **类/接口：** PascalCase
- **常量：** SCREAMING_SNAKE_CASE
- **文件：** 大多数使用 kebab-case，React 组件使用 PascalCase

### 错误处理
- 使用带有描述性消息的类型化错误
- 让错误适当传播，而不是静默捕获
- 使用 Zod 进行运行时验证（已作为依赖项）

### Git 集成
- Biome 与 git 集成（VCS 已启用）
- 提交前应通过 `bun run check:ci` 检查

## 项目结构

```
oh-my-opencode-slim/
├── src/              # TypeScript 源文件
├── dist/             # 构建后的 JavaScript 和声明文件
├── node_modules/     # 依赖项
├── biome.json        # Biome 配置
├── tsconfig.json     # TypeScript 配置
└── package.json      # 项目清单和脚本
```

## 关键依赖

- `@modelcontextprotocol/sdk` - MCP 协议实现
- `@opencode-ai/sdk` - OpenCode AI SDK
- `zod` - 运行时验证
- `vscode-jsonrpc` / `vscode-languageserver-protocol` - LSP 支持

## 开发工作流

1. 修改代码
2. 运行 `bun run check:ci` 验证代码检查和格式化
3. 运行 `bun run typecheck` 验证类型
4. 运行 `bun test` 验证测试通过
5. 提交更改

## 常见模式

- 这是一个 OpenCode 插件——大部分功能位于 `src/` 中
- CLI 入口点是 `src/cli/index.ts`
- 主插件导出是 `src/index.ts`
- 技能位于 `src/skills/`（包含在包发布中）
