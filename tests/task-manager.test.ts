import assert from "node:assert/strict";
import test from "node:test";
import { TaskManager } from "../src/task-manager.js";

const nodeInvocation = (script: string) => ({
  command: process.execPath,
  args: ["-e", script],
  cwd: process.cwd(),
});

test("spawn returns immediately and wait observes a successful task with logs", async () => {
  const manager = new TaskManager();
  const started = manager.spawn(nodeInvocation("setTimeout(() => { console.log('ASYNC_OK') }, 80)"));
  assert.match(started.id, /^[0-9a-f-]{36}$/u);
  assert.ok(["queued", "running"].includes(started.status));

  const finished = await manager.wait(started.id, 2_000);
  assert.equal(finished.status, "succeeded");
  assert.equal(finished.exitCode, 0);
  assert.match(manager.logs(started.id).text, /ASYNC_OK/u);
});

test("records failed exit codes", async () => {
  const manager = new TaskManager();
  const task = manager.spawn(nodeInvocation("console.error('BROKEN'); process.exit(7)"));
  const finished = await manager.wait(task.id, 2_000);
  assert.equal(finished.status, "failed");
  assert.equal(finished.exitCode, 7);
  assert.match(manager.logs(task.id).text, /BROKEN/u);
});

test("times out a long-running task", async () => {
  const manager = new TaskManager();
  const task = manager.spawn({ ...nodeInvocation("setInterval(() => {}, 1000)"), timeoutMs: 50 });
  const finished = await manager.wait(task.id, 2_000);
  assert.equal(finished.status, "timed_out");
});

test("cancels a running task", async () => {
  const manager = new TaskManager();
  const task = manager.spawn(nodeInvocation("setInterval(() => {}, 1000)"));
  const cancelled = manager.cancel(task.id);
  assert.equal(cancelled.status, "cancelled");
  assert.equal((await manager.wait(task.id, 2_000)).status, "cancelled");
});

test("log cursors return only new output", async () => {
  const manager = new TaskManager();
  const task = manager.spawn(nodeInvocation("console.log('one'); setTimeout(() => console.log('two'), 30)"));
  await manager.wait(task.id, 2_000);
  const first = manager.logs(task.id);
  const second = manager.logs(task.id, first.cursor);
  assert.match(first.text, /one/u);
  assert.match(first.text, /two/u);
  assert.equal(second.text, "");
});

test("stores structured response and session parsed at completion", async () => {
  const manager = new TaskManager();
  const task = manager.spawn({
    ...nodeInvocation("console.log('structured')"),
    parseOutput: (log) => ({ response: log.trim(), sessionId: "session_x" }),
  });
  const finished = await manager.wait(task.id, 2_000);
  assert.equal(finished.response, "structured");
  assert.equal(finished.sessionId, "session_x");
});
