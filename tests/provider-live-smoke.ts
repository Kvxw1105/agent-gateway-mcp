import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const allProviders = ["zcode", "kimi", "claude", "codex", "pi"] as const;
const requested = process.argv[2];
const promptFile = process.argv[3];
const resultFile = process.argv[4];
const benchmarkPrompt = promptFile
  ? readFileSync(path.resolve(promptFile), "utf8").trim()
  : undefined;
const providers = requested
  ? allProviders.filter((provider) => provider === requested)
  : allProviders;
if (providers.length === 0) throw new Error(`Unknown provider: ${requested}`);
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(process.cwd(), "dist", "src", "index.js")],
});
const client = new Client({ name: "agent-gateway-provider-live-smoke", version: "0.1.0" });

function payload(response: Awaited<ReturnType<Client["callTool"]>>): Record<string, unknown> {
  const block = Array.isArray(response.content) ? response.content.find((item) => item.type === "text") : undefined;
  if (!block || block.type !== "text") throw new Error("MCP response has no text block");
  return JSON.parse(block.text) as Record<string, unknown>;
}

try {
  await client.connect(transport);
  const taskIds = new Map<string, string>();
  for (const provider of providers) {
    const token = `${provider.toUpperCase()}_GATEWAY_OK`;
    const response = await client.callTool({
      name: "agents_spawn",
      arguments: {
        provider,
        prompt: benchmarkPrompt
          ?? `This is a connection smoke test. Do not read or modify files and do not run tools. Reply with exactly: ${token}`,
        work_dir: process.cwd(),
        permission: "read-only",
        timeout_seconds: 180,
      },
    });
    const data = payload(response);
    const task = data.task as { id?: string } | undefined;
    if (!task?.id) throw new Error(`${provider} did not return a task id: ${JSON.stringify(data)}`);
    taskIds.set(provider, task.id);
    process.stdout.write(`[${provider}] 已启动 task ${task.id}\n`);
  }

  const results: Record<string, unknown> = {};
  for (const [provider, taskId] of taskIds) {
    let waited: Record<string, unknown> | undefined;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      waited = payload(await client.callTool(
        { name: "agents_wait", arguments: { task_id: taskId, wait_seconds: 50 } },
        undefined,
        { timeout: 55_000 },
      ));
      const status = (waited.task as { status?: string } | undefined)?.status;
      process.stdout.write(`[${provider}] 状态：${status ?? "unknown"}\n`);
      if (["succeeded", "failed", "timed_out", "cancelled"].includes(status ?? "")) break;
    }
    const logs = payload(await client.callTool({ name: "agents_logs", arguments: { task_id: taskId } }));
    results[provider] = { task: waited?.task, logs: logs.text };
  }
  const report = JSON.stringify(results, null, 2);
  if (resultFile) writeFileSync(path.resolve(resultFile), `${report}\n`, "utf8");
  process.stdout.write(`${report}\n`);
} finally {
  await client.close();
}
