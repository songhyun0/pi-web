import { existsSync, readFileSync } from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { buildWebKeybindings, type WebKeybindingConfig } from "@/lib/web-keybindings";

export const dynamic = "force-dynamic";

function readKeybindingConfig(filePath: string): WebKeybindingConfig | null {
  if (!existsSync(filePath)) return null;
  const parsed = JSON.parse(readFileSync(filePath, "utf8"));
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as WebKeybindingConfig
    : null;
}

export async function GET() {
  try {
    const filePath = path.join(getAgentDir(), "keybindings.json");
    const config = readKeybindingConfig(filePath);
    return NextResponse.json({
      path: filePath,
      keybindings: buildWebKeybindings(config),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
