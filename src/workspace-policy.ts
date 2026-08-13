import path from "node:path";
import type { PermissionMode } from "./providers/types.js";

export class WorkspacePolicy {
  readonly #writeLocks = new Set<string>();

  acquire(workDir: string, permission: PermissionMode, isolatedWorktree: boolean): () => void {
    if (permission === "read-only") return () => {};
    const key = normalize(workDir);
    if (!isolatedWorktree && this.#writeLocks.has(key)) {
      throw new Error(
        `work_dir already has an active write task: ${workDir}. Use an independent Git worktree for parallel writes.`,
      );
    }
    this.#writeLocks.add(key);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#writeLocks.delete(key);
    };
  }
}

function normalize(workDir: string): string {
  return path.resolve(workDir).toLowerCase();
}

