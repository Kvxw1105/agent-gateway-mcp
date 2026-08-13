import assert from "node:assert/strict";
import test from "node:test";
import { parseProviderOutput } from "../src/providers/output.js";

test("extracts ZCode response and session", () => {
  assert.deepEqual(parseProviderOutput("zcode", JSON.stringify({ sessionId: "sess_z", response: "Z_OK" })), {
    sessionId: "sess_z",
    response: "Z_OK",
  });
});

test("extracts Kimi response and resume hint", () => {
  const log = [
    JSON.stringify({ role: "assistant", content: "K_OK" }),
    JSON.stringify({ role: "meta", type: "session.resume_hint", session_id: "session_k" }),
  ].join("\n");
  assert.deepEqual(parseProviderOutput("kimi", log), { sessionId: "session_k", response: "K_OK" });
});

test("extracts Claude result and session", () => {
  const log = JSON.stringify({ type: "result", result: "C_OK", session_id: "session_c", is_error: false });
  assert.deepEqual(parseProviderOutput("claude", log), { sessionId: "session_c", response: "C_OK" });
});

test("extracts Codex final message and thread", () => {
  const log = [
    JSON.stringify({ type: "thread.started", thread_id: "thread_x" }),
    JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "X_OK" } }),
  ].join("\n");
  assert.deepEqual(parseProviderOutput("codex", log), { sessionId: "thread_x", response: "X_OK" });
});

test("extracts Pi session and assistant message", () => {
  const log = [
    JSON.stringify({ type: "session", id: "pi_s" }),
    JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "P_OK" }] } }),
  ].join("\n");
  assert.deepEqual(parseProviderOutput("pi", log), { sessionId: "pi_s", response: "P_OK" });
});

