import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !specifier.match(/\\.[cm]?[jt]sx?$/) && !specifier.includes("?")) {
      try {
        return nextResolve(`${specifier}.ts`, context);
      } catch {
        // Fall through to Node's default resolver for non-TypeScript relative imports.
      }
    }
    return nextResolve(specifier, context);
  },
});

const execFileAsync = promisify(execFile);

let importCounter = 0;

async function loadProfiles() {
  importCounter += 1;
  return import(`./profiles.ts?case=${importCounter}`);
}

async function loadStore() {
  importCounter += 1;
  return import(`./profile-store.ts?case=${importCounter}`);
}

function tempDir(name = "pi-web-profiles") {
  const dir = path.join(tmpdir(), `${name}-${process.pid}-${importCounter}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function tempStorePath() {
  return path.join(tempDir(), "web-profiles.json");
}

function sampleDraft(overrides = {}) {
  return {
    name: "Coding Full",
    description: "Default coding profile",
    tools: {
      builtinPreset: "full",
      pluginTools: "fromSelectedPlugins",
    },
    plugins: [
      "npm:pi-web-access",
      { source: "npm:example", skills: ["+skills/review/SKILL.md"], prompts: ["+prompts/ignored.md"], themes: ["+themes/ignored.json"] },
    ],
    skills: {
      mode: "pluginDefaultThenNarrow",
      disabledSkillRefs: [
        { source: "npm:example", scope: "package", path: "skills/audit/SKILL.md", name: "audit" },
      ],
    },
    ...overrides,
  };
}

test("missing profile store bootstraps a persisted user default profile", async () => {
  const dir = tempDir();
  const filePath = path.join(dir, "web-profiles.json");
  writeFileSync(path.join(dir, "settings.json"), JSON.stringify({
    packages: [
      "npm:global-one",
      { source: "npm:global-two", prompts: ["+prompts/**"], themes: ["+themes/**"] },
    ],
  }, null, 2));
  const { readProfilesFile, listProfiles, hasPersistedProfileStore } = await loadStore();

  const store = await readProfilesFile({ filePath });
  assert.equal(store.version, 1);
  assert.match(store.defaults.globalProfileRef, /^profile:/);
  assert.equal(store.profiles.length, 1);
  assert.equal(store.profiles[0].id, store.defaults.globalProfileRef);
  assert.equal(store.profiles[0].name, "Coding Full");
  assert.equal(store.profiles[0].tools.builtinPreset, "full");
  assert.deepEqual(store.profiles[0].plugins, [
    { source: "npm:global-one", prompts: [], themes: [] },
    { source: "npm:global-two", prompts: [], themes: [] },
  ]);
  assert.equal(existsSync(filePath), true);
  assert.equal(hasPersistedProfileStore({ filePath }), true);

  const list = await listProfiles({ filePath });
  assert.equal(list.defaults.globalProfileRef, store.defaults.globalProfileRef);
  assert.equal(list.profiles.length, 1);
  assert.equal(list.builtinProfiles[0].id, "builtin:default");
});

test("concurrent first reads bootstrap exactly one default profile", async () => {
  const filePath = tempStorePath();
  const { readProfilesFile } = await loadStore();

  const stores = await Promise.all([
    readProfilesFile({ filePath }),
    readProfilesFile({ filePath }),
    readProfilesFile({ filePath }),
  ]);
  const stored = stores.at(-1);
  assert.ok(stored);
  assert.equal(stored.profiles.length, 1);
  assert.equal(stored.profiles[0].id, stored.defaults.globalProfileRef);
  assert.deepEqual(new Set(stores.map((store) => store.defaults.globalProfileRef)), new Set([stored.defaults.globalProfileRef]));
});

test("profiles API exposes one-shot bootstrap warnings", async () => {
  const filePath = tempStorePath();
  const { getProfilesApiResult } = await loadStore();

  const first = await getProfilesApiResult({ filePath });
  assert.equal(first.status, 200);
  assert.equal(first.body.profiles.length, 1);
  assert.equal(first.body.defaults.globalProfileRef, first.body.profiles[0].id);
  assert.deepEqual(first.body.warnings, ["Created the initial server default profile from global package settings."]);
  assert.deepEqual(first.body.profiles[0].tools, { builtinPreset: "full", pluginTools: "fromSelectedPlugins" });
  assert.deepEqual(first.body.profiles[0].skills, { mode: "pluginDefaultThenNarrow" });

  const second = await getProfilesApiResult({ filePath });
  assert.deepEqual(second.body.warnings, []);
});

test("bootstrap imports global packages only and preserves settings bytes", async () => {
  const root = tempDir();
  const agentDir = path.join(root, "agent");
  const cwd = path.join(root, "project");
  mkdirSync(path.join(cwd, ".pi"), { recursive: true });
  mkdirSync(agentDir, { recursive: true });
  const filePath = path.join(agentDir, "web-profiles.json");
  const globalSettingsPath = path.join(agentDir, "settings.json");
  const projectSettingsPath = path.join(cwd, ".pi", "settings.json");
  const globalBytes = `${JSON.stringify({ packages: ["npm:global", { source: "npm:filtered", skills: ["+skills/**"], prompts: ["+prompts/**"], themes: ["+themes/**"] }] }, null, 2)}\n`;
  const projectBytes = `${JSON.stringify({ packages: ["npm:project-only"] }, null, 2)}\n`;
  writeFileSync(globalSettingsPath, globalBytes);
  writeFileSync(projectSettingsPath, projectBytes);
  const { resolveProfilesFile } = await loadStore();

  const resolved = await resolveProfilesFile({ agentDir, cwd, filePath });
  assert.deepEqual(resolved.store.profiles[0].plugins, [
    { source: "npm:global", prompts: [], themes: [] },
    { source: "npm:filtered", skills: ["+skills/**"], prompts: [], themes: [] },
  ]);
  assert.equal(JSON.stringify(resolved.store.profiles[0].plugins).includes("project-only"), false);
  assert.equal(readFileSync(globalSettingsPath, "utf8"), globalBytes);
  assert.equal(readFileSync(projectSettingsPath, "utf8"), projectBytes);
});

test("valid persisted built-in default remains byte-stable", async () => {
  const filePath = tempStorePath();
  const before = `${JSON.stringify({ version: 1, defaults: { globalProfileRef: "builtin:default" }, profiles: [] }, null, 2)}\n`;
  writeFileSync(filePath, before);
  const { resolveProfilesFile } = await loadStore();

  const resolved = await resolveProfilesFile({ filePath });
  assert.equal(resolved.store.defaults.globalProfileRef, "builtin:default");
  assert.deepEqual(resolved.store.profiles, []);
  assert.deepEqual(resolved.warnings, []);
  assert.equal(readFileSync(filePath, "utf8"), before);
});

test("dangling global default is repaired with a visible warning", async () => {
  const filePath = tempStorePath();
  const existing = {
    id: "profile:00000000-0000-4000-8000-000000000002",
    name: "Existing",
    createdAt: "2026-01-02T03:04:05.000Z",
    updatedAt: "2026-01-02T03:04:05.000Z",
    tools: { builtinPreset: "default", pluginTools: "fromSelectedPlugins" },
    plugins: [],
    skills: { mode: "pluginDefaultThenNarrow" },
    futureProfileKey: { keep: true },
  };
  writeFileSync(filePath, `${JSON.stringify({
    version: 1,
    defaults: { globalProfileRef: "profile:00000000-0000-4000-8000-000000000003", projectProfileRefs: { "/repo": existing.id } },
    profiles: [existing],
    futureTopLevelKey: { keep: true },
  }, null, 2)}\n`);
  const { getProfilesApiResult } = await loadStore();

  const result = await getProfilesApiResult({ filePath });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.warnings, ["The stored global default profile was missing or invalid; a safe default profile was created and selected."]);
  assert.notEqual(result.body.defaults.globalProfileRef, "profile:00000000-0000-4000-8000-000000000003");
  assert.ok(result.body.profiles.some((profile) => profile.id === existing.id));
  assert.ok(result.body.profiles.some((profile) => profile.id === result.body.defaults.globalProfileRef));
  const stored = JSON.parse(readFileSync(filePath, "utf8"));
  assert.deepEqual(stored.futureTopLevelKey, { keep: true });
  assert.deepEqual(stored.profiles.find((profile) => profile.id === existing.id).futureProfileKey, { keep: true });
  assert.equal(stored.defaults.projectProfileRefs, undefined);
});

test("invalid global settings fail before bootstrap and can be retried", async () => {
  const cases = [
    { name: "malformed JSON", contents: "{not-json" },
    { name: "array root", contents: "[]" },
    { name: "null packages", contents: JSON.stringify({ packages: null }) },
    { name: "invalid PackageSource", contents: JSON.stringify({ packages: [{ source: 42 }] }) },
  ];
  const { resolveProfilesFile } = await loadStore();

  for (const testCase of cases) {
    const agentDir = tempDir(`pi-web-invalid-settings-${testCase.name.replaceAll(" ", "-")}`);
    const filePath = path.join(agentDir, "web-profiles.json");
    const settingsPath = path.join(agentDir, "settings.json");
    writeFileSync(settingsPath, testCase.contents);
    await assert.rejects(
      () => resolveProfilesFile({ agentDir, filePath }),
      (error) => {
        assert.equal(error.statusCode, 500);
        assert.match(error.message, /global.*settings|PackageSource/i);
        return true;
      },
    );
    assert.equal(existsSync(filePath), false);
    assert.equal(existsSync(`${filePath}.lock`), false);
    assert.equal(readFileSync(settingsPath, "utf8"), testCase.contents);

    writeFileSync(settingsPath, JSON.stringify({ packages: ["npm:retry"] }));
    const retried = await resolveProfilesFile({ agentDir, filePath });
    assert.deepEqual(retried.store.profiles[0].plugins, [{ source: "npm:retry", prompts: [], themes: [] }]);
  }
});

test("abandoned profile-store locks are recovered without deleting a new owner's lock", async () => {
  const agentDir = tempDir("pi-web-stale-profile-lock");
  const filePath = path.join(agentDir, "web-profiles.json");
  writeFileSync(path.join(agentDir, "settings.json"), JSON.stringify({ packages: [] }));
  writeFileSync(`${filePath}.lock`, JSON.stringify({ pid: 99_999_999, token: "dead-owner", createdAt: "2020-01-01T00:00:00.000Z" }));
  const { resolveProfilesFile } = await loadStore();

  const resolved = await resolveProfilesFile({ agentDir, filePath });
  assert.equal(resolved.store.profiles.length, 1);
  assert.equal(existsSync(`${filePath}.lock`), false);
});

test("abandoned-lock recovery preserves cross-process mutual exclusion", async () => {
  const root = tempDir("pi-web-lock-recovery-stress");
  const lockPath = path.join(root, "store.lock");
  const insidePath = path.join(root, "inside");
  const violationPath = path.join(root, "violations");
  writeFileSync(lockPath, JSON.stringify({ pid: 99_999_999, token: "dead-owner", createdAt: "2020-01-01T00:00:00.000Z" }));
  const moduleUrl = new URL("./file-lock.ts", import.meta.url).href;
  const worker = `
    import { appendFile, open, unlink } from "node:fs/promises";
    import { withFileLock } from ${JSON.stringify(moduleUrl)};
    const [lockPath, insidePath, violationPath] = process.argv.slice(1);
    await withFileLock(lockPath, async () => {
      let marker;
      try { marker = await open(insidePath, "wx"); }
      catch { await appendFile(violationPath, "overlap\\n"); }
      await new Promise((resolve) => setTimeout(resolve, 10));
      await marker?.close();
      if (marker) await unlink(insidePath).catch(() => undefined);
    }, { attempts: 1000, retryDelayMs: 2 });
  `;
  await Promise.all(Array.from({ length: 16 }, () => execFileAsync(
    process.execPath,
    ["--input-type=module", "-e", worker, lockPath, insidePath, violationPath],
    { maxBuffer: 1024 * 1024 },
  )));
  assert.equal(existsSync(violationPath), false);
  assert.equal(existsSync(lockPath), false);
  assert.equal(existsSync(`${lockPath}.recovery`), false);
});

test("first profile mutation returns bootstrap warnings instead of consuming them", async () => {
  const agentDir = tempDir("pi-web-mutation-warning");
  const filePath = path.join(agentDir, "web-profiles.json");
  writeFileSync(path.join(agentDir, "settings.json"), JSON.stringify({ packages: [] }));
  const { postProfilesApiResult, getProfilesApiResult } = await loadStore();

  const created = await postProfilesApiResult(sampleDraft(), { agentDir, filePath });
  assert.equal(created.status, 201);
  assert.deepEqual(created.body.warnings, ["Created the initial server default profile from global package settings."]);
  assert.deepEqual((await getProfilesApiResult({ agentDir, filePath })).body.warnings, []);
});

test("cross-process bootstrap converges on one persisted default", async () => {
  const filePath = tempStorePath();
  const moduleUrl = new URL("./profile-store.ts", import.meta.url).href;
  const worker = `
    import { registerHooks } from "node:module";
    registerHooks({ resolve(specifier, context, nextResolve) {
      if (specifier.startsWith(".") && !specifier.match(/\\\\.[cm]?[jt]sx?$/) && !specifier.includes("?")) {
        try { return nextResolve(specifier + ".ts", context); } catch {}
      }
      return nextResolve(specifier, context);
    }});
    const mod = await import(process.argv[1] + "?worker=" + process.pid);
    const store = await mod.readProfilesFile({ filePath: process.argv[2] });
    process.stdout.write(store.defaults.globalProfileRef);
  `;

  const results = await Promise.all(Array.from({ length: 4 }, () => execFileAsync(
    process.execPath,
    ["--input-type=module", "-e", worker, moduleUrl, filePath],
    { cwd: process.cwd(), timeout: 30_000 },
  )));
  const refs = results.map((result) => result.stdout.trim());
  assert.equal(new Set(refs).size, 1);
  const stored = JSON.parse(readFileSync(filePath, "utf8"));
  assert.equal(stored.profiles.length, 1);
  assert.equal(stored.profiles[0].id, stored.defaults.globalProfileRef);
  assert.deepEqual(readdirSync(path.dirname(filePath)).filter((name) => name.endsWith(".lock") || name.endsWith(".tmp")), []);
});

test("profile CRUD and global default API helpers write only web-profiles.json", async () => {
  const dir = tempDir();
  const filePath = path.join(dir, "web-profiles.json");
  const settingsPath = path.join(dir, "settings.json");
  writeFileSync(settingsPath, JSON.stringify({ untouched: true }, null, 2));
  const {
    postProfilesApiResult,
    patchProfileApiResult,
    patchDefaultProfileApiResult,
    deleteProfileApiResult,
    getProfilesApiResult,
  } = await loadStore();

  const created = await postProfilesApiResult(sampleDraft(), { filePath });
  assert.equal(created.status, 201);
  assert.match(created.body.id, /^profile:/);
  assert.equal(created.body.name, "Coding Full");

  const patched = await patchProfileApiResult(created.body.id, { name: "Renamed" }, { filePath });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.name, "Renamed");

  const defaulted = await patchDefaultProfileApiResult({ globalProfileRef: created.body.id }, { filePath });
  assert.equal(defaulted.status, 200);
  assert.equal(defaulted.body.defaults.globalProfileRef, created.body.id);

  await assert.rejects(
    () => deleteProfileApiResult(created.body.id, {}, { filePath }),
    /Deleting the global default profile requires replacementGlobalProfileRef/,
  );

  const deleted = await deleteProfileApiResult(created.body.id, { replacementGlobalProfileRef: "builtin:default" }, { filePath });
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.defaults.globalProfileRef, "builtin:default");
  assert.equal(deleted.body.profiles.length, 1);

  const listed = await getProfilesApiResult({ filePath });
  assert.equal(listed.status, 200);
  assert.equal(listed.body.defaults.globalProfileRef, "builtin:default");
  assert.deepEqual(JSON.parse(readFileSync(settingsPath, "utf8")), { untouched: true });
});

test("validators enforce exact Pi PackageSource shape and disabled SkillRef shape", async () => {
  const { postProfilesApiResult } = await loadStore();
  const filePath = tempStorePath();

  await assert.rejects(
    () => postProfilesApiResult(sampleDraft({ prompts: [] }), { filePath }),
    /profile\.prompts: is not supported for profile definitions/,
  );

  await assert.rejects(
    () => postProfilesApiResult(sampleDraft({ plugins: [{ source: "npm:x", unknown: [] }] }), { filePath }),
    /is not a supported PackageSource key/,
  );


  await assert.rejects(
    () => postProfilesApiResult(sampleDraft({ tools: { builtinPreset: "full", pluginTools: "fromSelectedPlugins", theme: "dark" } }), { filePath }),
    /profile\.tools\.theme: is not supported for profile tools/,
  );
  await assert.rejects(
    () => postProfilesApiResult(sampleDraft({ skills: { mode: "pluginDefaultThenNarrow", prompts: ["x"] } }), { filePath }),
    /profile\.skills\.prompts: is not supported for profile skills/,
  );

  await assert.rejects(
    () => postProfilesApiResult(sampleDraft({ skills: { mode: "pluginDefaultThenNarrow", disabledSkillRefs: [{ source: "npm:x" }] } }), { filePath }),
    /path: must be a non-empty string/,
  );

  const ok = await postProfilesApiResult(sampleDraft({
    plugins: [
      "npm:string-source",
      { source: "npm:object-source", extensions: [], skills: [], prompts: [], themes: [] },
    ],
  }), { filePath });
  assert.equal(ok.status, 201);
});

test("persisted profiles reject reserved capability fields while preserving unrelated metadata", async () => {
  const filePath = tempStorePath();
  const { postProfilesApiResult, resolveProfilesFile } = await loadStore();
  const created = await postProfilesApiResult(sampleDraft(), { filePath });
  const store = JSON.parse(readFileSync(filePath, "utf8"));
  const target = store.profiles.find((profile) => profile.id === created.body.id);
  target.prompts = ["forbidden.md"];
  target.futureMetadata = { keep: true };
  writeFileSync(filePath, JSON.stringify(store));

  await assert.rejects(() => resolveProfilesFile({ filePath }), /prompts: is not supported for profile definitions/);
});

test("effective package normalization disables prompts and themes without mutating saved definitions", async () => {
  const { normalizeProfilePackages } = await loadProfiles();
  const plugins = [
    "npm:pi-web-access",
    { source: "npm:example", extensions: ["+ext.ts"], skills: ["+skills/foo/SKILL.md"], prompts: ["+p.md"], themes: ["+t.json"] },
  ];
  const before = JSON.stringify(plugins);

  const normalized = normalizeProfilePackages(plugins);
  assert.deepEqual(normalized, [
    { source: "npm:pi-web-access", prompts: [], themes: [] },
    { source: "npm:example", extensions: ["+ext.ts"], skills: ["+skills/foo/SKILL.md"], prompts: [], themes: [] },
  ]);
  assert.equal(JSON.stringify(plugins), before);
});

test("read-modify-write preserves unknown top-level and profile-object keys but not project defaults", async () => {
  const filePath = tempStorePath();
  const { updateProfile, readProfilesFile } = await loadStore();
  const profile = {
    id: "profile:123e4567-e89b-12d3-a456-426614174000",
    name: "Existing",
    createdAt: "2026-01-02T03:04:05.000Z",
    updatedAt: "2026-01-02T03:04:05.000Z",
    tools: { builtinPreset: "default", pluginTools: "fromSelectedPlugins" },
    plugins: [],
    skills: { mode: "pluginDefaultThenNarrow" },
    futureProfileKey: { keep: true },
  };
  writeFileSync(filePath, `${JSON.stringify({
    version: 1,
    defaults: { globalProfileRef: profile.id, projectProfileRefs: { "/repo": profile.id } },
    profiles: [profile],
    futureTopLevelKey: { keep: true },
  }, null, 2)}\n`);

  await updateProfile(profile.id, { name: "Updated" }, { filePath });
  const stored = JSON.parse(readFileSync(filePath, "utf8"));
  assert.deepEqual(stored.futureTopLevelKey, { keep: true });
  assert.deepEqual(stored.profiles[0].futureProfileKey, { keep: true });
  assert.equal(stored.defaults.projectProfileRefs, undefined);
  assert.equal(stored.profiles[0].name, "Updated");

  const readBack = await readProfilesFile({ filePath });
  assert.equal(readBack.profiles[0].name, "Updated");
});

test("serialized concurrent profile creates preserve all profiles and valid default", async () => {
  const filePath = tempStorePath();
  const { createProfile, readProfilesFile } = await loadStore();

  const [first, second] = await Promise.all([
    createProfile(sampleDraft({ name: "One" }), { filePath }),
    createProfile(sampleDraft({ name: "Two" }), { filePath }),
  ]);

  const stored = await readProfilesFile({ filePath });
  assert.equal(stored.profiles.length, 3);
  assert.ok(stored.profiles.some((profile) => profile.id === first.id));
  assert.ok(stored.profiles.some((profile) => profile.id === second.id));
  assert.match(stored.defaults.globalProfileRef, /^profile:/);
  assert.ok(stored.profiles.some((profile) => profile.id === stored.defaults.globalProfileRef));
});

test("built-in refs are read-only generated entries, not saved user profiles", async () => {
  const filePath = tempStorePath();
  const { patchProfileApiResult, deleteProfileApiResult, postProfilesApiResult } = await loadStore();

  await assert.rejects(
    () => patchProfileApiResult("builtin:default", { name: "Nope" }, { filePath }),
    /must be a user profile:<uuid> ref/,
  );
  await assert.rejects(
    () => deleteProfileApiResult("builtin:default", {}, { filePath }),
    /must be a user profile:<uuid> ref/,
  );
  await assert.rejects(
    () => postProfilesApiResult({ ...sampleDraft(), id: "builtin:default" }, { filePath }),
    /profile\.id: is not supported for profile definitions/,
  );
});

test("Phase 01 source does not define snapshot-specific canonical types", () => {
  const source = readFileSync(new URL("./profiles.ts", import.meta.url), "utf8");
  assert.equal(/interface\s+CapabilitySnapshotV1/.test(source), false);
  assert.equal(/interface\s+ToolConflict/.test(source), false);
  assert.equal(/interface\s+ProfileDiagnostic/.test(source), false);
});
