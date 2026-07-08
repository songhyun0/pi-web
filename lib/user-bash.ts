export interface ParsedUserBashCommand {
  command: string;
  excludeFromContext: boolean;
  prefix: "!" | "!!";
}

export function parseUserBashCommand(input: string): ParsedUserBashCommand | null {
  if (!input.startsWith("!")) return null;
  if (input.startsWith("!!!")) return null;
  const excludeFromContext = input.startsWith("!!");
  const prefix = excludeFromContext ? "!!" : "!";
  const command = input.slice(prefix.length).trim();
  if (!command) return { command: "", excludeFromContext, prefix };
  return { command, excludeFromContext, prefix };
}

export function formatBashDuration(durationMs?: number): string | null {
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs < 0) return null;
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(durationMs < 10_000 ? 1 : 0)}s`;
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.round((durationMs % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}
