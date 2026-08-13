import assert from "node:assert/strict";
import test from "node:test";
import { buildProviderInvocation, listProviders } from "../src/providers/catalog.js";

test("catalog exposes the five installed agent families with structured transports", () => {
  const providers = listProviders();
  assert.deepEqual(providers.map((provider) => provider.id), ["zcode", "kimi", "claude", "codex", "pi"]);
  assert.deepEqual(
    Object.fromEntries(providers.map((provider) => [provider.id, provider.transport])),
    {
      zcode: "json",
      kimi: "stream-json",
      claude: "stream-json",
      codex: "jsonl",
      pi: "json",
    },
  );
});

test("read-only invocations use provider-native restrictions", () => {
  const common = { prompt: "inspect only", workDir: "C:\\repo", permission: "read-only" as const };

  assert.deepEqual(buildProviderInvocation("zcode", common).args.slice(-7), [
    "--prompt", "inspect only", "--cwd", "C:\\repo", "--json", "--mode", "plan",
  ]);
  assert.deepEqual(buildProviderInvocation("kimi", common).args, [
    "-p", "inspect only", "--output-format", "stream-json",
  ]);
  assert.deepEqual(buildProviderInvocation("claude", common).args, [
    "-p", "inspect only", "--output-format", "stream-json", "--verbose", "--permission-mode", "plan",
  ]);
  assert.deepEqual(buildProviderInvocation("codex", common).args.slice(-11), [
    "exec", "--json", "--color", "never", "-m", "gpt-5.5", "-C", "C:\\repo", "-s", "read-only", "inspect only",
  ]);
  assert.deepEqual(buildProviderInvocation("pi", common).args.slice(-10), [
    "-p", "--mode", "json", "--provider", "anthropic", "--model", "anthropic/claude-sonnet-4-6", "--tools", "read,grep,find,ls", "inspect only",
  ]);
});

test("Windows npm shims are resolved without shell execution", () => {
  if (process.platform !== "win32") return;
  const common = { prompt: "safe & literal", workDir: "C:\\repo", permission: "read-only" as const };
  for (const id of ["zcode", "codex", "pi"] as const) {
    const invocation = buildProviderInvocation(id, common);
    assert.match(invocation.command, /node\.exe$/iu);
    assert.match(invocation.args[0] ?? "", /\.(?:js|mjs)$/iu);
  }
  assert.match(buildProviderInvocation("claude", common).command, /claude\.exe$/iu);
});

test("resume uses explicit session ids without attaching to a live TUI", () => {
  const request = {
    prompt: "continue",
    workDir: "C:\\repo",
    permission: "workspace-write" as const,
    sessionId: "session-123",
  };

  assert.deepEqual(buildProviderInvocation("zcode", request).args.slice(-2), ["--resume", "session-123"]);
  assert.deepEqual(buildProviderInvocation("kimi", request).args.slice(-2), ["-S", "session-123"]);
  assert.deepEqual(buildProviderInvocation("claude", request).args.slice(-2), ["--resume", "session-123"]);
  const codexArgs = buildProviderInvocation("codex", request).args;
  const execIndex = codexArgs.indexOf("exec");
  assert.deepEqual(codexArgs.slice(execIndex, execIndex + 5), ["exec", "resume", "--json", "--color", "never"]);
  assert.ok(codexArgs.includes("session-123"));
  assert.deepEqual(buildProviderInvocation("pi", request).args.slice(-3, -1), ["--session", "session-123"]);
});
