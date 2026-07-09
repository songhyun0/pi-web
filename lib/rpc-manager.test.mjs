import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const { createJiti } = require("jiti");

async function loadRpcSubject(agentDir) {
  if (agentDir) process.env.PI_CODING_AGENT_DIR = agentDir;
  const jiti = createJiti(import.meta.url, { moduleCache: false });
  return jiti("./rpc-manager.ts");
}

function makeFakeSession(overrides = {}) {
  const calls = { prompt: 0, setModel: 0, setThinkingLevel: 0 };
  let activeTools = [];
  const tools = overrides.tools ?? [
    { name: "read", description: "Read", sourceInfo: { source: "builtin" } },
    { name: "bash", description: "Bash", sourceInfo: { source: "builtin" } },
    { name: "lateExtension", description: "Late", sourceInfo: { source: "extension" } },
  ];
  const fake = {
    sessionId: "fake-session",
    sessionFile: undefined,
    isStreaming: overrides.isStreaming ?? false,
    isBashRunning: overrides.isBashRunning ?? false,
    isCompacting: overrides.isCompacting ?? false,
    autoCompactionEnabled: true,
    autoRetryEnabled: true,
    model: { provider: "provider", id: "old-model" },
    modelRegistry: { find: (provider, modelId) => ({ provider, id: modelId }) },
    sessionManager: {
      getEntries: () => [],
      appendCustomEntry: () => "entry",
      getLeafId: () => null,
      branch: () => {},
      resetLeaf: () => {},
      getCwd: () => overrides.cwd ?? tmpdir(),
      getSessionDir: () => undefined,
      isPersisted: () => false,
      ...(overrides.sessionManager ?? {}),
    },
    settingsManager: {},
    agent: { state: { systemPrompt: "base", thinkingLevel: "off" } },
    extensionRunner: { getRegisteredCommands: () => [], setUIContext: () => {} },
    promptTemplates: [],
    resourceLoader: { getSkills: () => ({ skills: [] }) },
    reload: async () => {},
    subscribe: () => () => {},
    prompt: async () => { calls.prompt += 1; },
    abort: async () => {},
    setModel: async (model) => { calls.setModel += 1; fake.model = model; },
    navigateTree: async () => ({ cancelled: true }),
    setThinkingLevel: (level) => { calls.setThinkingLevel += 1; fake.agent.state.thinkingLevel = level; },
    compact: async () => null,
    setSessionName: () => {},
    getSessionStats: () => ({ sessionId: "fake-session", userMessages: 0, assistantMessages: 0, toolCalls: 0, toolResults: 0, totalMessages: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0 }),
    getLastAssistantText: () => undefined,
    getUserMessagesForForking: () => [],
    exportToHtml: async () => "",
    exportToJsonl: () => "",
    setAutoCompactionEnabled: () => {},
    setAutoRetryEnabled: () => {},
    steer: async () => {},
    followUp: async () => {},
    pendingMessageCount: 0,
    getSteeringMessages: () => [],
    getFollowUpMessages: () => [],
    clearQueue: () => ({ steering: [], followUp: [] }),
    getAllTools: () => tools,
    getActiveToolNames: () => activeTools,
    setActiveToolsByName: (names) => { activeTools = [...names]; },
    abortCompaction: () => {},
    executeBash: async () => ({ output: "", exitCode: 0, cancelled: false, truncated: false }),
    abortBash: () => {},
    getContextUsage: () => undefined,
    ...overrides.session,
  };
  return { fake, calls, tools, getActiveTools: () => activeTools };
}
test("RPC session startup preloads extension-registered providers before restoring models", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const startupSource = source.slice(source.indexOf("export async function startRpcSession"));

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

test("profile state preserves explicit new-session model and thinking overrides", async () => {
  const rpcSource = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const newRouteSource = await readFile(new URL("../app/api/agent/new/route.ts", import.meta.url), "utf8");

  assert.match(rpcSource, /modelOverride\?: boolean/);
  assert.match(rpcSource, /thinkingOverride\?: boolean/);
  assert.match(rpcSource, /persisted\.modelOverride \? \{ provider: undefined, modelId: undefined \}/);
  assert.match(rpcSource, /persisted\.thinkingOverride \? \{ thinkingLevel: undefined \}/);
  assert.match(newRouteSource, /profileModelOverride: hasRequestModelOverride/);
  assert.match(newRouteSource, /profileThinkingOverride: hasRequestThinkingOverride/);
  assert.match(newRouteSource, /const hasRequestThinkingOverride = requestedThinkingLevel !== undefined/);
  assert.match(newRouteSource, /const shouldApplyRequestThinkingLevel = requestedThinkingLevel !== undefined && requestedThinkingLevel !== "auto"/);
  assert.match(newRouteSource, /profileThinkingOverride: hasRequestThinkingOverride/);
});

test("explicit thinking auto overrides persist without changing SDK thinking", async () => {
  const { AgentSessionWrapper } = await loadRpcSubject();
  const appended = [];
  const profile = {
    profileRef: "builtin:full",
    profileName: "Full",
    toolNames: ["read"],
    includeExtensionTools: true,
    extensionToolMode: "all",
    instructions: { mode: "default", files: [] },
    resources: { skillPaths: [], promptPaths: [], themePaths: [] },
  };
  const profileStateRef = {
    current: {
      cwd: tmpdir(),
      persisted: { profileRef: "builtin:full" },
      profile,
      signature: "profile",
      snapshots: new Set(),
      refresh: () => profile,
    },
  };
  const { fake, calls } = makeFakeSession({
    sessionManager: {
      appendCustomEntry: (type, data) => { appended.push({ type, data }); return "entry"; },
    },
  });
  const wrapper = new AgentSessionWrapper(fake, profileStateRef, tmpdir());
  try {
    await wrapper.send({ type: "set_thinking_level", level: "auto" });

    assert.equal(calls.setThinkingLevel, 0);
    assert.equal(profileStateRef.current.persisted.thinkingOverride, true);
    assert.equal(appended.at(-1)?.data.thinkingOverride, true);
  } finally {
    wrapper.destroy();
  }
});

test("profile model and thinking application stays session-local", async () => {
  const { AgentSessionWrapper } = await loadRpcSubject();
  const profileModel = { provider: "provider", id: "profile-model", reasoning: true };
  const profile = {
    profileRef: "global:model-profile",
    profileName: "Model Profile",
    provider: "provider",
    modelId: "profile-model",
    thinkingLevel: "high",
    toolNames: ["read"],
    includeExtensionTools: true,
    extensionToolMode: "all",
    instructions: { mode: "default", files: [] },
    resources: { skillPaths: [], promptPaths: [], themePaths: [] },
  };
  const { fake, calls } = makeFakeSession({
    session: {
      model: { provider: "provider", id: "old-model", reasoning: true },
      modelRegistry: { find: () => profileModel },
    },
  });
  const wrapper = new AgentSessionWrapper(fake, { current: undefined }, tmpdir());
  try {
    wrapper.applyProfileModelAndThinking(profile);

    assert.equal(calls.setModel, 0);
    assert.equal(fake.model.id, "old-model");
    assert.equal(fake.agent.state.model.id, "profile-model");
    assert.equal(calls.setThinkingLevel, 0);
    assert.equal(fake.agent.state.thinkingLevel, "high");
  } finally {
    wrapper.destroy();
  }
});

test("extension binding reapplies profile tool policy after dynamic tools register", async () => {
  const { AgentSessionWrapper } = await loadRpcSubject();
  const tools = [
    { name: "read", description: "Read", sourceInfo: { source: "builtin" } },
  ];
  const { fake, getActiveTools } = makeFakeSession({
    tools,
    session: {
      bindExtensions: async () => {
        tools.push({ name: "lateExtension", description: "Late", sourceInfo: { source: "extension" } });
      },
    },
  });
  const wrapper = new AgentSessionWrapper(fake, { current: undefined }, tmpdir());
  try {
    wrapper.setActiveToolPolicy(["read"], true, "all");
    assert.deepEqual(getActiveTools(), ["read"]);

    wrapper.beginExtensionBinding({ forceEmptySystemPrompt: false });
    await wrapper.send({ type: "get_commands" });

    assert.deepEqual(new Set(getActiveTools()), new Set(["read", "lateExtension"]));
  } finally {
    wrapper.destroy();
  }
});

test("profile selector does not create hidden localStorage default overrides", async () => {
  const hookSource = await readFile(new URL("../hooks/useAgentSession.ts", import.meta.url), "utf8");
  const storageSource = hookSource.slice(
    hookSource.indexOf("function readStoredProfileSelection"),
    hookSource.indexOf("function readStoredThinkingLevel")
  );
  const handlerSource = hookSource.slice(
    hookSource.indexOf("const handleProfileChange"),
    hookSource.indexOf("const scrollToBottom")
  );
  const profilesLoadSource = hookSource.slice(
    hookSource.indexOf("setActiveProfileRef((current)"),
    hookSource.indexOf("} catch (error)", hookSource.indexOf("setActiveProfileRef((current)"))
  );

  assert.match(storageSource, /removeLocalStorageValue\(PROFILE_STORAGE_KEY\)/);
  assert.match(storageSource, /removeLocalStorageValue\(TOOL_PRESET_STORAGE_KEY\)/);
  assert.match(hookSource, /if \(!isNew\) return undefined/);
  assert.match(hookSource, /profileStorageCheckedRef\.current = true/);
  assert.doesNotMatch(handlerSource, /writeLocalStorageValue\(PROFILE_STORAGE_KEY/);
  assert.match(handlerSource, /newSessionProfileOverrideRef\.current = true/);
  assert.match(profilesLoadSource, /initialProfileSelectionSourceRef\.current/);
  assert.match(profilesLoadSource, /newSessionProfileOverrideRef\.current/);
});

test("profile tool policy interposes late active-tool mutations", async () => {
  const { AgentSessionWrapper } = await loadRpcSubject();
  const { fake, getActiveTools } = makeFakeSession();
  const wrapper = new AgentSessionWrapper(fake, { current: undefined }, tmpdir());
  try {
    wrapper.setActiveToolPolicy(["read"], false, "none");
    assert.deepEqual(getActiveTools(), ["read"]);

    fake.setActiveToolsByName(["lateExtension"]);

    assert.deepEqual(getActiveTools(), ["read"]);
  } finally {
    wrapper.destroy();
  }
});

test("profile tool policy fails safe on extension tool shadowing", async () => {
  const { AgentSessionWrapper } = await loadRpcSubject();
  const { fake, getActiveTools } = makeFakeSession({
    tools: [
      { name: "read", description: "Built-in read", sourceInfo: { source: "builtin" } },
      { name: "read", description: "Extension read", sourceInfo: { source: "extension" } },
    ],
  });
  const wrapper = new AgentSessionWrapper(fake, { current: undefined }, tmpdir());
  try {
    assert.throws(() => wrapper.setActiveToolPolicy(["read"], false, "none"), /shadow allowed built-in tool names/);
    assert.deepEqual(getActiveTools(), []);
  } finally {
    wrapper.destroy();
  }
});

test("profile switches can recover from a no-extension shadow policy error", async () => {
  const agentDir = mkdtempSync(path.join(tmpdir(), "pi-web-rpc-agent-"));
  const cwd = mkdtempSync(path.join(tmpdir(), "pi-web-rpc-cwd-"));
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(path.join(agentDir, "settings.json"), `${JSON.stringify({
    agentProfiles: {
      version: 1,
      profiles: [{
        id: "extension-ok",
        name: "Extension OK",
        thinkingLevel: "auto",
        tools: { mode: "custom", toolNames: ["read"], includeExtensionTools: true },
        instructions: { mode: "default", files: [] },
        resources: { skillPaths: [], promptPaths: [], themePaths: [] },
      }],
    },
  }, null, 2)}\n`);
  const { AgentSessionWrapper } = await loadRpcSubject(agentDir);
  const { fake } = makeFakeSession({
    cwd,
    tools: [
      { name: "read", description: "Built-in read", sourceInfo: { source: "builtin" } },
      { name: "read", description: "Extension read", sourceInfo: { source: "extension" } },
    ],
  });
  const wrapper = new AgentSessionWrapper(fake, { current: undefined }, cwd);
  try {
    assert.throws(() => wrapper.setActiveToolPolicy(["read"], false, "none"), /shadow allowed built-in tool names/);

    const result = await wrapper.send({ type: "set_profile", profileRef: "global:extension-ok" });

    assert.equal(result.profileRef, "global:extension-ok");
  } finally {
    wrapper.destroy();
  }
});

test("model and thinking changes are rejected while running", async () => {
  const { AgentSessionWrapper } = await loadRpcSubject();
  const { fake, calls } = makeFakeSession({ isStreaming: true });
  const wrapper = new AgentSessionWrapper(fake, { current: undefined }, tmpdir());
  try {
    await assert.rejects(
      () => wrapper.send({ type: "set_model", provider: "provider", modelId: "new-model" }),
      /Cannot change model while the session is running/,
    );
    await assert.rejects(
      () => wrapper.send({ type: "set_thinking_level", level: "high" }),
      /Cannot change thinking level while the session is running/,
    );
    assert.equal(calls.setModel, 0);
    assert.equal(calls.setThinkingLevel, 0);
  } finally {
    wrapper.destroy();
  }
});

test("no-tools profile changes preserve resource prompt contributions", async () => {
  const { AgentSessionWrapper } = await loadRpcSubject();
  const resourceProfile = {
    profileRef: "project:styleseed",
    profileName: "StyleSeed",
    toolNames: ["read"],
    includeExtensionTools: false,
    extensionToolMode: "none",
    instructions: { mode: "default", files: [] },
    resources: {
      skillPaths: [{ scope: "project", path: "styleseed/skills/review", resolvedPath: path.join(tmpdir(), "styleseed/skills/review") }],
      promptPaths: [],
      themePaths: [],
    },
  };
  const profileStateRef = {
    current: {
      cwd: tmpdir(),
      persisted: { profileRef: "project:styleseed" },
      profile: resourceProfile,
      signature: "resource",
      snapshots: new Set(),
      refresh: () => resourceProfile,
    },
  };
  const { fake } = makeFakeSession();
  const wrapper = new AgentSessionWrapper(fake, profileStateRef, tmpdir());
  try {
    await wrapper.send({ type: "set_tools", toolNames: [], includeExtensionTools: false });

    assert.equal(fake.agent.state.systemPrompt, "base");
  } finally {
    wrapper.destroy();
  }
});

test("missing persisted profiles surface errors and block prompts", async () => {
  const agentDir = mkdtempSync(path.join(tmpdir(), "pi-web-rpc-agent-"));
  const cwd = mkdtempSync(path.join(tmpdir(), "pi-web-rpc-cwd-"));
  const { AgentSessionWrapper } = await loadRpcSubject(agentDir);
  const missingProfile = {
    profileRef: "global:missing",
    profileName: "Missing",
    toolNames: [],
    includeExtensionTools: false,
    extensionToolMode: "none",
    instructions: { mode: "default", files: [] },
    resources: { skillPaths: [], promptPaths: [], themePaths: [] },
  };
  const profileStateRef = {
    current: {
      cwd,
      persisted: { profileRef: "global:missing" },
      profile: missingProfile,
      signature: "missing",
      snapshots: new Set(),
      refresh: () => missingProfile,
    },
  };
  const { fake, calls } = makeFakeSession({ cwd });
  const wrapper = new AgentSessionWrapper(fake, profileStateRef, cwd);
  try {
    wrapper.setActiveToolPolicy([], false, "none", true);
    await assert.rejects(
      () => wrapper.send({ type: "prompt", message: "hello" }),
      /Failed to restore profile global:missing/,
    );
    assert.equal(calls.prompt, 0);
    const state = await wrapper.send({ type: "get_state" });
    assert.equal(state.profile.ref, "global:missing");
    assert.equal(state.profile.missing, true);
    assert.match(state.profile.error, /Failed to restore profile global:missing/);
  } finally {
    wrapper.destroy();
  }
});

test("fast toggle is blocked when persisted profile cannot be restored", async () => {
  const agentDir = mkdtempSync(path.join(tmpdir(), "pi-web-rpc-agent-"));
  const cwd = mkdtempSync(path.join(tmpdir(), "pi-web-rpc-cwd-"));
  const { AgentSessionWrapper } = await loadRpcSubject(agentDir);
  const missingProfile = {
    profileRef: "global:missing",
    profileName: "Missing",
    toolNames: [],
    includeExtensionTools: false,
    extensionToolMode: "none",
    instructions: { mode: "default", files: [] },
    resources: { skillPaths: [], promptPaths: [], themePaths: [] },
  };
  const profileStateRef = {
    current: {
      cwd,
      persisted: { profileRef: "global:missing" },
      profile: missingProfile,
      signature: "missing",
      snapshots: new Set(),
      refresh: () => missingProfile,
    },
  };
  const { fake, calls } = makeFakeSession({
    cwd,
    session: {
      model: { provider: "openai-codex", id: "gpt-5.4" },
      extensionRunner: {
        getRegisteredCommands: () => [{ invocationName: "fast", description: "Fast" }],
        setUIContext: () => {},
      },
    },
  });
  const wrapper = new AgentSessionWrapper(fake, profileStateRef, cwd);
  try {
    wrapper.setActiveToolPolicy([], false, "none", true);
    await assert.rejects(
      () => wrapper.send({ type: "toggle_openai_fast" }),
      /Failed to restore profile global:missing/,
    );
    assert.equal(calls.prompt, 0);
  } finally {
    wrapper.destroy();
  }
});

test("profile UI keeps draft runtime profile stable and bounded", async () => {
  const hookSource = await readFile(new URL("../hooks/useAgentSession.ts", import.meta.url), "utf8");
  const inputSource = await readFile(new URL("../components/ChatInput.tsx", import.meta.url), "utf8");
  const profilesLoadSource = hookSource.slice(
    hookSource.indexOf("setActiveProfileRef((current)"),
    hookSource.indexOf("} catch (error)", hookSource.indexOf("setActiveProfileRef((current)")),
  );
  const ensureSource = hookSource.slice(
    hookSource.indexOf("const ensureNewSession"),
    hookSource.indexOf("const loadSlashCommands"),
  );

  assert.match(profilesLoadSource, /sessionIdRef\.current/);
  assert.match(profilesLoadSource, /return current;/);
  assert.match(ensureSource, /sendAgentCommand<AgentStateResponse>\(realId, \{ type: "get_state" \}\)/);
  assert.match(hookSource, /state\.profile === null/);
  assert.match(inputSource, /profileUnavailable/);
  assert.match(inputSource, /Profile unavailable/);
  assert.match(inputSource, /overflowY: "auto"/);
  assert.match(inputSource, /maxHeight: "min\(360px, calc\(100vh - 160px\)\)"/);
});
