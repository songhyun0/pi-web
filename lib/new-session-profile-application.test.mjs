import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !specifier.match(/\.[cm]?[jt]sx?$/) && !specifier.includes("?")) {
      try {
        return nextResolve(`${specifier}.ts`, context);
      } catch {
        // Fall through to Node's default resolver for non-TypeScript relative imports.
      }
    }
    return nextResolve(specifier, context);
  },
});

let importCounter = 0;

async function loadApplication() {
  importCounter += 1;
  return import(`./new-session-profile-application.ts?case=${importCounter}`);
}

function tempDir(name = "pi-web-new-session-profile") {
  const dir = path.join(tmpdir(), `${name}-${process.pid}-${importCounter}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

const PROFILE_REF = "profile:00000000-0000-4000-8000-000000000001";

function makePreview({
  profileRef = PROFILE_REF,
  cwd = "/repo",
  requestedBuiltinTools = ["read"],
  activeToolNames = ["read"],
  pluginTools = [],
  conflicts = [],
  diagnostics = [],
  safeToApply = true,
  unknownToolMetadata = false,
} = {}) {
  return {
    profileRef,
    profileName: "Test profile",
    cwd,
    plugins: [],
    tools: {
      builtinPreset: requestedBuiltinTools.length === 0 ? "none" : "default",
      requestedBuiltinTools,
      pluginTools,
      conflicts,
      unknownToolMetadata,
      ...(activeToolNames === undefined ? {} : { activeToolNames }),
    },
    skills: {
      mode: "pluginDefaultThenNarrow",
      visibleSkillRefs: [],
      hiddenSkillRefs: [],
    },
    diagnostics,
    safeToApply,
  };
}

function makeRuntime(events, {
  realSessionId = "session-new-1",
  sessionFile = "/tmp/session-new-1.json",
  allTools = [{ name: "read", sourceInfo: { source: "builtin", path: "<builtin:read>" } }],
} = {}) {
  let activeTools = [];
  const session = {
    sessionId: realSessionId,
    sessionFile,
    inner: {
      getAllTools: () => allTools,
      getActiveToolNames: () => activeTools,
      setActiveToolsByName: (names) => {
        activeTools = [...names];
        events.push(`activate:${activeTools.join(",")}`);
      },
    },
    bindExtensions: async () => {
      events.push("bind");
    },
    stageSessionFileForPublication: () => {
      events.push("stage-session-file");
      return sessionFile;
    },
    promoteIsolatedSessionFile: () => {
      events.push("promote-session-file");
    },
    send: async (command) => {
      events.push(`send:${command.type}`);
      return { ok: true };
    },
    destroy: () => {
      events.push("destroy");
    },
  };
  return { session, realSessionId };
}

function makeBaseDependencies(events, overrides = {}) {
  const runtime = overrides.runtime ?? makeRuntime(events);
  let restoreAttempts = 0;
  return {
    resolveProfilesFile: async () => ({
      store: { version: 1, defaults: { globalProfileRef: PROFILE_REF }, profiles: [] },
      warnings: [],
    }),
    resolveProfilePreview: async (request) => {
      events.push(`preview:${request.profileRef}`);
      return overrides.preview ?? makePreview({ profileRef: request.profileRef, cwd: request.cwd });
    },
    createUnregisteredRpcSession: async (cwd, toolNames, runtimeOptions) => {
      events.push("create");
      assert.equal(cwd, "/repo");
      assert.equal(toolNames, undefined, "profile-backed new sessions must not trust client toolNames");
      assert.equal(runtimeOptions.profileSnapshot.profileRef, PROFILE_REF);
      return runtime;
    },
    getSessionProfileSnapshot: async (sessionId) => {
      events.push(`lookup:${sessionId}`);
      return { state: "legacy", label: "Legacy", snapshot: null, writeToken: { storeRevision: 0 } };
    },
    setSessionProfileSnapshot: async (sessionId, snapshot, metadata, token) => {
      events.push("persist");
      assert.equal(sessionId, runtime.realSessionId);
      assert.equal(token.storeRevision, 0);
      assert.equal(metadata.cwd, "/repo");
      await overrides.onPersist?.({ sessionId, snapshot, metadata });
      return {
        record: {
          sessionId,
          sessionFilePath: metadata.sessionFilePath,
          cwd: metadata.cwd,
          updatedAt: metadata.updatedAt,
          recordRevision: 1,
          snapshot,
        },
        previousRecord: overrides.previousRecord ?? null,
        writeToken: { storeRevision: 1, recordRevision: 1, snapshotId: snapshot.snapshotId },
      };
    },
    restoreSessionProfileSnapshot: async () => {
      restoreAttempts += 1;
      events.push("restore");
      if (restoreAttempts <= (overrides.restoreFailures ?? 0)) throw new Error("restore failed");
    },
    registerRpcSession: () => {
      events.push("register");
      if (overrides.registerError) throw overrides.registerError;
    },
    unregisterRpcSession: (_sessionId, session) => {
      events.push("unregister");
      session?.destroy();
    },
    makeSnapshotId: () => "snapshot-1",
    now: () => "2026-07-10T00:00:00.000Z",
    ensureSessionFileMaterialized: async (session, sessionId, cwd) => {
      events.push("materialize-session-file");
      assert.equal(session.sessionFile, runtime.session.sessionFile);
      assert.equal(sessionId, runtime.realSessionId);
      assert.equal(path.isAbsolute(cwd), true);
    },
    cleanupSessionFile: async () => {
      events.push("cleanup-session-file");
    },
  };
}

test("creates an immutable snapshot before registering the new runtime", async () => {
  const { createProfileBackedNewSessionRuntime } = await loadApplication();
  const events = [];
  const result = await createProfileBackedNewSessionRuntime(
    { cwd: "/repo", profileRef: PROFILE_REF },
    makeBaseDependencies(events),
  );

  assert.equal(result.realSessionId, "session-new-1");
  assert.equal(result.profileSnapshot.snapshotId, "snapshot-1");
  assert.equal(result.profileSnapshot.profileRef, PROFILE_REF);
  assert.deepEqual(result.profileSnapshot.tools.activeToolNames, ["read"]);
  assert.deepEqual(events, [
    `preview:${PROFILE_REF}`,
    "create",
    "stage-session-file",
    "materialize-session-file",
    "bind",
    "activate:read",
    "lookup:session-new-1",
    "persist",
    "promote-session-file",
    "register",
  ]);
});

test("new-session publication materializes a canonical session header", async () => {
  const { createProfileBackedNewSessionRuntime } = await loadApplication();
  const events = [];
  const root = tempDir("pi-web-new-session-header");
  const sessionFile = path.join(root, "session-new-1.jsonl");
  const runtime = makeRuntime(events, { sessionFile });
  const dependencies = makeBaseDependencies(events, { runtime });
  delete dependencies.ensureSessionFileMaterialized;

  const result = await createProfileBackedNewSessionRuntime({ cwd: "/repo", profileRef: PROFILE_REF }, dependencies);
  const header = JSON.parse(readFileSync(sessionFile, "utf8").split("\n")[0]);
  assert.deepEqual({ type: header.type, version: header.version, id: header.id, cwd: header.cwd }, {
    type: "session", version: 3, id: result.realSessionId, cwd: "/repo",
  });
});

test("new-session file remains undiscoverable until its snapshot is durable", async () => {
  const { createProfileBackedNewSessionRuntime } = await loadApplication();
  const events = [];
  const root = tempDir("pi-web-new-session-pending");
  const sessionFile = path.join(root, "session-new-1.jsonl");
  const pendingFile = `${sessionFile}.profile-pending-test`;
  const runtime = makeRuntime(events, { sessionFile });
  runtime.session.stageSessionFileForPublication = () => {
    events.push("stage-session-file");
    assert.equal(existsSync(sessionFile), false);
    runtime.session.sessionFile = pendingFile;
    return sessionFile;
  };
  runtime.session.bindExtensions = async () => {
    events.push("bind");
    assert.equal(existsSync(sessionFile), false);
    appendFileSync(pendingFile, `${JSON.stringify({ type: "session_info", id: "bind-entry", parentId: null, timestamp: "2026-07-10T00:00:00.000Z", name: "bound" })}\n`);
  };
  runtime.session.promoteIsolatedSessionFile = () => {
    events.push("promote-session-file");
    renameSync(pendingFile, sessionFile);
    runtime.session.sessionFile = sessionFile;
  };
  const dependencies = makeBaseDependencies(events, {
    runtime,
    onPersist: ({ metadata }) => {
      assert.equal(metadata.sessionFilePath, sessionFile);
      assert.equal(existsSync(sessionFile), false);
      assert.equal(existsSync(pendingFile), true);
    },
  });
  dependencies.ensureSessionFileMaterialized = async (session, sessionId, cwd) => {
    events.push("materialize-session-file");
    assert.equal(session.sessionFile, pendingFile);
    appendFileSync(pendingFile, `${JSON.stringify({ type: "session", version: 3, id: sessionId, timestamp: "2026-07-10T00:00:00.000Z", cwd })}\n`);
  };

  await createProfileBackedNewSessionRuntime({ cwd: "/repo", profileRef: PROFILE_REF }, dependencies);
  assert.equal(existsSync(sessionFile), true);
  assert.equal(existsSync(pendingFile), false);
  assert.match(readFileSync(sessionFile, "utf8"), /bind-entry/);
  assert.ok(events.indexOf("stage-session-file") < events.indexOf("materialize-session-file"));
  assert.ok(events.indexOf("persist") < events.indexOf("promote-session-file"));
});

test("omitted profileRef uses the resolved server default and records setup diagnostics", async () => {
  const { createProfileBackedNewSessionRuntime } = await loadApplication();
  const events = [];
  const warning = "Created the initial server default profile from global package settings.";
  const result = await createProfileBackedNewSessionRuntime(
    { cwd: "/repo" },
    {
      ...makeBaseDependencies(events),
      resolveProfilesFile: async () => ({
        store: { version: 1, defaults: { globalProfileRef: PROFILE_REF }, profiles: [] },
        warnings: [warning],
      }),
    },
  );

  assert.equal(result.profileSnapshot.profileRef, PROFILE_REF);
  assert.equal(result.profileSnapshot.diagnostics[0].type, "warning");
  assert.equal(result.profileSnapshot.diagnostics[0].message, warning);
  assert.deepEqual(result.diagnostics, result.profileSnapshot.diagnostics);
});

test("omitted profileRef bootstraps a real store and persists its warning", async () => {
  const { createProfileBackedNewSessionRuntime } = await loadApplication();
  const root = tempDir();
  const profilePath = path.join(root, "web-profiles.json");
  const sessionProfilePath = path.join(root, "web-session-profiles.json");
  const events = [];
  const dependencies = makeBaseDependencies(events);
  delete dependencies.resolveProfilesFile;
  delete dependencies.getSessionProfileSnapshot;
  delete dependencies.setSessionProfileSnapshot;
  delete dependencies.restoreSessionProfileSnapshot;
  dependencies.profileStoreOptions = { agentDir: root, filePath: profilePath };
  dependencies.sessionProfileStoreOptions = { filePath: sessionProfilePath };
  dependencies.createUnregisteredRpcSession = async (_cwd, toolNames, runtimeOptions) => {
    events.push("create");
    assert.equal(toolNames, undefined);
    assert.match(runtimeOptions.profileSnapshot.profileRef, /^profile:/);
    return makeRuntime(events);
  };

  const result = await createProfileBackedNewSessionRuntime({ cwd: root }, dependencies);
  const profiles = JSON.parse(readFileSync(profilePath, "utf8"));
  const sessionProfiles = JSON.parse(readFileSync(sessionProfilePath, "utf8"));
  assert.equal(profiles.profiles.length, 1);
  assert.equal(result.profileSnapshot.profileRef, profiles.defaults.globalProfileRef);
  assert.equal(result.profileSnapshot.profileName, "Test profile");
  assert.ok(result.profileSnapshot.diagnostics.some((item) => item.type === "warning" && /initial server default/.test(item.message)));
  assert.deepEqual(result.diagnostics, result.profileSnapshot.diagnostics);
  assert.deepEqual(sessionProfiles.sessions["session-new-1"].snapshot.diagnostics, result.profileSnapshot.diagnostics);
});

test("explicit malformed or missing profile refs create no runtime or snapshot", async () => {
  const { createProfileBackedNewSessionRuntime } = await loadApplication();
  for (const [profileRef, expectedStatus] of [["bad", 400], ["profile:00000000-0000-4000-8000-000000000099", 404]]) {
    const root = tempDir("pi-web-new-session-invalid-profile");
    const profilePath = path.join(root, "web-profiles.json");
    const sessionProfilePath = path.join(root, "web-session-profiles.json");
    const events = [];
    const dependencies = makeBaseDependencies(events);
    delete dependencies.resolveProfilesFile;
    delete dependencies.resolveProfilePreview;
    dependencies.profileStoreOptions = { agentDir: root, filePath: profilePath };
    dependencies.sessionProfileStoreOptions = { filePath: sessionProfilePath };

    await assert.rejects(
      () => createProfileBackedNewSessionRuntime({ cwd: root, profileRef }, dependencies),
      (error) => {
        assert.equal(error.statusCode, expectedStatus);
        return true;
      },
    );
    assert.equal(events.includes("create"), false);
    assert.equal(events.includes("persist"), false);
    assert.equal(events.includes("register"), false);
    assert.equal(existsSync(sessionProfilePath), false);
  }
});

test("rejects unsafe previews before creating a runtime", async () => {
  const { createProfileBackedNewSessionRuntime, NewSessionProfileError } = await loadApplication();
  const events = [];
  await assert.rejects(
    createProfileBackedNewSessionRuntime(
      { cwd: "/repo", profileRef: PROFILE_REF },
      makeBaseDependencies(events, {
        preview: makePreview({
          activeToolNames: undefined,
          safeToApply: false,
          unknownToolMetadata: true,
          diagnostics: [{ type: "error", message: "unknown tool metadata", source: "pkg" }],
        }),
      }),
    ),
    (error) => {
      assert.ok(error instanceof NewSessionProfileError);
      assert.equal(error.statusCode, 400);
      assert.match(error.message, /not safe/);
      return true;
    },
  );
  assert.deepEqual(events, [`preview:${PROFILE_REF}`]);
});

test("destroys the unregistered runtime when runtime capabilities mismatch the snapshot", async () => {
  const { createProfileBackedNewSessionRuntime } = await loadApplication();
  const events = [];
  await assert.rejects(
    createProfileBackedNewSessionRuntime(
      { cwd: "/repo", profileRef: PROFILE_REF },
      makeBaseDependencies(events, {
        preview: makePreview({
          activeToolNames: ["read", "extra_plugin"],
          pluginTools: [{ name: "extra_plugin", source: "expected-pkg", extension: "extensions/tool.mjs", provenance: "plugin", metadataResolved: true }],
        }),
        runtime: makeRuntime(events, {
          allTools: [
            { name: "read", sourceInfo: { source: "builtin", path: "<builtin:read>" } },
            { name: "extra_plugin", sourceInfo: { source: "pkg", path: "extensions/tool.mjs", origin: "package" } },
          ],
        }),
      }),
    ),
    /do not match|does not match/,
  );
  assert.deepEqual(events, [
    `preview:${PROFILE_REF}`,
    "create",
    "stage-session-file",
    "materialize-session-file",
    "bind",
    "activate:read,extra_plugin",
    "unregister",
    "destroy",
    "cleanup-session-file",
  ]);
});

test("rolls back a persisted snapshot if registration fails before exposure", async () => {
  const { createProfileBackedNewSessionRuntime } = await loadApplication();
  const events = [];
  await assert.rejects(
    createProfileBackedNewSessionRuntime(
      { cwd: "/repo", profileRef: PROFILE_REF },
      makeBaseDependencies(events, { registerError: new Error("register failed") }),
    ),
    /register failed/,
  );
  assert.deepEqual(events, [
    `preview:${PROFILE_REF}`,
    "create",
    "stage-session-file",
    "materialize-session-file",
    "bind",
    "activate:read",
    "lookup:session-new-1",
    "persist",
    "promote-session-file",
    "register",
    "restore",
    "unregister",
    "destroy",
    "cleanup-session-file",
  ]);
});

test("new-session rollback retries transient failures and surfaces persistent failures", async () => {
  const { createProfileBackedNewSessionRuntime } = await loadApplication();
  const transientEvents = [];
  await assert.rejects(
    createProfileBackedNewSessionRuntime(
      { cwd: "/repo", profileRef: PROFILE_REF },
      makeBaseDependencies(transientEvents, { registerError: new Error("register failed"), restoreFailures: 1 }),
    ),
    /register failed/,
  );
  assert.equal(transientEvents.filter((event) => event === "restore").length, 2);
  assert.ok(transientEvents.includes("cleanup-session-file"));

  const persistentEvents = [];
  await assert.rejects(
    createProfileBackedNewSessionRuntime(
      { cwd: "/repo", profileRef: PROFILE_REF },
      makeBaseDependencies(persistentEvents, { registerError: new Error("register failed"), restoreFailures: 3 }),
    ),
    /snapshot rollback failed: restore failed/,
  );
  assert.equal(persistentEvents.filter((event) => event === "restore").length, 3);
  assert.ok(persistentEvents.includes("cleanup-session-file"));
});

test("new-session route delegates profile-backed creation and never passes client toolNames to runtime startup", () => {
  const source = readFileSync(path.join(process.cwd(), "app/api/agent/new/route.ts"), "utf8");
  assert.match(source, /createProfileBackedNewSessionRuntime\(\{ cwd, profileRef \}\)/);
  assert.doesNotMatch(source, /startRpcSession\(/);
  assert.doesNotMatch(source, /createProfileBackedNewSessionRuntime\([^)]*toolNames/);
  assert.ok(source.indexOf("createProfileBackedNewSessionRuntime") < source.indexOf("allowFileRoot(profileSnapshot.cwd)"));
  assert.ok(source.indexOf("allowFileRoot(profileSnapshot.cwd)") < source.indexOf('type: "set_model"'));
});
