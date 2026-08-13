import assert from "node:assert/strict";
import test from "node:test";
import { parseKimiJsonLines } from "../src/kimi-runner.js";

test("parses assistant response and resume session", () => {
  const raw = [
    JSON.stringify({ role: "meta", type: "system.version", version: "0.34.0" }),
    JSON.stringify({ role: "assistant", content: "KIMI_BRIDGE_OK" }),
    JSON.stringify({ role: "meta", type: "session.resume_hint", session_id: "session_123" }),
  ].join("\n");
  const result = parseKimiJsonLines(raw);
  assert.equal(result.text, "KIMI_BRIDGE_OK");
  assert.equal(result.sessionId, "session_123");
  assert.equal(result.events.length, 3);
});

test("ignores non-JSON output and joins content blocks", () => {
  const raw = `noise\n${JSON.stringify({ role: "assistant", content: [{ type: "text", text: "A" }, { type: "text", text: "B" }] })}`;
  assert.equal(parseKimiJsonLines(raw).text, "A\nB");
});
