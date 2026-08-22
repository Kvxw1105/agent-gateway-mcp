# Agent Gateway MCP

A Windows-native MCP gateway that lets any MCP-capable host orchestrate local coding-agent CLIs as external workers.

Windows 原生的通用 CLI Agent 网关。Codex、Claude Desktop 或其他支持 stdio MCP 的宿主，可以统一调度本机 ZCode、Kimi Code、Claude Code、Codex CLI 和 Pi Coding Agent。

## Why

- Route routine work to lower-cost plans/models and reserve the controller for hard decisions.
- Compare different agent harnesses with the same task and permissions.
- Keep asynchronous lifecycle, logs, cancellation, resume and workspace safety behind one MCP API.
- Prefer structured CLI protocols; never inject into an already-open interactive TUI.

## MCP tools

`agents_list`, `agents_spawn`, `agents_status`, `agents_wait`, `agents_logs`, `agents_cancel`, and `agents_resume`.

Legacy Kimi compatibility tools remain available: `kimi_status`, `kimi_run`, `kimi_resume`, and `kimi_list_sessions`.

For quota-sensitive work, pass `profile: "economy"` to `agents_spawn` or `agents_resume`. Economy rejects prompts over 12,000 characters and, for an isolated write worktree, cancels a worker that produces neither a HEAD change nor a Git status change within three minutes. Existing callers remain on `standard` behavior by default. `agents_logs` returns at most 12,000 characters per call by default (configurable up to 50,000 with `max_chars`) and reports `hasMore` for cursor-based paging.

## Install

Requirements: Windows, Node.js 20+, and at least one supported Agent CLI already installed and authenticated.

```powershell
git clone https://github.com/Kvxw1105/agent-gateway-mcp.git
cd agent-gateway-mcp
npm ci
npm run build
npm test
```

Add the built server to any stdio MCP host. Generic JSON:

```json
{
  "mcpServers": {
    "agent-gateway": {
      "command": "node",
      "args": ["C:\\absolute\\path\\agent-gateway-mcp\\dist\\src\\index.js"]
    }
  }
}
```

Codex TOML and generic JSON examples are in [`examples/`](examples/). Restart the host after editing its MCP configuration.

## Natural-language usage

The controller can translate requests such as:

- “Let Pi inspect this repository without editing files.”
- “让 Kimi 先定位问题；失败后再升级给 Codex。”
- “Run the same read-only task with Pi and ZCode, then compare their harness behavior.”
- “让两个 Agent 在各自 Git worktree 实现，最后只保留通过测试的方案。”

The reusable orchestration Skill is included under [`integrations/skills/agent-gateway-orchestrator`](integrations/skills/agent-gateway-orchestrator). Install it for Codex, Claude Code, or both:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-skill.ps1 -TargetHost both
```

## Provider configuration

The gateway auto-discovers common global npm layouts and executables on `PATH`. Override any provider without editing source:

| Variable | Purpose |
| --- | --- |
| `AGENT_GATEWAY_<ID>_COMMAND` | Executable for `ZCODE`, `KIMI`, `CLAUDE`, `CODEX`, or `PI` |
| `AGENT_GATEWAY_<ID>_PREFIX_ARGS` | JSON array inserted before normal CLI arguments |
| `AGENT_GATEWAY_CODEX_MODEL` | Default Codex model |
| `AGENT_GATEWAY_PI_PROVIDER` | Default Pi provider; defaults to `opencode-go` |
| `AGENT_GATEWAY_PI_MODEL` | Default Pi model; defaults to `opencode-go/deepseek-v4-flash` |
| `AGENT_GATEWAY_PI_API_KEY_ENV` | Windows user-environment key read for Pi; defaults to `OPENCODE_API_KEY` |
| `AGENT_GATEWAY_CLAUDE_CLEAN_ENV=1` | Remove Anthropic endpoint overrides only for the Claude child process |

For a JavaScript CLI installed in an unusual location, set both command and prefix arguments:

```powershell
$env:AGENT_GATEWAY_ZCODE_COMMAND = 'C:\Program Files\nodejs\node.exe'
$env:AGENT_GATEWAY_ZCODE_PREFIX_ARGS = '["C:\\tools\\zcode\\bin\\zcode.js"]'
```

Secrets belong in the provider's credential store or Windows user environment. Do not put API keys in the repository, prompts, or MCP config.

## Safety model

- `read-only` is the default permission.
- Concurrent writes to the same ordinary directory are rejected.
- Parallel writers must use separate Git worktrees and set `isolated_worktree=true`.
- Cancellation terminates the task process tree on Windows.
- Resume starts a new non-interactive process; it never writes into an open TUI session.
- Kimi prompt mode lacks a hard read-only flag, so its read-only boundary is explicitly reported as mixed.
- Task state is currently in-memory; provider session IDs may still be resumed after an MCP server restart.

## Development

```powershell
npm test
npm run typecheck
npm run smoke
npm audit
```

The upstream ecosystem audit is in [`docs/audits/2026-08-13-windows-agent-gateway-ecosystem.md`](docs/audits/2026-08-13-windows-agent-gateway-ecosystem.md).

Current architecture decisions, limitations, and the prioritized handoff roadmap are in [`.context/handoff/2026-08-13-agent-gateway-handoff.md`](.context/handoff/2026-08-13-agent-gateway-handoff.md).

## License

Apache-2.0. The supported Agent CLIs are separate products with their own licenses and terms; this repository does not redistribute them.
