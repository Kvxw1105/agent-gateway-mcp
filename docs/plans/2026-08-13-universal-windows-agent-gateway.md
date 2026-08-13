# 通用 Windows CLI Agent Gateway 实现计划

**目标：** 将 Kimi 专用 MCP 演进为 Windows 原生、多 CLI、异步且可恢复的通用 Agent Gateway，同时保持兼容入口。

**架构：** MCP 层只负责校验与任务控制；`TaskManager` 持有异步生命周期和日志；provider adapter 负责命令、权限和结构化事件解析。第一阶段使用各 CLI 已稳定的无头 JSON/RPC 输出，ACP client 作为独立的协议升级切片，ConPTY 延后到确有需要的 provider。

**技术栈：** Node.js 22、TypeScript、官方 MCP SDK、Node test runner；后续 ACP 切片使用官方 `@agentclientprotocol/sdk`。

---

### 任务 1：通用 provider catalog 与命令构建

**文件：**
- 创建：`src/providers/types.ts`
- 创建：`src/providers/catalog.ts`
- 创建：`tests/provider-catalog.test.ts`

1. 先写测试，固定五个 provider 的 id、可执行文件发现、只读/写权限参数、resume 参数和结构化输出模式。
2. 运行目标测试并确认因模块缺失而失败。
3. 实现最小 adapter catalog。
4. 运行目标测试和全量测试。

### 任务 2：异步 TaskManager、日志、超时和取消

**文件：**
- 创建：`src/task-manager.ts`
- 创建：`src/task-store.ts`
- 创建：`tests/task-manager.test.ts`

1. 先写带 fixture 子进程的生命周期测试：queued/running/succeeded/failed/timed_out/cancelled。
2. 验证失败原因是功能不存在。
3. 实现后台 spawn、stdout/stderr 日志、等待、超时与 Windows 进程树取消。
4. 验证所有状态转换和日志游标。

### 任务 3：并行写保护与 worktree 边界

**文件：**
- 创建：`src/workspace-policy.ts`
- 创建：`tests/workspace-policy.test.ts`
- 修改：`src/task-manager.ts`

1. 先写测试：同一普通目录只能有一个写任务；read-only 可并行；不同 worktree 可并行。
2. 实现基于规范化路径和任务状态的锁，不自动删除任何 worktree。
3. 验证拒绝信息可操作且不会影响既有未提交改动。

### 任务 4：通用 MCP 工具与 Kimi 兼容层

**文件：**
- 修改：`src/index.ts`
- 修改：`tests/mcp-smoke.ts`

1. 先扩展 smoke 期望的通用工具列表，确认失败。
2. 接入 `agents_list/spawn/status/wait/logs/cancel/resume`。
3. 保留四个 `kimi_*` 工具；兼容调用走现有实现并返回迁移提示。
4. build 后执行 MCP tools/list 与只读调用 smoke。

### 任务 5：五 provider 现场 smoke

**文件：**
- 创建：`tests/provider-live-smoke.ts`
- 修改：`package.json`
- 修改：`README.md`

1. 对每个 CLI 先执行 version/status 探测。
2. 对只读临时目录发出明确“不读写文件，只回复 token”的最小请求，记录结构化输出和 session id。
3. 对支持 resume 的 provider 做一次续接；不接触已打开的 TUI session。
4. 将未通过的 provider 精确标记为 blocked/unsupported，不用 fallback 隐藏失败。

### 任务 6：ACP 协议切片

**文件：**
- 创建：`src/protocols/acp-client.ts`
- 创建：`tests/acp-client.test.ts`
- 修改：Kimi adapter

1. 审计并固定 `@agentclientprotocol/sdk` 版本、许可证和 npm audit。
2. 使用内存/fixture ACP server 写握手、session/new、prompt、cancel 测试并确认先失败。
3. 以官方 SDK 实现 client；对 `kimi acp` 做真实只读 smoke。
4. 仅在 ACP smoke 可靠后切换 Kimi 主路径；保留 stream-json 作为版本受控 fallback。

### 任务 7：交付验证与 Codex 迁移

**文件：**
- 修改：`README.md`
- 修改：`C:/Users/kvxkf/.codex/config.toml`（仅在 build/smoke 全部通过后）

1. 运行 `npm test`、`npm run typecheck`、`npm run build`、MCP smoke、`npm audit`。
2. 检查 `git diff`，确认没有密钥、调试代码或仓库外业务改动。
3. 更新 MCP server 名称为通用入口，同时保留旧配置的平滑迁移说明。
4. 真实从 Codex MCP 调用 `agents_list` 和一个只读 agent task。

