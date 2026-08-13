# Local Agent Gateway MCP

让 Codex Desktop 在 Windows 原生环境中，把本机 Agent CLI 当作外部 subagent 使用。当前统一接入 ZCode、Kimi Code、Claude Code、Codex CLI 和 Pi Coding Agent，并保留旧版 Kimi 专用工具。

## 给使用者

不需要自己敲 CLI。重启 Codex Desktop 或新建任务后，直接用自然语言说：

- “让 ZCode 只读审计这个项目，然后告诉我结论。”
- “让 Kimi 在这个独立 worktree 实现登录页，完成后把结果给我。”
- “让 Codex 检查测试失败原因，不要修改文件。”
- “让 Pi 用 DeepSeek V4 Flash 只读审查这个项目。”

Codex 会调用 `agents_spawn`，再用 `agents_wait` 和 `agents_logs` 等待结果。完成任务会直接带回 `response` 与 `sessionId`；需要续接时使用 `agents_resume`。

## 通用 MCP 工具

- `agents_list`：列出 provider、结构化 transport、权限边界和默认模型。
- `agents_spawn`：后台启动任务，立即返回 task id。
- `agents_status`：查询 queued/running/succeeded/failed/timed_out/cancelled。
- `agents_wait`：短时间等待终态；建议每次不超过 50 秒并重复调用。
- `agents_logs`：按 cursor 增量读取 stdout/stderr。
- `agents_cancel`：在 Windows 上终止该任务的进程树。
- `agents_resume`：以明确 session id 启动一次受控续接。

兼容入口仍为 `kimi_status`、`kimi_run`、`kimi_resume`、`kimi_list_sessions`。

## 安全边界

- 默认 `read-only`；需要编辑时必须明确使用 `workspace-write`。
- 同一普通目录不允许两个并行写任务。并行写必须为每个任务准备独立 Git worktree，并设置 `isolated_worktree=true`。
- 网关不会向仍打开的交互式 TUI 注入或双写。`agents_resume` 只启动新的非交互 CLI 进程。
- ZCode/Codex/Claude/Pi 使用各自原生权限参数；Kimi prompt 模式没有可与 `--prompt` 同用的硬只读 flag，因此 Kimi 的 read-only 是软约束。
- task registry 与日志当前由 MCP server 进程持有；Codex Desktop 重启后 task id 不可继续查询，但 provider session id 仍可用于 resume。

## 本机现场状态（2026-08-13）

| Provider | 结构化启动 | 真实 smoke | 说明 |
| --- | --- | --- | --- |
| ZCode 3.7.5-11 | JSON | 通过 | 返回 response 与 `sess_*`。 |
| Kimi 0.34.0 | stream-json | 通过 | 返回 response 与 `session_*`。 |
| Codex 0.133.0 | JSONL | 通过 | 网关默认 `gpt-5.5`，避开当前配置模型要求升级 CLI；仍有非阻断 cache 警告。 |
| Claude 2.1.193 | stream-json | 阻断 | 清除不兼容的第三方 Anthropic 环境变量后，原生认证状态为未登录；需先完成 `claude auth login`，或提供真正兼容 Anthropic Messages API 的服务。 |
| Pi 0.84.1 | JSON | 通过 | 默认使用 `opencode-go/deepseek-v4-flash`；Base URL 由 Pi 的 `models.json` 管理，网关只在启动子进程时从 Windows 用户环境读取 `OPENCODE_API_KEY`。 |

Pi 与 Claude 可以由同一个 MCP 网关统一调度，但不能直接共用 OpenCode Go 的 API 配置：Pi 支持 OpenAI Completions 兼容的 OpenCode Go 接口；Claude Code 要求 Anthropic 登录或 Anthropic Messages 兼容接口。密钥不应写入仓库、MCP 配置或任务日志。

## 开发与验证

```powershell
npm install
npm test
npm run typecheck
npm run smoke
npm run smoke:providers
npm audit
```

生态审计见 `docs/audits/2026-08-13-windows-agent-gateway-ecosystem.md`，实现计划见 `docs/plans/2026-08-13-universal-windows-agent-gateway.md`。
