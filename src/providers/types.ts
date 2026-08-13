export type ProviderId = "zcode" | "kimi" | "claude" | "codex" | "pi";
export type PermissionMode = "read-only" | "workspace-write";
export type StructuredTransport = "json" | "stream-json" | "jsonl";

export interface ProviderInfo {
  id: ProviderId;
  displayName: string;
  command: string;
  transport: StructuredTransport;
  supportsResume: boolean;
  permissionBoundary: "hard" | "mixed";
  defaultModel?: string;
}

export interface ProviderRequest {
  prompt: string;
  workDir: string;
  permission: PermissionMode;
  sessionId?: string;
  model?: string;
}

export interface ProviderInvocation {
  command: string;
  args: string[];
  cwd: string;
  unsetEnv?: string[];
  userEnvKeys?: string[];
}
