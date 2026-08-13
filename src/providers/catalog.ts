import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ProviderId, ProviderInfo, ProviderInvocation, ProviderRequest } from "./types.js";

function firstExisting(candidates: string[], fallback: string): string {
  return candidates.find((candidate) => existsSync(candidate)) ?? fallback;
}

const zcodeRoot = "D:\\node\\node-v22.16.0-win-x64";
const claudeRoot = path.join(os.homedir(), "AppData", "Local", "Programs", "nodejs", "node-v22.19.0-win-x64");
const codexRoot = "D:\\node\\node-v22.16.0-win-x64";
const piScript = path.join(os.homedir(), "AppData", "Roaming", "npm", "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js");

const launchPrefixes: Partial<Record<ProviderId, string[]>> = {};

function windowsNodeLaunch(id: ProviderId, root: string, scriptParts: string[]): string {
  const node = path.join(root, "node.exe");
  const script = path.join(root, ...scriptParts);
  if (process.platform === "win32" && existsSync(node) && existsSync(script)) {
    launchPrefixes[id] = [script];
    return node;
  }
  return id;
}

const providers: ProviderInfo[] = [
  {
    id: "zcode",
    displayName: "ZCode",
    command: windowsNodeLaunch("zcode", zcodeRoot, ["node_modules", "zcode-app-cli", "bin", "zcode.js"]),
    transport: "json",
    supportsResume: true,
    permissionBoundary: "hard",
  },
  {
    id: "kimi",
    displayName: "Kimi Code",
    command: firstExisting([path.join(os.homedir(), ".kimi-code", "bin", "kimi.exe")], "kimi"),
    transport: "stream-json",
    supportsResume: true,
    permissionBoundary: "mixed",
  },
  {
    id: "claude",
    displayName: "Claude Code",
    command: firstExisting([path.join(claudeRoot, "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe")], "claude"),
    transport: "stream-json",
    supportsResume: true,
    permissionBoundary: "hard",
  },
  {
    id: "codex",
    displayName: "Codex CLI",
    command: windowsNodeLaunch("codex", codexRoot, ["node_modules", "@openai", "codex", "bin", "codex.js"]),
    transport: "jsonl",
    supportsResume: true,
    permissionBoundary: "hard",
    defaultModel: "gpt-5.5",
  },
  {
    id: "pi",
    displayName: "Pi Coding Agent",
    command: process.platform === "win32" && existsSync(piScript)
      ? (launchPrefixes.pi = [piScript], process.execPath)
      : "pi",
    transport: "json",
    supportsResume: true,
    permissionBoundary: "hard",
    defaultModel: "opencode-go/deepseek-v4-flash",
  },
];

export function listProviders(): ProviderInfo[] {
  return providers.map((provider) => ({ ...provider }));
}

export function getProvider(id: ProviderId): ProviderInfo {
  const provider = providers.find((item) => item.id === id);
  if (!provider) throw new Error(`Unsupported provider: ${id}`);
  return provider;
}

export function buildProviderInvocation(id: ProviderId, request: ProviderRequest): ProviderInvocation {
  const provider = getProvider(id);
  const args = [...(launchPrefixes[id] ?? []), ...buildArgs(id, request)];
  const unsetEnv = id === "claude"
    ? ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL"]
    : undefined;
  const userEnvKeys = id === "pi" ? ["OPENCODE_API_KEY"] : undefined;
  return { command: provider.command, args, cwd: request.workDir, unsetEnv, userEnvKeys };
}

function buildArgs(id: ProviderId, request: ProviderRequest): string[] {
  const { prompt, workDir, permission, sessionId } = request;
  switch (id) {
    case "zcode": {
      const args = ["--prompt", prompt, "--cwd", workDir, "--json", "--mode", permission === "read-only" ? "plan" : "edit"];
      if (request.model) args.push("--model", request.model);
      if (sessionId) args.push("--resume", sessionId);
      return args;
    }
    case "kimi": {
      const args = ["-p", prompt, "--output-format", "stream-json"];
      if (request.model) args.push("--model", request.model);
      if (sessionId) args.push("-S", sessionId);
      return args;
    }
    case "claude": {
      const args = ["-p", prompt, "--output-format", "stream-json", "--verbose", "--permission-mode", permission === "read-only" ? "plan" : "acceptEdits"];
      if (request.model) args.push("--model", request.model);
      if (sessionId) args.push("--resume", sessionId);
      return args;
    }
    case "codex": {
      const prefix = sessionId ? ["exec", "resume"] : ["exec"];
      const args = [...prefix, "--json", "--color", "never", "-m", request.model ?? "gpt-5.5", "-C", workDir, "-s", permission === "read-only" ? "read-only" : "workspace-write"];
      if (sessionId) args.push(sessionId);
      args.push(prompt);
      return args;
    }
    case "pi": {
      const tools = permission === "read-only" ? "read,grep,find,ls" : "read,bash,edit,write,grep,find,ls";
      const args = ["-p", "--mode", "json", "--provider", "opencode-go", "--model", request.model ?? "opencode-go/deepseek-v4-flash", "--tools", tools];
      if (sessionId) args.push("--session", sessionId);
      args.push(prompt);
      return args;
    }
  }
}
