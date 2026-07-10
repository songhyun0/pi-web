import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
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

let importCounter = 0;

async function loadStore() {
  importCounter += 1;
  return import(`./session-profile-store.ts?case=${importCounter}`);
}

function tempStorePath() {
  const dir = path.join(tmpdir(), `pi-web-session-profiles-${process.pid}-${importCounter}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return path.join(dir, "web-session-profiles.json");
}

function sampleSnapshot(overrides = {}) {
  return {
    version: 1,
    snapshotId: overrides.snapshotId ?? "snapshot-1",
    createdAt: overrides.createdAt ?? "2026-01-02T03:04:05.000Z",
    profileRef: overrides.profileRef ?? "profile:123e4567-e89b-12d3-a456-426614174000",
    profileName: overrides.profileName ?? "Coding Full",
    cwd: overrides.cwd ?? "/tmp/project",
    projectRoot: overrides.projectRoot ?? "/tmp/project",
    tools: overrides.tools ?? {
      builtinPreset: "default",
      requestedBuiltinTools: ["read", "bash", "edit", "write"],
      pluginTools: [{ name: "web_search", source: "npm:pi-web-access", extension: "extensions/web-search.ts", provenance: "plugin", metadataResolved: true }],
      activeToolNames: ["read", "bash", "edit", "write", "web_search"],
      conflicts: [],
    },
    plugins: overrides.plugins ?? [
      { source: "npm:pi-web-access", prompts: [], themes: [] },
      { source: "npm:example", skills: ["+skills/review/SKILL.md"], prompts: [], themes: [] },
    ],
    skills: overrides.skills ?? {
      mode: "pluginDefaultThenNarrow",
      visibleSkillRefs: [{ source: "npm:example", scope: "package", path: "skills/review/SKILL.md", name: "review" }],
      hiddenSkillRefs: [{ source: "npm:example", scope: "package", path: "skills/audit/SKILL.md", name: "audit" }],
    },
    diagnostics: overrides.diagnostics ?? [
      { type: "info", message: "Profile resolved for testing.", source: "test" },
    ],
  };
}

function withProfileName(name) {
  return sampleSnapshot({ snapshotId: `snapshot-${name}`, profileName: name });
}

test("missing store and missing session return legacy without creating a file", async () => {
  const filePath = tempStorePath();
  const { getSessionProfileSnapshot, readSessionProfilesFile } = await loadStore();

  const lookup = await getSessionProfileSnapshot("session-a", { filePath });
  assert.equal(lookup.state, "legacy");
  assert.equal(lookup.label, "Legacy / current settings");
  assert.equal(lookup.snapshot, null);
  assert.deepEqual(lookup.writeToken, { storeRevision: 0 });
  assert.equal(existsSync(filePath), false);

  assert.deepEqual(await readSessionProfilesFile({ filePath }), { version: 1, revision: 0, sessions: {} });
  assert.equal(existsSync(filePath), false);
});

test("snapshot writes preserve unknown top-level keys and return exact saved snapshots", async () => {
  const filePath = tempStorePath();
  writeFileSync(filePath, JSON.stringify({ version: 1, revision: 0, sessions: {}, futureKey: { keep: true } }, null, 2));
  const { setSessionProfileSnapshot, getSessionProfileSnapshot, readSessionProfilesFile } = await loadStore();

  const snapshot = sampleSnapshot();
  const result = await setSessionProfileSnapshot("session-a", snapshot, {
    sessionFilePath: "/tmp/session-a.jsonl",
    cwd: "/tmp/project",
    updatedAt: "2026-01-02T04:05:06.000Z",
  }, undefined, { filePath });

  assert.deepEqual(result.writeToken, { storeRevision: 1, recordRevision: 1, snapshotId: "snapshot-1" });
  const stored = JSON.parse(readFileSync(filePath, "utf8"));
  assert.deepEqual(stored.futureKey, { keep: true });
  assert.equal(stored.revision, 1);

  const lookup = await getSessionProfileSnapshot("session-a", { filePath });
  assert.equal(lookup.state, "snapshot");
  assert.deepEqual(lookup.snapshot, snapshot);
  assert.equal(lookup.record.sessionFilePath, "/tmp/session-a.jsonl");
  assert.equal(lookup.record.cwd, "/tmp/project");

  const raw = await readSessionProfilesFile({ filePath });
  assert.deepEqual(raw.futureKey, { keep: true });
});

test("invalid snapshot payload is rejected before replacing an existing file", async () => {
  const filePath = tempStorePath();
  const { setSessionProfileSnapshot } = await loadStore();
  await setSessionProfileSnapshot("session-a", sampleSnapshot(), { updatedAt: "2026-01-02T04:05:06.000Z" }, undefined, { filePath });
  const before = readFileSync(filePath, "utf8");

  await assert.rejects(
    () => setSessionProfileSnapshot("session-a", { ...sampleSnapshot(), version: 2 }, {}, undefined, { filePath }),
    (error) => error?.code === "VALIDATION" && /version must be 1/.test(error.message),
  );
  assert.equal(readFileSync(filePath, "utf8"), before);
});

test("snapshot schema rejects reserved nested keys, resource filters, and tool widening", async () => {
  const filePath = tempStorePath();
  const { setSessionProfileSnapshot } = await loadStore();
  const base = sampleSnapshot();
  const cases = [
    { ...base, tools: { ...base.tools, promptBundle: "forbidden" } },
    { ...base, plugins: [{ source: "npm:pi-web-access", prompts: ["+prompts/**"], themes: [] }] },
    {
      ...base,
      tools: { builtinPreset: "none", requestedBuiltinTools: ["bash"], pluginTools: [], activeToolNames: ["bash"], conflicts: [] },
    },
  ];
  for (const [index, snapshot] of cases.entries()) {
    await assert.rejects(
      () => setSessionProfileSnapshot(`session-invalid-${index}`, snapshot, {}, undefined, { filePath }),
      (error) => error?.code === "VALIDATION",
    );
  }
  assert.equal(existsSync(filePath), false);
});

test("concurrent writes to different sessions preserve both records", async () => {
  const filePath = tempStorePath();
  const { setSessionProfileSnapshot, readSessionProfilesFile } = await loadStore();

  await Promise.all([
    setSessionProfileSnapshot("session-a", withProfileName("Alpha"), {}, undefined, { filePath }),
    setSessionProfileSnapshot("session-b", withProfileName("Beta"), {}, undefined, { filePath }),
  ]);

  const stored = await readSessionProfilesFile({ filePath });
  assert.equal(stored.revision, 2);
  assert.equal(stored.sessions["session-a"].snapshot.profileName, "Alpha");
  assert.equal(stored.sessions["session-b"].snapshot.profileName, "Beta");
  assert.equal(stored.sessions["session-a"].recordRevision, 1);
  assert.equal(stored.sessions["session-b"].recordRevision, 1);
});

test("same-session competing writes obey CAS tokens", async () => {
  const filePath = tempStorePath();
  const { getSessionProfileSnapshot, setSessionProfileSnapshot } = await loadStore();
  const legacy = await getSessionProfileSnapshot("session-a", { filePath });

  const writes = await Promise.allSettled([
    setSessionProfileSnapshot("session-a", withProfileName("Alpha"), {}, legacy.writeToken, { filePath }),
    setSessionProfileSnapshot("session-a", withProfileName("Beta"), {}, legacy.writeToken, { filePath }),
  ]);

  assert.equal(writes.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = writes.find((result) => result.status === "rejected");
  assert.equal(rejected?.reason.code, "CAS_CONFLICT");

  const stored = await getSessionProfileSnapshot("session-a", { filePath });
  assert.equal(stored.state, "snapshot");
  assert.equal(stored.writeToken.storeRevision, 1);
  assert.equal(stored.writeToken.recordRevision, 1);
  assert.ok(["Alpha", "Beta"].includes(stored.snapshot.profileName));
});

test("rollback restores the exact previous record when the failed write token matches", async () => {
  const filePath = tempStorePath();
  const { setSessionProfileSnapshot, restoreSessionProfileSnapshot, getSessionProfileSnapshot } = await loadStore();

  const first = await setSessionProfileSnapshot("session-a", withProfileName("Original"), {
    sessionFilePath: "/tmp/session-a.jsonl",
    updatedAt: "2026-01-02T04:05:06.000Z",
  }, undefined, { filePath });
  const second = await setSessionProfileSnapshot("session-a", withProfileName("Attempt"), {
    sessionFilePath: "/tmp/session-a.jsonl",
    updatedAt: "2026-01-02T05:06:07.000Z",
  }, first.writeToken, { filePath });

  assert.deepEqual(second.previousRecord, first.record);
  const rollback = await restoreSessionProfileSnapshot("session-a", second.previousRecord, second.writeToken, { filePath });
  assert.deepEqual(rollback.record, first.record);
  assert.deepEqual(rollback.writeToken, { storeRevision: 3, recordRevision: 1, snapshotId: "snapshot-Original" });

  const lookup = await getSessionProfileSnapshot("session-a", { filePath });
  assert.equal(lookup.state, "snapshot");
  assert.deepEqual(lookup.record, first.record);
});

test("rollback deletes a failed-attempt record when previous state was legacy", async () => {
  const filePath = tempStorePath();
  const { getSessionProfileSnapshot, setSessionProfileSnapshot, restoreSessionProfileSnapshot, readSessionProfilesFile } = await loadStore();

  const legacy = await getSessionProfileSnapshot("session-a", { filePath });
  const attempt = await setSessionProfileSnapshot("session-a", withProfileName("Attempt"), {}, legacy.writeToken, { filePath });
  assert.equal(attempt.previousRecord, null);

  const rollback = await restoreSessionProfileSnapshot("session-a", null, attempt.writeToken, { filePath });
  assert.equal(rollback.record, null);
  assert.deepEqual(rollback.writeToken, { storeRevision: 2 });

  const lookup = await getSessionProfileSnapshot("session-a", { filePath });
  assert.equal(lookup.state, "legacy");
  const stored = await readSessionProfilesFile({ filePath });
  assert.deepEqual(stored.sessions, {});
});

test("rollback ignores unrelated-session writes when target record still matches failed attempt", async () => {
  const filePath = tempStorePath();
  const { getSessionProfileSnapshot, setSessionProfileSnapshot, restoreSessionProfileSnapshot } = await loadStore();

  const first = await setSessionProfileSnapshot("session-a", withProfileName("Original"), {}, undefined, { filePath });
  const attempt = await setSessionProfileSnapshot("session-a", withProfileName("Attempt"), {}, first.writeToken, { filePath });
  await setSessionProfileSnapshot("session-b", withProfileName("Unrelated"), {}, undefined, { filePath });

  const rollback = await restoreSessionProfileSnapshot("session-a", attempt.previousRecord, attempt.writeToken, { filePath });
  assert.equal(rollback.record?.snapshot.profileName, "Original");
  assert.equal(rollback.writeToken.recordRevision, 1);

  const sessionA = await getSessionProfileSnapshot("session-a", { filePath });
  const sessionB = await getSessionProfileSnapshot("session-b", { filePath });
  assert.equal(sessionA.state, "snapshot");
  assert.equal(sessionA.snapshot.profileName, "Original");
  assert.equal(sessionB.state, "snapshot");
  assert.equal(sessionB.snapshot.profileName, "Unrelated");
});

test("rollback refuses to overwrite a newer concurrent commit", async () => {
  const filePath = tempStorePath();
  const { setSessionProfileSnapshot, restoreSessionProfileSnapshot, getSessionProfileSnapshot } = await loadStore();

  const first = await setSessionProfileSnapshot("session-a", withProfileName("Original"), {}, undefined, { filePath });
  const failedAttempt = await setSessionProfileSnapshot("session-a", withProfileName("Attempt"), {}, first.writeToken, { filePath });
  await setSessionProfileSnapshot("session-a", withProfileName("Newer"), {}, failedAttempt.writeToken, { filePath });

  await assert.rejects(
    () => restoreSessionProfileSnapshot("session-a", failedAttempt.previousRecord, failedAttempt.writeToken, { filePath }),
    (error) => error?.code === "CAS_CONFLICT" && error.currentToken?.recordRevision === 3,
  );
  const lookup = await getSessionProfileSnapshot("session-a", { filePath });
  assert.equal(lookup.state, "snapshot");
  assert.equal(lookup.snapshot.profileName, "Newer");
});

test("rollback rejects same-session ABA when record revision is reused with a different snapshot", async () => {
  const filePath = tempStorePath();
  const {
    deleteSessionProfileSnapshot,
    getSessionProfileSnapshot,
    restoreSessionProfileSnapshot,
    setSessionProfileSnapshot,
  } = await loadStore();

  const legacy = await getSessionProfileSnapshot("session-a", { filePath });
  const attempt = await setSessionProfileSnapshot("session-a", withProfileName("Attempt"), {}, legacy.writeToken, { filePath });
  await deleteSessionProfileSnapshot("session-a", attempt.writeToken, { filePath });
  const afterDelete = await getSessionProfileSnapshot("session-a", { filePath });
  await setSessionProfileSnapshot("session-a", withProfileName("Newer"), {}, afterDelete.writeToken, { filePath });

  await assert.rejects(
    () => restoreSessionProfileSnapshot("session-a", attempt.previousRecord, attempt.writeToken, { filePath }),
    (error) => error?.code === "CAS_CONFLICT" && error.currentToken?.snapshotId === "snapshot-Newer",
  );
});

test("GET API result returns saved snapshots and explicit legacy shape", async () => {
  const filePath = tempStorePath();
  const { setSessionProfileSnapshot } = await loadStore();
  const { getSessionProfileApiResult } = await loadStore();
  const resolveSessionPath = async (sessionId) => sessionId === "missing" ? null : `/tmp/${sessionId}.jsonl`;

  const legacy = await getSessionProfileApiResult("legacy-session", { resolveSessionPath, storeOptions: { filePath } });
  assert.equal(legacy.status, 200);
  assert.deepEqual(legacy.body, { state: "legacy", label: "Legacy / current settings", snapshot: null });

  const snapshot = sampleSnapshot();
  await setSessionProfileSnapshot("session-a", snapshot, {
    sessionFilePath: "/tmp/session-a.jsonl",
    updatedAt: "2026-01-02T04:05:06.000Z",
  }, undefined, { filePath });
  const saved = await getSessionProfileApiResult("session-a", { resolveSessionPath, storeOptions: { filePath } });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.state, "snapshot");
  assert.deepEqual(saved.body.snapshot, snapshot);
  assert.deepEqual(saved.body.record, {
    sessionId: "session-a",
    sessionFilePath: "/tmp/session-a.jsonl",
    updatedAt: "2026-01-02T04:05:06.000Z",
    recordRevision: 1,
  });

  const missing = await getSessionProfileApiResult("missing", { resolveSessionPath, storeOptions: { filePath } });
  assert.equal(missing.status, 404);
});


test("abandoned snapshot-store locks are recovered", async () => {
  const filePath = tempStorePath();
  writeFileSync(`${filePath}.lock`, JSON.stringify({ pid: 99_999_999, token: "dead-owner", createdAt: "2020-01-01T00:00:00.000Z" }));
  const { setSessionProfileSnapshot } = await loadStore();

  await setSessionProfileSnapshot("session-a", sampleSnapshot(), {}, undefined, { filePath });
  assert.equal(existsSync(`${filePath}.lock`), false);
  assert.equal(existsSync(filePath), true);
});

test("session snapshot store writes only web-session-profiles.json and reuses Phase 01 profile types", async () => {
  const dir = path.join(tmpdir(), `pi-web-session-profile-agent-${process.pid}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  const settingsPath = path.join(dir, "settings.json");
  writeFileSync(settingsPath, JSON.stringify({ untouched: true }, null, 2));
  const { setSessionProfileSnapshot, getSessionProfilesPath } = await loadStore();

  const filePath = getSessionProfilesPath({ agentDir: dir });
  await setSessionProfileSnapshot("session-a", sampleSnapshot(), {}, undefined, { agentDir: dir });

  assert.equal(filePath, path.join(dir, "web-session-profiles.json"));
  assert.equal(existsSync(filePath), true);
  assert.deepEqual(JSON.parse(readFileSync(settingsPath, "utf8")), { untouched: true });

  const source = readFileSync(new URL("./session-profile-store.ts", import.meta.url), "utf8");
  assert.match(source, /from "\.\/profiles"/);
  assert.equal(/const PROFILE_REF_RE/.test(source), false);
  assert.equal(/const PACKAGE_SOURCE_KEYS/.test(source), false);
  assert.equal(/type ToolPreset =/.test(source), false);
});
