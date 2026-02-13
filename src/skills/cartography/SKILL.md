---
name: cartography
description: Repository understanding and hierarchical codemap generation
---

# 制图技能

你帮助用户理解和映射仓库，通过创建层级化的代码地图。

## 使用时机

- 用户要求理解/映射一个仓库
- 用户需要代码库文档
- 开始在一个不熟悉的代码库上工作

## 工作流

### 步骤 1：检查现有状态

**首先，检查仓库根目录中是否存在 `.slim/cartography.json`。**

如果**存在**：跳到步骤 3（检测变更）——无需重新初始化。

如果**不存在**：继续步骤 2（初始化）。

### 步骤 2：初始化（仅在没有状态时）

1. **分析仓库结构** - 列出文件，了解目录
2. **推断模式**，**仅包含核心代码/配置文件**：
   - **包含**：`src/**/*.ts`、`package.json` 等
   - **排除（必须）**：不要包含测试、文档或翻译文件。
     - 测试：`**/*.test.ts`、`**/*.spec.ts`、`tests/**`、`__tests__/**`
     - 文档：`docs/**`、`*.md`（如需要可保留根目录 `README.md`）、`LICENSE`
     - 构建/依赖：`node_modules/**`、`dist/**`、`build/**`、`*.min.js`
   - 自动遵循 `.gitignore`
3. **运行 cartographer.py init**：

```bash
python3 ~/.config/opencode/skills/cartography/scripts/cartographer.py init \
  --root ./ \
  --include "src/**/*.ts" \
  --exclude "**/*.test.ts" --exclude "dist/**" --exclude "node_modules/**"
```

这将创建：
- `.slim/cartography.json` - 用于变更检测的文件和文件夹哈希
- 在所有相关子目录中创建空的 `codemap.md` 文件

4. **委派给 Explorer 代理** - 为每个文件夹生成一个 Explorer 来读取代码并填写其对应的 `codemap.md` 文件。

### 步骤 3：检测变更（如果状态已存在）

1. **运行 cartographer.py changes** 查看变更内容：

```bash
python3 ~/.config/opencode/skills/cartography/scripts/cartographer.py changes \
  --root ./
```

2. **查看输出** - 它会显示：
   - 新增的文件
   - 删除的文件
   - 修改的文件
   - 受影响的文件夹

3. **仅更新受影响的代码地图** - 为每个受影响的文件夹生成一个 Explorer 来更新其 `codemap.md`。
4. **运行 update** 保存新状态：

```bash
python3 ~/.config/opencode/skills/cartography/scripts/cartographer.py update \
  --root ./
```

### 步骤 4：完成仓库地图集（根代码地图）

当所有特定目录都已映射完成后，Orchestrator 必须创建或更新根目录的 `codemap.md`。此文件作为任何代理或人员进入仓库的**主入口点**。

1.  **映射根目录资源**：记录根级文件（如 `package.json`、`index.ts`、`plugin.json`）以及项目的整体用途。
2.  **聚合子地图**：创建"仓库目录地图"部分。对于每个拥有 `codemap.md` 的文件夹，提取其**职责**摘要并以表格或列表形式包含在根地图中。
3.  **交叉引用**：确保根地图包含指向子地图的绝对或相对路径，以便代理可以直接跳转到相关详情。


## 代码地图内容

在此工作流中，Explorer 被授予对 `codemap.md` 文件的写入权限。使用精确的技术术语来记录实现：

- **职责** - 使用标准软件工程术语定义此目录的具体角色（如"服务层"、"数据访问对象"、"中间件"）。
- **设计模式** - 识别并命名使用的具体模式（如"观察者"、"单例"、"工厂"、"策略"）。详细说明抽象和接口。
- **数据与控制流** - 明确追踪数据如何进入和离开模块。提及具体的函数调用序列和状态转换。
- **集成点** - 列出依赖项和消费模块。使用钩子、事件或 API 端点的技术名称。

代码地图示例：

```markdown
# src/agents/

## Responsibility
Defines agent personalities and manages their configuration lifecycle.

## Design
Each agent is a prompt + permission set. Config system uses:
- Default prompts (orchestrator.ts, explorer.ts, etc.)
- User overrides from ~/.config/opencode/oh-my-opencode-slim.json
- Permission wildcards for skill/MCP access control

## Flow
1. Plugin loads → calls getAgentConfigs()
2. Reads user config preset
3. Merges defaults with overrides
4. Applies permission rules (wildcard expansion)
5. Returns agent configs to OpenCode

## Integration
- Consumed by: Main plugin (src/index.ts)
- Depends on: Config loader, skills registry
```

**根代码地图（地图集）**示例：

```markdown
# Repository Atlas: oh-my-opencode-slim

## Project Responsibility
A high-performance, low-latency agent orchestration plugin for OpenCode, focusing on specialized sub-agent delegation and background task management.

## System Entry Points
- `src/index.ts`: Plugin initialization and OpenCode integration.
- `package.json`: Dependency manifest and build scripts.
- `oh-my-opencode-slim.json`: User configuration schema.

## Directory Map (Aggregated)
| Directory | Responsibility Summary | Detailed Map |
|-----------|------------------------|--------------|
| `src/agents/` | Defines agent personalities (Orchestrator, Explorer) and manages model routing. | [View Map](src/agents/codemap.md) |
| `src/features/` | Core logic for tmux integration, background task spawning, and session state. | [View Map](src/features/codemap.md) |
| `src/config/` | Implements the configuration loading pipeline and environment variable injection. | [View Map](src/config/codemap.md) |
```
