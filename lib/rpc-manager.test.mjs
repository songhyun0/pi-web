import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !specifier.match(/\.[cm]?[jt]sx?$/) && !specifier.includes("?")) {
      try { return nextResolve(`${specifier}.ts`, context); } catch {}
    }
    return nextResolve(specifier, context);
  },
});

let importCounter = 0;

function tempDir(name = "pi-web-rpc-profile-derived") {
  const dir = path.join(tmpdir(), `${name}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

test("RPC session startup preloads extension-registered providers before restoring models", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const wrapperStart = source.indexOf("async function createRpcSessionWrapper");
  const startStart = source.indexOf("export async function startRpcSession");
  const startupSource = source.slice(wrapperStart, startStart);

  assert.match(startupSource, /createAgentSessionServices\(/);
  assert.match(startupSource, /createAgentSessionFromServices\(/);
  assert.doesNotMatch(startupSource, /await createAgentSession\(/);
});

test("Fast mode is not restored through hidden slash-command prompts", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const promptCaseSource = source.slice(
    source.indexOf('case "prompt"'),
    source.indexOf('case "abort"')
  );

  assert.doesNotMatch(promptCaseSource, /\/fast/);
  assert.doesNotMatch(source, /applyRememberedOpenAIFastPreference/);
});

test("profile-backed clones inherit a fresh immutable capability snapshot", async () => {
  const root = tempDir();
  const agentDir = path.join(root, "agent");
  const cwd = path.join(root, "project");
  const sessionDir = path.join(root, "sessions");
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(cwd, { recursive: true });
  mkdirSync(sessionDir, { recursive: true });
  const manager = SessionManager.create(cwd, sessionDir);
  manager.appendSessionInfo("clone source");
  manager._rewriteFile?.();
  const snapshot = {
    version: 1,
    snapshotId: "source-snapshot",
    createdAt: "2026-01-01T00:00:00.000Z",
    profileRef: "profile:00000000-0000-4000-8000-000000000001",
    profileName: "Restricted",
    cwd,
    tools: { builtinPreset: "none", requestedBuiltinTools: [], pluginTools: [], activeToolNames: [], conflicts: [] },
    plugins: [],
    skills: { mode: "pluginDefaultThenNarrow", visibleSkillRefs: [], hiddenSkillRefs: [] },
    diagnostics: [],
  };
  let disposeCalls = 0;
  const fakeInner = {
    sessionId: manager.getSessionId(),
    sessionFile: manager.getSessionFile(),
    sessionManager: manager,
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    getAllTools: () => [],
    getActiveToolNames: () => [],
    setActiveToolsByName: () => undefined,
    resourceLoader: { getSkills: () => ({ skills: [], diagnostics: [] }) },
    extensionRunner: { emit: async () => undefined, invalidate: () => undefined },
    dispose: () => { disposeCalls += 1; },
  };
  const rpc = await import(`./rpc-manager.ts?derived=${++importCounter}`);
  const snapshotStore = await import(`./session-profile-store.ts?derived=${++importCounter}`);
  const wrapper = new rpc.AgentSessionWrapper(fakeInner, snapshot, agentDir);

  const result = await wrapper.send({ type: "clone" });
  assert.equal(result.cancelled, false);
  const lookup = await snapshotStore.getSessionProfileSnapshot(result.newSessionId, { agentDir });
  assert.equal(lookup.state, "snapshot");
  assert.equal(lookup.snapshot.profileRef, snapshot.profileRef);
  assert.notEqual(lookup.snapshot.snapshotId, snapshot.snapshotId);
  assert.deepEqual(lookup.snapshot.tools.activeToolNames, []);
  assert.equal(lookup.record.sessionFilePath.endsWith(`${result.newSessionId}.jsonl`), true);
  await wrapper.shutdown();
  assert.equal(disposeCalls, 1);
});
