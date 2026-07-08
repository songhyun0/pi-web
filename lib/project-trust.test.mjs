import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

async function loadSubject() {
  return import("./project-trust-core.ts");
}

test("collectProjectTrustInventory detects trust-requiring resources without loading code", async () => {
  const { collectProjectTrustInventory } = await loadSubject();
  const cwd = mkdtempSync(path.join(tmpdir(), "pi-web-trust-"));
  mkdirSync(path.join(cwd, ".pi", "extensions"), { recursive: true });
  writeFileSync(path.join(cwd, ".pi", "extensions", "evil.ts"), "throw new Error('should not run')\n");
  writeFileSync(path.join(cwd, ".pi", "settings.json"), JSON.stringify({ packages: ["npm:@example/plugin"] }));

  const inventory = collectProjectTrustInventory(cwd);
  const extensions = inventory.find((item) => item.kind === "pi-extensions");
  assert.equal(extensions?.exists, true);
  assert.equal(extensions?.count, 1);

  const packages = inventory.find((item) => item.kind === "project-packages");
  assert.equal(packages?.exists, true);
  assert.equal(packages?.count, 1);
  assert.deepEqual(packages?.details, ["npm:@example/plugin"]);
});

test("getProjectTrustActionUpdates matches CLI parent trust semantics", async () => {
  const { getProjectTrustActionUpdates } = await loadSubject();
  const cwd = path.join(tmpdir(), "project", "child");
  assert.deepEqual(getProjectTrustActionUpdates(cwd, "trust"), [{ path: path.resolve(cwd), decision: true }]);
  assert.deepEqual(getProjectTrustActionUpdates(cwd, "deny"), [{ path: path.resolve(cwd), decision: false }]);
  assert.deepEqual(getProjectTrustActionUpdates(cwd, "clear"), [{ path: path.resolve(cwd), decision: null }]);
  assert.deepEqual(getProjectTrustActionUpdates(cwd, "trust-parent"), [
    { path: path.dirname(path.resolve(cwd)), decision: true },
    { path: path.resolve(cwd), decision: null },
  ]);
});
