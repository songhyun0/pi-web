import { NextResponse } from "next/server";
import { type AppSettings, normalizeAppDisplayName } from "@/lib/app-settings";
import { readAppSettings, writeAppSettings } from "@/lib/app-settings-store";

export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function GET() {
  return NextResponse.json(readAppSettings());
}

export async function PATCH(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!isRecord(body)) {
    return NextResponse.json({ error: "Request body must be an object." }, { status: 400 });
  }

  let next: AppSettings = readAppSettings();
  try {
    if ("displayName" in body) {
      next = { ...next, displayName: normalizeAppDisplayName(body.displayName) };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    writeAppSettings(next);
    return NextResponse.json(next);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
