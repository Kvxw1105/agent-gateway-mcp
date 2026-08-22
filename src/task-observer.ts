import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export interface ObserverRequest {
  taskId: string;
  logPath: string;
  statusPath: string;
  scriptPath?: string;
}

export function buildObserverInvocation(request: ObserverRequest): { command: string; args: string[] } {
  const scriptPath = request.scriptPath ?? fileURLToPath(new URL(
    "../../integrations/skills/agent-gateway-orchestrator/scripts/show-agent-terminals.ps1",
    import.meta.url,
  ));
  return {
    command: "powershell.exe",
    args: [
      "-NoLogo", "-NoProfile", "-NoExit", "-ExecutionPolicy", "Bypass",
      "-File", scriptPath,
      "-TaskId", request.taskId,
      "-LogPath", request.logPath,
      "-StatusPath", request.statusPath,
    ],
  };
}

export function launchTaskObserver(request: ObserverRequest): number | undefined {
  if (process.platform !== "win32") throw new Error("visible task observers are currently supported on Windows only");
  const invocation = buildObserverInvocation(request);
  const child = spawn(invocation.command, invocation.args, {
    detached: true,
    windowsHide: false,
    stdio: "ignore",
  });
  child.unref();
  return child.pid;
}
