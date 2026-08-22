import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildObserverInvocation } from "../src/task-observer.js";

test("observer invocation only reads an existing task log and status", async () => {
  const scriptPath = path.resolve("integrations/skills/agent-gateway-orchestrator/scripts/show-agent-terminals.ps1");
  const invocation = buildObserverInvocation({
    taskId: "task-123",
    logPath: "C:\\temp\\task.log",
    statusPath: "C:\\temp\\task.json",
    scriptPath,
  });
  assert.equal(invocation.command.toLowerCase(), "powershell.exe");
  assert.ok(invocation.args.includes("C:\\temp\\task.log"));
  assert.ok(invocation.args.includes("C:\\temp\\task.json"));
  const script = await readFile(scriptPath, "utf8");
  assert.doesNotMatch(script, /provider-live-smoke|agents_spawn|kimi_run/u);
  assert.match(script, /LogPath/u);
  assert.match(script, /StatusPath/u);
});
