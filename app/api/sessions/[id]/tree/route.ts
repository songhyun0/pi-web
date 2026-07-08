import { NextResponse } from "next/server";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { resolveSessionPath } from "@/lib/session-reader";

async function openSession(id: string) {
  const filePath = await resolveSessionPath(id);
  if (!filePath) return null;
  return SessionManager.open(filePath);
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const sm = await openSession(id);
    if (!sm) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    return NextResponse.json({
      sessionId: id,
      leafId: sm.getLeafId(),
      tree: sm.getTree(),
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await req.json().catch(() => ({})) as { targetId?: unknown; label?: unknown };
    const targetId = typeof body.targetId === "string" ? body.targetId.trim() : "";
    if (!targetId) {
      return NextResponse.json({ error: "targetId is required" }, { status: 400 });
    }
    if (body.label !== undefined && body.label !== null && typeof body.label !== "string") {
      return NextResponse.json({ error: "label must be a string, null, or undefined" }, { status: 400 });
    }
    const normalizedLabel = typeof body.label === "string" && body.label.trim() ? body.label.trim() : undefined;

    const sm = await openSession(id);
    if (!sm) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    const labelEntryId = sm.appendLabelChange(targetId, normalizedLabel);
    return NextResponse.json({
      sessionId: id,
      leafId: sm.getLeafId(),
      labelEntryId,
      targetId,
      label: normalizedLabel,
      tree: sm.getTree(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
