import { resolveSessionPath } from "@/lib/session-reader";
import { getRpcSession, startRpcSession } from "@/lib/rpc-manager";
import { withSessionProfileMutationLock } from "@/lib/existing-session-profile-application";
import { getSessionProfileSnapshot } from "@/lib/session-profile-store";
import { assertSessionProfileBinding } from "@/lib/session-profile-binding";
import { SessionManager } from "@earendil-works/pi-coding-agent";

export const dynamic = "force-dynamic";

// GET /api/agent/[id]/events - SSE stream of agent events
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let session: ReturnType<typeof getRpcSession> | null | undefined;
  try {
    session = await withSessionProfileMutationLock(id, async () => {

      const filePath = await resolveSessionPath(id);
      if (!filePath) return null;
      const header = SessionManager.open(filePath).getHeader();
      if (header?.id && header.id !== id) throw new Error("Session header id does not match the requested session.");
      const cwd = header?.cwd ?? process.cwd();
      const profileLookup = await getSessionProfileSnapshot(id);
      const binding = await assertSessionProfileBinding({ sessionId: id, sessionFilePath: filePath, cwd, lookup: profileLookup });
      const runtimeOptions = profileLookup.state === "snapshot"
        ? { profileSnapshot: profileLookup.snapshot }
        : undefined;
      return (await startRpcSession(id, binding.sessionFilePath, binding.cwd, undefined, runtimeOptions)).session;
    });
  } catch (error) {
    const status = typeof (error as { statusCode?: unknown }).statusCode === "number"
      ? (error as { statusCode: number }).statusCode
      : 500;
    return new Response(`Failed to start agent: ${error instanceof Error ? error.message : String(error)}`, { status });
  }
  if (!session) {
    return new Response("Session not found", { status: 404 });
  }

  const stream = new ReadableStream({
    start(controller) {
      const encode = (data: unknown) => {
        const text = `data: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(new TextEncoder().encode(text));
      };

      // Send initial connected event
      encode({ type: "connected", sessionId: id });

      let cleanup = () => undefined;
      const unsubscribe = session.onEvent((event) => {
        encode(event);
        if (event.type === "runtime_closed") cleanup();
      });

      // Heartbeat every 30s to prevent server/proxy timeout (Next.js default ~120-150s)
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(new TextEncoder().encode(":\n\n"));
        } catch {
          // controller already closed
        }
      }, 30_000);

      // Cleanup when client disconnects
      cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
        try { controller.close(); } catch { /* already closed */ }
      };

      // Detect client disconnect via abort signal
      req.signal?.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
