import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { createJiti } = require("jiti");
async function readSource(file) {
  return readFile(new URL(file, import.meta.url), "utf8");
}

async function loadProfilesSubject(agentDir) {
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const jiti = createJiti(import.meta.url, { moduleCache: false });
  return jiti("./agent-profiles-core.ts");
}

test("project profile writes promote clean projects only after settings are saved", async () => {
  const source = await readSource("./agent-profiles-core.ts");
  const writerSource = source.slice(
    source.indexOf("function writeProfilesSettings"),
    source.indexOf("function promoteCleanProjectProfileTrust")
  );
  assert.match(writerSource, /withSettingsFileLock/);
  assert.match(writerSource, /afterWrite/);
  assert.match(writerSource, /promoteCleanProjectProfileTrust\(store, settingsRoot\)/);
  assert.match(writerSource, /unlinkSync\(store\.settingsPath\)/);
});

test("project default profile writes are trust-requiring and reloaded", async () => {
  const profilesSource = await readSource("./agent-profiles-core.ts");
  const trustSource = await readSource("./project-trust-core.ts");
  const writerSource = profilesSource.slice(
    profilesSource.indexOf("function writeProfilesSettings"),
    profilesSource.indexOf("function promoteCleanProjectProfileTrust")
  );
  assert.match(writerSource, /withSettingsFileLock/);
  assert.match(writerSource, /afterWrite/);
  assert.match(writerSource, /promoteCleanProjectProfileTrust\(store, settingsRoot\)/);
  assert.match(trustSource, /defaultProfileRef/);
  assert.match(trustSource, /Default profile \(\$\{defaultProfileRef\}\)/);
  assert.match(trustSource, /requiresTrust: details\.length > 0/);
});

test("default instructions round-trip with an empty files array", async () => {
  const source = await readSource("./agent-profiles-core.ts");
  const normalizeInstructionsSource = source.slice(
    source.indexOf("function normalizeInstructions"),
    source.indexOf("function normalizeResources")
  );

  assert.match(normalizeInstructionsSource, /mode === "default"/);
  assert.match(normalizeInstructionsSource, /value\.files !== undefined && \(!Array\.isArray\(value\.files\) \|\| value\.files\.length > 0\)/);
  assert.match(normalizeInstructionsSource, /return \{ mode: "default", files: \[\] \}/);
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
  const subject = await loadProfilesSubject(agentDir);

  subject.upsertAgentProfile(cwd, "project", {
    id: "styleseed",
    name: "StyleSeed",
    thinkingLevel: "medium",
    tools: { mode: "preset", preset: "default", includeExtensionTools: true },
    instructions: { mode: "default", files: [] },
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

  assert.deepEqual(styleOptions.resources.skillPaths.map((entry) => entry.resolvedPath), [realpathSync.native(skillDir)]);
  assert.deepEqual(minimalOptions.resources.skillPaths, []);
  assert.deepEqual(fullOptions.resources.skillPaths, []);
  assert.notDeepEqual(styleOptions.toolNames, minimalOptions.toolNames, "parallel sessions can expand distinct active profiles");
  assert.equal(subject.getIncludeExtensionToolsForAgentProfile(noTools), false);
  assert.equal(subject.getIncludeExtensionToolsForAgentProfile(defaultProfile), true);
  assert.equal(subject.getIncludeExtensionToolsForAgentProfile(subject.resolveAgentProfile(cwd, "builtin:full")), true);
});
