import { NextResponse } from "next/server";
import {
  deleteAgentProfile,
  normalizeAgentProfileRef,
  loadAgentProfiles,
  setDefaultAgentProfile,
  upsertAgentProfile,
  validateAgentProfilesCwd,
  type AgentProfileScope,
  type AgentProfilesMutationRequest,
} from "@/lib/agent-profiles";

export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const statusCode = typeof error === "object" && error !== null && "statusCode" in error
    ? Number((error as { statusCode?: unknown }).statusCode)
    : 500;
  return NextResponse.json({ error: message }, { status: Number.isFinite(statusCode) ? statusCode : 500 });
}

function readScope(scope: unknown): AgentProfileScope {
  if (scope !== "global" && scope !== "project") throw Object.assign(new Error("scope must be global or project"), { statusCode: 400 });
  return scope;
}

async function readJsonObject(req: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw Object.assign(new Error("Invalid JSON body."), { statusCode: 400 });
  }
  if (!isRecord(body)) throw Object.assign(new Error("Request body must be an object."), { statusCode: 400 });
  return body;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const cwd = url.searchParams.get("cwd");
    if (!cwd) return NextResponse.json({ error: "cwd is required" }, { status: 400 });
    const safeCwd = await validateAgentProfilesCwd(cwd);
    return NextResponse.json(loadAgentProfiles(safeCwd));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(req: Request) {
  try {
    const body = await readJsonObject(req) as unknown as AgentProfilesMutationRequest;
    if (typeof body.cwd !== "string" || !body.cwd.trim()) {
      return NextResponse.json({ error: "cwd is required" }, { status: 400 });
    }
    const safeCwd = await validateAgentProfilesCwd(body.cwd);
    const scope = readScope(body.scope);

    if (body.action === "upsert") {
      if (!body.profile) return NextResponse.json({ error: "profile is required" }, { status: 400 });
      return NextResponse.json(upsertAgentProfile(safeCwd, scope, body.profile));
    }
    if (body.action === "delete") {
      if (typeof body.id !== "string" || !body.id.trim()) {
        return NextResponse.json({ error: "id is required" }, { status: 400 });
      }
      return NextResponse.json(deleteAgentProfile(safeCwd, scope, body.id));
    }
    if (body.action === "set-default") {
      const ref = normalizeAgentProfileRef(body.ref);
      if (!ref) {
        return NextResponse.json({ error: "ref must be a valid profile reference" }, { status: 400 });
      }
      return NextResponse.json(setDefaultAgentProfile(safeCwd, scope, ref));
    }
    if (body.action === "clear-default") {
      return NextResponse.json(setDefaultAgentProfile(safeCwd, scope, null));
    }

    return NextResponse.json({ error: "action must be upsert, delete, set-default, or clear-default" }, { status: 400 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(req: Request) {
  return POST(req);
}

export async function DELETE(req: Request) {
  try {
    const url = new URL(req.url);
    const cwd = url.searchParams.get("cwd");
    const scopeParam = url.searchParams.get("scope");
    const id = url.searchParams.get("id");
    if (!cwd) return NextResponse.json({ error: "cwd is required" }, { status: 400 });
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
    const safeCwd = await validateAgentProfilesCwd(cwd);
    const scope = readScope(scopeParam);
    return NextResponse.json(deleteAgentProfile(safeCwd, scope, id));
  } catch (error) {
    return errorResponse(error);
  }
}
