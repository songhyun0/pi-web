import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { createJiti } = require("jiti");
async function loadSubject(agentDir) {
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const jiti = createJiti(import.meta.url, { moduleCache: false });
  return jiti("./runtime-settings-core.ts");
}

async function loadRuntimeSettingsEntry(agentDir) {
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const jiti = createJiti(import.meta.url, { moduleCache: false });
  return {
    ...jiti("./runtime-settings.ts"),
    ...jiti("./file-access.ts"),
  };
}

test("patchRuntimeSettings preserves unknown fields and updates nested keys", async () => {
  const agentDir = mkdtempSync(path.join(tmpdir(), "pi-web-settings-agent-"));
  const cwd = mkdtempSync(path.join(tmpdir(), "pi-web-settings-cwd-"));
  const { patchRuntimeSettings, loadRuntimeSettings } = await loadSubject(agentDir);

  patchRuntimeSettings(cwd, "global", {
    "compaction.enabled": false,
    steeringMode: "all",
  });
  let settingsFile = JSON.parse(readFileSync(path.join(agentDir, "settings.json"), "utf8"));
  settingsFile.unknownFutureField = { keep: true };
  settingsFile.compaction.reserveTokens = 42;
  settingsFile.agentProfiles = { version: 1, profiles: [{ id: "keep", name: "Keep" }] };
  await import("node:fs").then(({ writeFileSync }) => writeFileSync(path.join(agentDir, "settings.json"), `${JSON.stringify(settingsFile, null, 2)}\n`));

  const patched = patchRuntimeSettings(cwd, "global", { "retry.enabled": false });
  const stored = JSON.parse(readFileSync(path.join(agentDir, "settings.json"), "utf8"));
  assert.deepEqual(stored.unknownFutureField, { keep: true });
  assert.equal(stored.compaction.enabled, false);
  assert.equal(stored.compaction.reserveTokens, 42);
  assert.equal(stored.retry.enabled, false);
  assert.deepEqual(stored.agentProfiles, { version: 1, profiles: [{ id: "keep", name: "Keep" }] });

  const compaction = loadRuntimeSettings(cwd).settings.find((setting) => setting.key === "compaction.enabled");
  assert.equal(compaction?.effectiveValue, false);
  assert.equal(patched.changed.includes("retry.enabled"), true);
});

test("patchRuntimeSettings validates allowed values and reset deletes keys", async () => {
  const agentDir = mkdtempSync(path.join(tmpdir(), "pi-web-settings-agent-"));
  const cwd = mkdtempSync(path.join(tmpdir(), "pi-web-settings-cwd-"));
  const { patchRuntimeSettings } = await loadSubject(agentDir);

  assert.throws(() => patchRuntimeSettings(cwd, "global", { defaultProjectTrust: "maybe" }), /must be one of/);
  const result = patchRuntimeSettings(cwd, "global", { defaultProjectTrust: "always" });
  assert.equal(result.settings.find((setting) => setting.key === "defaultProjectTrust")?.effectiveValue, "always");
  const reset = patchRuntimeSettings(cwd, "global", { defaultProjectTrust: null });
  assert.equal(reset.settings.find((setting) => setting.key === "defaultProjectTrust")?.effectiveValue, "ask");
  assert.equal(reset.reset.includes("defaultProjectTrust"), true);
});

test("project runtime settings keep upstream clean-project trust semantics", async () => {
  const agentDir = mkdtempSync(path.join(tmpdir(), "pi-web-settings-agent-"));
  const cwd = mkdtempSync(path.join(tmpdir(), "pi-web-settings-cwd-"));
  const { ProjectTrustStore } = await import("@earendil-works/pi-coding-agent");
  const { patchRuntimeSettings, loadRuntimeSettings } = await loadSubject(agentDir);

  const before = loadRuntimeSettings(cwd);
  assert.equal(before.projectTrustSource, "none-required");
  assert.equal(before.scopes.project.readable, true);
  assert.equal(before.scopes.project.writable, true);

  const patched = patchRuntimeSettings(cwd, "project", { steeringMode: "all" });

  assert.equal(new ProjectTrustStore(agentDir).get(cwd), null);
  assert.equal(patched.projectTrustSource, "untrusted");
  assert.equal(patched.scopes.project.writable, false);
  assert.equal(patched.settings.find((setting) => setting.key === "steeringMode")?.effectiveScope, "default");
  const stored = JSON.parse(readFileSync(path.join(cwd, ".pi", "settings.json"), "utf8"));
  assert.equal(stored.steeringMode, "all");
});

test("validateRuntimeSettingsCwd rejects symlink escapes", async () => {
  const agentDir = mkdtempSync(path.join(tmpdir(), "pi-web-settings-agent-"));
  const allowedRoot = mkdtempSync(path.join(tmpdir(), "pi-web-settings-allowed-"));
  const outsideRoot = mkdtempSync(path.join(tmpdir(), "pi-web-settings-outside-"));
  const linkPath = path.join(allowedRoot, "outside-link");
  symlinkSync(outsideRoot, linkPath);
  const { allowFileRoot, validateRuntimeSettingsCwd } = await loadRuntimeSettingsEntry(agentDir);

  allowFileRoot(allowedRoot);

  await assert.rejects(
    () => validateRuntimeSettingsCwd(linkPath),
    /Access denied for cwd/,
  );
});

test("validateRuntimeSettingsCwd returns canonical real paths", async () => {
  const agentDir = mkdtempSync(path.join(tmpdir(), "pi-web-settings-agent-"));
  const allowedRoot = realpathSync.native(mkdtempSync(path.join(tmpdir(), "pi-web-settings-allowed-")));
  const realCwd = mkdtempSync(path.join(allowedRoot, "real-cwd-"));
  const linkPath = path.join(allowedRoot, "cwd-link");
  symlinkSync(realCwd, linkPath);
  const { allowFileRoot, validateRuntimeSettingsCwd } = await loadRuntimeSettingsEntry(agentDir);

  allowFileRoot(allowedRoot);

  assert.equal(await validateRuntimeSettingsCwd(linkPath), realCwd);
});
