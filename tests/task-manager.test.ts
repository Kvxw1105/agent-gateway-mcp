import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
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

test("log reads are bounded and paginated", async () => {
  const manager = new TaskManager();
  const task = manager.spawn(nodeInvocation("process.stdout.write('abcdefghij')"));
  await manager.wait(task.id, 2_000);
  const first = manager.logs(task.id, 0, 4);
  const second = manager.logs(task.id, first.cursor, 4);
  const third = manager.logs(task.id, second.cursor, 4);
  assert.deepEqual(first, { text: "abcd", cursor: 4, hasMore: true });
  assert.deepEqual(second, { text: "efgh", cursor: 8, hasMore: true });
  assert.deepEqual(third, { text: "ij", cursor: 10, hasMore: false });
});

test("write task times out when its worktree never changes", async () => {
  const manager = new TaskManager();
  const task = manager.spawn({
    ...nodeInvocation("setInterval(() => {}, 1000)"),
    firstWorktreeChangeMs: 50,
  });
  const finished = await manager.wait(task.id, 2_000);
  assert.equal(finished.status, "timed_out");
  assert.match(finished.error ?? "", /No worktree change/u);
});

test("a new worktree file satisfies the first-change gate", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-gateway-change-"));
  try {
    assert.equal(spawnSync("git", ["init"], { cwd: directory }).status, 0);
    const target = path.join(directory, "artifact.txt");
    const script = `const fs=require('node:fs'); setTimeout(()=>fs.writeFileSync(${JSON.stringify(target)},'ok'),20); setTimeout(()=>{},120)`;
    const manager = new TaskManager();
    const task = manager.spawn({
      command: process.execPath,
      args: ["-e", script],
      cwd: directory,
      firstWorktreeChangeMs: 60,
    });
    const finished = await manager.wait(task.id, 2_000);
    assert.equal(finished.status, "succeeded");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("editing an already dirty tracked file satisfies the first-change gate", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-gateway-tracked-change-"));
  try {
    assert.equal(spawnSync("git", ["init"], { cwd: directory }).status, 0);
    assert.equal(spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: directory }).status, 0);
    assert.equal(spawnSync("git", ["config", "user.name", "Test"], { cwd: directory }).status, 0);
    const target = path.join(directory, "tracked.txt");
    await writeFile(target, "committed");
    assert.equal(spawnSync("git", ["add", "tracked.txt"], { cwd: directory }).status, 0);
    assert.equal(spawnSync("git", ["commit", "-m", "base"], { cwd: directory }).status, 0);
    await writeFile(target, "dirty-one");
    const script = `const fs=require('node:fs'); setTimeout(()=>fs.writeFileSync(${JSON.stringify(target)},'dirty-two'),20); setTimeout(()=>{},120)`;
    const manager = new TaskManager();
    const task = manager.spawn({ command: process.execPath, args: ["-e", script], cwd: directory, firstWorktreeChangeMs: 60 });
    assert.equal((await manager.wait(task.id, 2_000)).status, "succeeded");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("editing an existing untracked file satisfies the first-change gate", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-gateway-untracked-change-"));
  try {
    assert.equal(spawnSync("git", ["init"], { cwd: directory }).status, 0);
    const target = path.join(directory, "untracked.txt");
    await writeFile(target, "one");
    const script = `const fs=require('node:fs'); setTimeout(()=>fs.writeFileSync(${JSON.stringify(target)},'two'),20); setTimeout(()=>{},120)`;
    const manager = new TaskManager();
    const task = manager.spawn({ command: process.execPath, args: ["-e", script], cwd: directory, firstWorktreeChangeMs: 60 });
    assert.equal((await manager.wait(task.id, 2_000)).status, "succeeded");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
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

test("exposes resolved skill metadata without skill contents", async () => {
  const manager = new TaskManager();
  const task = manager.spawn({
    ...nodeInvocation("console.log('ok')"),
    skillMode: "reference",
    resolvedSkills: [{ name: "alpha", path: "C:\\skills\\alpha\\SKILL.md" }],
  });
  const finished = await manager.wait(task.id, 2_000);
  assert.equal(finished.skillMode, "reference");
  assert.deepEqual(finished.resolvedSkills, [{ name: "alpha", path: "C:\\skills\\alpha\\SKILL.md" }]);
  assert.doesNotMatch(JSON.stringify(finished), /skill contents/u);
});
