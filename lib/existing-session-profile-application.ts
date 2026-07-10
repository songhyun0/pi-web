import { randomUUID } from "node:crypto";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { assertProfileRef, type ProfileRef } from "./profiles";
import type { ProfileStoreOptions } from "./profile-store";
import { resolveProfilePreview } from "./profile-preview";
import {
  NewSessionProfileError,
  buildCapabilitySnapshotFromPreview,
  type NewSessionRuntime,
} from "./new-session-profile-application";
import {
  applyProfileToolPolicy,
  validateProfileRuntimeAgainstSnapshot,
} from "./profile-runtime";
import {
  createUnregisteredRpcSessionFromFile,
  getRpcSession,
  replaceRpcSession,
  unregisterRpcSession,
  type AgentSessionWrapper,
} from "./rpc-manager";
import {
  getSessionProfileResponse,
  getSessionProfileSnapshot,
  restoreSessionProfileSnapshot,
  setSessionProfileSnapshot,
  type CapabilitySnapshotV1,
  type ProfileDiagnostic,
  type SessionProfileResponse,
  type SessionProfileStoreOptions,
  type SessionSnapshotWriteToken,
  type SessionProfileRecordV1,
} from "./session-profile-store";

declare global {
  var __piSessionProfileMutationLocks: Map<string, Promise<void>> | undefined;
}

function getMutationLocks(): Map<string, Promise<void>> {
  if (!globalThis.__piSessionProfileMutationLocks) globalThis.__piSessionProfileMutationLocks = new Map();
  return globalThis.__piSessionProfileMutationLocks;
}

export async function withSessionProfileMutationLock<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
  const locks = getMutationLocks();
  const previous = locks.get(sessionId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  const normalized = current.then(() => undefined, () => undefined);
  locks.set(sessionId, normalized);
  try {
    return await current;
  } finally {
    if (locks.get(sessionId) === normalized) locks.delete(sessionId);
  }
}

export interface ExistingSessionProfileSwitchBody {
  profileRef?: unknown;
}

export type ExistingSessionProfileApiResult = {
  status: number;
  body: Record<string, unknown> | SessionProfileResponse;
};

export interface ExistingSessionProfileSwitchDependencies {
  resolveSessionPath: (sessionId: string) => Promise<string | null>;
  profileStoreOptions?: ProfileStoreOptions;
  sessionProfileStoreOptions?: SessionProfileStoreOptions;
  agentDir?: string;
  getRpcSession?: typeof getRpcSession;
  readSessionCwd?: (sessionFilePath: string) => string;
  resolveProfilePreview?: typeof resolveProfilePreview;
  createUnregisteredRpcSessionFromFile?: (
    sessionFile: string,
    cwd: string,
    toolNames?: string[],
    runtimeOptions?: { agentDir?: string; profileSnapshot?: CapabilitySnapshotV1; isolateSessionFile?: boolean },
  ) => Promise<{ session: NewSessionRuntime; realSessionId: string }>;
  replaceRpcSession?: (sessionId: string, session: NewSessionRuntime) => AgentSessionWrapper | NewSessionRuntime | undefined;
  unregisterRpcSession?: (sessionId: string, session?: NewSessionRuntime) => void;
  getSessionProfileSnapshot?: typeof getSessionProfileSnapshot;
  getSessionProfileResponse?: typeof getSessionProfileResponse;
  setSessionProfileSnapshot?: typeof setSessionProfileSnapshot;
  restoreSessionProfileSnapshot?: typeof restoreSessionProfileSnapshot;
  now?: () => string;
  makeSnapshotId?: () => string;
}

function defaultReadSessionCwd(sessionFilePath: string): string {
  return SessionManager.open(sessionFilePath).getHeader()?.cwd ?? process.cwd();
}

function defaultDependencies(): Required<Omit<ExistingSessionProfileSwitchDependencies,
  "profileStoreOptions" | "sessionProfileStoreOptions" | "agentDir">> {
  return {
    resolveSessionPath: async () => null,
    getRpcSession,
    readSessionCwd: defaultReadSessionCwd,
    resolveProfilePreview,
    createUnregisteredRpcSessionFromFile: (sessionFile, cwd, toolNames, runtimeOptions) =>
      createUnregisteredRpcSessionFromFile(sessionFile, cwd, toolNames, runtimeOptions),
    replaceRpcSession: (sessionId, session) => replaceRpcSession(sessionId, session as AgentSessionWrapper),
    unregisterRpcSession: (sessionId, session) => unregisterRpcSession(sessionId, session as AgentSessionWrapper | undefined),
    getSessionProfileSnapshot,
    getSessionProfileResponse,
    setSessionProfileSnapshot,
    restoreSessionProfileSnapshot,
    now: () => new Date().toISOString(),
    makeSnapshotId: randomUUID,
  };
}

const RUNNING_SWITCH_MESSAGE = "Wait for the current response to finish before switching profiles.";

function runningConflict(): ExistingSessionProfileApiResult {
  return {
    status: 409,
    body: { error: RUNNING_SWITCH_MESSAGE },
  };
}

function throwRunningConflict(): never {
  throw new NewSessionProfileError(RUNNING_SWITCH_MESSAGE, 409);
}

function snapshotResponse(record: SessionProfileRecordV1): SessionProfileResponse {
  return {
    state: "snapshot",
    snapshot: record.snapshot,
    record: {
      sessionId: record.sessionId,
      ...(record.sessionFilePath ? { sessionFilePath: record.sessionFilePath } : {}),
      updatedAt: record.updatedAt,
      recordRevision: record.recordRevision,
    },
  };
}

function normalizeProfileRef(value: unknown): ProfileRef {
  assertProfileRef(value, "profileRef");
  return value;
}

function hasRunningRuntime(sessionId: string, dependencies: ReturnType<typeof defaultDependencies>): boolean {
  const existing = dependencies.getRpcSession(sessionId);
  return Boolean(existing?.isAlive() && existing.isRunning());
}

async function buildSwitchSnapshot(options: {
  cwd: string;
  profileRef: ProfileRef;
  dependencies: ReturnType<typeof defaultDependencies>;
  profileStoreOptions?: ProfileStoreOptions;
  agentDir?: string;
}): Promise<CapabilitySnapshotV1> {
  // Resolve through the read-only preview resolver so switch snapshots are based on
  // the target profile definition at switch time, while future restores use this
  // immutable snapshot rather than re-resolving the profile.
  const preview = await options.dependencies.resolveProfilePreview(
    { cwd: options.cwd, profileRef: options.profileRef },
    { agentDir: options.agentDir, profileStoreOptions: options.profileStoreOptions },
  );
  const diagnostics: ProfileDiagnostic[] = [];
  return buildCapabilitySnapshotFromPreview({
    preview,
    profileRef: options.profileRef,
    cwd: preview.cwd,
    diagnostics,
    snapshotId: options.dependencies.makeSnapshotId(),
    createdAt: options.dependencies.now(),
  });
}

async function rollbackSnapshot(options: {
  sessionId: string;
  previousRecord: SessionProfileRecordV1 | null;
  writeToken: SessionSnapshotWriteToken;
  dependencies: ReturnType<typeof defaultDependencies>;
  sessionProfileStoreOptions?: SessionProfileStoreOptions;
}): Promise<void> {
  await options.dependencies.restoreSessionProfileSnapshot(
    options.sessionId,
    options.previousRecord,
    options.writeToken,
    options.sessionProfileStoreOptions,
  );
}

function destroyLiveRuntime(sessionId: string, dependencies: ReturnType<typeof defaultDependencies>): void {
  const live = dependencies.getRpcSession(sessionId);
  if (live?.isAlive()) {
    dependencies.unregisterRpcSession(sessionId, live as unknown as NewSessionRuntime);
  }
}

export async function switchExistingSessionProfileApiResult(
  sessionId: string,
  body: ExistingSessionProfileSwitchBody,
  dependencyOverrides: ExistingSessionProfileSwitchDependencies,
): Promise<ExistingSessionProfileApiResult> {
  let profileRef: ProfileRef;
  try {
    profileRef = normalizeProfileRef(body.profileRef);
  } catch (error) {
    return { status: 400, body: { error: error instanceof Error ? error.message : String(error) } };
  }

  const dependencies = { ...defaultDependencies(), ...dependencyOverrides };
  const { profileStoreOptions, sessionProfileStoreOptions, agentDir } = dependencyOverrides;
  // Preflight outside the mutation lock so switches requested during long-running
  // locked commands reject immediately instead of waiting and then applying after
  // the response finishes.
  if (hasRunningRuntime(sessionId, dependencies)) return runningConflict();

  return withSessionProfileMutationLock(sessionId, async () => {
    const sessionFilePath = await dependencies.resolveSessionPath(sessionId);
    if (!sessionFilePath) return { status: 404, body: { error: "Session not found" } };
    if (hasRunningRuntime(sessionId, dependencies)) return runningConflict();

    const cwd = dependencies.readSessionCwd(sessionFilePath);
    const snapshot = await buildSwitchSnapshot({ cwd, profileRef, dependencies, profileStoreOptions, agentDir });

    let candidate: { session: NewSessionRuntime; realSessionId: string } | undefined;
    let writeResult: { record: SessionProfileRecordV1; previousRecord: SessionProfileRecordV1 | null; writeToken: SessionSnapshotWriteToken } | undefined;
    let swapped = false;

    try {
      candidate = await dependencies.createUnregisteredRpcSessionFromFile(sessionFilePath, snapshot.cwd, undefined, {
        agentDir,
        profileSnapshot: snapshot,
        isolateSessionFile: true,
      });
      if (candidate.realSessionId !== sessionId) {
        throw new NewSessionProfileError(`Candidate runtime session id ${candidate.realSessionId} did not match requested session ${sessionId}.`, 500);
      }

      await candidate.session.bindExtensions({ forceEmptySystemPrompt: snapshot.tools.activeToolNames.length === 0 });
      const metadata = applyProfileToolPolicy(candidate.session.inner, snapshot);
      const validation = validateProfileRuntimeAgainstSnapshot(candidate.session.inner, snapshot, metadata);
      if (validation.diagnostics.length > 0) {
        throw new NewSessionProfileError(
          "Profile runtime capabilities do not match the immutable capability snapshot.",
          500,
          validation.diagnostics,
        );
      }

      if (hasRunningRuntime(sessionId, dependencies)) throwRunningConflict();
      const existingSnapshot = await dependencies.getSessionProfileSnapshot(sessionId, sessionProfileStoreOptions);
      writeResult = await dependencies.setSessionProfileSnapshot(
        sessionId,
        snapshot,
        { sessionFilePath, cwd: snapshot.cwd, updatedAt: dependencies.now() },
        existingSnapshot.writeToken,
        sessionProfileStoreOptions,
      );

      if (hasRunningRuntime(sessionId, dependencies)) throwRunningConflict();
      candidate.session.promoteIsolatedSessionFile?.();

      const previous = dependencies.replaceRpcSession(sessionId, candidate.session);
      swapped = true;
      if (previous && previous !== candidate.session) {
        if (typeof previous.shutdown === "function") await previous.shutdown("new", candidate.session.sessionFile);
        else previous.destroy();
      }
      return { status: 200, body: snapshotResponse(writeResult.record) };
    } catch (error) {
      if (!swapped && candidate) {
        if (writeResult) {
          try {
            await rollbackSnapshot({
              sessionId,
              previousRecord: writeResult.previousRecord,
              writeToken: writeResult.writeToken,
              dependencies,
              sessionProfileStoreOptions,
            });
          } catch (rollbackError) {
            destroyLiveRuntime(sessionId, dependencies);
            dependencies.unregisterRpcSession(sessionId, candidate.session);
            throw new NewSessionProfileError(
              `Profile switch failed and rollback failed; the live runtime was destroyed to avoid a saved/live capability mismatch: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
              500,
            );
          }
        }
        dependencies.unregisterRpcSession(sessionId, candidate.session);
        if (typeof candidate.session.shutdown === "function") await candidate.session.shutdown();
      }
      throw error;
    }
  });
}

export async function getSessionProfileApiResultSerialized(
  sessionId: string,
  dependencies: { resolveSessionPath: (sessionId: string) => Promise<string | null>; storeOptions?: SessionProfileStoreOptions },
): Promise<ExistingSessionProfileApiResult> {
  return withSessionProfileMutationLock(sessionId, async () => {
    const filePath = await dependencies.resolveSessionPath(sessionId);
    if (!filePath) return { status: 404, body: { error: "Session not found" } };
    return { status: 200, body: await getSessionProfileResponse(sessionId, dependencies.storeOptions) };
  });
}
