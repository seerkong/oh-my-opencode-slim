export const RALPH_LOOP_TEMPLATE = `你正在启动 Ralph 循环 - 一个持续运行直到任务完成的自引用开发循环。

## Ralph 循环工作原理

1. 你将持续处理任务
2. 当你确信任务已完全完成时，输出：\`<promise>{{COMPLETION_PROMISE}}</promise>\`
3. 如果你没有输出承诺标记，循环将自动注入另一个提示以继续
4. 最大迭代次数：可配置（默认 100）

## 规则

- 专注于完整地完成任务，而非部分完成
- 在任务真正完成之前不要输出完成承诺标记
- 每次迭代都应朝目标取得有意义的进展
- 如果遇到困难，尝试不同的方法
- 使用待办事项跟踪你的进度

## 暂停 / 挂起（新功能）

如果你需要任何人工输入（澄清、确认、批准或审查），你必须挂起循环。

当你需要外部输入时：
1. 提出 1-3 个精确的问题（优先使用 A/B/C 选项）
2. 然后输出：\`<promise>YIELD</promise>\`
3. 立即停止。不要运行工具。不要继续工作。

## 退出条件

1. **完成**：任务完全完成时输出 \`<promise>DONE</promise>\`（或自定义承诺文本）
2. **挂起**：等待外部输入时输出 \`<promise>YIELD</promise>\`
3. **最大迭代次数**：达到限制时循环自动停止
4. **取消**：用户运行 \`/cancel-ralph\` 命令

## 你的任务

解析以下参数并开始处理任务。格式为：
\`"task description" [--completion-promise=TEXT] [--yield-promise=TEXT] [--resume-mode=user,file] [--resume-file=PATH] [--max-iterations=N]\`

默认值：
- 完成承诺标记："DONE"
- 暂停承诺标记："YIELD"
- 恢复模式："user,file"
- 恢复文件：".eidolon/ralph-resume.md"`;

export const CANCEL_RALPH_TEMPLATE = `取消当前活跃的 Ralph 循环。

这将：
1. 停止循环继续运行
2. 清除循环状态文件
3. 允许会话正常结束

检查是否有活跃的循环并取消它。将结果通知用户。`;

export const RALPH_RESUME_TEMPLATE = `恢复已挂起的 Ralph 循环。

用法：
- 如果你有载荷，运行：/ralph-resume "<payload>"
- 否则，将载荷写入 .eidolon/ralph-resume.md（设置 status: ready），然后运行 /ralph-resume

行为：
- 如果有 Ralph 循环处于挂起状态，恢复它。
- 如果没有循环处于挂起状态，通知用户。`;
