import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const picker = await readFile(new URL("../components/DirectoryPickerModal.tsx", import.meta.url), "utf8");
const pickerStyles = await readFile(new URL("../components/DirectoryPickerModal.module.css", import.meta.url), "utf8");
const primitives = await readFile(new URL("../components/ui/primitives.css", import.meta.url), "utf8");
const mountedCoverage = await readFile(new URL("./directory-picker-interaction.test.tsx", import.meta.url), "utf8");

test("directory picker uses the named shared lifecycle with safe initial focus", () => {
  assert.equal(picker.match(/<Dialog\b/g)?.length, 1);
  assert.match(picker, /title=\{title\}/);
  assert.match(picker, /description=\{subtitle\}/);
  assert.match(picker, /variant="adaptive"/);
  assert.match(picker, /height="viewport"/);
  assert.match(picker, /bodyLayout="flush"/);
  assert.match(picker, /initialFocus="panel"/);
  assert.match(picker, /onOpenChange=\{handleOpenChange\}/);
  assert.match(picker, /if \(!nextOpen\) onClose\(\)/);
  assert.doesNotMatch(picker, /createPortal|role="dialog"|position:\s*"fixed"/);
});

test("directory browse, state, selection, and cancellation flows remain wired", () => {
  assert.match(picker, /fetch\(`\/api\/cwd\/browse\$\{query\}`/);
  assert.match(picker, /setParent\(data\.parent \?\? null\)/);
  assert.match(picker, /setEntries\(data\.entries \?\? \[\]\)/);
  assert.match(picker, /Loading directories…/);
  assert.match(picker, /role="alert"/);
  assert.match(picker, /No subdirectories/);
  assert.match(picker, /Parent directory/);
  assert.match(picker, /entries\.map\(\(entry\)/);
  assert.match(picker, /void onSelect\(cwd\)/);
  assert.match(picker, /disabled=\{!cwd \|\| loading \|\| busy\}/);
  assert.match(picker, /onClick=\{\(\) => handleOpenChange\(false\)\}/);
});

test("directory controls inherit token anatomy, safe areas, and touch sizing", () => {
  assert.match(picker, /<Button\b/);
  assert.doesNotMatch(picker, /<button\b/);
  assert.doesNotMatch(pickerStyles, /border-radius:\s*\d|box-shadow:\s*(?!var)/);
  assert.match(pickerStyles, /var\(--space-/);
  assert.match(pickerStyles, /var\(--pi-safe-area-right\)/);
  assert.match(pickerStyles, /var\(--pi-safe-area-left\)/);
  assert.match(primitives, /@media \(pointer: coarse\), \(max-width: 640px\)[\s\S]*?\.pi-button\[data-size="compact"\] \{ min-height: var\(--control-touch\); \}/);
});

test("directory contract is backed by mounted state and dismissal coverage", () => {
  assert.match(mountedCoverage, /loading, success, navigation, empty, and selection states/);
  assert.match(mountedCoverage, /browse failures and external busy errors/);
  assert.match(mountedCoverage, /Cancel, backdrop, and Escape/);
  assert.match(mountedCoverage, /document\.activeElement === panel/);
  assert.match(mountedCoverage, /document\.activeElement === opener/);
  assert.match(mountedCoverage, /selectedPath, "\/workspace\/project"/);
});
