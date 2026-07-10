import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { assertProfileRef, cloneJson, type ProfileRef } from "./profiles";
import { resolveProfilesFile, type ProfileStoreOptions } from "./profile-store";
import { resolveProfilePreview, type ProfilePreviewResult } from "./profile-preview";
import {
  applyProfileToolPolicy,
  validateProfileRuntimeAgainstSnapshot,
  type ProfileToolPolicySession,
} from "./profile-runtime";
import {
  createUnregisteredRpcSession,
  registerRpcSession,
  unregisterRpcSession,
  type AgentSessionWrapper,
} from "./rpc-manager";
import {
  getSessionProfileSnapshot,
  restoreSessionProfileSnapshot,
  setSessionProfileSnapshot,
  type CapabilitySnapshotV1,
  type ProfileDiagnostic,
  type SessionProfileRecordV1,
  type SessionProfileStoreOptions,
  type SessionSnapshotWriteToken,
} from "./session-profile-store";

export interface NewSessionRuntime {
  sessionId: string;
  sessionFile: string;
  inner: ProfileToolPolicySession;
  readonly capabilitySnapshot?: CapabilitySnapshotV1;
  bindExtensions(options?: { forceEmptySystemPrompt?: boolean }): Promise<void>;
  finalizeProfileToolPolicy?(): CapabilitySnapshotV1 | undefined;
  stageSessionFileForPublication?(): string;
  promoteIsolatedSessionFile?(): void;
  send(command: Record<string, unknown>): Promise<unknown>;
  shutdown?(reason?: "quit" | "reload" | "new" | "resume" | "fork", targetSessionFile?: string): Promise<void>;
  destroy(): void;
}

export interface CreateProfileBackedNewSessionInput {
  cwd: string;
  profileRef?: unknown;
  agentDir?: string;
}

export interface CreateProfileBackedNewSessionResult {
  session: NewSessionRuntime;
  realSessionId: string;
  profileSnapshot: CapabilitySnapshotV1;
  diagnostics: ProfileDiagnostic[];
}

type CreateUnregisteredSession = (
  cwd: string,
  toolNames?: string[],
  runtimeOptions?: { agentDir?: string; profileSnapshot?: CapabilitySnapshotV1; resolveProfileTools?: boolean },
) => Promise<{ session: NewSessionRuntime; realSessionId: string }>;
export interface NewSessionProfileDependencies {
  profileStoreOptions?: ProfileStoreOptions;
  sessionProfileStoreOptions?: SessionProfileStoreOptions;
  resolveProfilePreview?: typeof resolveProfilePreview;
  resolveProfilesFile?: typeof resolveProfilesFile;
  createUnregisteredRpcSession?: CreateUnregisteredSession;
  registerRpcSession?: (realSessionId: string, session: NewSessionRuntime) => void;
  unregisterRpcSession?: (realSessionId: string, session?: NewSessionRuntime) => void;
  getSessionProfileSnapshot?: typeof getSessionProfileSnapshot;
  setSessionProfileSnapshot?: typeof setSessionProfileSnapshot;
  restoreSessionProfileSnapshot?: typeof restoreSessionProfileSnapshot;
  makeSnapshotId?: () => string;
  now?: () => string;
  ensureSessionFileMaterialized?: (session: NewSessionRuntime, sessionId: string, cwd: string) => Promise<void>;
  cleanupSessionFile?: (sessionFile: string) => Promise<void>;
}

export class NewSessionProfileError extends Error {
  statusCode: number;
  diagnostics?: ProfileDiagnostic[];

  constructor(message: string, statusCode = 400, diagnostics?: ProfileDiagnostic[]) {
    super(message);
    this.name = "NewSessionProfileError";
    this.statusCode = statusCode;
    if (diagnostics) this.diagnostics = diagnostics;
  }
}

function defaultDependencies(): Required<Omit<NewSessionProfileDependencies, "profileStoreOptions" | "sessionProfileStoreOptions">> {
  return {
    resolveProfilePreview,
    resolveProfilesFile,
    createUnregisteredRpcSession: createUnregisteredRpcSession as CreateUnregisteredSession,
    registerRpcSession: (realSessionId, session) => registerRpcSession(realSessionId, session as AgentSessionWrapper),
    unregisterRpcSession: (realSessionId, session) => unregisterRpcSession(realSessionId, session as AgentSessionWrapper | undefined),
    getSessionProfileSnapshot,
    setSessionProfileSnapshot,
    restoreSessionProfileSnapshot,
    makeSnapshotId: randomUUID,
    now: () => new Date().toISOString(),
    ensureSessionFileMaterialized: async (session, sessionId, cwd) => {
      const sessionFile = session.sessionFile;
      if (!sessionFile) throw new NewSessionProfileError("Profile-backed sessions require a durable session file before publication.", 500);
      await mkdir(dirname(sessionFile), { recursive: true });
      const manager = (session.inner as unknown as { sessionManager?: { _rewriteFile?: () => void; flushed?: boolean } }).sessionManager;
      if (!existsSync(sessionFile) && manager?._rewriteFile) {
        manager._rewriteFile();
        manager.flushed = true;
      } else if (!existsSync(sessionFile)) {
        const handle = await open(sessionFile, "wx", 0o600);
        try {
          await handle.writeFile(`${JSON.stringify({ type: "session", version: 3, id: sessionId, timestamp: new Date().toISOString(), cwd })}\n`, "utf8");
          await handle.sync();
        } finally {
          await handle.close();
        }
      } else if (manager) {
        manager.flushed = true;
      }
      const firstLine = (await readFile(sessionFile, "utf8")).split("\n", 1)[0];
      const header = JSON.parse(firstLine) as { type?: unknown; id?: unknown; cwd?: unknown };
      if (header.type !== "session" || header.id !== sessionId || header.cwd !== cwd) {
        throw new NewSessionProfileError("Existing session file identity does not match the profile-backed runtime.", 500);
      }
    },
    cleanupSessionFile: async (sessionFile) => {
      if (!sessionFile) return;
      await unlink(sessionFile).catch(() => undefined);
    },
  };
}

async function resolveEffectiveProfileRef(
  profileRef: unknown,
  dependencies: Required<Omit<NewSessionProfileDependencies, "profileStoreOptions" | "sessionProfileStoreOptions">>,
  profileStoreOptions: ProfileStoreOptions | undefined,
): Promise<{ profileRef: ProfileRef; diagnostics: ProfileDiagnostic[] }> {
  if (profileRef !== undefined) {
    assertProfileRef(profileRef, "profileRef");
    return { profileRef, diagnostics: [] };
  }

  const resolved = await dependencies.resolveProfilesFile(profileStoreOptions);
  const diagnostics: ProfileDiagnostic[] = resolved.warnings.map((message) => ({
    type: "warning",
    message,
    source: resolved.store.defaults.globalProfileRef,
  }));
  return { profileRef: resolved.store.defaults.globalProfileRef, diagnostics };
}

export function buildCapabilitySnapshotFromPreview(options: {
  preview: ProfilePreviewResult;
  profileRef: ProfileRef;
  cwd: string;
  diagnostics?: ProfileDiagnostic[];
  snapshotId?: string;
  createdAt?: string;
}): CapabilitySnapshotV1 {
  const diagnostics = [...(options.diagnostics ?? []), ...options.preview.diagnostics];
  if (!options.preview.safeToApply || !options.preview.tools.activeToolNames) {
    const safetyDiagnostics: ProfileDiagnostic[] = diagnostics.some((diagnostic) => diagnostic.type === "error")
      ? diagnostics
      : [{
          type: "error",
          message: "Profile preview is not safe to apply to a new session.",
          source: options.profileRef,
        }, ...diagnostics];
    throw new NewSessionProfileError("Profile preview is not safe to apply to a new session.", 400, safetyDiagnostics);
  }

  return {
    version: 1,
    snapshotId: options.snapshotId ?? randomUUID(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    profileRef: options.profileRef,
    profileName: options.preview.profileName,
    cwd: options.cwd,
    tools: {
      builtinPreset: options.preview.tools.builtinPreset,
      requestedBuiltinTools: cloneJson(options.preview.tools.requestedBuiltinTools),
      pluginTools: cloneJson(options.preview.tools.pluginTools),
      activeToolNames: cloneJson(options.preview.tools.activeToolNames),
      conflicts: cloneJson(options.preview.tools.conflicts),
    },
    plugins: cloneJson(options.preview.plugins),
    skills: cloneJson(options.preview.skills),
    diagnostics: cloneJson(diagnostics),
  };
}

async function rollbackProfileSnapshot(
  sessionId: string,
  previousRecord: SessionProfileRecordV1 | null,
  writeToken: SessionSnapshotWriteToken,
  dependencies: Required<Omit<NewSessionProfileDependencies, "profileStoreOptions" | "sessionProfileStoreOptions">>,
  sessionProfileStoreOptions: SessionProfileStoreOptions | undefined,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await dependencies.restoreSessionProfileSnapshot(sessionId, previousRecord, writeToken, sessionProfileStoreOptions);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export async function createProfileBackedNewSessionRuntime(
  input: CreateProfileBackedNewSessionInput,
  dependencyOverrides: NewSessionProfileDependencies = {},
): Promise<CreateProfileBackedNewSessionResult> {
  const dependencies = { ...defaultDependencies(), ...dependencyOverrides };
  const { profileStoreOptions, sessionProfileStoreOptions } = dependencyOverrides;
  const resolved = await resolveEffectiveProfileRef(input.profileRef, dependencies, profileStoreOptions);
  const preview = await dependencies.resolveProfilePreview(
    { cwd: input.cwd, profileRef: resolved.profileRef },
    { agentDir: input.agentDir, profileStoreOptions },
  );
  let snapshot = buildCapabilitySnapshotFromPreview({
    preview,
    profileRef: resolved.profileRef,
    cwd: preview.cwd,
    diagnostics: resolved.diagnostics,
    snapshotId: dependencies.makeSnapshotId(),
    createdAt: dependencies.now(),
  });

  let runtime: { session: NewSessionRuntime; realSessionId: string } | undefined;
  let writeResult: {
    record: SessionProfileRecordV1;
    previousRecord: SessionProfileRecordV1 | null;
    writeToken: SessionSnapshotWriteToken;
  } | undefined;
  let exposed = false;

  try {
    runtime = await dependencies.createUnregisteredRpcSession(preview.cwd, undefined, {
      agentDir: input.agentDir,
      profileSnapshot: snapshot,
      resolveProfileTools: true,
    });
    const publishedSessionFile = runtime.session.stageSessionFileForPublication?.() ?? runtime.session.sessionFile;
    await dependencies.ensureSessionFileMaterialized(runtime.session, runtime.realSessionId, preview.cwd);

    await runtime.session.bindExtensions({ forceEmptySystemPrompt: !preview.tools.unknownToolMetadata && snapshot.tools.activeToolNames.length === 0 });
    snapshot = runtime.session.finalizeProfileToolPolicy?.() ?? runtime.session.capabilitySnapshot ?? snapshot;
    const runtimeMetadata = applyProfileToolPolicy(runtime.session.inner, snapshot);
    const runtimeValidation = validateProfileRuntimeAgainstSnapshot(runtime.session.inner, snapshot, runtimeMetadata);
    if (runtimeValidation.diagnostics.length > 0) {
      throw new NewSessionProfileError(
        "Profile runtime capabilities do not match the immutable capability snapshot.",
        500,
        runtimeValidation.diagnostics,
      );
    }


    const existingSnapshot = await dependencies.getSessionProfileSnapshot(runtime.realSessionId, sessionProfileStoreOptions);
    if (existingSnapshot.state !== "legacy") {
      throw new NewSessionProfileError(`Session ${runtime.realSessionId} already has a profile snapshot.`, 409);
    }

    writeResult = await dependencies.setSessionProfileSnapshot(
      runtime.realSessionId,
      snapshot,
      { sessionFilePath: publishedSessionFile || undefined, cwd: preview.cwd, updatedAt: dependencies.now() },
      existingSnapshot.writeToken,
      sessionProfileStoreOptions,
    );

    runtime.session.promoteIsolatedSessionFile?.();
    dependencies.registerRpcSession(runtime.realSessionId, runtime.session);
    exposed = true;

    return {
      session: runtime.session,
      realSessionId: runtime.realSessionId,
      profileSnapshot: writeResult.record.snapshot,
      diagnostics: writeResult.record.snapshot.diagnostics,
    };
  } catch (error) {
    if (!exposed && runtime) {
      let rollbackError: unknown;
      if (writeResult) {
        try {
          await rollbackProfileSnapshot(
            runtime.realSessionId,
            writeResult.previousRecord,
            writeResult.writeToken,
            dependencies,
            sessionProfileStoreOptions,
          );
        } catch (failure) {
          rollbackError = failure;
        }
      }
      dependencies.unregisterRpcSession(runtime.realSessionId, runtime.session);
      try {
        await runtime.session.shutdown?.();
      } finally {
        await dependencies.cleanupSessionFile(runtime.session.sessionFile);
      }
      if (rollbackError) {
        throw new NewSessionProfileError(
          `New session creation failed and snapshot rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
          500,
        );
      }
    }
    throw error;
  }
}
