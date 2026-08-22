import assert from "node:assert/strict";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(process.cwd(), "dist", "src", "index.js")],
});
const client = new Client({ name: "agent-gateway-smoke", version: "0.1.0" });

try {
  await client.connect(transport);
  const listed = await client.listTools();
  const names = listed.tools.map((tool) => tool.name).sort();
  assert.deepEqual(names, [
    "agents_cancel",
    "agents_list",
    "agents_logs",
    "agents_resume",
    "agents_spawn",
    "agents_status",
    "agents_wait",
    "kimi_list_sessions",
    "kimi_resume",
    "kimi_run",
    "kimi_status",
  ]);
  const spawnTool = listed.tools.find((tool) => tool.name === "agents_spawn");
  const resumeTool = listed.tools.find((tool) => tool.name === "agents_resume");
  const logsTool = listed.tools.find((tool) => tool.name === "agents_logs");
  assert.match(JSON.stringify(spawnTool?.inputSchema), /profile/u);
  assert.match(JSON.stringify(spawnTool?.inputSchema), /skills/u);
  assert.match(JSON.stringify(spawnTool?.inputSchema), /skill_mode/u);
  assert.match(JSON.stringify(resumeTool?.inputSchema), /skills/u);
  assert.match(JSON.stringify(resumeTool?.inputSchema), /skill_mode/u);
  assert.match(JSON.stringify(logsTool?.inputSchema), /max_chars/u);

  const oversized = await client.callTool({
    name: "agents_spawn",
    arguments: {
      provider: "pi",
      prompt: "x".repeat(12_001),
      work_dir: process.cwd(),
      permission: "read-only",
      profile: "economy",
    },
  });
  assert.equal(oversized.isError, true);
  assert.match(JSON.stringify(oversized.content), /compact task capsule/u);

  const providers = await client.callTool({ name: "agents_list", arguments: {} });
  assert.equal(providers.isError, undefined);
  assert.match(JSON.stringify(providers.content), /zcode/u);

  const status = await client.callTool({ name: "kimi_status", arguments: {} });
  assert.ok(Array.isArray(status.content));
  const sessions = await client.callTool({ name: "kimi_list_sessions", arguments: { limit: 3 } });
  assert.equal(sessions.isError, undefined);

  if (process.argv.includes("--live")) {
    const response = await client.callTool({
      name: "kimi_run",
      arguments: {
        prompt: "这是 MCP 连接验收。不要读取或修改文件，只回复：KIMI_MCP_OK",
        work_dir: process.cwd(),
        timeout_seconds: 120,
      },
    });
    assert.equal(response.isError, undefined);
    const payload = JSON.stringify(response.content);
    assert.match(payload, /KIMI_MCP_OK/u);

    const textBlock = Array.isArray(response.content)
      ? response.content.find((block) => block.type === "text")
      : undefined;
    assert.ok(textBlock && textBlock.type === "text");
    const runPayload = JSON.parse(textBlock.text) as { session_id?: string };
    assert.ok(runPayload.session_id);

    const resumed = await client.callTool({
      name: "kimi_resume",
      arguments: {
        session_id: runPayload.session_id,
        prompt: "这是续接验收。不要读取或修改文件，只回复：KIMI_RESUME_OK",
        work_dir: process.cwd(),
        timeout_seconds: 120,
      },
    });
    assert.equal(resumed.isError, undefined);
    assert.match(JSON.stringify(resumed.content), /KIMI_RESUME_OK/u);
  }

  process.stdout.write(JSON.stringify({ ok: true, tools: names, live: process.argv.includes("--live") }) + "\n");
} finally {
  await client.close();
}
