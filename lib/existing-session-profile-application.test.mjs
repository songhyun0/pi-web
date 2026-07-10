import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";

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
  return import(`./existing-session-profile-application.ts?case=${importCounter}`);
}

async function loadRpcManager() {
  importCounter += 1;
  return import(`./rpc-manager.ts?legacy=${importCounter}`);
}

async function loadSessionProfileStore() {
  importCounter += 1;
  return import(`./session-profile-store.ts?legacy=${importCounter}`);
}

function tempDir(name = "pi-web-legacy-restore") {
  const dir = path.join(tmpdir(), `${name}-${process.pid}-${importCounter}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeToolPackage(root, toolName) {
  mkdirSync(path.join(root, "extensions"), { recursive: true });
  writeFileSync(path.join(root, "package.json"), JSON.stringify({
    name: `pkg-${toolName}`,
    version: "1.0.0",
    type: "module",
    pi: { extensions: ["extensions/*.mjs"] },
  }));
  writeFileSync(path.join(root, "extensions", "tool.mjs"), `export default function ext(pi) {
    pi.registerTool({
      name: ${JSON.stringify(toolName)},
      description: ${JSON.stringify(toolName)},
      parameters: { type: "object", properties: {} },
      async execute() { return { content: [{ type: "text", text: "ok" }] }; }
    });
  }`);
  return root;
}

const PROFILE_REF = "profile:00000000-0000-4000-8000-000000000001";

function makePreview({ profileRef = PROFILE_REF, activeToolNames = ["read"], pluginTools = [], requestedBuiltinTools = ["read"], diagnostics = [] } = {}) {
  return {
    profileRef,
    profileName: "Switch profile",
    cwd: "/repo",
    plugins: [],
    tools: {
      builtinPreset: requestedBuiltinTools.length === 0 ? "none" : "default",
      requestedBuiltinTools,
      pluginTools,
      conflicts: [],
      unknownToolMetadata: false,
      activeToolNames,
    },
    skills: { mode: "pluginDefaultThenNarrow", visibleSkillRefs: [], hiddenSkillRefs: [] },
    diagnostics,
    safeToApply: true,
  };
}

function makeRuntime(events, { realSessionId = "session-1", allTools = [{ name: "read", sourceInfo: { source: "builtin", path: "<builtin:read>" } }] } = {}) {
  let active = [];
  const session = {
    sessionId: realSessionId,
    sessionFile: "/sessions/session-1.json",
    inner: {
      getAllTools: () => allTools,
      getActiveToolNames: () => active,
      setActiveToolsByName: (names) => {
        active = names.filter((name) => allTools.some((tool) => tool.name === name));
        events.push(`activate:${active.join(",")}`);
      },
    },
    bindExtensions: async () => { events.push("bind"); },
    send: async () => null,
    destroy: () => { events.push("destroy-candidate"); },
  };
  return { session, realSessionId };
}

function makeIdleCurrent(events) {
  return {
    isAlive: () => true,
    isRunning: () => false,
    destroy: () => { events.push("destroy-previous"); },
  };
}

function makeRunningCurrent() {
  return { isAlive: () => true, isRunning: () => true };
}

function makeDeps(events, overrides = {}) {
  const current = overrides.current ?? makeIdleCurrent(events);
  const candidate = overrides.candidate ?? makeRuntime(events);
  return {
    resolveSessionPath: async (sessionId) => {
      events.push(`path:${sessionId}`);
      return "/sessions/session-1.json";
    },
    readSessionCwd: () => "/repo",
    getRpcSession: () => current,
    resolveProfilePreview: async (request) => {
      events.push(`preview:${request.profileRef}`);
      return overrides.preview ?? makePreview({ profileRef: request.profileRef });
    },
    createUnregisteredRpcSessionFromFile: async (filePath, cwd, toolNames, runtimeOptions) => {
      events.push("create-candidate");
      assert.equal(filePath, "/sessions/session-1.json");
      assert.equal(cwd, "/repo");
      assert.equal(toolNames, undefined);
      assert.equal(runtimeOptions.profileSnapshot.profileRef, PROFILE_REF);
      if (overrides.createError) throw overrides.createError;
      return candidate;
    },
    getSessionProfileSnapshot: async () => {
      events.push("lookup-snapshot");
      return { state: "legacy", label: "Legacy", snapshot: null, writeToken: { storeRevision: 0 } };
    },
    setSessionProfileSnapshot: async (sessionId, snapshot, metadata, token) => {
      events.push("persist-snapshot");
      if (overrides.persistError) throw overrides.persistError;
      assert.equal(sessionId, "session-1");
      assert.equal(metadata.sessionFilePath, "/sessions/session-1.json");
      assert.equal(token.storeRevision, 0);
      return {
        record: { sessionId, sessionFilePath: metadata.sessionFilePath, cwd: metadata.cwd, updatedAt: metadata.updatedAt, recordRevision: 1, snapshot },
        previousRecord: overrides.previousRecord ?? null,
        writeToken: { storeRevision: 1, recordRevision: 1, snapshotId: snapshot.snapshotId },
      };
    },
    restoreSessionProfileSnapshot: async () => { events.push("restore-snapshot"); },
    replaceRpcSession: () => {
      events.push("replace-runtime");
      if (overrides.replaceError) throw overrides.replaceError;
      return current;
    },
    unregisterRpcSession: (_sessionId, session) => {
      events.push("unregister-candidate");
      session?.destroy();
    },
    makeSnapshotId: () => "snapshot-switch-1",
    now: () => "2026-07-10T00:00:00.000Z",
  };
}

test("idle switch persists the snapshot before swapping the active runtime", async () => {
  const { switchExistingSessionProfileApiResult } = await loadApplication();
  const events = [];
  const result = await switchExistingSessionProfileApiResult("session-1", { profileRef: PROFILE_REF }, makeDeps(events));

  assert.equal(result.status, 200);
  assert.equal(result.body.state, "snapshot");
  assert.equal(result.body.snapshot.snapshotId, "snapshot-switch-1");
  assert.deepEqual(events, [
    "path:session-1",
    `preview:${PROFILE_REF}`,
    "create-candidate",
    "bind",
    "activate:read",
    "lookup-snapshot",
    "persist-snapshot",
    "replace-runtime",
    "destroy-previous",
  ]);
});

test("idle switch persists preview setup warnings in the immutable snapshot", async () => {
  const { switchExistingSessionProfileApiResult } = await loadApplication();
  const events = [];
  const warning = { type: "warning", message: "The stored global default profile was missing or invalid; a safe default profile was created and selected." };
  const result = await switchExistingSessionProfileApiResult(
    "session-1",
    { profileRef: PROFILE_REF },
    makeDeps(events, { preview: makePreview({ diagnostics: [warning] }) }),
  );

  assert.equal(result.status, 200);
  assert.deepEqual(result.body.snapshot.diagnostics, [warning]);
});

test("running switch returns 409 before preview, runtime creation, or persistence", async () => {
  const { switchExistingSessionProfileApiResult } = await loadApplication();
  const events = [];
  const result = await switchExistingSessionProfileApiResult(
    "session-1",
    { profileRef: PROFILE_REF },
    makeDeps(events, { current: makeRunningCurrent() }),
  );

  assert.equal(result.status, 409);
  assert.match(result.body.error, /Wait for the current response/);
  assert.deepEqual(events, []);
});

test("late running recheck cleans up the isolated candidate and leaves snapshots untouched", async () => {
  const { switchExistingSessionProfileApiResult } = await loadApplication();
  const events = [];
  let running = false;
  const current = { isAlive: () => true, isRunning: () => running, destroy: () => events.push("destroy-previous") };
  const candidate = makeRuntime(events);
  candidate.session.bindExtensions = async () => {
    events.push("bind");
    running = true;
  };

  await assert.rejects(
    switchExistingSessionProfileApiResult(
      "session-1",
      { profileRef: PROFILE_REF },
      makeDeps(events, { current, candidate }),
    ),
    /Wait for the current response/,
  );
  assert.deepEqual(events, [
    "path:session-1",
    `preview:${PROFILE_REF}`,
    "create-candidate",
    "bind",
    "activate:read",
    "unregister-candidate",
    "destroy-candidate",
  ]);
});

test("post-persist late running recheck restores the snapshot and cleans up the candidate", async () => {
  const { switchExistingSessionProfileApiResult } = await loadApplication();
  const events = [];
  let running = false;
  const current = { isAlive: () => true, isRunning: () => running, destroy: () => events.push("destroy-previous") };
  const deps = makeDeps(events, { current });
  const baseSet = deps.setSessionProfileSnapshot;
  deps.setSessionProfileSnapshot = async (...args) => {
    const result = await baseSet(...args);
    running = true;
    return result;
  };

  await assert.rejects(
    switchExistingSessionProfileApiResult("session-1", { profileRef: PROFILE_REF }, deps),
    (error) => {
      assert.equal(error.statusCode, 409);
      assert.match(error.message, /Wait for the current response/);
      return true;
    },
  );
  assert.deepEqual(events, [
    "path:session-1",
    `preview:${PROFILE_REF}`,
    "create-candidate",
    "bind",
    "activate:read",
    "lookup-snapshot",
    "persist-snapshot",
    "restore-snapshot",
    "unregister-candidate",
    "destroy-candidate",
  ]);
});

test("runtime capability mismatch destroys the isolated candidate and leaves snapshots untouched", async () => {
  const { switchExistingSessionProfileApiResult } = await loadApplication();
  const events = [];
  await assert.rejects(
    switchExistingSessionProfileApiResult(
      "session-1",
      { profileRef: PROFILE_REF },
      makeDeps(events, {
        preview: makePreview({
          activeToolNames: ["plugin_tool"],
          requestedBuiltinTools: [],
          pluginTools: [{ name: "plugin_tool", source: "selected-pkg", extension: "extensions/tool.mjs", provenance: "plugin", metadataResolved: true }],
        }),
        candidate: makeRuntime(events, {
          allTools: [{ name: "plugin_tool", sourceInfo: { source: "other-pkg", path: "/pkg/extensions/tool.mjs", origin: "package" } }],
        }),
      }),
    ),
    /do not match/,
  );
  assert.deepEqual(events, [
    "path:session-1",
    `preview:${PROFILE_REF}`,
    "create-candidate",
    "bind",
    "activate:plugin_tool",
    "unregister-candidate",
    "destroy-candidate",
  ]);
});

test("snapshot persistence failure destroys the isolated candidate without swapping runtime", async () => {
  const { switchExistingSessionProfileApiResult } = await loadApplication();
  const events = [];
  await assert.rejects(
    switchExistingSessionProfileApiResult(
      "session-1",
      { profileRef: PROFILE_REF },
      makeDeps(events, { persistError: new Error("persist failed") }),
    ),
    /persist failed/,
  );
  assert.deepEqual(events, [
    "path:session-1",
    `preview:${PROFILE_REF}`,
    "create-candidate",
    "bind",
    "activate:read",
    "lookup-snapshot",
    "persist-snapshot",
    "unregister-candidate",
    "destroy-candidate",
  ]);
});

test("swap failure restores the previous snapshot and destroys the candidate", async () => {
  const { switchExistingSessionProfileApiResult } = await loadApplication();
  const events = [];
  await assert.rejects(
    switchExistingSessionProfileApiResult(
      "session-1",
      { profileRef: PROFILE_REF },
      makeDeps(events, { replaceError: new Error("swap failed") }),
    ),
    /swap failed/,
  );
  assert.deepEqual(events, [
    "path:session-1",
    `preview:${PROFILE_REF}`,
    "create-candidate",
    "bind",
    "activate:read",
    "lookup-snapshot",
    "persist-snapshot",
    "replace-runtime",
    "restore-snapshot",
    "unregister-candidate",
    "destroy-candidate",
  ]);
});

test("rollback failure destroys the live runtime to avoid saved/live mismatch", async () => {
  const { switchExistingSessionProfileApiResult } = await loadApplication();
  const events = [];
  const deps = makeDeps(events, { replaceError: new Error("swap failed") });
  deps.restoreSessionProfileSnapshot = async () => {
    events.push("restore-snapshot");
    throw new Error("rollback failed");
  };

  await assert.rejects(
    switchExistingSessionProfileApiResult("session-1", { profileRef: PROFILE_REF }, deps),
    /rollback failed.*live runtime was destroyed/,
  );
  assert.deepEqual(events, [
    "path:session-1",
    `preview:${PROFILE_REF}`,
    "create-candidate",
    "bind",
    "activate:read",
    "lookup-snapshot",
    "persist-snapshot",
    "replace-runtime",
    "restore-snapshot",
    "unregister-candidate",
    "destroy-previous",
    "unregister-candidate",
    "destroy-candidate",
  ]);
});

test("session profile mutation lock serializes same-session work", async () => {
  const { withSessionProfileMutationLock } = await loadApplication();
  const events = [];
  let releaseFirst;
  const first = withSessionProfileMutationLock("session-serial", async () => {
    events.push("first-start");
    await new Promise((resolve) => { releaseFirst = resolve; });
    events.push("first-end");
  });
  const second = withSessionProfileMutationLock("session-serial", async () => {
    events.push("second");
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(events, ["first-start"]);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(events, ["first-start", "first-end", "second"]);
});

test("legacy runtime restore uses current settings and creates no snapshot", async () => {
  const root = tempDir();
  const agentDir = path.join(root, "agent");
  const cwd = path.join(root, "project");
  const sessionDir = path.join(root, "sessions");
  const legacyPackage = writeToolPackage(path.join(root, "legacy-package"), "legacy_settings_tool");
  const mutableProfilePackage = writeToolPackage(path.join(root, "profile-package"), "mutable_profile_tool");
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(cwd, { recursive: true });
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(path.join(agentDir, "settings.json"), JSON.stringify({ packages: [legacyPackage] }));
  writeFileSync(path.join(agentDir, "web-profiles.json"), JSON.stringify({
    version: 1,
    defaults: { globalProfileRef: PROFILE_REF },
    profiles: [{
      id: PROFILE_REF,
      name: "Mutable default",
      createdAt: "2026-01-02T03:04:05.000Z",
      updatedAt: "2026-01-02T03:04:05.000Z",
      tools: { builtinPreset: "none", pluginTools: "fromSelectedPlugins" },
      plugins: [mutableProfilePackage],
      skills: { mode: "pluginDefaultThenNarrow" },
    }],
  }));

  const manager = SessionManager.create(cwd, sessionDir);
  manager.newSession();
  const sessionFile = manager.getSessionFile();
  manager._rewriteFile?.();
  assert.ok(sessionFile && existsSync(sessionFile));
  const sessionId = manager.getSessionId();
  const snapshotPath = path.join(agentDir, "web-session-profiles.json");
  const snapshotStore = await loadSessionProfileStore();
  const before = await snapshotStore.getSessionProfileSnapshot(sessionId, { filePath: snapshotPath });
  assert.equal(before.state, "legacy");
  assert.equal(before.label, "Legacy / current settings");
  assert.equal(existsSync(snapshotPath), false);

  const rpc = await loadRpcManager();
  const { session, realSessionId } = await rpc.startRpcSession(sessionId, sessionFile, cwd, undefined, { agentDir });
  try {
    await session.bindExtensions();
    const tools = await session.send({ type: "get_tools" });
    assert.ok(tools.some((tool) => tool.name === "legacy_settings_tool"));
    assert.equal(tools.some((tool) => tool.name === "mutable_profile_tool"), false);
    const after = await snapshotStore.getSessionProfileSnapshot(sessionId, { filePath: snapshotPath });
    assert.equal(after.state, "legacy");
    assert.equal(after.snapshot, null);
    assert.equal(existsSync(snapshotPath), false);
  } finally {
    rpc.unregisterRpcSession(realSessionId, session);
  }
});

test("existing-session candidates bind against an isolated session-file copy", async () => {
  const root = tempDir("pi-web-isolated-candidate");
  const agentDir = path.join(root, "agent");
  const cwd = path.join(root, "project");
  const sessionDir = path.join(root, "sessions");
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(cwd, { recursive: true });
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(path.join(agentDir, "settings.json"), JSON.stringify({ packages: [] }));
  const manager = SessionManager.create(cwd, sessionDir);
  manager.appendSessionInfo("source");
  manager._rewriteFile?.();
  const sessionFile = manager.getSessionFile();
  const before = readFileSync(sessionFile);
  const canonicalCwd = realpathSync(cwd);
  const snapshot = {
    version: 1, snapshotId: "isolated-snapshot", createdAt: "2026-01-02T03:04:05.000Z",
    profileRef: PROFILE_REF, profileName: "Isolated", cwd: canonicalCwd,
    tools: { builtinPreset: "none", requestedBuiltinTools: [], pluginTools: [], activeToolNames: [], conflicts: [] },
    plugins: [], skills: { mode: "pluginDefaultThenNarrow", visibleSkillRefs: [], hiddenSkillRefs: [] }, diagnostics: [],
  };
  const rpc = await loadRpcManager();
  const { session } = await rpc.createUnregisteredRpcSessionFromFile(sessionFile, canonicalCwd, undefined, {
    agentDir, profileSnapshot: snapshot, isolateSessionFile: true,
  });
  assert.match(session.sessionFile, /\.profile-candidate-/);
  await session.bindExtensions({ forceEmptySystemPrompt: true });
  await session.promoteIsolatedSessionFile();
  assert.equal(session.sessionFile, realpathSync(sessionFile));
  assert.deepEqual(readFileSync(sessionFile), before);
  await session.shutdown();
  const deleteSource = readFileSync(path.join(process.cwd(), "app/api/sessions/[id]/route.ts"), "utf8");
  assert.match(deleteSource, /withSessionProfileMutationLock\(id/);
  assert.match(deleteSource, /await deleteSessionProfileSnapshot\(id\)/);
  assert.match(deleteSource, /await runtime\.shutdown\(\)/);
});

test("failed candidate construction removes the isolated session copy", async () => {
  const root = tempDir("pi-web-failed-isolated-candidate");
  const agentDir = path.join(root, "agent");
  const sourceCwd = path.join(root, "source");
  const requestedCwd = path.join(root, "requested");
  const sessionDir = path.join(root, "sessions");
  for (const dir of [agentDir, sourceCwd, requestedCwd, sessionDir]) mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(agentDir, "settings.json"), "{}\n");
  const manager = SessionManager.create(sourceCwd, sessionDir);
  manager.appendSessionInfo("source");
  manager._rewriteFile?.();
  const sessionFile = manager.getSessionFile();
  const canonicalRequestedCwd = realpathSync(requestedCwd);
  const snapshot = {
    version: 1, snapshotId: "failed-isolated-snapshot", createdAt: "2026-01-02T03:04:05.000Z",
    profileRef: PROFILE_REF, profileName: "Isolated", cwd: canonicalRequestedCwd,
    tools: { builtinPreset: "none", requestedBuiltinTools: [], pluginTools: [], activeToolNames: [], conflicts: [] },
    plugins: [], skills: { mode: "pluginDefaultThenNarrow", visibleSkillRefs: [], hiddenSkillRefs: [] }, diagnostics: [],
  };
  const rpc = await loadRpcManager();
  await assert.rejects(
    rpc.createUnregisteredRpcSessionFromFile(sessionFile, canonicalRequestedCwd, undefined, {
      agentDir, profileSnapshot: snapshot, isolateSessionFile: true,
    }),
    /Session file cwd/,
  );
  assert.equal(readdirSync(sessionDir).some((name) => name.includes(".profile-candidate-")), false);
});

test("new profile runtimes reserve a pending path before any JSONL write", async () => {
  const root = tempDir("pi-web-pending-new-runtime");
  const agentDir = path.join(root, "agent");
  const cwd = path.join(root, "project");
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(cwd, { recursive: true });
  writeFileSync(path.join(agentDir, "settings.json"), "{}\n");
  const canonicalCwd = realpathSync(cwd);
  const snapshot = {
    version: 1, snapshotId: "pending-new-snapshot", createdAt: "2026-01-02T03:04:05.000Z",
    profileRef: PROFILE_REF, profileName: "Pending", cwd: canonicalCwd,
    tools: { builtinPreset: "none", requestedBuiltinTools: [], pluginTools: [], activeToolNames: [], conflicts: [] },
    plugins: [], skills: { mode: "pluginDefaultThenNarrow", visibleSkillRefs: [], hiddenSkillRefs: [] }, diagnostics: [],
  };
  const rpc = await loadRpcManager();
  const { session } = await rpc.createUnregisteredRpcSession(canonicalCwd, undefined, { agentDir, profileSnapshot: snapshot });
  try {
    assert.match(session.sessionFile, /\.jsonl\.profile-pending-/);
    const canonicalSessionFile = session.stageSessionFileForPublication();
    assert.match(canonicalSessionFile, /\.jsonl$/);
    assert.equal(existsSync(canonicalSessionFile), false);
    assert.equal(existsSync(session.sessionFile), false);
  } finally {
    await session.shutdown();
  }
});

test("saved-profile restore allows session_start initialization before freezing tool policy", async () => {
  const root = tempDir("pi-web-profile-restore-binding");
  const agentDir = path.join(root, "agent");
  const cwd = path.join(root, "project");
  const sessionDir = path.join(root, "sessions");
  const packageRoot = path.join(root, "binding-package");
  const markerPath = path.join(root, "session-start-ran");
  for (const dir of [agentDir, cwd, sessionDir, path.join(packageRoot, "extensions")]) mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(agentDir, "settings.json"), "{}\n");
  writeFileSync(path.join(packageRoot, "package.json"), JSON.stringify({
    name: "profile-binding-package",
    version: "1.0.0",
    type: "module",
    pi: { extensions: ["extensions/*.mjs"] },
  }));
  writeFileSync(path.join(packageRoot, "extensions", "binding.mjs"), `import { writeFileSync } from "node:fs";
export default function ext(pi) {
  pi.on("session_start", () => {
    pi.setActiveTools(pi.getActiveTools().filter((name) => name !== "edit"));
    writeFileSync(${JSON.stringify(markerPath)}, "bound");
  });
}`);

  const manager = SessionManager.create(cwd, sessionDir);
  manager.newSession();
  manager._rewriteFile?.();
  const sessionFile = manager.getSessionFile();
  const sessionId = manager.getSessionId();
  assert.ok(sessionFile && existsSync(sessionFile));
  const canonicalCwd = realpathSync(cwd);
  const snapshot = {
    version: 1, snapshotId: "restore-binding-snapshot", createdAt: "2026-01-02T03:04:05.000Z",
    profileRef: PROFILE_REF, profileName: "Restore binding", cwd: canonicalCwd,
    tools: { builtinPreset: "full", requestedBuiltinTools: ["read", "edit"], pluginTools: [], activeToolNames: ["read", "edit"], conflicts: [] },
    plugins: [{ source: packageRoot, prompts: [], themes: [] }],
    skills: { mode: "pluginDefaultThenNarrow", visibleSkillRefs: [], hiddenSkillRefs: [] },
    diagnostics: [],
  };
  const rpc = await loadRpcManager();
  const { session, realSessionId } = await rpc.startRpcSession(sessionId, sessionFile, canonicalCwd, undefined, { agentDir, profileSnapshot: snapshot });
  try {
    assert.equal(readFileSync(markerPath, "utf8"), "bound");
    const tools = await session.send({ type: "get_tools" });
    const active = tools.filter((tool) => tool.active).map((tool) => tool.name);
    assert.ok(active.includes("read"));
    assert.ok(active.includes("edit"));
    assert.equal(session.isAlive(), true);
  } finally {
    rpc.unregisterRpcSession(realSessionId, session);
  }
});

test("existing-session routes restore saved snapshots through profile-scoped startup", () => {
  const postSource = readFileSync(path.join(process.cwd(), "app/api/agent/[id]/route.ts"), "utf8");
  assert.match(postSource, /getSessionProfileSnapshot\(id\)/);
  assert.match(postSource, /result && typeof result === "object"/);
  assert.match(postSource, /profileSnapshot: profileLookup\.snapshot/);
  assert.match(postSource, /startRpcSession\(id, binding\.sessionFilePath, binding\.cwd, undefined, runtimeOptions\)/);
  assert.ok(postSource.indexOf("getSessionProfileSnapshot(id)") < postSource.indexOf("startRpcSession(id, binding.sessionFilePath"));
  assert.match(postSource, /withSessionProfileMutationLock\(id/);

  const eventsSource = readFileSync(path.join(process.cwd(), "app/api/agent/[id]/events/route.ts"), "utf8");
  assert.match(eventsSource, /getSessionProfileSnapshot\(id\)/);
  assert.match(eventsSource, /profileSnapshot: profileLookup\.snapshot/);
  assert.match(eventsSource, /startRpcSession\(id, binding\.sessionFilePath, binding\.cwd, undefined, runtimeOptions\)/);
  assert.match(eventsSource, /withSessionProfileMutationLock\(id/);

  const rpcSource = readFileSync(path.join(process.cwd(), "lib/rpc-manager.ts"), "utf8");
  const startSource = rpcSource.slice(rpcSource.indexOf("export async function startRpcSession"));
  assert.ok(startSource.indexOf("await result.session.bindExtensions") < startSource.indexOf("registerRpcSession(result.realSessionId"));
  assert.match(startSource, /if \(profileSnapshot\) \{/);
  assert.match(startSource, /await result\?\.session\.shutdown\(\)/);
});
