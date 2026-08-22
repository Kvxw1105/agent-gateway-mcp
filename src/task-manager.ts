import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export type TaskStatus = "queued" | "running" | "succeeded" | "failed" | "timed_out" | "cancelled";

export interface TaskInvocation {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs?: number;
  parseOutput?: (log: string) => { response?: string; sessionId?: string };
  unsetEnv?: string[];
  userEnvKeys?: string[];
  /** Cancel a write task if its Git content digest does not change by this deadline. */
  firstWorktreeChangeMs?: number;
  skillMode?: "reference" | "full";
  resolvedSkills?: Array<{ name: string; path: string }>;
}

export interface TaskRecord {
  id: string;
  status: TaskStatus;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  exitCode?: number | null;
  error?: string;
  response?: string;
  sessionId?: string;
  skillMode?: "reference" | "full";
  resolvedSkills?: Array<{ name: string; path: string }>;
  logPath?: string;
  statusPath?: string;
  responseTruncated?: boolean;
}

interface InternalTask {
  record: TaskRecord;
  child?: ChildProcess;
  log: string;
  timer?: NodeJS.Timeout;
  changeTimer?: NodeJS.Timeout;
  done: Promise<void>;
  resolveDone: () => void;
  parseOutput?: TaskInvocation["parseOutput"];
  baselineWorktree?: string;
}

export class TaskManager {
  readonly #tasks = new Map<string, InternalTask>();
  readonly #taskDirectory: string;

  constructor(options: { taskDirectory?: string } = {}) {
    this.#taskDirectory = options.taskDirectory ?? path.join(os.tmpdir(), "agent-gateway", "tasks");
    mkdirSync(this.#taskDirectory, { recursive: true });
  }

  spawn(invocation: TaskInvocation): TaskRecord {
    const id = randomUUID();
    let resolveDone: () => void = () => {};
    const done = new Promise<void>((resolve) => { resolveDone = resolve; });
    const task: InternalTask = {
      record: {
        id,
        status: "queued",
        createdAt: new Date().toISOString(),
        skillMode: invocation.skillMode,
        resolvedSkills: invocation.resolvedSkills,
        logPath: path.join(this.#taskDirectory, `${id}.log`),
        statusPath: path.join(this.#taskDirectory, `${id}.status.json`),
      },
      log: "",
      done,
      resolveDone,
      parseOutput: invocation.parseOutput,
      baselineWorktree: invocation.firstWorktreeChangeMs === undefined
        ? undefined
        : worktreeSnapshot(invocation.cwd),
    };
    writeFileSync(task.record.logPath!, "", "utf8");
    persistObserverStatus(task.record);
    this.#tasks.set(id, task);

    const childEnv: NodeJS.ProcessEnv = { ...process.env };
    for (const name of invocation.unsetEnv ?? []) delete childEnv[name];
    for (const name of invocation.userEnvKeys ?? []) {
      const value = readWindowsUserEnvironment(name);
      if (value) childEnv[name] = value;
    }
    const child = spawn(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      env: childEnv,
      shell: false,
      detached: process.platform === "win32",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    task.child = child;
    task.record.status = "running";
    task.record.startedAt = new Date().toISOString();
    persistObserverStatus(task.record);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { this.#appendLog(task, chunk); });
    child.stderr.on("data", (chunk: string) => { this.#appendLog(task, chunk); });
    child.on("error", (error) => this.#finish(task, "failed", null, error.message));
    child.on("close", (code) => {
      if (isTerminal(task.record.status)) return;
      this.#finish(task, code === 0 ? "succeeded" : "failed", code);
    });

    if (invocation.timeoutMs !== undefined) {
      task.timer = setTimeout(() => {
        if (isTerminal(task.record.status)) return;
        this.#terminate(task);
        this.#finish(task, "timed_out", null, `Timed out after ${invocation.timeoutMs}ms`);
      }, invocation.timeoutMs);
    }
    if (invocation.firstWorktreeChangeMs !== undefined && task.baselineWorktree !== undefined) {
      task.changeTimer = setTimeout(() => {
        if (isTerminal(task.record.status)) return;
        const current = worktreeSnapshot(invocation.cwd);
        // A failed git probe is not evidence that the worker made no progress.
        if (current === undefined || current !== task.baselineWorktree) return;
        this.#terminate(task);
        this.#finish(
          task,
          "timed_out",
          null,
          `No worktree change after ${invocation.firstWorktreeChangeMs}ms`,
        );
      }, invocation.firstWorktreeChangeMs);
    }
    return { ...task.record };
  }

  status(id: string): TaskRecord {
    return { ...this.#require(id).record };
  }

  async wait(id: string, timeoutMs = 30_000): Promise<TaskRecord> {
    const task = this.#require(id);
    if (!isTerminal(task.record.status)) {
      await Promise.race([
        task.done,
        new Promise<void>((_, reject) => setTimeout(() => reject(new Error(`Wait timed out after ${timeoutMs}ms`)), timeoutMs)),
      ]);
    }
    return { ...task.record };
  }

  logs(id: string, cursor = 0, maxChars = 12_000): { text: string; cursor: number; hasMore: boolean } {
    const log = this.#require(id).log;
    const safeCursor = Math.max(0, Math.min(cursor, log.length));
    const safeLimit = Math.max(1, maxChars);
    const nextCursor = Math.min(log.length, safeCursor + safeLimit);
    return {
      text: log.slice(safeCursor, nextCursor),
      cursor: nextCursor,
      hasMore: nextCursor < log.length,
    };
  }

  cancel(id: string): TaskRecord {
    const task = this.#require(id);
    if (!isTerminal(task.record.status)) {
      this.#terminate(task);
      this.#finish(task, "cancelled", null);
    }
    return { ...task.record };
  }

  #terminate(task: InternalTask): void {
    if (!task.child || task.child.exitCode !== null) return;
    if (process.platform === "win32" && task.child.pid) {
      spawnSync("taskkill.exe", ["/pid", String(task.child.pid), "/t", "/f"], {
        windowsHide: true,
        stdio: "ignore",
      });
      return;
    }
    task.child.kill("SIGTERM");
  }

  #appendLog(task: InternalTask, chunk: string): void {
    task.log += chunk;
    appendFileSync(task.record.logPath!, chunk, "utf8");
  }

  #finish(task: InternalTask, status: TaskStatus, exitCode: number | null, error?: string): void {
    if (isTerminal(task.record.status)) return;
    if (task.timer) clearTimeout(task.timer);
    if (task.changeTimer) clearTimeout(task.changeTimer);
    task.record.status = status;
    task.record.exitCode = exitCode;
    task.record.endedAt = new Date().toISOString();
    if (error) task.record.error = error;
    if (task.parseOutput) {
      try {
        const parsed = task.parseOutput(task.log);
        if (parsed.response !== undefined) {
          task.record.response = parsed.response.slice(0, 8_000);
          if (parsed.response.length > 8_000) task.record.responseTruncated = true;
        }
        if (parsed.sessionId !== undefined) task.record.sessionId = parsed.sessionId;
      } catch (parseError) {
        task.record.error ??= `Output parse failed: ${parseError instanceof Error ? parseError.message : String(parseError)}`;
      }
    }
    persistObserverStatus(task.record);
    task.resolveDone();
  }

  #require(id: string): InternalTask {
    const task = this.#tasks.get(id);
    if (!task) throw new Error(`Unknown task: ${id}`);
    return task;
  }
}

function persistObserverStatus(record: TaskRecord): void {
  if (!record.statusPath) return;
  writeFileSync(record.statusPath, JSON.stringify({
    id: record.id,
    status: record.status,
    createdAt: record.createdAt,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    exitCode: record.exitCode,
    error: record.error,
  }), "utf8");
}

function worktreeSnapshot(cwd: string): string | undefined {
  const root = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    windowsHide: true,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (root.status !== 0) return undefined;
  const head = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd,
    windowsHide: true,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const unstaged = spawnSync("git", ["diff", "--binary", "--no-ext-diff"], {
    cwd,
    windowsHide: true,
    encoding: "buffer",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const staged = spawnSync("git", ["diff", "--cached", "--binary", "--no-ext-diff"], {
    cwd,
    windowsHide: true,
    encoding: "buffer",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const untracked = spawnSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], {
    cwd,
    windowsHide: true,
    encoding: "buffer",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (unstaged.status !== 0 || staged.status !== 0 || untracked.status !== 0) return undefined;

  const hash = createHash("sha256");
  hash.update(head.status === 0 ? head.stdout.trim() : "NO_HEAD");
  hash.update("\0unstaged\0");
  hash.update(unstaged.stdout);
  hash.update("\0staged\0");
  hash.update(staged.stdout);
  hash.update("\0untracked\0");
  const rootPath = root.stdout.trim();
  for (const relativePath of untracked.stdout.toString("utf8").split("\0").filter(Boolean).sort()) {
    hash.update(relativePath);
    hash.update("\0");
    try {
      hash.update(readFileSync(path.join(rootPath, relativePath)));
    } catch {
      // A concurrently removed file still changes the next snapshot's path set.
    }
    hash.update("\0");
  }
  return hash.digest("hex");
}

function isTerminal(status: TaskStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "timed_out" || status === "cancelled";
}

function readWindowsUserEnvironment(name: string): string | undefined {
  if (process.platform !== "win32") return process.env[name];
  const result = spawnSync("reg.exe", ["query", "HKCU\\Environment", "/v", name], {
    windowsHide: true,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status !== 0 || !result.stdout) return process.env[name];
  const line = result.stdout.split(/\r?\n/u).find((item) => item.trimStart().startsWith(name));
  if (!line) return process.env[name];
  const match = line.match(/^\s*\S+\s+REG_(?:SZ|EXPAND_SZ)\s+(.*)$/u);
  return match?.[1]?.trim() || process.env[name];
}
