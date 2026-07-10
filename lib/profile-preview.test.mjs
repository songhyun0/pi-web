import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
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

async function loadPreview() {
  importCounter += 1;
  return import(`./profile-preview.ts?case=${importCounter}`);
}

async function loadProfileStore() {
  importCounter += 1;
  return import(`./profile-store.ts?case=${importCounter}`);
}

function tempDir(name = "pi-web-profile-preview") {
  const dir = path.join(tmpdir(), `${name}-${process.pid}-${importCounter}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makePackage({ extensionFiles = {}, skillNames = ["review", "audit"], manifest = {} } = {}) {
  const root = tempDir("pi-web-preview-package");
  mkdirSync(path.join(root, "extensions"), { recursive: true });
  mkdirSync(path.join(root, "skills"), { recursive: true });
  for (const [fileName, content] of Object.entries(extensionFiles)) {
    writeFileSync(path.join(root, "extensions", fileName), content);
  }
  for (const skillName of skillNames) {
    const skillDir = path.join(root, "skills", skillName);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(path.join(skillDir, "SKILL.md"), `---\nname: ${skillName}\n---\n# ${skillName}\n`);
  }
  writeFileSync(path.join(root, "package.json"), JSON.stringify({
    name: `pkg-${path.basename(root)}`,
    pi: {
      extensions: ["extensions/*.mjs"],
      skills: ["skills/**/SKILL.md"],
      prompts: ["prompts/*.md"],
      themes: ["themes/*.json"],
      ...manifest,
    },
  }, null, 2));
  return root;
}

function staticToolExtension(toolName = "read") {
  return `export default function ext(pi) {\n  pi.registerTool({ name: "${toolName}", description: "${toolName}", parameters: {}, execute: async () => "ok" });\n}\n`;
}

function dynamicToolExtension() {
  return `export default function ext(pi) {\n  const name = "dynamic";\n  pi.registerTool({ name, description: "dynamic", parameters: {}, execute: async () => "ok" });\n}\n`;
}

function helperExtension() {
  return `export default function ext(pi) {\n  pi.registerTool({ name: "read", description: "read", parameters: {}, execute: async () => "ok" });\n  registerEverything(pi);\n}\n`;
}

function dynamicResourceExtension() {
  return `export default function ext(pi) {\n  pi.on("resources_discover", () => ({ skillPaths: ["/tmp/dynamic/SKILL.md"] }));\n}\n`;
}

function sampleDraft(pluginSource, overrides = {}) {
  return {
    name: "Preview Profile",
    description: "Preview test profile",
    tools: { builtinPreset: "default", pluginTools: "fromSelectedPlugins" },
    plugins: [pluginSource],
    skills: { mode: "pluginDefaultThenNarrow" },
    ...overrides,
  };
}

test("previews saved profile refs and draft profiles without real snapshot ids", async () => {
  const agentDir = tempDir("pi-web-preview-agent");
  const profilePath = path.join(agentDir, "web-profiles.json");
  const pkg = makePackage({ extensionFiles: { "tool.mjs": staticToolExtension("read") } });
  const { postProfilesApiResult } = await loadProfileStore();
  const { postProfilePreviewApiResult } = await loadPreview();

  const created = await postProfilesApiResult(sampleDraft(pkg), { filePath: profilePath });
  const saved = await postProfilePreviewApiResult({ cwd: pkg, profileRef: created.body.id }, {
    agentDir,
    profileStoreOptions: { filePath: profilePath },
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.profileRef, created.body.id);
  assert.equal(saved.body.snapshotId, undefined);
  assert.equal(saved.body.tools.unknownToolMetadata, false);
  assert.equal(saved.body.safeToApply, true);
  assert.deepEqual(saved.body.tools.conflicts[0], {
    name: "read",
    builtinSelected: true,
    selectedProvider: "plugin",
    pluginSource: pkg,
    message: `Plugin tool 'read' from ${pkg} may override the selected built-in tool.`,
  });
  assert.deepEqual(saved.body.tools.activeToolNames, ["read", "bash", "edit", "write"]);

  const draft = await postProfilePreviewApiResult({ cwd: pkg, draftProfile: sampleDraft({ source: pkg, extensions: [], skills: [] }) }, { agentDir });
  assert.equal(draft.status, 200);
  assert.equal(draft.body.profileRef, undefined);
  assert.deepEqual(draft.body.plugins, [{ source: pkg, extensions: [], skills: [], prompts: [], themes: [] }]);
  assert.deepEqual(draft.body.tools.pluginTools, []);
});

test("preview input validation fails closed", async () => {
  const agentDir = tempDir("pi-web-preview-validation-agent");
  const profilePath = path.join(agentDir, "web-profiles.json");
  const cwd = tempDir("pi-web-preview-validation-cwd");
  const { postProfilePreviewApiResult } = await loadPreview();
  assert.equal((await postProfilePreviewApiResult({ draftProfile: {} }, { agentDir, profileStoreOptions: { filePath: profilePath } })).status, 400);
  assert.equal((await postProfilePreviewApiResult({ cwd }, { agentDir, profileStoreOptions: { filePath: profilePath } })).status, 400);
  assert.equal((await postProfilePreviewApiResult({ cwd, profileRef: "bad" }, { agentDir, profileStoreOptions: { filePath: profilePath } })).status, 400);
  assert.equal((await postProfilePreviewApiResult({ cwd, profileRef: "builtin:missing" }, { agentDir, profileStoreOptions: { filePath: profilePath } })).status, 400);
  assert.equal((await postProfilePreviewApiResult({ cwd, profileRef: "profile:11111111-1111-4111-8111-111111111111" }, { agentDir, profileStoreOptions: { filePath: profilePath } })).status, 404);
});

test("saved preview carries repaired-default warnings", async () => {
  const agentDir = tempDir("pi-web-preview-repair-agent");
  const profilePath = path.join(agentDir, "web-profiles.json");
  const cwd = tempDir("pi-web-preview-repair-cwd");
  const profile = {
    id: "profile:00000000-0000-4000-8000-000000000010",
    name: "Saved profile",
    createdAt: "2026-01-02T03:04:05.000Z",
    updatedAt: "2026-01-02T03:04:05.000Z",
    tools: { builtinPreset: "none", pluginTools: "fromSelectedPlugins" },
    plugins: [],
    skills: { mode: "pluginDefaultThenNarrow" },
  };
  writeFileSync(profilePath, JSON.stringify({
    version: 1,
    defaults: { globalProfileRef: "profile:00000000-0000-4000-8000-000000000011" },
    profiles: [profile],
  }));
  const { postProfilePreviewApiResult } = await loadPreview();

  const result = await postProfilePreviewApiResult(
    { cwd, profileRef: profile.id },
    { agentDir, profileStoreOptions: { filePath: profilePath } },
  );
  assert.equal(result.status, 200);
  assert.equal(result.body.safeToApply, true);
  assert.ok(result.body.diagnostics.some((item) => item.type === "warning" && /global default profile was missing or invalid/.test(item.message)));
});

test("explicit built-in preview still runs shared first-use bootstrap", async () => {
  const agentDir = tempDir("pi-web-preview-builtin-bootstrap");
  const profilePath = path.join(agentDir, "web-profiles.json");
  const cwd = tempDir("pi-web-preview-builtin-cwd");
  const { postProfilePreviewApiResult } = await loadPreview();

  const result = await postProfilePreviewApiResult(
    { cwd, profileRef: "builtin:default" },
    { agentDir, profileStoreOptions: { filePath: profilePath } },
  );
  assert.equal(result.status, 200);
  assert.equal(existsSync(profilePath), true);
  const stored = JSON.parse(readFileSync(profilePath, "utf8"));
  assert.equal(stored.profiles.length, 1);
  assert.ok(result.body.diagnostics.some((item) => /Created the initial server default profile/.test(item.message)));
});

test("multiple selected plugin providers for one tool fail closed", async () => {
  const agentDir = tempDir("pi-web-preview-ambiguous-agent");
  const pkg = makePackage({
    extensionFiles: {
      "a.mjs": staticToolExtension("duplicate_tool"),
      "b.mjs": staticToolExtension("duplicate_tool"),
    },
    skillNames: [],
  });
  const { postProfilePreviewApiResult } = await loadPreview();
  const result = await postProfilePreviewApiResult({ cwd: pkg, draftProfile: sampleDraft(pkg) }, { agentDir });
  assert.equal(result.status, 200);
  assert.equal(result.body.safeToApply, false);
  assert.ok(result.body.tools.activeToolNames.includes("duplicate_tool"));
  assert.ok(result.body.diagnostics.some((item) => /provider selection is ambiguous/.test(item.message)));
});

test("PackageSource filters preserve omitted-vs-empty semantics and prompts/themes normalization", async () => {
  const agentDir = tempDir("pi-web-preview-agent");
  const pkg = makePackage({ extensionFiles: { "tool.mjs": staticToolExtension("pkg_tool") }, skillNames: ["review", "audit"] });
  const { postProfilePreviewApiResult } = await loadPreview();

  const defaults = await postProfilePreviewApiResult({ cwd: pkg, draftProfile: sampleDraft(pkg) }, { agentDir });
  assert.equal(defaults.status, 200);
  assert.equal(defaults.body.tools.pluginTools.length, 1);
  assert.deepEqual(defaults.body.skills.visibleSkillRefs.map((skill) => skill.name).sort(), ["audit", "review"]);
  assert.deepEqual(defaults.body.plugins, [{ source: pkg, prompts: [], themes: [] }]);

  const empty = await postProfilePreviewApiResult({ cwd: pkg, draftProfile: sampleDraft({ source: pkg, extensions: [], skills: [] }) }, { agentDir });
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body.tools.pluginTools, []);
  assert.deepEqual(empty.body.skills.visibleSkillRefs, []);

  const narrowed = await postProfilePreviewApiResult({ cwd: pkg, draftProfile: sampleDraft({ source: pkg, extensions: ["!extensions/**"], skills: ["!skills/**", "+skills/review/SKILL.md"] }) }, { agentDir });
  assert.equal(narrowed.status, 200);
  assert.deepEqual(narrowed.body.tools.pluginTools, []);
  assert.deepEqual(narrowed.body.skills.visibleSkillRefs.map((skill) => skill.name), ["review"]);
});

test("unresolved packages and dynamic resources fail closed while runtime-resolvable tools remain applicable", async () => {
  const agentDir = tempDir("pi-web-preview-agent");
  const cwd = tempDir("pi-web-preview-cwd");
  const missing = path.join(cwd, "missing-package");
  const dynamicPkg = makePackage({ extensionFiles: { "dynamic.mjs": dynamicToolExtension() }, skillNames: [] });
  const helperPkg = makePackage({ extensionFiles: { "helper.mjs": helperExtension() }, skillNames: [] });
  const resourcePkg = makePackage({ extensionFiles: { "resource.mjs": dynamicResourceExtension() }, skillNames: [] });
  const { postProfilePreviewApiResult } = await loadPreview();

  const requested = await postProfilePreviewApiResult({ cwd, draftProfile: sampleDraft(missing) }, { agentDir });
  assert.equal(requested.status, 200);
  assert.equal(requested.body.safeToApply, false);
  assert.equal(requested.body.tools.unknownToolMetadata, true);
  assert.equal(requested.body.tools.activeToolNames, undefined);

  const noCapability = await postProfilePreviewApiResult({ cwd, draftProfile: sampleDraft({ source: missing, extensions: [], skills: [] }) }, { agentDir });
  assert.equal(noCapability.status, 200);
  assert.equal(noCapability.body.safeToApply, true);
  assert.equal(noCapability.body.tools.unknownToolMetadata, false);
  assert.deepEqual(noCapability.body.tools.activeToolNames, ["read", "bash", "edit", "write"]);

  for (const pkg of [dynamicPkg, helperPkg]) {
    const result = await postProfilePreviewApiResult({ cwd: pkg, draftProfile: sampleDraft(pkg) }, { agentDir });
    assert.equal(result.status, 200);
    assert.equal(result.body.safeToApply, true);
    assert.equal(result.body.tools.unknownToolMetadata, true);
    assert.ok(Array.isArray(result.body.tools.activeToolNames));
    assert.equal(result.body.diagnostics.some((item) => item.type === "warning"), true);
  }
  const resourceResult = await postProfilePreviewApiResult({ cwd: resourcePkg, draftProfile: sampleDraft(resourcePkg) }, { agentDir });
  assert.equal(resourceResult.body.safeToApply, false);
  assert.equal(resourceResult.body.diagnostics.some((item) => item.type === "error" && /resources/.test(item.message)), true);
});

test("preview is read-only and hidden skill refs win", async () => {
  const agentDir = tempDir("pi-web-preview-agent");
  const pkg = makePackage({ extensionFiles: {}, skillNames: ["review", "audit"] });
  const standalonePath = path.join(agentDir, "skills", "standalone", "SKILL.md");
  mkdirSync(path.dirname(standalonePath), { recursive: true });
  writeFileSync(standalonePath, "---\nname: standalone\ndescription: standalone\n---\n# standalone\n");
  const projectSkillPath = path.join(pkg, ".pi", "skills", "project-standalone", "SKILL.md");
  mkdirSync(path.dirname(projectSkillPath), { recursive: true });
  writeFileSync(projectSkillPath, "---\nname: project-standalone\ndescription: project standalone\n---\n# project standalone\n");
  const { ProjectTrustStore } = await import("@earendil-works/pi-coding-agent");
  new ProjectTrustStore(agentDir).setMany([{ path: pkg, decision: true }]);
  const settingsPath = path.join(agentDir, "settings.json");
  const profilesPath = path.join(agentDir, "web-profiles.json");
  const sessionsPath = path.join(agentDir, "web-session-profiles.json");
  writeFileSync(settingsPath, JSON.stringify({ packages: ["base"] }, null, 2));
  const beforeSettings = readFileSync(settingsPath, "utf8");
  const { postProfilePreviewApiResult } = await loadPreview();

  const result = await postProfilePreviewApiResult({
    cwd: pkg,
    draftProfile: sampleDraft({ source: pkg, extensions: [], skills: ["!skills/**", "+skills/review/SKILL.md"] }, {
      skills: { mode: "pluginDefaultThenNarrow", disabledSkillRefs: [{ source: pkg, scope: "package", path: "skills/review/SKILL.md", name: "review" }] },
    }),
  }, { agentDir });
  assert.equal(result.status, 200);
  assert.equal(result.body.skills.visibleSkillRefs.some((skill) => skill.path === "skills/review/SKILL.md"), false);
  assert.equal(result.body.skills.hiddenSkillRefs.some((skill) => skill.path === "skills/review/SKILL.md"), true);
  assert.equal(result.body.skills.visibleSkillRefs.some((skill) => skill.path === standalonePath && skill.scope === "user"), true);
  assert.equal(result.body.skills.visibleSkillRefs.some((skill) => skill.path === realpathSync(projectSkillPath) && skill.scope === "project"), true);
  assert.equal(readFileSync(settingsPath, "utf8"), beforeSettings);
  assert.equal(existsSync(profilesPath), false);
  assert.equal(existsSync(sessionsPath), false);
});
