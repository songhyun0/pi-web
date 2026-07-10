import { NextResponse } from "next/server";
import { resolveSessionPath } from "@/lib/session-reader";
import { startRpcSession, getRpcSession } from "@/lib/rpc-manager";
import { withSessionProfileMutationLock } from "@/lib/existing-session-profile-application";
import { getSessionProfileSnapshot } from "@/lib/session-profile-store";
import { assertSessionProfileBinding } from "@/lib/session-profile-binding";
import { SessionManager } from "@earendil-works/pi-coding-agent";

// POST /api/agent/[id] - Send a command to an existing session
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const body = await req.json() as { type: string; [key: string]: unknown };

    const result = await withSessionProfileMutationLock(id, async () => {

      const filePath = await resolveSessionPath(id);
      if (!filePath) {
        return { __notFound: true };
      }

      const header = SessionManager.open(filePath).getHeader();
      if (header?.id && header.id !== id) throw new Error("Session header id does not match the requested session.");
      const cwd = header?.cwd ?? process.cwd();
      const profileLookup = await getSessionProfileSnapshot(id);
      const binding = await assertSessionProfileBinding({ sessionId: id, sessionFilePath: filePath, cwd, lookup: profileLookup });
      const runtimeOptions = profileLookup.state === "snapshot"
        ? { profileSnapshot: profileLookup.snapshot }
        : undefined;

      const { session } = await startRpcSession(id, binding.sessionFilePath, binding.cwd, undefined, runtimeOptions);
      return session.send(body);
    });

    if (result && typeof result === "object" && (result as { __notFound?: boolean }).__notFound) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    const status = typeof (error as { statusCode?: unknown }).statusCode === "number"
      ? (error as { statusCode: number }).statusCode
      : 500;
    const diagnostics = (error as { diagnostics?: unknown }).diagnostics;
    return NextResponse.json({
      error: error instanceof Error ? error.message : String(error),
      ...(diagnostics ? { diagnostics } : {}),
    }, { status });
  }
}

// GET /api/agent/[id] - Get current agent state
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const state = await withSessionProfileMutationLock(id, async () => {
      const session = getRpcSession(id);
      if (!session || !session.isAlive()) return { __notRunning: true };
      return session.send({ type: "get_state" });
    });
    if ((state as { __notRunning?: boolean }).__notRunning) {
      return NextResponse.json({ running: false });
    }
    return NextResponse.json({ running: true, state });
  } catch (error) {
    const status = typeof (error as { statusCode?: unknown }).statusCode === "number"
      ? (error as { statusCode: number }).statusCode
      : 500;
    const diagnostics = (error as { diagnostics?: unknown }).diagnostics;
    return NextResponse.json({
      error: error instanceof Error ? error.message : String(error),
      ...(diagnostics ? { diagnostics } : {}),
    }, { status });
  }
}
