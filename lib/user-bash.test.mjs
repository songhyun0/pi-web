import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./user-bash.ts");
}

test("parseUserBashCommand distinguishes context inclusion", async () => {
  const { parseUserBashCommand } = await loadSubject();
  assert.deepEqual(parseUserBashCommand("!pwd"), { command: "pwd", excludeFromContext: false, prefix: "!" });
  assert.deepEqual(parseUserBashCommand("!! npm test "), { command: "npm test", excludeFromContext: true, prefix: "!!" });
  assert.equal(parseUserBashCommand("hello"), null);
  assert.equal(parseUserBashCommand("!!!danger"), null);
});

test("formatBashDuration formats useful ranges", async () => {
  const { formatBashDuration } = await loadSubject();
  assert.equal(formatBashDuration(250), "250ms");
  assert.equal(formatBashDuration(1400), "1.4s");
  assert.equal(formatBashDuration(65_000), "1m 5s");
});
