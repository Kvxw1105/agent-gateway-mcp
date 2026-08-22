#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getKimiVersion, runKimi } from "./kimi-runner.js";
import { listKimiSessions } from "./session-store.js";
import { buildProviderInvocation, listProviders } from "./providers/catalog.js";
import type { PermissionMode, ProviderId } from "./providers/types.js";
import { parseProviderOutput } from "./providers/output.js";
import { TaskManager } from "./task-manager.js";
import { WorkspacePolicy } from "./workspace-policy.js";

const server = new McpServer({
  name: "local-agent-gateway",
  version: "0.2.0",
});
const tasks = new TaskManager();
const workspacePolicy = new WorkspacePolicy();

function text(value: unknown) {
  return { content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
}

function errorResult(error: unknown) {
  return { ...text({ ok: false, error: error instanceof Error ? error.message : String(error) }), isError: true as const };
}

const providerSchema = z.enum(["zcode", "kimi", "claude", "codex", "pi"]);
const permissionSchema = z.enum(["read-only", "workspace-write"]);
const profileSchema = z.enum(["standard", "economy"]);
const ECONOMY_PROMPT_MAX_CHARS = 12_000;
const ECONOMY_FIRST_CHANGE_MS = 180_000;

export function assertPromptWithinProfile(prompt: string, profile: "standard" | "economy"): void {
  if (profile === "economy" && prompt.length > ECONOMY_PROMPT_MAX_CHARS) {
    throw new Error(
      `economy prompt exceeds ${ECONOMY_PROMPT_MAX_CHARS} characters; send a compact task capsule instead`,
    );
  }
}

server.tool(
  "agents_list",
  "List supported local CLI agents and their structured transport, resume, and permission capabilities.",
  {},
  async () => text({ ok: true, providers: listProviders() }),
);

server.tool(
  "agents_spawn",
  "Start a local CLI agent asynchronously and return a task id immediately. Use read-only unless edits are required. Parallel write tasks must use independent Git worktrees.",
  {
    provider: providerSchema,
    prompt: z.string().min(1),
    model: z.string().min(1).optional(),
    work_dir: z.string().min(1),
    permission: permissionSchema.default("read-only"),
    isolated_worktree: z.boolean().optional().describe("Set true only when work_dir is an independent Git worktree."),
    profile: profileSchema.default("standard"),
    timeout_seconds: z.number().int().min(10).max(7200).optional(),
  },
  async ({ provider, prompt, model, work_dir, permission, isolated_worktree, profile, timeout_seconds }) => {
    try {
      assertPromptWithinProfile(prompt, profile);
      const release = workspacePolicy.acquire(work_dir, permission as PermissionMode, isolated_worktree === true);
      try {
        const invocation = buildProviderInvocation(provider as ProviderId, {
          prompt,
          workDir: work_dir,
          permission: permission as PermissionMode,
          model,
        });
        const task = tasks.spawn({
          ...invocation,
          timeoutMs: (timeout_seconds ?? 600) * 1000,
          firstWorktreeChangeMs: profile === "economy"
            && permission === "workspace-write"
            && isolated_worktree === true
            ? ECONOMY_FIRST_CHANGE_MS
            : undefined,
          parseOutput: (log) => parseProviderOutput(provider as ProviderId, log),
        });
        void tasks.wait(task.id, (timeout_seconds ?? 600) * 1000 + 60_000).finally(release);
        return text({ ok: true, task });
      } catch (error) {
        release();
        throw error;
      }
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.tool(
  "agents_resume",
  "Resume a completed CLI agent session as a new asynchronous task. Never use this to inject into a session still open in an interactive TUI.",
  {
    provider: providerSchema,
    session_id: z.string().min(1),
    prompt: z.string().min(1),
    model: z.string().min(1).optional(),
    work_dir: z.string().min(1),
    permission: permissionSchema.default("read-only"),
    isolated_worktree: z.boolean().optional(),
    profile: profileSchema.default("standard"),
    timeout_seconds: z.number().int().min(10).max(7200).optional(),
  },
  async ({ provider, session_id, prompt, model, work_dir, permission, isolated_worktree, profile, timeout_seconds }) => {
    try {
      assertPromptWithinProfile(prompt, profile);
      const release = workspacePolicy.acquire(work_dir, permission as PermissionMode, isolated_worktree === true);
      try {
        const invocation = buildProviderInvocation(provider as ProviderId, {
          prompt,
          workDir: work_dir,
          permission: permission as PermissionMode,
          sessionId: session_id,
          model,
        });
        const task = tasks.spawn({
          ...invocation,
          timeoutMs: (timeout_seconds ?? 600) * 1000,
          firstWorktreeChangeMs: profile === "economy"
            && permission === "workspace-write"
            && isolated_worktree === true
            ? ECONOMY_FIRST_CHANGE_MS
            : undefined,
          parseOutput: (log) => parseProviderOutput(provider as ProviderId, log),
        });
        void tasks.wait(task.id, (timeout_seconds ?? 600) * 1000 + 60_000).finally(release);
        return text({ ok: true, task });
      } catch (error) {
        release();
        throw error;
      }
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.tool(
  "agents_status",
  "Return the current state of an asynchronous agent task.",
  { task_id: z.string().uuid() },
  async ({ task_id }) => {
    try { return text({ ok: true, task: tasks.status(task_id) }); }
    catch (error) { return errorResult(error); }
  },
);

server.tool(
  "agents_wait",
  "Wait for an agent task to reach a terminal state, bounded by wait_seconds.",
  { task_id: z.string().uuid(), wait_seconds: z.number().int().min(1).max(300).optional() },
  async ({ task_id, wait_seconds }) => {
    try { return text({ ok: true, task: await tasks.wait(task_id, (wait_seconds ?? 30) * 1000) }); }
    catch (error) { return errorResult(error); }
  },
);

server.tool(
  "agents_logs",
  "Read agent stdout/stderr from a character cursor. Pass the returned cursor to fetch only new output.",
  {
    task_id: z.string().uuid(),
    cursor: z.number().int().min(0).optional(),
    max_chars: z.number().int().min(1).max(50_000).default(12_000),
  },
  async ({ task_id, cursor, max_chars }) => {
    try { return text({ ok: true, ...tasks.logs(task_id, cursor, max_chars) }); }
    catch (error) { return errorResult(error); }
  },
);

server.tool(
  "agents_cancel",
  "Cancel a running agent task. This does not attach to or modify unrelated interactive TUI sessions.",
  { task_id: z.string().uuid() },
  async ({ task_id }) => {
    try { return text({ ok: true, task: tasks.cancel(task_id) }); }
    catch (error) { return errorResult(error); }
  },
);

server.tool(
  "kimi_status",
  "Check whether the local Kimi Code CLI is callable and report its version.",
  {},
  async () => {
    try {
      return text({ ok: true, ...(await getKimiVersion()) });
    } catch (error) {
      return { ...text({ ok: false, error: String(error) }), isError: true };
    }
  },
);

server.tool(
  "kimi_run",
  "Start a new non-interactive Kimi Code agent session in a working directory. The Kimi CLI may read, edit, and run commands in that directory. Scope the prompt and work_dir carefully.",
  {
    prompt: z.string().min(1).describe("Task for Kimi Code"),
    work_dir: z.string().min(1).describe("Absolute working directory"),
    timeout_seconds: z.number().int().min(10).max(1800).optional(),
  },
  async ({ prompt, work_dir, timeout_seconds }) => {
    try {
      const result = await runKimi({
        prompt,
        workDir: work_dir,
        timeoutMs: (timeout_seconds ?? 600) * 1000,
      });
      return text({ ok: true, response: result.text, session_id: result.sessionId });
    } catch (error) {
      return { ...text({ ok: false, error: String(error) }), isError: true };
    }
  },
);

server.tool(
  "kimi_resume",
  "Resume a Kimi Code session. Do not resume a session that is still open in an interactive TUI, because two writers can race on the same session.",
  {
    session_id: z.string().min(1),
    prompt: z.string().min(1),
    work_dir: z.string().min(1),
    timeout_seconds: z.number().int().min(10).max(1800).optional(),
  },
  async ({ session_id, prompt, work_dir, timeout_seconds }) => {
    try {
      const result = await runKimi({
        prompt,
        workDir: work_dir,
        sessionId: session_id,
        timeoutMs: (timeout_seconds ?? 600) * 1000,
      });
      return text({ ok: true, response: result.text, session_id: result.sessionId || session_id });
    } catch (error) {
      return { ...text({ ok: false, error: String(error) }), isError: true };
    }
  },
);

server.tool(
  "kimi_list_sessions",
  "List local Kimi Code sessions, optionally filtered by working directory.",
  {
    work_dir: z.string().optional(),
    limit: z.number().int().min(1).max(100).optional(),
  },
  async ({ work_dir, limit }) => text(await listKimiSessions(work_dir, limit)),
);

const transport = new StdioServerTransport();
await server.connect(transport);
