import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";

export type TaskStatus = "queued" | "running" | "succeeded" | "failed" | "timed_out" | "cancelled";

export interface TaskInvocation {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs?: number;
  parseOutput?: (log: string) => { response?: string; sessionId?: string };
  unsetEnv?: string[];
  userEnvKeys?: string[];
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
}

interface InternalTask {
  record: TaskRecord;
  child?: ChildProcess;
  log: string;
  timer?: NodeJS.Timeout;
  done: Promise<void>;
  resolveDone: () => void;
  parseOutput?: TaskInvocation["parseOutput"];
}

export class TaskManager {
  readonly #tasks = new Map<string, InternalTask>();

  spawn(invocation: TaskInvocation): TaskRecord {
    const id = randomUUID();
    let resolveDone: () => void = () => {};
    const done = new Promise<void>((resolve) => { resolveDone = resolve; });
    const task: InternalTask = {
      record: { id, status: "queued", createdAt: new Date().toISOString() },
      log: "",
      done,
      resolveDone,
      parseOutput: invocation.parseOutput,
    };
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
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { task.log += chunk; });
    child.stderr.on("data", (chunk: string) => { task.log += chunk; });
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

  logs(id: string, cursor = 0): { text: string; cursor: number } {
    const log = this.#require(id).log;
    const safeCursor = Math.max(0, Math.min(cursor, log.length));
    return { text: log.slice(safeCursor), cursor: log.length };
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

  #finish(task: InternalTask, status: TaskStatus, exitCode: number | null, error?: string): void {
    if (isTerminal(task.record.status)) return;
    if (task.timer) clearTimeout(task.timer);
    task.record.status = status;
    task.record.exitCode = exitCode;
    task.record.endedAt = new Date().toISOString();
    if (error) task.record.error = error;
    if (task.parseOutput) {
      try {
        const parsed = task.parseOutput(task.log);
        if (parsed.response !== undefined) task.record.response = parsed.response;
        if (parsed.sessionId !== undefined) task.record.sessionId = parsed.sessionId;
      } catch (parseError) {
        task.record.error ??= `Output parse failed: ${parseError instanceof Error ? parseError.message : String(parseError)}`;
      }
    }
    task.resolveDone();
  }

  #require(id: string): InternalTask {
    const task = this.#tasks.get(id);
    if (!task) throw new Error(`Unknown task: ${id}`);
    return task;
  }
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
