import { NextResponse } from "next/server";
import { existsSync } from "fs";
import { allowFileRoot } from "@/lib/file-access";
import { createProfileBackedNewSessionRuntime } from "@/lib/new-session-profile-application";

// POST /api/agent/new  body: { cwd: string; type: string; message?: string; ... }
// Spawns a brand-new pi session. Most calls immediately send the first command;
// type:"ensure_session" only creates the runtime so clients can query commands.
// Returns { sessionId, data } where sessionId is pi's real session id.
export async function POST(req: Request) {
  let recovery: { sessionId: string; profileSnapshot: unknown } | null = null;
  try {
    const body = await req.json() as { cwd?: string; [key: string]: unknown };
    const { cwd, ...command } = body;

    if (!cwd || typeof cwd !== "string") {
      return NextResponse.json({ error: "cwd is required" }, { status: 400 });
    }
    if (!existsSync(cwd)) {
      return NextResponse.json({ error: `Directory does not exist: ${cwd}` }, { status: 400 });
    }

    // Profile-backed new sessions always resolve their tool surface server-side.
    const { provider, modelId, toolNames: _toolNames, thinkingLevel, profileRef, ...promptCommand } = command as { provider?: string; modelId?: string; toolNames?: string[]; thinkingLevel?: string; profileRef?: unknown; [key: string]: unknown };
    // profile-backed new sessions derive tools from the immutable server-side profile snapshot.
    // Keep accepting legacy client toolNames for wire compatibility, but never trust them
    // when creating a profiled runtime.
    void _toolNames;

    const { session, realSessionId, profileSnapshot } = await createProfileBackedNewSessionRuntime({ cwd, profileRef });
    recovery = { sessionId: realSessionId, profileSnapshot };

    // Keep the files-route allowed-roots cache (see app/api/files/[...path]/route.ts)
    // in sync so the new cwd is immediately readable via /api/files. Without this,
    // a file request under a brand-new cwd would 403 for up to the cache TTL.
    allowFileRoot(profileSnapshot.cwd);

    // Apply pre-selected model after the profile snapshot has been persisted and
    // the runtime has been registered. Errors after this point behave like normal
    // command failures and do not roll back the exposed session/snapshot.
    if (provider && modelId) {
      await session.send({ type: "set_model", provider, modelId });
    }

    // Apply pre-selected thinking level before sending the prompt.
    if (thinkingLevel) {
      await session.send({ type: "set_thinking_level", level: thinkingLevel });
    }

    if (promptCommand.type === "ensure_session") {
      return NextResponse.json({ success: true, sessionId: realSessionId, profileSnapshot, data: null });
    }

    const result = await session.send(promptCommand);

    return NextResponse.json({ success: true, sessionId: realSessionId, profileSnapshot, data: result });
  } catch (error) {
    const status = typeof (error as { statusCode?: unknown }).statusCode === "number"
      ? (error as { statusCode: number }).statusCode
      : 500;
    const diagnostics = (error as { diagnostics?: unknown }).diagnostics;
    return NextResponse.json({
      error: error instanceof Error ? error.message : String(error),
      ...(diagnostics ? { diagnostics } : {}),
      ...(recovery ? { ...recovery, exposed: true } : {}),
    }, { status });
  }
}
