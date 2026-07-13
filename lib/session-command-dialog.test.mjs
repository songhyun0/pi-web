import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sessionModals = await readFile(new URL("../components/SessionCommandModals.tsx", import.meta.url), "utf8");
const sharedDialog = await readFile(new URL("../components/ui/Dialog.tsx", import.meta.url), "utf8");

function functionSource(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing ${startMarker}`);
  assert.notEqual(end, -1, `missing ${endMarker}`);
  return source.slice(start, end);
}

test("session selectors use named shared dialogs with intentional search focus", () => {
  assert.equal(sessionModals.match(/<Dialog\b/g)?.length, 2);
  assert.match(sessionModals, /title="Navigate session tree"/);
  assert.match(sessionModals, /title="Fork from user message"/);
  assert.equal(sessionModals.match(/description="[^"]+"/g)?.length, 2);
  assert.equal(sessionModals.match(/initialFocusRef=\{inputRef\}/g)?.length, 2);
  assert.equal(sessionModals.match(/aria-label="(?:Search session tree|Filter user messages)"/g)?.length, 2);
  assert.doesNotMatch(sessionModals, /ModalShell|position:\s*"absolute"|100vh/);

  assert.match(sharedDialog, /aria-labelledby=\{titleId\}/);
  assert.match(sharedDialog, /aria-describedby=\{descriptionId\}/);
  assert.match(sharedDialog, /const explicitTarget = preferred && isTabbable\(preferred, panel\)/);
  assert.match(sharedDialog, /focusWithoutScroll\(explicitTarget \?\? policyTarget \?\? panel\)/);
});

test("shared dialog owns topmost Escape and contains Tab focus", () => {
  const treeKeys = functionSource(sessionModals, "const handleTreeKeyDown", "return (\n    <Dialog");
  const forkKeys = functionSource(sessionModals, "const handleForkKeyDown", "return (\n    <Dialog");
  assert.doesNotMatch(treeKeys, /event\.key === "Escape"/);
  assert.doesNotMatch(forkKeys, /event\.key === "Escape"/);
  assert.match(sessionModals, /event\.key === "Escape"[\s\S]*?event\.stopPropagation\(\)[\s\S]*?setEditingLabelId\(null\)/);

  assert.match(sharedDialog, /openDialogStack\[openDialogStack\.length - 1\] !== instanceId/);
  assert.match(sharedDialog, /event\.key === "Escape"[\s\S]*?!event\.defaultPrevented && dismissibleRef\.current/);
  assert.match(sharedDialog, /event\.stopImmediatePropagation\(\)/);
  assert.match(sharedDialog, /event\.key !== "Tab"/);
  assert.match(sharedDialog, /event\.shiftKey && activeElement === first/);
  assert.match(sharedDialog, /!event\.shiftKey && activeElement === last/);
});

test("shared dialog locks background interaction and restores opener focus", () => {
  assert.match(sharedDialog, /const previouslyFocused = document\.activeElement instanceof HTMLElement/);
  assert.match(sharedDialog, /lockBody\(\)/);
  assert.match(sharedDialog, /unlockBody\(\)/);
  assert.match(sharedDialog, /previouslyFocused\?\.isConnected/);
  assert.match(sharedDialog, /focusWithoutScroll\(previouslyFocused\)/);
});

test("session selectors use adaptive viewport dialogs and touch-safe controls", () => {
  assert.equal(sessionModals.match(/variant="adaptive"/g)?.length, 2);
  assert.equal(sessionModals.match(/height="viewport"/g)?.length, 2);
  assert.equal(sessionModals.match(/bodyLayout="flush"/g)?.length, 2);
  assert.match(sessionModals, /<Button\b/);
  assert.match(sessionModals, /<IconButton\b/);
  assert.match(sessionModals, /<Input\b/);
  assert.match(sessionModals, /<Select\b/);
  assert.match(sessionModals, /minHeight: "var\(--control-touch\)"/);
  assert.ok((sessionModals.match(/var\(--pi-safe-area-left\)/g) ?? []).length >= 4);
  assert.ok((sessionModals.match(/var\(--pi-safe-area-right\)/g) ?? []).length >= 4);
  assert.doesNotMatch(sessionModals, /#[0-9a-f]{3,8}\b/i);
});

test("session command keys do not override nested controls", () => {
  assert.match(sessionModals, /interactiveTarget = target\?\.closest\("button, input, select, textarea, a\[href\]"\)/);
  assert.match(sessionModals, /target === inputRef\.current/);
  assert.match(sessionModals, /data-tree-row-control="true"/);
  assert.match(sessionModals, /data-fork-row-control="true"/);
  assert.match(sessionModals, /if \(!handlesTreeCommands\) return/);
  assert.match(sessionModals, /if \(!handlesForkCommands\) return/);
});
