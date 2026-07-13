import { SessionManager } from "@earendil-works/pi-coding-agent";
import { NextResponse } from "next/server";
import { withSessionProfileMutationLock } from "@/lib/existing-session-profile-application";
import { getPiCodexFastModeState, loadPiCodexFastModeConfig } from "@/lib/pi-codex-fast";
import { getRpcSession } from "@/lib/rpc-manager";
import { buildSessionContext, resolveSessionPath } from "@/lib/session-reader";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    return await withSessionProfileMutationLock(id, async () => {
      const rpc = getRpcSession(id);
      if (rpc?.isAlive()) {
        const state = await rpc.send({ type: "get_state" });
        return NextResponse.json({ running: true, state });
      }

      const sm = SessionManager.open(filePath);
      const context = buildSessionContext(sm.getEntries() as never, sm.getLeafId(), {
        deferThinking: true,
        deferToolResultImages: true,
      });
      return NextResponse.json({
        running: false,
        state: {
          extensionStatuses: [],
          extensionWidgets: [],
          queuedMessages: { steering: [], followUp: [] },
          openAIFastMode: getPiCodexFastModeState(context.model),
          openAIFastConfig: loadPiCodexFastModeConfig(),
        },
      });
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
