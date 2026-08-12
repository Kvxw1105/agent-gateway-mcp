import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { access, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface KimiEvent {
  role?: string;
  type?: string;
  content?: unknown;
  session_id?: string;
  [key: string]: unknown;
}

export interface KimiRunOptions {
  prompt: string;
  workDir: string;
  sessionId?: string;
  timeoutMs?: number;
}

export interface KimiRunResult {
  text: string;
  sessionId?: string;
  events: KimiEvent[];
  stderr: string;
}

export function kimiCommand(): string {
  const configured = process.env.KIMI_BIN?.trim();
  if (configured) return configured;
  if (process.platform === "win32") {
    const bundled = path.join(os.homedir(), ".kimi-code", "bin", "kimi.exe");
    if (existsSync(bundled)) return bundled;
  }
  return "kimi";
}

export async function validateWorkDir(workDir: string): Promise<string> {
  const resolved = path.resolve(workDir);
  await access(resolved);
  const info = await stat(resolved);
  if (!info.isDirectory()) {
    throw new Error(`work_dir is not a directory: ${resolved}`);
  }
  return resolved;
}

export function parseKimiJsonLines(raw: string): Pick<KimiRunResult, "text" | "sessionId" | "events"> {
  const events: KimiEvent[] = [];
  const messages: string[] = [];
  let sessionId: string | undefined;

  for (const line of raw.split(/\r?\n/u)) {
    if (!line.trim()) continue;
    let event: KimiEvent;
    try {
      event = JSON.parse(line) as KimiEvent;
    } catch {
      continue;
    }
    events.push(event);
    if (event.role === "assistant") {
      if (typeof event.content === "string") {
        messages.push(event.content);
      } else if (Array.isArray(event.content)) {
        for (const part of event.content) {
          if (part && typeof part === "object" && "text" in part && typeof part.text === "string") {
            messages.push(part.text);
          }
        }
      }
    }
    if (event.type === "session.resume_hint" && typeof event.session_id === "string") {
      sessionId = event.session_id;
    }
  }

  return {
    text: messages.join("\n").trim(),
    sessionId,
    events,
  };
}

export async function runKimi(options: KimiRunOptions): Promise<KimiRunResult> {
  const workDir = await validateWorkDir(options.workDir);
  const args = ["-p", options.prompt, "--output-format", "stream-json"];
  if (options.sessionId) args.push("-S", options.sessionId);

  return await new Promise<KimiRunResult>((resolve, reject) => {
    const child = spawn(kimiCommand(), args, {
      cwd: workDir,
      env: process.env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeoutMs = options.timeoutMs ?? 600_000;

    const finishError = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", (error) => finishError(error));
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Kimi exited with code ${code}`));
        return;
      }
      const parsed = parseKimiJsonLines(stdout);
      resolve({ ...parsed, stderr });
    });

    const timer = setTimeout(() => {
      child.kill();
      finishError(new Error(`Kimi timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
}

export async function getKimiVersion(): Promise<{ command: string; version: string }> {
  return await new Promise((resolve, reject) => {
    const command = kimiCommand();
    const child = spawn(command, ["--version"], {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ command, version: stdout.trim() || stderr.trim() });
      else reject(new Error(stderr.trim() || `Kimi exited with code ${code}`));
    });
  });
}
