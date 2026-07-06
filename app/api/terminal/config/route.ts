import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import path from "path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

interface GhosttyTerminalConfig {
  fontFamilies: string[];
  fontSize: number | null;
  configPath: string | null;
  wsUrl: string;
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function terminalWsUrl(req: Request): string {
  const url = new URL(req.url);
  const protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const wsPort = process.env.TERMINAL_WS_PORT || "30142";
  const host = url.hostname.includes(":") ? `[${url.hostname}]` : url.hostname;
  return `${protocol}//${host}:${wsPort}/api/terminal/ws`;
}

function parseGhosttyConfig(filePath: string, wsUrl: string): GhosttyTerminalConfig | null {
  if (!existsSync(filePath)) return null;
  const fontFamilies: string[] = [];
  let fontSize: number | null = null;

  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^([A-Za-z0-9_.-]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;

    const key = match[1];
    const value = stripQuotes(match[2]);
    if (key === "font-family" && value) {
      fontFamilies.push(value);
    } else if (key === "font-size" && value) {
      const parsed = Number.parseFloat(value);
      if (Number.isFinite(parsed) && parsed > 0) fontSize = parsed;
    }
  }

  if (fontFamilies.length === 0 && fontSize === null) return null;
  return { fontFamilies, fontSize, configPath: filePath, wsUrl };
}

function configCandidates(): string[] {
  const home = homedir();
  const candidates = [
    path.join(process.env.XDG_CONFIG_HOME || path.join(home, ".config"), "ghostty", "config"),
  ];

  if (process.platform === "darwin") {
    candidates.push(path.join(home, "Library", "Application Support", "com.mitchellh.ghostty", "config"));
  }

  return [...new Set(candidates)];
}

export async function GET(req: Request) {
  const wsUrl = terminalWsUrl(req);
  for (const candidate of configCandidates()) {
    const parsed = parseGhosttyConfig(candidate, wsUrl);
    if (parsed) return NextResponse.json(parsed);
  }

  return NextResponse.json({
    fontFamilies: ["MesloLGS NF", "D2CodingLigature Nerd Font Mono"],
    fontSize: 16,
    configPath: null,
    wsUrl,
  } satisfies GhosttyTerminalConfig);
}
