import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !specifier.match(/\.[cm]?[jt]sx?$/) && !specifier.includes("?")) {
      try { return nextResolve(`${specifier}.ts`, context); } catch {}
    }
    return nextResolve(specifier, context);
  },
});

let importCounter = 0;
async function loadCore() {
  importCounter += 1;
  return import(`./profile-ui-core.ts?case=${importCounter}`);
}

const PROFILE_REF = "profile:00000000-0000-4000-8000-000000000001";

function profile(id = PROFILE_REF, name = "Profile") {
  return { id, name };
}

test("new-session profile payload never includes legacy toolNames", async () => {
  const { buildNewSessionProfilePayload } = await loadCore();
  assert.deepEqual(buildNewSessionProfilePayload({ cwd: "/repo" }), { cwd: "/repo", type: "ensure_session" });
  assert.deepEqual(buildNewSessionProfilePayload({ cwd: "/repo", profileRef: PROFILE_REF, provider: "openai", modelId: "gpt", thinkingLevel: "high" }), {
    cwd: "/repo",
    type: "ensure_session",
    profileRef: PROFILE_REF,
    provider: "openai",
    modelId: "gpt",
    thinkingLevel: "high",
  });
  assert.equal("toolNames" in buildNewSessionProfilePayload({ cwd: "/repo", profileRef: PROFILE_REF }), false);
});

test("last-used profile refs are validated conveniences, not defaults", async () => {
  const { profileRefExists, profileDisplayName } = await loadCore();
  assert.equal(profileRefExists(PROFILE_REF, [profile()]), true);
  assert.equal(profileRefExists("profile:missing", [profile()]), false);
  assert.equal(profileDisplayName({ profiles: [profile(PROFILE_REF, "Saved")], globalDefaultProfileRef: PROFILE_REF, newSession: true }), "Default: Saved");
});

test("diagnostics and tool conflicts are summarized separately", async () => {
  const { summarizeProfileIssues } = await loadCore();
  const snapshot = {
    diagnostics: [
      { type: "warning", message: "hidden wins" },
      { type: "warning", message: "Enabled extension tool metadata will be resolved from the isolated session runtime." },
      { type: "error", message: "metadata unknown" },
    ],
    tools: { conflicts: [{ name: "read", builtinSelected: true, selectedProvider: "plugin", message: "override" }] },
  };
  const summary = summarizeProfileIssues(snapshot);
  assert.equal(summary.warningCount, 1);
  assert.equal(summary.errorCount, 1);
  assert.equal(summary.conflictCount, 1);
  assert.equal(summary.hasIssues, true);
});

test("plugin changes clear stale hidden skill refs", async () => {
  const { reconcileHiddenSkillRefsForPlugins } = await loadCore();
  const refs = [
    { source: "pkg-a", scope: "package", path: "skills/a/SKILL.md", name: "a" },
    { source: "pkg-b", scope: "package", path: "skills/b/SKILL.md", name: "b" },
    { source: "/skills/local/SKILL.md", scope: "user", path: "/skills/local/SKILL.md", name: "local" },
  ];
  assert.deepEqual(reconcileHiddenSkillRefsForPlugins(refs, ["pkg-b"]), [refs[1], refs[2]]);
});

test("skill toggles update authoritative PackageSource.skills filters", async () => {
  const { updatePackageSkillVisibility } = await loadCore();
  const review = { source: "pkg-a", scope: "package", path: "skills/review/SKILL.md", name: "review" };
  const audit = { source: "pkg-a", scope: "package", path: "skills/audit/SKILL.md", name: "audit" };
  const initial = [{ source: "pkg-a", extensions: ["+extensions/**"], prompts: [], themes: [] }];

  const narrowed = updatePackageSkillVisibility(initial, [review, audit], [review, audit], audit, false);
  assert.deepEqual(narrowed.plugins, [{
    source: "pkg-a",
    extensions: ["+extensions/**"],
    skills: ["!**", "+skills/review/SKILL.md"],
    prompts: [],
    themes: [],
  }]);
  const widened = updatePackageSkillVisibility(narrowed.plugins, [review, audit], [review], audit, true);
  assert.deepEqual(widened.plugins, [{ source: "pkg-a", extensions: ["+extensions/**"], prompts: [], themes: [] }]);
});

test("frontend source has no editable legacy tool override path", () => {
  const useAgent = readFileSync(path.join(process.cwd(), "hooks/useAgentSession.ts"), "utf8");
  assert.doesNotMatch(useAgent, /TOOL_PRESET_STORAGE_KEY/);
  assert.doesNotMatch(useAgent, /getToolNamesForPreset/);
  assert.doesNotMatch(useAgent, /type:\s*["']set_tools["']/);
  assert.doesNotMatch(useAgent, /toolNames/);

  const chatInput = readFileSync(path.join(process.cwd(), "components/ChatInput.tsx"), "utf8");
  assert.doesNotMatch(chatInput, /onToolPresetChange/);
  assert.doesNotMatch(chatInput, /toolPreset/);
  assert.match(chatInput, /profileSelector/);
});

test("profile UI uses server APIs and avoids project default or prompt-theme controls", () => {
  const files = [
    "hooks/useProfiles.ts",
    "hooks/useSessionProfile.ts",
    "components/ProfileSelector.tsx",
    "components/ProfileManagerModal.tsx",
    "components/ProfileWizard.tsx",
  ].map((file) => readFileSync(path.join(process.cwd(), file), "utf8")).join("\n");
  assert.match(files, /\/api\/profiles/);
  assert.match(files, /\/api\/profiles\/preview/);
  assert.match(files, /\/api\/sessions\/\$\{encodeURIComponent\(targetSessionId\)\}\/profile/);
  assert.match(files, /sessionId \?\? materializedSessionId/);
  assert.doesNotMatch(files, /projectDefault|project default|settings\.json|promptsOverride|themesOverride/i);
});

test("compact OpenAI Fast control always exposes feature and state", () => {
  const chatInput = readFileSync(path.join(process.cwd(), "components/ChatInput.tsx"), "utf8");
  const fastControl = readFileSync(path.join(process.cwd(), "components/OpenAIFastCompactControl.tsx"), "utf8");
  assert.match(chatInput, /<OpenAIFastCompactControl/);
  assert.match(fastControl, />OpenAI Fast<\/span>/);
  assert.match(fastControl, /compactState: unavailable \? "Unavailable"/);
  assert.match(fastControl, /aria-label=\{`OpenAI Fast — \$\{state\.compactState\}`\}/);
  assert.doesNotMatch(chatInput, /openAIFastCompactLabel/);
});

test("profile setup warnings and server errors remain visible", () => {
  const useProfiles = readFileSync(path.join(process.cwd(), "hooks/useProfiles.ts"), "utf8");
  const chatWindow = readFileSync(path.join(process.cwd(), "components/ChatWindow.tsx"), "utf8");
  const selector = readFileSync(path.join(process.cwd(), "components/ProfileSelector.tsx"), "utf8");
  const manager = readFileSync(path.join(process.cwd(), "components/ProfileManagerModal.tsx"), "utf8");
  const wizard = readFileSync(path.join(process.cwd(), "components/ProfileWizard.tsx"), "utf8");
  const useAgent = readFileSync(path.join(process.cwd(), "hooks/useAgentSession.ts"), "utf8");
  const useSessionProfile = readFileSync(path.join(process.cwd(), "hooks/useSessionProfile.ts"), "utf8");

  assert.match(useProfiles, /warnings:\s*string\[\]/);
  assert.match(useProfiles, /setWarnings/);
  assert.match(chatWindow, /setupWarnings=\{profilesState\.warnings\}/);
  assert.match(selector, /Profile setup/);
  assert.match(manager, /profilesState\.warnings\.map/);
  assert.match(manager, /\/api\/plugins\?cwd=/);
  assert.match(manager, /plugin\.packageSource/);
  assert.match(manager, /inventoryDiagnostics/);
  const pluginsRoute = readFileSync(path.join(process.cwd(), "app/api/plugins/route.ts"), "utf8");
  assert.match(pluginsRoute, /settingsManager\.drainErrors\(\)/);
  assert.match(pluginsRoute, /Global settings\.json must contain a JSON object/);
  assert.match(wizard, /preview\?\.skills\.hiddenSkillRefs/);
  assert.match(wizard, /removedPluginsRef/);
  const ensureSource = useAgent.slice(useAgent.indexOf("const ensureNewSession"), useAgent.indexOf("const loadSlashCommands"));
  assert.ok(ensureSource.indexOf("await res.json()") < ensureSource.indexOf("if (!res.ok)"));
  assert.match(useAgent, /setRuntimeTools\(\[\]\)/);
  assert.match(useAgent, /Failed to refresh runtime tools/);
  assert.match(useAgent, /optimisticUserMessageTimestampRef/);
  assert.match(useAgent, /const reconcileProfileRuntime/);
  assert.match(chatWindow, /onAfterSwitch: reconcileAfterProfileSwitch/);
  assert.ok(useSessionProfile.indexOf("await onAfterSwitch?.(targetSessionId)") < useSessionProfile.indexOf("setResponse(result)"));
  assert.match(useAgent, /runtimeEpochRef\.current \+= 1/);
  assert.match(useAgent, /requestEpoch !== runtimeEpochRef\.current/);
  assert.match(useAgent, /eventSourceRef\.current\?\.close\(\)/);
  assert.match(selector, /role="alert"/);
  assert.match(chatWindow, /agentRunning \|\| isCompacting \|\| sessionProfile\.applying/);
});
