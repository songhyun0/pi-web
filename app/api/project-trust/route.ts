import { NextResponse } from "next/server";
import {
  getProjectTrustStatus,
  saveProjectTrustDecision,
  validateProjectTrustCwd,
  type ProjectTrustAction,
} from "@/lib/project-trust";

export const dynamic = "force-dynamic";

const PROJECT_TRUST_ACTIONS = new Set<ProjectTrustAction>(["trust", "trust-parent", "deny", "clear"]);

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
    const safeCwd = await validateProjectTrustCwd(cwd);
    return NextResponse.json(getProjectTrustStatus(safeCwd));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as { cwd?: unknown; action?: unknown };
    if (typeof body.cwd !== "string" || !body.cwd.trim()) {
      return NextResponse.json({ error: "cwd is required" }, { status: 400 });
    }
    if (typeof body.action !== "string" || !PROJECT_TRUST_ACTIONS.has(body.action as ProjectTrustAction)) {
      return NextResponse.json({ error: "action must be one of trust, trust-parent, deny, clear" }, { status: 400 });
    }
    const safeCwd = await validateProjectTrustCwd(body.cwd);
    const status = saveProjectTrustDecision(safeCwd, body.action as ProjectTrustAction);
    return NextResponse.json(status);
  } catch (error) {
    return errorResponse(error);
  }
}
