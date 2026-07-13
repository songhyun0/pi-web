import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const extensionHost = await readFile(new URL("../components/ExtensionUiHost.tsx", import.meta.url), "utf8");
const extensionStyles = await readFile(new URL("../components/ExtensionUiHost.module.css", import.meta.url), "utf8");
const sharedDialog = await readFile(new URL("../components/ui/Dialog.tsx", import.meta.url), "utf8");
const sharedPrimitives = await readFile(new URL("../components/ui/primitives.css", import.meta.url), "utf8");
const mountedCoverage = await readFile(new URL("./extension-ui-interaction.test.tsx", import.meta.url), "utf8");

function functionSource(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing ${startMarker}`);
  assert.notEqual(end, -1, `missing ${endMarker}`);
  return source.slice(start, end);
}

const extensionDialog = functionSource(extensionHost, "function ExtensionDialog", "function toTerminalKeyData");
const terminalKeys = functionSource(extensionHost, "function toTerminalKeyData", "function renderAnsiLine");
const customPanel = extensionHost.slice(extensionHost.indexOf("function ExtensionCustomPanel"));

test("extension request transitions remount named shared dialogs", () => {
  assert.match(extensionHost, /<ExtensionDialog[\s\S]*?key=\{dialog\.id\}/);
  assert.match(extensionHost, /<ExtensionCustomPanel[\s\S]*?key=\{customUi\.id\}/);
  assert.equal(extensionHost.match(/<Dialog\b/g)?.length, 2);
  assert.match(extensionDialog, /title=\{request\.title\}/);
  assert.match(extensionDialog, /description="Extension request"/);
  assert.doesNotMatch(extensionHost, /role="dialog"|position:\s*"absolute"/);
  assert.match(sharedDialog, /createPortal\([\s\S]*?document\.body/);
  assert.match(sharedDialog, /aria-labelledby=\{titleId\}/);
  assert.match(sharedDialog, /aria-modal="true"/);
});

test("every standard request has purposeful initial focus and shared containment", () => {
  assert.match(extensionDialog, /initialFocusRef=\{initialFocusRef\}/);
  assert.match(extensionDialog, /request\.method === "confirm"[\s\S]*?captureInitialFocus/);
  assert.match(extensionDialog, /request\.options\.length === 0[\s\S]*?captureInitialFocus/);
  assert.match(extensionDialog, /ref=\{index === 0 \? captureInitialFocus : undefined\}/);
  assert.equal(extensionDialog.match(/ref=\{captureInitialFocus\}/g)?.length, 2);
  assert.doesNotMatch(extensionDialog, /autoFocus|outline:\s*"none"|event\.key === "Escape"/);

  assert.match(sharedDialog, /event\.key !== "Tab"/);
  assert.match(sharedDialog, /event\.shiftKey && activeElement === first/);
  assert.match(sharedDialog, /!event\.shiftKey && activeElement === last/);
  assert.match(sharedDialog, /event\.key === "Escape"[\s\S]*?onEscapeKeyDownRef\.current\?\.\(event\)/);
  assert.match(sharedDialog, /!event\.defaultPrevented && dismissibleRef\.current/);
  assert.match(sharedDialog, /openDialogStack\[openDialogStack\.length - 1\]/);
  assert.match(sharedDialog, /lockBody\(\)/);
  assert.match(sharedDialog, /focusWithoutScroll\(previouslyFocused\)/);
});

test("extension responses retain select, confirm, cancel, input, and editor protocol values", () => {
  assert.match(extensionDialog, /onRespond\(request, \{ cancelled: true \}\)/);
  assert.match(extensionDialog, /onRespond\(request, \{ confirmed: true \}\)/);
  assert.match(extensionDialog, /onRespond\(request, \{ value \}\)/);
  assert.match(extensionDialog, /onRespond\(request, \{ value: option \}\)/);
  assert.match(extensionDialog, /event\.key === "Enter" && !event\.nativeEvent\.isComposing/);
  assert.match(extensionDialog, /\(event\.metaKey \|\| event\.ctrlKey\)[\s\S]*?event\.key === "Enter"/);
});

test("custom terminal keeps terminal Tab and Escape while exposing a visible focus route to Close", () => {
  assert.match(customPanel, /dismissible=\{false\}/);
  assert.match(customPanel, /initialFocusRef=\{inputRef\}/);
  assert.match(customPanel, /onEscapeKeyDown=\{\(event\) => \{[\s\S]*?onInput\(request, "\\x1b"\)[\s\S]*?inputRef\.current\?\.focus/);
  assert.match(terminalKeys, /case "Escape":[\s\S]*?return "\\x1b"/);
  assert.match(terminalKeys, /case "Tab":[\s\S]*?return "\\t"/);
  assert.match(customPanel, /event\.key === "F6"[\s\S]*?closeRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(customPanel, /onClick=\{\(\) => onInput\(request, "\\x03"\)\}/);
  assert.match(customPanel, /Escape and Tab are sent to the terminal/);
  assert.match(extensionStyles, /\.terminalShell:focus-within\s*\{[\s\S]*?var\(--focus-ring\)/);
  assert.doesNotMatch(extensionStyles, /\.terminalInput\s*\{[\s\S]*?opacity\s*:\s*0/);
});

test("extension dialogs inherit token contrast, viewport safety, and touch target sizing", () => {
  assert.doesNotMatch(extensionHost, /#[0-9a-f]{3,8}\b/i);
  assert.match(sharedPrimitives, /\.pi-button\[data-variant="primary"\]\s*\{\s*color:\s*var\(--accent-contrast\)/);
  assert.match(sharedPrimitives, /max-height:\s*calc\(var\(--pi-dialog-viewport-height\) - var\(--pi-safe-area-top\) - var\(--pi-safe-area-bottom\)/);
  assert.match(sharedPrimitives, /@media \(pointer: coarse\), \(max-width: 640px\)[\s\S]*?\.pi-button\[data-size="compact"\] \{ min-height: var\(--control-touch\); \}/);
  assert.match(extensionStyles, /calc\(var\(--pi-dialog-viewport-height\) - var\(--pi-safe-area-top\) - var\(--pi-safe-area-bottom\)/);
});

test("extension response protocol is backed by mounted submitted-value coverage", () => {
  assert.match(mountedCoverage, /submit the values produced by mounted controls/);
  assert.match(mountedCoverage, /expected: \{ value: "Beta value" \}/);
  assert.match(mountedCoverage, /expected: \{ confirmed: true \}/);
  assert.match(mountedCoverage, /expected: \{ value: "typed response" \}/);
  assert.match(mountedCoverage, /expected: \{ value: "edited\\nresponse" \}/);
  assert.match(mountedCoverage, /pressKey\(editor, "Enter", \{ ctrlKey: true \}\)/);
});
