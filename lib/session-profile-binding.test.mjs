import assert from "node:assert/strict";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !specifier.match(/\.[cm]?[jt]sx?$/) && !specifier.includes("?")) {
      try { return nextResolve(`${specifier}.ts`, context); } catch { /* fall through */ }
    }
    return nextResolve(specifier, context);
  },
});

function fixture() {
  const root = path.join(tmpdir(), `pi-web-profile-binding-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const cwd = path.join(root, "project");
  const otherCwd = path.join(root, "other");
  const sessionFilePath = path.join(root, "session.jsonl");
  const otherFilePath = path.join(root, "other.jsonl");
  mkdirSync(cwd, { recursive: true });
  mkdirSync(otherCwd, { recursive: true });
  writeFileSync(sessionFilePath, "{}\n");
  writeFileSync(otherFilePath, "{}\n");
  const canonicalCwd = realpathSync(cwd);
  const canonicalFile = realpathSync(sessionFilePath);
  const snapshot = { cwd: canonicalCwd, snapshotId: "snapshot-1" };
  const lookup = {
    state: "snapshot",
    snapshot,
    record: { sessionId: "session-a", sessionFilePath: canonicalFile, cwd: canonicalCwd, snapshot },
    writeToken: { storeRevision: 1 },
  };
  return { cwd, otherCwd, sessionFilePath, otherFilePath, canonicalCwd, canonicalFile, lookup };
}

test("session profile binding accepts one canonical identity", async () => {
  const { assertSessionProfileBinding } = await import("./session-profile-binding.ts");
  const f = fixture();
  const result = await assertSessionProfileBinding({ sessionId: "session-a", sessionFilePath: f.sessionFilePath, cwd: f.cwd, lookup: f.lookup });
  assert.deepEqual(result, { sessionFilePath: f.canonicalFile, cwd: f.canonicalCwd });
});

test("session profile binding rejects cwd and file drift", async () => {
  const { assertSessionProfileBinding } = await import("./session-profile-binding.ts");
  const f = fixture();
  await assert.rejects(
    () => assertSessionProfileBinding({ sessionId: "session-a", sessionFilePath: f.sessionFilePath, cwd: f.otherCwd, lookup: f.lookup }),
    /snapshot cwd does not match/,
  );
  await assert.rejects(
    () => assertSessionProfileBinding({ sessionId: "session-a", sessionFilePath: f.otherFilePath, cwd: f.cwd, lookup: f.lookup }),
    /record path does not match/,
  );
});
