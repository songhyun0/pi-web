import { NextResponse } from "next/server";
import {
  loadRuntimeSettings,
  patchRuntimeSettings,
  validateRuntimeSettingsCwd,
  type RuntimeSettingsScope,
} from "@/lib/runtime-settings";

export const dynamic = "force-dynamic";

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const statusCode = typeof error === "object" && error !== null && "statusCode" in error
    ? Number((error as { statusCode?: unknown }).statusCode)
    : 500;
  return NextResponse.json({ error: message }, { status: Number.isFinite(statusCode) ? statusCode : 500 });
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const cwd = url.searchParams.get("cwd");
    if (!cwd) return NextResponse.json({ error: "cwd is required" }, { status: 400 });
    const safeCwd = await validateRuntimeSettingsCwd(cwd);
    return NextResponse.json(loadRuntimeSettings(safeCwd));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json() as { cwd?: unknown; scope?: unknown; updates?: unknown };
    if (typeof body.cwd !== "string" || !body.cwd.trim()) {
      return NextResponse.json({ error: "cwd is required" }, { status: 400 });
    }
    if (body.scope !== "global" && body.scope !== "project") {
      return NextResponse.json({ error: "scope must be global or project" }, { status: 400 });
    }
    if (!body.updates || typeof body.updates !== "object" || Array.isArray(body.updates)) {
      return NextResponse.json({ error: "updates must be an object" }, { status: 400 });
    }
    const safeCwd = await validateRuntimeSettingsCwd(body.cwd);
    const result = patchRuntimeSettings(
      safeCwd,
      body.scope as RuntimeSettingsScope,
      body.updates as Record<string, unknown>,
    );
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
