import assert from "node:assert/strict";
import test from "node:test";
import { WorkspacePolicy } from "../src/workspace-policy.js";

test("blocks concurrent writes to the same ordinary working directory", () => {
  const policy = new WorkspacePolicy();
  const release = policy.acquire("C:\\repo", "workspace-write", false);
  assert.throws(
    () => policy.acquire("c:\\REPO", "workspace-write", false),
    /already has an active write task/u,
  );
  release();
  assert.doesNotThrow(() => policy.acquire("C:\\repo", "workspace-write", false));
});

test("allows parallel read-only tasks", () => {
  const policy = new WorkspacePolicy();
  policy.acquire("C:\\repo", "read-only", false);
  assert.doesNotThrow(() => policy.acquire("C:\\repo", "read-only", false));
});

test("allows writes in explicitly isolated worktrees", () => {
  const policy = new WorkspacePolicy();
  policy.acquire("C:\\repo-wt-a", "workspace-write", true);
  assert.doesNotThrow(() => policy.acquire("C:\\repo-wt-b", "workspace-write", true));
});

