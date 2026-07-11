import assert from "node:assert/strict";
import test from "node:test";

import { diffFileLines } from "./file-diff.ts";

const compact = (lines) => lines.map(({ type, text, lineNo }) => [type, text, lineNo]);

test("file diff preserves unchanged lines around replacements and insertions", () => {
  assert.deepEqual(compact(diffFileLines(
    ["alpha", "beta", "gamma", ""],
    ["alpha", "beta updated", "gamma", "delta", ""],
  )), [
    ["unchanged", "alpha", 1],
    ["removed", "beta", 2],
    ["added", "beta updated", 2],
    ["unchanged", "gamma", 3],
    ["added", "delta", 4],
    ["unchanged", "", 4],
  ]);
});

test("file diff handles leading and trailing edits", () => {
  assert.deepEqual(compact(diffFileLines(["b", "c"], ["a", "b"])), [
    ["added", "a", 1],
    ["unchanged", "b", 1],
    ["removed", "c", 2],
  ]);
});

test("file diff handles identical and empty inputs", () => {
  assert.deepEqual(compact(diffFileLines(["same"], ["same"])), [["unchanged", "same", 1]]);
  assert.deepEqual(compact(diffFileLines([], ["new"])), [["added", "new", 1]]);
  assert.deepEqual(compact(diffFileLines(["old"], [])), [["removed", "old", 1]]);
  assert.deepEqual(diffFileLines([], []), []);
});

test("file diff falls back safely for very large edit distances", () => {
  const oldLines = Array.from({ length: 501 }, (_, index) => `old-${index}`);
  const newLines = Array.from({ length: 501 }, (_, index) => `new-${index}`);
  const result = diffFileLines(oldLines, newLines);

  assert.equal(result.length, 1002);
  assert.deepEqual(result[0], { type: "removed", text: "old-0", lineNo: 1 });
  assert.deepEqual(result.at(-1), { type: "added", text: "new-500", lineNo: 501 });
});
