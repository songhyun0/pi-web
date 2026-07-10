import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import type { SessionProfileSnapshotLookup } from "./session-profile-store";

export async function canonicalizeExistingPath(value: string, label: string): Promise<string> {
  try {
    return await realpath(resolve(value));
  } catch (error) {
    throw new Error(`${label} must resolve to an existing path: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function assertSessionProfileBinding(options: {
  sessionId: string;
  sessionFilePath: string;
  cwd: string;
  lookup: SessionProfileSnapshotLookup;
}): Promise<{ sessionFilePath: string; cwd: string }> {
  const sessionFilePath = await canonicalizeExistingPath(options.sessionFilePath, "Session file");
  const cwd = await canonicalizeExistingPath(options.cwd, "Session cwd");
  if (options.lookup.state === "legacy") return { sessionFilePath, cwd };

  const { record, snapshot } = options.lookup;
  if (record.sessionId !== options.sessionId) throw new Error("Session profile record id does not match the requested session.");
  if (!record.sessionFilePath) throw new Error("Profile-backed session record is missing its session file path.");
  const recordPath = await canonicalizeExistingPath(record.sessionFilePath, "Recorded session file");
  if (recordPath !== sessionFilePath) throw new Error("Session profile record path does not match the resolved session file.");
  const snapshotCwd = await canonicalizeExistingPath(snapshot.cwd, "Snapshot cwd");
  if (snapshotCwd !== cwd) throw new Error("Session profile snapshot cwd does not match the session header cwd.");
  if (record.cwd) {
    const recordCwd = await canonicalizeExistingPath(record.cwd, "Recorded session cwd");
    if (recordCwd !== cwd) throw new Error("Session profile record cwd does not match the session header cwd.");
  }
  return { sessionFilePath, cwd };
}
