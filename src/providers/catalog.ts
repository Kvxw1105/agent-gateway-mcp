import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ProviderId, ProviderInfo, ProviderInvocation, ProviderRequest } from "./types.js";

interface LaunchTarget {
  command: string;
  prefixArgs: string[];
}

const launchTargets: Record<ProviderId, LaunchTarget> = {
  zcode: npmPackageLaunch("zcode", "zcode-app-cli", ["bin", "zcode.js"]),
  kimi: executableLaunch("kimi", [path.join(os.homedir(), ".kimi-code", "bin", "kimi.exe")]),
  claude: packageExecutableLaunch("claude", "@anthropic-ai/claude-code", ["bin", "claude.exe"]),
  codex: npmPackageLaunch("codex", "@openai/codex", ["bin", "codex.js"]),
  pi: npmPackageLaunch("pi", "@earendil-works/pi-coding-agent", ["dist", "cli.js"]),
};

const piProvider = environment("AGENT_GATEWAY_PI_PROVIDER") ?? "opencode-go";
const piModel = environment("AGENT_GATEWAY_PI_MODEL") ?? `${piProvider}/deepseek-v4-flash`;
const codexModel = environment("AGENT_GATEWAY_CODEX_MODEL") ?? "gpt-5.5";

const providers: ProviderInfo[] = [
  provider("zcode", "ZCode", "json", "hard"),
  provider("kimi", "Kimi Code", "stream-json", "mixed"),
  provider("claude", "Claude Code", "stream-json", "hard"),
  provider("codex", "Codex CLI", "jsonl", "hard", codexModel),
  provider("pi", "Pi Coding Agent", "json", "hard", piModel),
];

export function listProviders(): ProviderInfo[] {
  return providers.map((item) => ({ ...item }));
}

export function getProvider(id: ProviderId): ProviderInfo {
  const result = providers.find((item) => item.id === id);
  if (!result) throw new Error(`Unsupported provider: ${id}`);
  return result;
}

export function buildProviderInvocation(id: ProviderId, request: ProviderRequest): ProviderInvocation {
  const target = launchTargets[id];
  const unsetEnv = id === "claude" && environment("AGENT_GATEWAY_CLAUDE_CLEAN_ENV") === "1"
    ? ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL"]
    : undefined;
  const piKey = environment("AGENT_GATEWAY_PI_API_KEY_ENV") ?? "OPENCODE_API_KEY";
  const userEnvKeys = id === "pi" && piKey ? [piKey] : undefined;
  return {
    command: target.command,
    args: [...target.prefixArgs, ...buildArgs(id, request)],
    cwd: request.workDir,
    unsetEnv,
    userEnvKeys,
  };
}

function provider(
  id: ProviderId,
  displayName: string,
  transport: ProviderInfo["transport"],
  permissionBoundary: ProviderInfo["permissionBoundary"],
  defaultModel?: string,
): ProviderInfo {
  return {
    id,
    displayName,
    command: launchTargets[id].command,
    transport,
    supportsResume: true,
    permissionBoundary,
    defaultModel,
  };
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
      const args = [...prefix, "--json", "--color", "never", "-m", request.model ?? codexModel, "-C", workDir, "-s", permission === "read-only" ? "read-only" : "workspace-write"];
      if (sessionId) args.push(sessionId);
      args.push(prompt);
      return args;
    }
    case "pi": {
      const tools = permission === "read-only" ? "read,grep,find,ls" : "read,bash,edit,write,grep,find,ls";
      const args = ["-p", "--mode", "json", "--provider", piProvider, "--model", request.model ?? piModel, "--tools", tools];
      if (sessionId) args.push("--session", sessionId);
      args.push(prompt);
      return args;
    }
  }
}

function executableLaunch(id: ProviderId, extraCandidates: string[] = []): LaunchTarget {
  const override = configuredLaunch(id);
  if (override) return override;
  const names = process.platform === "win32" ? [`${id}.exe`] : [id];
  const found = [...extraCandidates, ...pathCandidates(names)].find((candidate) => existsSync(candidate));
  return { command: found ?? id, prefixArgs: [] };
}

function npmPackageLaunch(id: ProviderId, packageName: string, scriptParts: string[]): LaunchTarget {
  const override = configuredLaunch(id);
  if (override) return override;
  for (const root of npmRoots()) {
    const script = path.join(root, "node_modules", ...packageName.split("/"), ...scriptParts);
    if (!existsSync(script)) continue;
    const localNode = path.join(root, process.platform === "win32" ? "node.exe" : "node");
    return { command: existsSync(localNode) ? localNode : process.execPath, prefixArgs: [script] };
  }
  return { command: id, prefixArgs: [] };
}

function packageExecutableLaunch(id: ProviderId, packageName: string, executableParts: string[]): LaunchTarget {
  const override = configuredLaunch(id);
  if (override) return override;
  for (const root of npmRoots()) {
    const executable = path.join(root, "node_modules", ...packageName.split("/"), ...executableParts);
    if (existsSync(executable)) return { command: executable, prefixArgs: [] };
  }
  return executableLaunch(id);
}

function configuredLaunch(id: ProviderId): LaunchTarget | undefined {
  const prefix = `AGENT_GATEWAY_${id.toUpperCase()}_`;
  const command = environment(`${prefix}COMMAND`);
  if (!command) return undefined;
  const rawArgs = environment(`${prefix}PREFIX_ARGS`);
  if (!rawArgs) return { command, prefixArgs: [] };
  const parsed: unknown = JSON.parse(rawArgs);
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
    throw new Error(`${prefix}PREFIX_ARGS must be a JSON string array`);
  }
  return { command, prefixArgs: parsed };
}

function npmRoots(): string[] {
  const roots = new Set<string>();
  for (const entry of (process.env.PATH ?? "").split(path.delimiter)) if (entry) roots.add(entry);
  roots.add(path.dirname(process.execPath));
  if (process.env.APPDATA) roots.add(path.join(process.env.APPDATA, "npm"));
  return [...roots];
}

function pathCandidates(names: string[]): string[] {
  return (process.env.PATH ?? "").split(path.delimiter).flatMap((root) => names.map((name) => path.join(root, name)));
}

function environment(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}
