import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
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
  await import("node:fs").then(({ writeFileSync }) => writeFileSync(path.join(agentDir, "settings.json"), `${JSON.stringify(settingsFile, null, 2)}\n`));

  const patched = patchRuntimeSettings(cwd, "global", { "retry.enabled": false });
  const stored = JSON.parse(readFileSync(path.join(agentDir, "settings.json"), "utf8"));
  assert.deepEqual(stored.unknownFutureField, { keep: true });
  assert.equal(stored.compaction.enabled, false);
  assert.equal(stored.compaction.reserveTokens, 42);
  assert.equal(stored.retry.enabled, false);

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
