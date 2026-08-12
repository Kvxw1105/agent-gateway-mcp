import { readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface KimiSession {
  sessionId: string;
  sessionDir: string;
  workDir: string;
  updatedAt?: string;
}

function indexPath(): string {
  return process.env.KIMI_SESSION_INDEX?.trim()
    || path.join(os.homedir(), ".kimi-code", "session_index.jsonl");
}

export async function listKimiSessions(workDir?: string, limit = 20): Promise<KimiSession[]> {
  const content = await readFile(indexPath(), "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  const normalizedFilter = workDir ? path.resolve(workDir).toLowerCase() : undefined;
  const sessions: KimiSession[] = [];

  for (const line of content.split(/\r?\n/u)) {
    if (!line.trim()) continue;
    try {
      const item = JSON.parse(line) as Omit<KimiSession, "updatedAt">;
      if (!item.sessionId || !item.sessionDir || !item.workDir) continue;
      if (normalizedFilter && path.resolve(item.workDir).toLowerCase() !== normalizedFilter) continue;
      const info = await stat(item.sessionDir).catch(() => undefined);
      sessions.push({ ...item, updatedAt: info?.mtime.toISOString() });
    } catch {
      // Ignore malformed or partially written index lines.
    }
  }

  return sessions
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))
    .slice(0, Math.max(1, Math.min(limit, 100)));
}
