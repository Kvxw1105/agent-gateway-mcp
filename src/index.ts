#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getKimiVersion, runKimi } from "./kimi-runner.js";
import { listKimiSessions } from "./session-store.js";

const server = new McpServer({
  name: "local-agent-gateway",
  version: "0.1.0",
});

function text(value: unknown) {
  return { content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
}

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
