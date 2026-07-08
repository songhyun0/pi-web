import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./web-keybindings.ts");
}

test("buildWebKeybindings applies user overrides and detects browser conflicts", async () => {
  const { buildWebKeybindings } = await loadSubject();
  const bindings = buildWebKeybindings({ bindings: { "chat.editor.external": "Ctrl+E", "app.hotkeys": "Ctrl+L" } });
  const editor = bindings.find((binding) => binding.action === "chat.editor.external");
  assert.deepEqual(editor.keys, ["Ctrl+E"]);
  assert.equal(editor.source, "user");
  const hotkeys = bindings.find((binding) => binding.action === "app.hotkeys");
  assert.equal(hotkeys.status, "browser-conflict");
});

test("eventMatchesWebAction matches normalized keyboard events", async () => {
  const { buildWebKeybindings, eventMatchesWebAction } = await loadSubject();
  const bindings = buildWebKeybindings();
  assert.equal(eventMatchesWebAction({ key: "g", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false }, bindings, "chat.editor.external"), true);
  assert.equal(eventMatchesWebAction({ key: "Enter", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false }, bindings, "chat.submit"), true);
  assert.equal(eventMatchesWebAction({ key: "Enter", ctrlKey: false, metaKey: false, altKey: false, shiftKey: true }, bindings, "chat.submit"), false);
});
