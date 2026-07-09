import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { createJiti } = require("jiti");

async function loadProfilesSubject(agentDir) {
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const jiti = createJiti(import.meta.url, { moduleCache: false });
  return jiti("./agent-profiles-core.ts");
}

test("global profile writes create a missing agent dir and preserve unknown settings", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "pi-web-profiles-root-"));
  const agentDir = path.join(root, "missing", "agent");
  const cwd = mkdtempSync(path.join(tmpdir(), "pi-web-profiles-cwd-"));
  const subject = await loadProfilesSubject(agentDir);

  subject.upsertAgentProfile(cwd, "global", {
    id: "first",
    name: "First",
    thinkingLevel: "auto",
    tools: { mode: "preset", preset: "full", includeExtensionTools: true },
    instructions: { mode: "default", files: [] },
    resources: { skillPaths: [], promptPaths: [], themePaths: [] },
  });

  const settingsPath = path.join(agentDir, "settings.json");
  let settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  assert.equal(settings.agentProfiles.profiles[0].id, "first");

  settings.futureRoot = { keep: true };
  settings.agentProfiles.futureAgentProfilesKey = "keep";
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);

  subject.upsertAgentProfile(cwd, "global", {
    id: "second",
    name: "Second",
    thinkingLevel: "auto",
    tools: { mode: "preset", preset: "none", includeExtensionTools: false },
    instructions: { mode: "default", files: [] },
    resources: { skillPaths: [], promptPaths: [], themePaths: [] },
  });

  settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  assert.deepEqual(settings.futureRoot, { keep: true });
  assert.equal(settings.agentProfiles.futureAgentProfilesKey, "keep");
  assert.deepEqual(settings.agentProfiles.profiles.map((profile) => profile.id), ["first", "second"]);
});

test("project profile first save is profile-only before saved trust promotion", async () => {
  const agentDir = mkdtempSync(path.join(tmpdir(), "pi-web-profiles-agent-"));
  const cwd = mkdtempSync(path.join(tmpdir(), "pi-web-profiles-cwd-"));
  const subject = await loadProfilesSubject(agentDir);
  const { ProjectTrustStore } = await import("@earendil-works/pi-coding-agent");

  const created = subject.upsertAgentProfile(cwd, "project", {
    id: "project-reviewer",
    name: "Project Reviewer",
    thinkingLevel: "auto",
    tools: { mode: "preset", preset: "default", includeExtensionTools: true },
    instructions: { mode: "default", files: [] },
    resources: { skillPaths: [], promptPaths: [], themePaths: [] },
  });

  assert.ok(created.profiles.some((profile) => profile.ref === "project:project-reviewer"));
  const projectSettings = JSON.parse(readFileSync(path.join(cwd, ".pi", "settings.json"), "utf8"));
  assert.deepEqual(Object.keys(projectSettings), ["agentProfiles"]);
  assert.equal(new ProjectTrustStore(agentDir).get(cwd), true);
  assert.equal(subject.loadAgentProfiles(cwd).scopes.project.writable, true);

  const blockedCwd = mkdtempSync(path.join(tmpdir(), "pi-web-profiles-blocked-"));
  mkdirSync(path.join(blockedCwd, ".pi"), { recursive: true });
  writeFileSync(path.join(blockedCwd, ".pi", "SYSTEM.md"), "Project instructions\n");
  assert.throws(() => subject.upsertAgentProfile(blockedCwd, "project", {
    id: "blocked",
    name: "Blocked",
    thinkingLevel: "auto",
    tools: { mode: "preset", preset: "default", includeExtensionTools: true },
    instructions: { mode: "default", files: [] },
    resources: { skillPaths: [], promptPaths: [], themePaths: [] },
  }), /Project profiles cannot be changed until the project is trusted|Project profiles are ignored/);
});

test("default instructions round-trip with an empty files array", async () => {
  const agentDir = mkdtempSync(path.join(tmpdir(), "pi-web-profiles-agent-"));
  const cwd = mkdtempSync(path.join(tmpdir(), "pi-web-profiles-cwd-"));
  const subject = await loadProfilesSubject(agentDir);

  subject.upsertAgentProfile(cwd, "global", {
    id: "default-instructions",
    name: "Default instructions",
    thinkingLevel: "auto",
    tools: { mode: "preset", preset: "full", includeExtensionTools: true },
    instructions: { mode: "default", files: [] },
    resources: { skillPaths: [], promptPaths: [], themePaths: [] },
  });

  const resolved = subject.resolveAgentProfile(cwd, "global:default-instructions");
  assert.deepEqual(resolved.instructions, { mode: "default", files: [] });
});

test("global profile CRUD resolves model, thinking, tools, defaults, and deletion", async () => {
  const agentDir = mkdtempSync(path.join(tmpdir(), "pi-web-profiles-agent-"));
  const cwd = mkdtempSync(path.join(tmpdir(), "pi-web-profiles-cwd-"));
  const subject = await loadProfilesSubject(agentDir);
  const profile = {
    id: "reviewer",
    name: "Reviewer",
    description: "Focused review profile",
    model: { provider: "openai", modelId: "gpt-5.4-mini" },
    thinkingLevel: "high",
    tools: { mode: "custom", toolNames: ["read", "bash"], includeExtensionTools: false },
    instructions: { mode: "append", text: "Review carefully.", files: [] },
    resources: { skillPaths: [], promptPaths: [], themePaths: [] },
  };

  const created = subject.upsertAgentProfile(cwd, "global", profile);
  assert.ok(created.profiles.some((entry) => entry.ref === "global:reviewer"));

  const resolved = subject.resolveAgentProfile(cwd, "global:reviewer");
  assert.equal(resolved.model.provider, "openai");
  assert.equal(resolved.model.modelId, "gpt-5.4-mini");
  assert.equal(resolved.thinkingLevel, "high");
  assert.deepEqual(subject.getToolNamesForAgentProfile(resolved), ["read", "bash"]);
  assert.equal(subject.getIncludeExtensionToolsForAgentProfile(resolved), false);

  const expanded = subject.expandAgentProfileForNewSession(cwd, resolved);
  assert.equal(expanded.profileRef, "global:reviewer");
  assert.equal(expanded.provider, "openai");
  assert.equal(expanded.modelId, "gpt-5.4-mini");
  assert.equal(expanded.thinkingLevel, "high");
  assert.deepEqual(expanded.toolNames, ["read", "bash"]);

  const defaulted = subject.setDefaultAgentProfile(cwd, "global", "global:reviewer");
  assert.equal(defaulted.effectiveDefaultProfileRef, "global:reviewer");
  assert.equal(subject.resolveAgentProfile(cwd).ref, "global:reviewer");

  const deleted = subject.deleteAgentProfile(cwd, "global", "reviewer");
  assert.ok(!deleted.profiles.some((entry) => entry.ref === "global:reviewer"));
  assert.equal(subject.resolveAgentProfile(cwd).ref, "builtin:full");
});

test("profile application keeps StyleSeed resources active-profile scoped and built-ins isolated", async () => {
  const agentDir = mkdtempSync(path.join(tmpdir(), "pi-web-profiles-agent-"));
  const cwd = mkdtempSync(path.join(tmpdir(), "pi-web-profiles-cwd-"));
  const skillDir = path.join(cwd, "styleseed", "skills", "styleseed-design-review");
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(path.join(cwd, "styleseed", "AGENTS.md"), "Use StyleSeed conventions.\n");
  const subject = await loadProfilesSubject(agentDir);

  subject.upsertAgentProfile(cwd, "project", {
    id: "styleseed",
    name: "StyleSeed",
    thinkingLevel: "medium",
    tools: { mode: "preset", preset: "default", includeExtensionTools: true },
    instructions: { mode: "append", files: [{ scope: "project", path: "styleseed/AGENTS.md" }] },
    resources: {
      skillPaths: [{ scope: "project", path: "styleseed/skills/styleseed-design-review" }],
      promptPaths: [],
      themePaths: [],
    },
  });
  subject.upsertAgentProfile(cwd, "global", {
    id: "minimal",
    name: "Minimal",
    thinkingLevel: "auto",
    tools: { mode: "preset", preset: "none", includeExtensionTools: false },
    instructions: { mode: "default", files: [] },
    resources: { skillPaths: [], promptPaths: [], themePaths: [] },
  });

  const styleOptions = subject.expandAgentProfileForNewSession(cwd, subject.resolveAgentProfile(cwd, "project:styleseed"));
  const minimalOptions = subject.expandAgentProfileForNewSession(cwd, subject.resolveAgentProfile(cwd, "global:minimal"));
  const fullOptions = subject.expandAgentProfileForNewSession(cwd, subject.resolveAgentProfile(cwd, "builtin:full"));
  const noTools = subject.resolveAgentProfile(cwd, "builtin:no-tools");
  const defaultProfile = subject.resolveAgentProfile(cwd, "builtin:default");

  assert.deepEqual(styleOptions.instructions.files.map((entry) => entry.resolvedPath), [realpathSync.native(path.join(cwd, "styleseed", "AGENTS.md"))]);
  assert.deepEqual(styleOptions.resources.skillPaths.map((entry) => entry.resolvedPath), [realpathSync.native(skillDir)]);
  assert.deepEqual(minimalOptions.resources.skillPaths, []);
  assert.deepEqual(fullOptions.resources.skillPaths, []);
  assert.notDeepEqual(styleOptions.toolNames, minimalOptions.toolNames, "parallel sessions can expand distinct active profiles");
  assert.equal(subject.getIncludeExtensionToolsForAgentProfile(noTools), false);
  assert.equal(subject.getIncludeExtensionToolsForAgentProfile(defaultProfile), true);
  assert.equal(subject.getIncludeExtensionToolsForAgentProfile(subject.resolveAgentProfile(cwd, "builtin:full")), true);
});
