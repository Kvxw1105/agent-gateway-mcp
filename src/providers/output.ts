import type { ProviderId } from "./types.js";

export interface ProviderOutput {
  sessionId?: string;
  response?: string;
}

export function parseProviderOutput(provider: ProviderId, raw: string): ProviderOutput {
  if (provider === "zcode") return parseZcode(raw);
  const events = parseJsonLines(raw);
  switch (provider) {
    case "kimi":
      return {
        sessionId: lastString(events, "session_id", (event) => event.type === "session.resume_hint"),
        response: assistantText(events),
      };
    case "claude": {
      const result = [...events].reverse().find((event) => event.type === "result");
      return { sessionId: stringValue(result?.session_id), response: stringValue(result?.result) };
    }
    case "codex": {
      const thread = events.find((event) => event.type === "thread.started");
      const messages = events
        .filter((event) => event.type === "item.completed")
        .map((event) => objectValue(event.item))
        .filter((item) => item?.type === "agent_message")
        .map((item) => stringValue(item?.text))
        .filter((value): value is string => value !== undefined);
      return { sessionId: stringValue(thread?.thread_id), response: messages.at(-1) };
    }
    case "pi": {
      const session = events.find((event) => event.type === "session");
      return { sessionId: stringValue(session?.id), response: assistantText(events) };
    }
  }
}

function parseZcode(raw: string): ProviderOutput {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    return { sessionId: stringValue(value.sessionId), response: stringValue(value.response) };
  } catch {
    return {};
  }
}

function parseJsonLines(raw: string): Record<string, unknown>[] {
  const events: Record<string, unknown>[] = [];
  for (const line of raw.split(/\r?\n/u)) {
    if (!line.trim()) continue;
    try { events.push(JSON.parse(line) as Record<string, unknown>); } catch { /* stderr may be plain text */ }
  }
  return events;
}

function assistantText(events: Record<string, unknown>[]): string | undefined {
  const messages: string[] = [];
  for (const event of events) {
    if (event.role === "assistant") appendContent(messages, event.content);
    const message = objectValue(event.message);
    if (message?.role === "assistant") appendContent(messages, message.content);
  }
  return messages.length ? messages.join("\n") : undefined;
}

function appendContent(messages: string[], content: unknown): void {
  if (typeof content === "string") messages.push(content);
  if (!Array.isArray(content)) return;
  for (const part of content) {
    const item = objectValue(part);
    const value = stringValue(item?.text);
    if (value) messages.push(value);
  }
}

function lastString(
  events: Record<string, unknown>[],
  key: string,
  predicate: (event: Record<string, unknown>) => boolean,
): string | undefined {
  return stringValue([...events].reverse().find(predicate)?.[key]);
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
