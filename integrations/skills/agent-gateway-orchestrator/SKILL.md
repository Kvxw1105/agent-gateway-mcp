---
name: agent-gateway-orchestrator
description: Orchestrate local ZCode, Kimi, Claude Code, Codex CLI, and Pi agents through Agent Gateway MCP. Use for low-cost routing, multi-agent comparison, failure escalation, visible terminal demos, safe worktree-based parallelism, or maintaining the gateway.
---

# Agent Gateway Orchestrator

Act as the controller and use the `agent-gateway` MCP for process lifecycle. Do not recreate process management in prompts or inject into an open interactive TUI.

## Start

1. Call `agents_list` for current providers and capabilities.
2. Inspect the target directory and Git state.
3. Read `references/routing.md` when selecting agents. Read `references/setup.md` when installing or maintaining the gateway.
4. Skip unavailable or unauthenticated providers; never disguise an incompatible endpoint as another provider's API.

## Select a mode

- `economy`: default. Start with one lower-cost agent and escalate only after failure or failed validation.
- `compare`: use only when the user requests a harness comparison. Keep the prompt and output short; use identical inputs and permissions.
- `critical`: let one agent implement, a different agent review read-only, and the controller perform final validation.

If the user says quota or budget is low, force `economy` unless they explicitly request a bounded comparison.

## Execute

1. Define a testable result, allowed files, permission, output limit, timeout, and prohibited actions.
2. Call `agents_spawn`; retain task ID, provider, session ID, and working directory.
3. Poll with bounded `agents_wait` calls and read incremental `agents_logs`.
4. Use `agents_cancel` on timeout, drift, or abnormal cost. Do not retry the same failing route indefinitely.
5. Use `agents_resume` only to start a new controlled non-interactive process.
6. Validate locally. An agent's success claim is not completion evidence.

Agents report through Gateway logs and results to the controller. They do not communicate directly by default. For staged collaboration, pass only the previous agent's concise result to the next agent.

## Safety

- Default to `read-only`.
- Protect existing uncommitted work.
- Parallel writers require separate Git worktrees and `isolated_worktree=true`.
- Never allow multiple agents to write the same ordinary directory.
- Never put credentials in prompts, repositories, MCP config, or logs.

## Visible terminals

When the user explicitly asks to watch execution, run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/show-agent-terminals.ps1 -GatewayRepo <repo> -PromptFile <prompt> -Providers pi,kimi,zcode
```

The windows are an observation layer. Treat Gateway task state and saved results as authoritative.

## Report

State which agents ran, status, duration, validation, escalation, and material harness differences. Report token use only when the provider exposes reliable usage data.

