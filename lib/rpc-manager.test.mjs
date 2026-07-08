import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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

test("explicit thinking auto overrides are sent and persisted without changing SDK thinking", async () => {
  const rpcSource = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const hookSource = await readFile(new URL("../hooks/useAgentSession.ts", import.meta.url), "utf8");
  const thinkingCaseSource = rpcSource.slice(
    rpcSource.indexOf('case "set_thinking_level"'),
    rpcSource.indexOf('case "compact"')
  );
  const handlerSource = hookSource.slice(
    hookSource.indexOf("const handleThinkingLevelChange"),
    hookSource.indexOf("const handleProfileChange")
  );

  assert.match(thinkingCaseSource, /if \(level !== "auto"\) this\.setThinkingLevel\(level\)/);
  assert.match(thinkingCaseSource, /this\.persistProfileOverrideFlags\(\{ thinkingOverride: true \}\)/);
  assert.doesNotMatch(handlerSource, /if \(level === "auto"\) return/);
});

test("profile model and thinking application does not mutate saved defaults", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const methodSource = source.slice(
    source.indexOf("applyProfileModelAndThinking(profile"),
    source.indexOf('case "get_state"')
  );

  assert.match(methodSource, /setSessionModelForProfile\(model\)/);
  assert.match(methodSource, /setSessionThinkingLevelForProfile\(profile\.thinkingLevel\)/);
  assert.doesNotMatch(methodSource, /inner\.setModel\(/);
  assert.doesNotMatch(methodSource, /setThinkingLevel\(profile\.thinkingLevel\)/);
});

test("extension binding reapplies profile tool policy after dynamic tools register", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const bindingSource = source.slice(
    source.indexOf("private ensureExtensionsBound"),
    source.indexOf("private async waitForExtensionsBound")
  );
  const bindIndex = bindingSource.indexOf("await bindExtensions.call");
  const applyIndex = bindingSource.indexOf("this.applyActiveToolPolicy();", bindIndex);

  assert.ok(bindIndex >= 0, "session_start binding should be present");
  assert.ok(applyIndex > bindIndex, "profile tool policy must be reapplied after session_start dynamic tool registration");
  assert.doesNotMatch(bindingSource.slice(bindIndex), /this\.applyForcedEmptySystemPrompt\(\);/);
  assert.match(source, /function assertNoExtensionToolShadows/);
  assert.match(source, /tool\.sourceInfo\?\.source !== "builtin"/);
  assert.match(source, /assertNoExtensionToolShadows\(session, toolNames, includeExtensionTools, extensionToolMode\)/);
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
