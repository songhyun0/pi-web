import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./session-tree-view.ts");
}

function msg(id, parentId, role, text, extra = {}) {
  return {
    entry: {
      type: "message",
      id,
      parentId,
      timestamp: "2026-01-01T00:00:00.000Z",
      message: { role, content: text, ...extra },
    },
    children: [],
  };
}

function sampleTree() {
  const root = msg("root", null, "user", "start");
  const tool = msg("tool", "root", "toolResult", "tool output", { toolName: "bash" });
  const a = msg("a", "tool", "assistant", "answer");
  const b = msg("b", "root", "user", "branch question");
  b.label = "checkpoint";
  b.labelTimestamp = "2026-01-01T00:01:00.000Z";
  root.children = [tool, b];
  tool.children = [a];
  return [root];
}

test("flattenTree is iterative, labels rows, and preserves active path", async () => {
  const { flattenTree } = await loadSubject();
  const rows = flattenTree(sampleTree(), "a", { showLabelTimestamps: true });
  assert.deepEqual(rows.map((row) => row.id), ["root", "tool", "a", "b"]);
  assert.equal(rows.find((row) => row.id === "a").isActive, true);
  assert.equal(rows.find((row) => row.id === "b").label, "checkpoint");
  assert.match(rows.find((row) => row.id === "b").searchText, /checkpoint/);
  assert.ok(rows.find((row) => row.id === "b").labelTimestampText);
});

test("filter modes include labels, user rows, and no-tool rows", async () => {
  const { filterTreeRows, flattenTree } = await loadSubject();
  const rows = flattenTree(sampleTree(), "a");
  assert.deepEqual(filterTreeRows(rows, "", "labeled-only").map((row) => row.id), ["b"]);
  assert.deepEqual(filterTreeRows(rows, "", "user-only").map((row) => row.id), ["root", "b"]);
  assert.equal(filterTreeRows(rows, "", "no-tools").some((row) => row.id === "tool"), false);
  assert.deepEqual(filterTreeRows(rows, "checkpoint", "all").map((row) => row.id), ["b"]);
});

test("folded rows hide descendants while active path stays expanded", async () => {
  const { flattenTree } = await loadSubject();
  const hidden = flattenTree(sampleTree(), "b", { foldedIds: new Set(["tool"]) });
  assert.equal(hidden.some((row) => row.id === "a"), false);
  const activeExpanded = flattenTree(sampleTree(), "a", { foldedIds: new Set(["tool"]) });
  assert.equal(activeExpanded.some((row) => row.id === "a"), true);
});
