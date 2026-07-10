// Client-side helper for POST /api/agent/[id].

import type { ProfileDiagnostic } from "./session-profile-store";

export class AgentCommandError extends Error {
  status: number;
  diagnostics: ProfileDiagnostic[];

  constructor(message: string, status: number, diagnostics: ProfileDiagnostic[] = []) {
    super(message);
    this.name = "AgentCommandError";
    this.status = status;
    this.diagnostics = diagnostics;
  }
}

export async function sendAgentCommand<T = unknown>(
  sessionId: string,
  command: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`/api/agent/${encodeURIComponent(sessionId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  const body = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    data?: T;
    error?: string;
    diagnostics?: ProfileDiagnostic[];
  };
  if (!res.ok || body.error) {
    throw new AgentCommandError(body.error ?? `HTTP ${res.status}`, res.status, body.diagnostics ?? []);
  }
  return body.data as T;
}
