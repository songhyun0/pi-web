import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createAgentSessionServices, DefaultPackageManager, SettingsManager } from "@earendil-works/pi-coding-agent";

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

async function loadRuntime() {
  importCounter += 1;
  return import(`./profile-runtime.ts?case=${importCounter}`);
}

async function loadRpcManager() {
  importCounter += 1;
  return import(`./rpc-manager.ts?case=${importCounter}`);
}

async function loadUiCore() {
  importCounter += 1;
  return import(`./profile-ui-core.ts?case=${importCounter}`);
}

function tempDir(name = "pi-web-profile-runtime") {
  const dir = path.join(tmpdir(), `${name}-${process.pid}-${importCounter}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function extensionSource(toolName, markerPath) {
  return `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(markerPath)}, "loaded");\nexport default function ext(pi) {\n  pi.registerTool({ name: ${JSON.stringify(toolName)}, description: ${JSON.stringify(toolName)}, parameters: {}, execute: async () => "ok" });\n}\n`;
}

function makePackage({ toolName = "pkg_tool", markerPath = path.join(tempDir("marker"), "loaded"), skillNames = ["review", "audit"], includePromptTheme = true } = {}) {
  const root = tempDir("pi-web-runtime-package");
  mkdirSync(path.join(root, "extensions"), { recursive: true });
  mkdirSync(path.join(root, "skills"), { recursive: true });
  writeFileSync(path.join(root, "extensions", "tool.mjs"), extensionSource(toolName, markerPath));
  for (const skillName of skillNames) {
    const skillDir = path.join(root, "skills", skillName);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(path.join(skillDir, "SKILL.md"), `---\nname: ${skillName}\ndescription: ${skillName}\n---\n# ${skillName}\n`);
  }
  if (includePromptTheme) {
    mkdirSync(path.join(root, "prompts"), { recursive: true });
    mkdirSync(path.join(root, "themes"), { recursive: true });
    writeFileSync(path.join(root, "prompts", "prompt.md"), "# prompt\n");
    writeFileSync(path.join(root, "themes", "theme.json"), JSON.stringify({ name: "runtime-test-theme", colors: {} }));
  }
  writeFileSync(path.join(root, "package.json"), JSON.stringify({
    name: `pkg-${path.basename(root)}`,
    pi: {
      extensions: ["extensions/*.mjs"],
      skills: ["skills/**/SKILL.md"],
      prompts: ["prompts/*.md"],
      themes: ["themes/*.json"],
    },
  }, null, 2));
  return root;
}

function writeAutoExtension(dir, toolName, markerPath) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${toolName}.mjs`), extensionSource(toolName, markerPath));
}

function writeAutoSkill(dir, skillName) {
  const skillDir = path.join(dir, skillName);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(path.join(skillDir, "SKILL.md"), `---\nname: ${skillName}\ndescription: ${skillName}\n---\n# ${skillName}\n`);
}

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function sampleSnapshot({ plugins = [], requestedBuiltinTools = ["read", "bash", "edit", "write"], activeToolNames = requestedBuiltinTools, pluginTools = [], hiddenSkillRefs = [], visibleSkillRefs = [] } = {}) {
  return {
    version: 1,
    snapshotId: "snap-runtime-test",
    createdAt: "2026-01-01T00:00:00.000Z",
    profileRef: "profile:11111111-1111-4111-8111-111111111111",
    profileName: "Runtime Test",
    cwd: tempDir("snapshot-cwd"),
    tools: {
      builtinPreset: "default",
      requestedBuiltinTools,
      pluginTools,
      activeToolNames,
      conflicts: [],
    },
    plugins,
    skills: {
      mode: "pluginDefaultThenNarrow",
      visibleSkillRefs,
      hiddenSkillRefs,
    },
    diagnostics: [],
  };
}

function sourceInfo(source, filePath, baseDir) {
  return { source, path: filePath, scope: "user", origin: "package", baseDir };
}

test("normalizeProfilePackages preserves Pi filters while forcing prompts and themes empty", async () => {
  const { normalizeProfilePackages } = await import(`./profiles.ts?case=${++importCounter}`);
  const normalized = normalizeProfilePackages([
    "pkg-a",
    { source: "pkg-b", extensions: [], skills: ["!skills/**", "+skills/review/SKILL.md"] },
  ]);

  assert.deepEqual(normalized, [
    { source: "pkg-a", prompts: [], themes: [] },
    { source: "pkg-b", extensions: [], skills: ["!skills/**", "+skills/review/SKILL.md"], prompts: [], themes: [] },
  ]);
  assert.equal("extensions" in normalized[0], false);
  assert.throws(() => normalizeProfilePackages([{ source: "pkg-c", unsupported: [] }]), /not a supported PackageSource key/);
});

test("profile-scoped settings manager preserves non-resource settings and suppresses base resources without writes", async () => {
  const agentDir = tempDir("pi-web-runtime-agent");
  const cwd = tempDir("pi-web-runtime-cwd");
  const selectedPkg = makePackage();
  const basePkg = makePackage();
  const globalSettingsPath = path.join(agentDir, "settings.json");
  const projectSettingsPath = path.join(cwd, ".pi", "settings.json");
  writeJson(globalSettingsPath, {
    defaultProvider: "global-provider",
    defaultModel: "global-model",
    npmCommand: ["npm", "--global-test"],
    defaultProjectTrust: "never",
    packages: [basePkg],
    extensions: ["global-extension.mjs"],
    skills: ["global-skills"],
    prompts: ["global-prompts"],
    themes: ["global-themes"],
  });
  writeJson(projectSettingsPath, {
    defaultModel: "project-model",
    packages: [makePackage()],
    extensions: ["project-extension.mjs"],
    skills: ["project-skills"],
    prompts: ["project-prompts"],
    themes: ["project-themes"],
  });
  const beforeGlobal = readFileSync(globalSettingsPath, "utf8");
  const beforeProject = readFileSync(projectSettingsPath, "utf8");
  const { createProfileScopedSettingsManager } = await loadRuntime();

  const manager = createProfileScopedSettingsManager({ cwd, agentDir, snapshot: sampleSnapshot({ plugins: [selectedPkg] }), projectTrusted: true });
  const deniedManager = createProfileScopedSettingsManager({ cwd, agentDir, snapshot: sampleSnapshot({ plugins: [selectedPkg] }), projectTrusted: false });
  assert.equal(deniedManager.isProjectTrusted(), false);
  assert.equal(manager.getDefaultProvider(), "global-provider");
  assert.equal(manager.getDefaultModel(), "project-model");
  assert.deepEqual(manager.getNpmCommand(), ["npm", "--global-test"]);
  assert.deepEqual(manager.getGlobalSettings().packages, [{ source: selectedPkg, prompts: [], themes: [] }]);
  assert.deepEqual(manager.getGlobalSettings().extensions, ["!**"]);
  assert.deepEqual(manager.getProjectSettings().packages, []);
  assert.deepEqual(manager.getProjectSettings().skills, ["!**"]);
  assert.deepEqual(manager.getExtensionPaths(), []);
  assert.deepEqual(manager.getSkillPaths(), ["!**"]);
  assert.deepEqual(manager.getPromptTemplatePaths(), []);
  assert.deepEqual(manager.getThemePaths(), []);

  manager.applyOverrides({ packages: [basePkg], extensions: ["leak.mjs"], defaultModel: "override-model" });
  assert.equal(manager.getDefaultModel(), "override-model");
  assert.deepEqual(manager.getPackages(), [{ source: selectedPkg, prompts: [], themes: [] }]);
  await manager.reload();
  assert.deepEqual(manager.getPackages(), [{ source: selectedPkg, prompts: [], themes: [] }]);
  assert.equal(readFileSync(globalSettingsPath, "utf8"), beforeGlobal);
  assert.equal(readFileSync(projectSettingsPath, "utf8"), beforeProject);
});

test("profile-scoped settings fail closed on invalid roots and reloads", async () => {
  const { createProfileScopedSettingsManager } = await loadRuntime();
  const snapshot = sampleSnapshot();
  for (const bytes of ["[]\n", "null\n", "{invalid\n"]) {
    const agentDir = tempDir("pi-web-invalid-runtime-agent");
    const cwd = tempDir("pi-web-invalid-runtime-cwd");
    writeFileSync(path.join(agentDir, "settings.json"), bytes);
    assert.throws(
      () => createProfileScopedSettingsManager({ cwd, agentDir, snapshot }),
      /Profile-backed sessions require/,
    );
  }

  const agentDir = tempDir("pi-web-reload-runtime-agent");
  const cwd = tempDir("pi-web-reload-runtime-cwd");
  writeJson(path.join(agentDir, "settings.json"), {});
  const manager = createProfileScopedSettingsManager({ cwd, agentDir, snapshot });
  writeFileSync(path.join(agentDir, "settings.json"), "[]\n");
  await assert.rejects(manager.reload(), /require global settings\.json/);

  const trustedAgentDir = tempDir("pi-web-project-runtime-agent");
  const trustedCwd = tempDir("pi-web-project-runtime-cwd");
  writeJson(path.join(trustedAgentDir, "settings.json"), {});
  mkdirSync(path.join(trustedCwd, ".pi"), { recursive: true });
  writeFileSync(path.join(trustedCwd, ".pi", "settings.json"), "[]\n");
  assert.throws(
    () => createProfileScopedSettingsManager({ cwd: trustedCwd, agentDir: trustedAgentDir, snapshot, projectTrusted: true }),
    /project .*settings\.json to contain a JSON object/i,
  );
});

test("partial skill selection excludes nonstandard manifest skill paths", async () => {
  const pkg = tempDir("pi-web-custom-skill-package");
  const reviewPath = path.join(pkg, "custom", "review", "SKILL.md");
  const auditPath = path.join(pkg, "custom", "audit", "SKILL.md");
  mkdirSync(path.dirname(reviewPath), { recursive: true });
  mkdirSync(path.dirname(auditPath), { recursive: true });
  writeFileSync(reviewPath, "---\nname: review\ndescription: review\n---\n# review\n");
  writeFileSync(auditPath, "---\nname: audit\ndescription: audit\n---\n# audit\n");
  writeJson(path.join(pkg, "package.json"), { pi: { skills: ["custom/review/SKILL.md", "custom/audit/SKILL.md"] } });

  const review = { source: pkg, scope: "package", path: "custom/review/SKILL.md", name: "review" };
  const audit = { source: pkg, scope: "package", path: "custom/audit/SKILL.md", name: "audit" };
  const { updatePackageSkillVisibility } = await loadUiCore();
  const narrowed = updatePackageSkillVisibility([{ source: pkg }], [review, audit], [review, audit], audit, false);
  assert.deepEqual(narrowed.plugins, [{ source: pkg, skills: ["!**", "+custom/review/SKILL.md"] }]);

  const agentDir = tempDir("pi-web-custom-skill-agent");
  const cwd = tempDir("pi-web-custom-skill-cwd");
  writeJson(path.join(agentDir, "settings.json"), { packages: narrowed.plugins });
  const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted: false });
  const packageManager = new DefaultPackageManager({ cwd, agentDir, settingsManager });
  const resolved = await packageManager.resolve();
  assert.deepEqual(resolved.skills.filter((item) => item.enabled).map((item) => path.basename(path.dirname(item.path))), ["review"]);
});

test("profile-scoped services load selected packages before resources and preserve suppression across reload", async () => {
  const agentDir = tempDir("pi-web-runtime-agent");
  const cwd = tempDir("pi-web-runtime-cwd");
  const selectedMarker = path.join(tempDir("pi-web-runtime-marker"), "selected");
  const baseMarker = path.join(tempDir("pi-web-runtime-marker"), "base");
  const laterMarker = path.join(tempDir("pi-web-runtime-marker"), "later");
  const autoUserMarker = path.join(tempDir("pi-web-runtime-marker"), "auto-user");
  const autoProjectMarker = path.join(tempDir("pi-web-runtime-marker"), "auto-project");
  const laterAutoMarker = path.join(tempDir("pi-web-runtime-marker"), "later-auto");
  const selectedPkg = makePackage({ toolName: "selected_tool", markerPath: selectedMarker });
  const basePkg = makePackage({ toolName: "base_tool", markerPath: baseMarker });
  const laterPkg = makePackage({ toolName: "later_tool", markerPath: laterMarker });
  writeAutoExtension(path.join(agentDir, "extensions"), "auto_user_tool", autoUserMarker);
  writeAutoExtension(path.join(cwd, ".pi", "extensions"), "auto_project_tool", autoProjectMarker);
  writeAutoSkill(path.join(agentDir, "skills"), "auto-user-skill");
  writeAutoSkill(path.join(cwd, ".pi", "skills"), "auto-project-skill");
  const globalSettingsPath = path.join(agentDir, "settings.json");
  writeJson(globalSettingsPath, {
    packages: [basePkg],
    extensions: [path.join(basePkg, "extensions", "tool.mjs")],
    skills: [path.join(basePkg, "skills")],
    prompts: [path.join(basePkg, "prompts")],
    themes: [path.join(basePkg, "themes")],
  });
  const beforeGlobal = readFileSync(globalSettingsPath, "utf8");
  const { createProfileScopedRuntimeOptions } = await loadRuntime();
  const runtime = createProfileScopedRuntimeOptions({
    cwd,
    agentDir,
    snapshot: sampleSnapshot({ plugins: [{ source: selectedPkg, skills: ["!skills/**", "+skills/review/SKILL.md"] }] }),
  });

  const services = await createAgentSessionServices({
    cwd,
    agentDir,
    settingsManager: runtime.settingsManager,
    resourceLoaderOptions: runtime.resourceLoaderOptions,
  });
  assert.equal(existsSync(selectedMarker), true);
  assert.equal(existsSync(baseMarker), false);
  assert.equal(existsSync(autoUserMarker), false);
  assert.equal(existsSync(autoProjectMarker), false);
  assert.deepEqual(services.resourceLoader.getSkills().skills.map((skill) => skill.name), ["review"]);
  assert.equal(services.resourceLoader.getPrompts().prompts.length, 0);
  assert.equal(services.resourceLoader.getThemes().themes.length, 0);
  assert.equal(readFileSync(globalSettingsPath, "utf8"), beforeGlobal);

  writeJson(globalSettingsPath, { packages: [basePkg, laterPkg], extensions: [path.join(laterPkg, "extensions", "tool.mjs")] });
  writeAutoExtension(path.join(agentDir, "extensions"), "later_auto_tool", laterAutoMarker);
  await runtime.settingsManager.reload();
  await services.resourceLoader.reload();
  assert.equal(existsSync(baseMarker), false);
  assert.equal(existsSync(laterMarker), false);
  assert.equal(existsSync(laterAutoMarker), false);
  assert.deepEqual(runtime.settingsManager.getPackages(), [{ source: selectedPkg, skills: ["!skills/**", "+skills/review/SKILL.md"], prompts: [], themes: [] }]);
});

test("profile runtime loads only snapshotted global and project standalone skills", async () => {
  const agentDir = tempDir("pi-web-standalone-skill-agent");
  const cwd = tempDir("pi-web-standalone-skill-cwd");
  writeJson(path.join(agentDir, "settings.json"), {});
  writeAutoSkill(path.join(agentDir, "skills"), "standalone");
  writeAutoSkill(path.join(agentDir, "skills"), "not-selected");
  writeAutoSkill(path.join(cwd, ".pi", "skills"), "project-only");
  const skillPath = path.join(agentDir, "skills", "standalone", "SKILL.md");
  const projectSkillPath = path.join(cwd, ".pi", "skills", "project-only", "SKILL.md");
  const snapshot = sampleSnapshot({
    requestedBuiltinTools: [],
    activeToolNames: [],
    visibleSkillRefs: [
      { source: skillPath, scope: "user", path: skillPath, name: "standalone" },
      { source: projectSkillPath, scope: "project", path: projectSkillPath, name: "project-only" },
    ],
  });
  const { createProfileScopedSettingsManager } = await loadRuntime();
  const settingsManager = createProfileScopedSettingsManager({ cwd, agentDir, snapshot, projectTrusted: true });
  const services = await createAgentSessionServices({ cwd, agentDir, settingsManager });
  assert.deepEqual(services.resourceLoader.getSkills().skills.map((skill) => skill.name).sort(), ["project-only", "standalone"]);
  assert.deepEqual(settingsManager.getGlobalSettings().skills, ["!**", `+${skillPath}`]);
  assert.deepEqual(settingsManager.getProjectSettings().skills, ["!**", `+${projectSkillPath}`]);
  assert.deepEqual(settingsManager.getSkillPaths(), ["!**", `+${skillPath}`, `+${projectSkillPath}`]);
});

test("extensions empty disables selected package tools by absence before load", async () => {
  const agentDir = tempDir("pi-web-runtime-agent");
  const cwd = tempDir("pi-web-runtime-cwd");
  const marker = path.join(tempDir("pi-web-runtime-marker"), "disabled");
  const selectedPkg = makePackage({ markerPath: marker });
  const { createProfileScopedRuntimeOptions } = await loadRuntime();
  const runtime = createProfileScopedRuntimeOptions({
    cwd,
    agentDir,
    snapshot: sampleSnapshot({ plugins: [{ source: selectedPkg, extensions: [], skills: [] }] }),
  });

  const services = await createAgentSessionServices({
    cwd,
    agentDir,
    settingsManager: runtime.settingsManager,
    resourceLoaderOptions: runtime.resourceLoaderOptions,
  });
  assert.equal(existsSync(marker), false);
  assert.deepEqual(services.resourceLoader.getSkills().skills, []);
});

test("skills override is hidden-ref denylist cleanup, not a visible-skill allowlist", async () => {
  const pkg = tempDir("pi-web-runtime-package");
  const reviewPath = path.join(pkg, "skills", "review", "SKILL.md");
  const auditPath = path.join(pkg, "skills", "audit", "SKILL.md");
  const review = { name: "review", description: "review", filePath: reviewPath, baseDir: pkg, sourceInfo: sourceInfo(pkg, reviewPath, pkg), disableModelInvocation: false };
  const audit = { name: "audit", description: "audit", filePath: auditPath, baseDir: pkg, sourceInfo: sourceInfo(pkg, auditPath, pkg), disableModelInvocation: false };
  const { createProfileSkillsOverride } = await loadRuntime();

  const denyAudit = createProfileSkillsOverride(sampleSnapshot({
    hiddenSkillRefs: [{ source: pkg, scope: "package", path: "skills/audit/SKILL.md", name: "audit" }],
  }));
  assert.deepEqual(denyAudit({ skills: [review, audit], diagnostics: [] }).skills.map((skill) => skill.name), ["review"]);
  const rawReview = { ...review, filePath: "/cache/node_modules/pkg/skills/review/SKILL.md", sourceInfo: undefined };
  const rawAudit = { ...audit, filePath: "/cache/node_modules/pkg/skills/audit/SKILL.md", sourceInfo: undefined };
  const unverifiable = denyAudit({ skills: [rawReview, rawAudit], diagnostics: [] });
  assert.deepEqual(unverifiable.skills.map((skill) => skill.name), ["review", "audit"]);
  assert.match(unverifiable.diagnostics[0]?.message ?? "", /Cannot verify package source/);

  const staleVisible = createProfileSkillsOverride(sampleSnapshot({
    visibleSkillRefs: [{ source: pkg, scope: "package", path: "skills/review/SKILL.md", name: "review" }],
  }));
  assert.deepEqual(staleVisible({ skills: [review, audit], diagnostics: [] }).skills.map((skill) => skill.name), ["review", "audit"]);
});

test("runtime tool policy activates selected builtins and plugin tools with conflict metadata", async () => {
  const { applyProfileToolPolicy, getProfileRuntimeToolMetadata } = await loadRuntime();
  const pluginInfo = { source: "selected-pkg", path: "/pkg/extensions/tool.mjs", scope: "user", origin: "package" };
  const builtin = (name) => ({ name, description: name, sourceInfo: { source: "builtin", path: `<builtin:${name}>`, scope: "temporary", origin: "top-level" } });
  const fakeSession = {
    active: [],
    tools: [
      { name: "read", description: "plugin read", sourceInfo: pluginInfo },
      builtin("bash"),
      builtin("edit"),
      builtin("write"),
      builtin("grep"),
      { name: "summarize", description: "summarize", sourceInfo: pluginInfo },
    ],
    getAllTools() { return this.tools; },
    getActiveToolNames() { return this.active; },
    setActiveToolsByName(names) { this.active = names.filter((name) => this.tools.some((tool) => tool.name === name)); },
  };
  const snapshot = sampleSnapshot({
    requestedBuiltinTools: ["read", "bash", "edit", "write"],
    activeToolNames: ["read", "bash", "edit", "write", "summarize"],
    pluginTools: [
      { name: "read", source: "selected-pkg", extension: "extensions/tool.mjs", provenance: "plugin", metadataResolved: true },
      { name: "summarize", source: "selected-pkg", extension: "extensions/tool.mjs", provenance: "plugin", metadataResolved: true },
    ],
  });

  const metadata = applyProfileToolPolicy(fakeSession, snapshot);
  assert.deepEqual(fakeSession.active, ["read", "bash", "edit", "write", "summarize"]);
  assert.equal(metadata.find((tool) => tool.name === "grep").active, false);
  const read = getProfileRuntimeToolMetadata(fakeSession, snapshot).find((tool) => tool.name === "read");
  assert.equal(read.provenance, "plugin");
  assert.equal(read.selectedProvider, "plugin");
  assert.equal(read.pluginSource, "selected-pkg");
  assert.equal(read.conflict, true);
  assert.match(read.conflictMessage, /overrides the selected built-in tool/);
});

test("isolated runtime resolves dynamic selected-package tools before snapshot persistence", async () => {
  const { applyProfileToolPolicy, resolveProfileSnapshotToolsFromRuntime, validateProfileRuntimeAgainstSnapshot } = await loadRuntime();
  const pluginInfo = { source: "selected-pkg", path: "/pkg/extensions/dynamic.mjs", scope: "user", origin: "package" };
  const builtin = (name) => ({ name, description: name, sourceInfo: { source: "builtin", path: `<builtin:${name}>`, scope: "temporary", origin: "top-level" } });
  const fakeSession = {
    active: [],
    tools: [
      { name: "read", description: "plugin read", sourceInfo: pluginInfo },
      { name: "dynamic_tool", description: "dynamic", sourceInfo: pluginInfo },
      builtin("bash"), builtin("edit"), builtin("write"),
    ],
    getAllTools() { return this.tools; },
    getActiveToolNames() { return this.active; },
    setActiveToolsByName(names) { this.active = names.filter((name) => this.tools.some((tool) => tool.name === name)); },
  };
  const provisional = sampleSnapshot({
    plugins: [{ source: "selected-pkg", prompts: [], themes: [] }],
    requestedBuiltinTools: ["read", "bash", "edit", "write"],
    activeToolNames: ["read", "bash", "edit", "write"],
  });
  const resolved = resolveProfileSnapshotToolsFromRuntime(fakeSession, provisional);
  assert.deepEqual(resolved.tools.pluginTools.map((tool) => tool.name), ["dynamic_tool", "read"]);
  assert.deepEqual(new Set(resolved.tools.activeToolNames), new Set(["read", "bash", "edit", "write", "dynamic_tool"]));
  assert.equal(resolved.tools.conflicts[0].name, "read");
  const metadata = applyProfileToolPolicy(fakeSession, resolved);
  assert.deepEqual(validateProfileRuntimeAgainstSnapshot(fakeSession, resolved, metadata).diagnostics, []);
});

test("runtime validation rejects active plugin tools that are not recorded in the snapshot", async () => {
  const { applyProfileToolPolicy, validateProfileRuntimeAgainstSnapshot } = await loadRuntime();
  const pluginInfo = { source: "other-pkg", path: "/pkg/extensions/tool.mjs", scope: "user", origin: "package" };
  const fakeSession = {
    active: [],
    tools: [{ name: "plugin_tool", description: "plugin", sourceInfo: pluginInfo }],
    getAllTools() { return this.tools; },
    getActiveToolNames() { return this.active; },
    setActiveToolsByName(names) { this.active = names.filter((name) => this.tools.some((tool) => tool.name === name)); },
  };
  const snapshot = sampleSnapshot({
    requestedBuiltinTools: [],
    activeToolNames: ["plugin_tool"],
    pluginTools: [{ name: "plugin_tool", source: "selected-pkg", extension: "extensions/tool.mjs", provenance: "plugin", metadataResolved: true }],
  });

  const metadata = applyProfileToolPolicy(fakeSession, snapshot);
  const validation = validateProfileRuntimeAgainstSnapshot(fakeSession, snapshot, metadata);
  assert.equal(validation.diagnostics.length, 1);
  assert.match(validation.diagnostics[0].message, /not provided by the snapshotted plugin/);
});

test("runtime validation rejects same-name builtin substitution for a snapshotted plugin", async () => {
  const { applyProfileToolPolicy, validateProfileRuntimeAgainstSnapshot } = await loadRuntime();
  const fakeSession = {
    active: [],
    tools: [{ name: "bash", description: "builtin bash", sourceInfo: { source: "builtin", path: "<builtin:bash>" } }],
    getAllTools() { return this.tools; },
    getActiveToolNames() { return this.active; },
    setActiveToolsByName(names) { this.active = names.filter((name) => this.tools.some((tool) => tool.name === name)); },
  };
  const snapshot = sampleSnapshot({
    requestedBuiltinTools: [],
    activeToolNames: ["bash"],
    pluginTools: [{ name: "bash", source: "selected-pkg", extension: "extensions/bash.mjs", provenance: "plugin", metadataResolved: true }],
  });

  const metadata = applyProfileToolPolicy(fakeSession, snapshot);
  const validation = validateProfileRuntimeAgainstSnapshot(fakeSession, snapshot, metadata);
  assert.ok(validation.diagnostics.some((item) => /not provided by the snapshotted plugin/.test(item.message)));
});

test("profile wrapper blocks extension attempts to mutate active tools", async () => {
  const { AgentSessionWrapper } = await loadRpcManager();
  const fakeInner = {
    sessionId: "rpc-extension-tool-mutation",
    sessionFile: undefined,
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    active: ["read"],
    tools: [
      { name: "read", description: "read", sourceInfo: { source: "builtin", path: "<builtin:read>" } },
      { name: "bash", description: "bash", sourceInfo: { source: "builtin", path: "<builtin:bash>" } },
    ],
    getAllTools() { return this.tools; },
    getActiveToolNames() { return this.active; },
    setActiveToolsByName(names) { this.active = [...names]; },
    resourceLoader: { getSkills: () => ({ skills: [], diagnostics: [] }) },
    extensionRunner: { emit: async () => undefined, invalidate: () => undefined },
    dispose: () => undefined,
  };
  const wrapper = new AgentSessionWrapper(fakeInner, sampleSnapshot({ requestedBuiltinTools: ["read"], activeToolNames: ["read"] }));

  assert.throws(() => fakeInner.setActiveToolsByName(["bash"]), /extension tool mutation/);
  assert.deepEqual(fakeInner.active, ["read"]);
  assert.equal(wrapper.isAlive(), false);
  await wrapper.shutdown();
});

test("deferred profile tool resolution permits session-start setup then freezes the resolved runtime", async () => {
  const { AgentSessionWrapper } = await loadRpcManager();
  const pluginInfo = { source: "selected-pkg", path: "/pkg/extensions/read.mjs", scope: "user", origin: "package" };
  const fakeInner = {
    sessionId: "rpc-deferred-profile-tools", sessionFile: undefined, isStreaming: false, isCompacting: false, isBashRunning: false,
    active: ["read"],
    tools: [{ name: "read", description: "plugin read", sourceInfo: pluginInfo }],
    getAllTools() { return this.tools; },
    getActiveToolNames() { return this.active; },
    setActiveToolsByName(names) { this.active = [...names]; },
    async bindExtensions() { this.setActiveToolsByName([]); },
    resourceLoader: { getSkills: () => ({ skills: [], diagnostics: [] }) },
    extensionRunner: { emit: async () => undefined, invalidate: () => undefined },
    dispose: () => undefined,
  };
  const provisional = sampleSnapshot({
    plugins: [{ source: "selected-pkg", prompts: [], themes: [] }],
    requestedBuiltinTools: ["read"],
    activeToolNames: ["read"],
  });
  const wrapper = new AgentSessionWrapper(fakeInner, provisional, undefined, undefined, true);
  await wrapper.bindExtensions();
  assert.equal(wrapper.isAlive(), true);
  assert.deepEqual(fakeInner.active, []);
  const resolved = wrapper.finalizeProfileToolPolicy();
  assert.deepEqual(resolved.tools.pluginTools.map((tool) => tool.name), ["read"]);
  assert.deepEqual(fakeInner.active, ["read"]);
  assert.throws(() => fakeInner.setActiveToolsByName([]), /extension tool mutation/);
  await wrapper.shutdown();
});

test("runtime validation follows authoritative package skill filters instead of freezing preview inventory", async () => {
  const { validateProfileRuntimeAgainstSnapshot } = await loadRuntime();
  const baseDir = "/pkg";
  const loadedSkill = {
    name: "unexpected",
    filePath: "/pkg/skills/unexpected/SKILL.md",
    sourceInfo: sourceInfo("selected-pkg", "/pkg/skills/unexpected/SKILL.md", baseDir),
  };
  const fakeSession = {
    getAllTools: () => [],
    getActiveToolNames: () => [],
    setActiveToolsByName: () => undefined,
    resourceLoader: { getSkills: () => ({ skills: [loadedSkill], diagnostics: [] }) },
  };
  const snapshot = sampleSnapshot({
    requestedBuiltinTools: [],
    activeToolNames: [],
    plugins: [{ source: "selected-pkg", prompts: [], themes: [] }],
    visibleSkillRefs: [{ source: "selected-pkg", scope: "package", path: "skills/review/SKILL.md", name: "review" }],
  });

  const validation = validateProfileRuntimeAgainstSnapshot(fakeSession, snapshot);
  assert.deepEqual(validation.diagnostics, []);
});

test("runtime validation rejects extension-discovered top-level skills absent from the snapshot", async () => {
  const { validateProfileRuntimeAgainstSnapshot } = await loadRuntime();
  const dynamicSkill = {
    name: "dynamic-review",
    filePath: "/dynamic/skills/review/SKILL.md",
    sourceInfo: { source: "/dynamic/skills/review/SKILL.md", path: "/dynamic/skills/review/SKILL.md", origin: "top-level", scope: "temporary" },
  };
  const fakeSession = {
    getAllTools: () => [],
    getActiveToolNames: () => [],
    setActiveToolsByName: () => undefined,
    resourceLoader: { getSkills: () => ({ skills: [dynamicSkill], diagnostics: [] }) },
  };
  const snapshot = sampleSnapshot({ requestedBuiltinTools: [], activeToolNames: [], visibleSkillRefs: [] });

  const validation = validateProfileRuntimeAgainstSnapshot(fakeSession, snapshot);
  assert.equal(validation.diagnostics.length, 1);
  assert.match(validation.diagnostics[0].message, /outside the immutable skill capability set/);
});

test("profile-scoped RPC wrapper revalidates snapshot tool provenance after reload", async () => {
  const { AgentSessionWrapper, getRpcSession, registerRpcSession } = await loadRpcManager();
  let tools = [
    { name: "plugin_tool", description: "plugin", sourceInfo: { source: "selected-pkg", path: "/pkg/extensions/tool.mjs", scope: "user", origin: "package" } },
  ];
  const fakeInner = {
    sessionId: "rpc-profile-reload-test",
    sessionFile: undefined,
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    extensionRunner: { setUIContext: () => undefined },
    subscribe: () => () => undefined,
    dispose: () => undefined,
    getAllTools: () => tools,
    active: [],
    getActiveToolNames() { return this.active; },
    setActiveToolsByName(names) { this.active = names.filter((name) => tools.some((tool) => tool.name === name)); },
    reload: async () => {
      tools = [{ name: "plugin_tool", description: "plugin", sourceInfo: { source: "other-pkg", path: "/pkg/extensions/tool.mjs", scope: "user", origin: "package" } }];
    },
  };
  const wrapper = new AgentSessionWrapper(fakeInner, sampleSnapshot({
    requestedBuiltinTools: [],
    activeToolNames: ["plugin_tool"],
    pluginTools: [{ name: "plugin_tool", source: "selected-pkg", extension: "extensions/tool.mjs", provenance: "plugin", metadataResolved: true }],
  }));

  registerRpcSession(fakeInner.sessionId, wrapper);
  assert.equal(getRpcSession(fakeInner.sessionId), wrapper);
  await assert.rejects(() => wrapper.send({ type: "reload" }), /Profile runtime capabilities do not match/);
  assert.equal(wrapper.isAlive(), false);
  assert.equal(getRpcSession(fakeInner.sessionId), undefined);
});

test("profile-scoped RPC wrapper revalidates snapshot tool provenance after extension binding", async () => {
  const { AgentSessionWrapper } = await loadRpcManager();
  let tools = [
    { name: "plugin_tool", description: "plugin", sourceInfo: { source: "selected-pkg", path: "/pkg/extensions/tool.mjs", scope: "user", origin: "package" } },
  ];
  const fakeInner = {
    sessionId: "rpc-profile-bind-test",
    sessionFile: undefined,
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    bindExtensions: async () => {
      tools = [{ name: "plugin_tool", description: "plugin", sourceInfo: { source: "other-pkg", path: "/pkg/extensions/tool.mjs", scope: "user", origin: "package" } }];
    },
    getAllTools: () => tools,
    active: [],
    getActiveToolNames() { return this.active; },
    setActiveToolsByName(names) { this.active = names.filter((name) => tools.some((tool) => tool.name === name)); },
  };
  const wrapper = new AgentSessionWrapper(fakeInner, sampleSnapshot({
    requestedBuiltinTools: [],
    activeToolNames: ["plugin_tool"],
    pluginTools: [{ name: "plugin_tool", source: "selected-pkg", extension: "extensions/tool.mjs", provenance: "plugin", metadataResolved: true }],
  }));

  await assert.rejects(() => wrapper.bindExtensions(), /Profile runtime capabilities do not match/);
  wrapper.destroy();
});

test("swallowed extension policy violations cannot register a dead profile runtime", async () => {
  const { AgentSessionWrapper, registerRpcSession } = await loadRpcManager();
  const tools = [{ name: "read", description: "read", sourceInfo: { source: "builtin", path: "<builtin:read>", scope: "temporary", origin: "top-level" } }];
  const fakeInner = {
    sessionId: "rpc-profile-swallowed-bind-test",
    sessionFile: undefined,
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    extensionRunner: { invalidate: () => undefined },
    abort: async () => undefined,
    dispose: () => undefined,
    getAllTools: () => tools,
    active: ["read"],
    getActiveToolNames() { return this.active; },
    setActiveToolsByName(names) { this.active = names.filter((name) => tools.some((tool) => tool.name === name)); },
    async bindExtensions() {
      try { this.setActiveToolsByName(["bash"]); } catch { /* Pi reports handler errors and continues binding. */ }
    },
  };
  const wrapper = new AgentSessionWrapper(fakeInner, sampleSnapshot({ requestedBuiltinTools: ["read"], activeToolNames: ["read"] }));

  await assert.rejects(() => wrapper.bindExtensions(), /extension tool mutation/);
  assert.equal(wrapper.isAlive(), false);
  assert.throws(() => registerRpcSession(fakeInner.sessionId, wrapper), /Cannot register closed session/);
});
test("profile-scoped RPC wrapper blocks set_tools divergence and reapplies snapshot policy", async () => {
  const { AgentSessionWrapper } = await loadRpcManager();
  const pluginInfo = { source: "selected-pkg", path: "/pkg/extensions/tool.mjs", scope: "user", origin: "package" };
  const fakeInner = {
    sessionId: "rpc-profile-test",
    sessionFile: undefined,
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    getAllTools: () => [
      { name: "read", description: "read", sourceInfo: { source: "builtin", path: "<builtin:read>", scope: "temporary", origin: "top-level" } },
      { name: "plugin_tool", description: "plugin", sourceInfo: pluginInfo },
      { name: "grep", description: "grep", sourceInfo: { source: "builtin", path: "<builtin:grep>", scope: "temporary", origin: "top-level" } },
    ],
    active: ["grep"],
    getActiveToolNames() { return this.active; },
    setActiveToolsByName(names) { this.active = names; },
  };
  const wrapper = new AgentSessionWrapper(fakeInner, sampleSnapshot({
    requestedBuiltinTools: ["read"],
    activeToolNames: ["read", "plugin_tool"],
    pluginTools: [{ name: "plugin_tool", source: "selected-pkg", extension: "extensions/tool.mjs", provenance: "plugin", metadataResolved: true }],
  }));

  await assert.rejects(() => wrapper.send({ type: "set_tools", toolNames: ["grep"] }), /cannot change tools/);
  assert.deepEqual(fakeInner.active, ["read", "plugin_tool"]);
  wrapper.destroy();
});

test("RPC wrapper destruction disposes the underlying agent session exactly once", async () => {
  const { AgentSessionWrapper } = await loadRpcManager();
  let disposeCalls = 0;
  const wrapper = new AgentSessionWrapper({
    sessionId: "rpc-dispose-test",
    sessionFile: undefined,
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    dispose: () => { disposeCalls += 1; },
  });

  const shutdown = wrapper.shutdown();
  wrapper.destroy();
  await shutdown;
  assert.equal(disposeCalls, 1);
});
