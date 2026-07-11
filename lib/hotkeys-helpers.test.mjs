import assert from "node:assert/strict";
import test from "node:test";

const {
  bindingMatches,
  groupKeybindings,
  hotkeyScopeLabel,
  hotkeySourceLabel,
  hotkeyStats,
  hotkeyStatusLabel,
  hotkeyStatusTone,
  shortenHotkeyPath,
  splitKeySequence,
} = await import("../components/hotkeys/helpers.ts");

function binding(overrides = {}) {
  return {
    action: "chat.submit",
    label: "Submit message",
    description: "Send the current chat input.",
    scope: "chatInput",
    defaultKeys: ["Enter"],
    keys: ["Enter"],
    source: "default",
    status: "active",
    ...overrides,
  };
}

test("hotkey helpers format scopes, status, source, and paths", () => {
  assert.equal(hotkeyScopeLabel("chatInput"), "Chat input");
  assert.equal(hotkeyScopeLabel("tree"), "Session tree");
  assert.equal(hotkeyStatusLabel("browser-conflict"), "Browser conflict");
  assert.equal(hotkeyStatusTone("browser-conflict"), "warning");
  assert.equal(hotkeyStatusTone("active"), "neutral");
  assert.equal(hotkeySourceLabel(binding({ source: "user" })), "Customized");
  assert.equal(hotkeySourceLabel(binding({ source: "extension", owner: "review" })), "Extension · review");
  assert.equal(shortenHotkeyPath("/home/demo/.pi/agent/keybindings.json"), "~/.pi/agent/keybindings.json");
});

test("key sequences split alternatives into chords and keys", () => {
  assert.deepEqual(splitKeySequence("Shift+Enter"), [["Shift", "Enter"]]);
  assert.deepEqual(splitKeySequence("Escape Escape"), [["Escape"], ["Escape"]]);
});

test("hotkey filtering searches metadata and respects filters", () => {
  const custom = binding({ source: "user", keys: ["Ctrl+E"] });
  const conflict = binding({ action: "app.hotkeys", label: "Show hotkeys", scope: "global", status: "browser-conflict", keys: ["Ctrl+L"] });
  assert.equal(bindingMatches(custom, "ctrl+e", "all"), true);
  assert.equal(bindingMatches(custom, "", "custom"), true);
  assert.equal(bindingMatches(binding(), "", "custom"), false);
  assert.equal(bindingMatches(conflict, "", "issues"), true);
  assert.equal(bindingMatches(binding(), "", "issues"), false);
});

test("hotkey groups follow product scope order and stats classify issues", () => {
  const bindings = [
    binding({ action: "tree.open", scope: "tree", status: "unbound", keys: [] }),
    binding({ action: "app.hotkeys", scope: "global", source: "user", status: "browser-conflict", keys: ["Ctrl+L"] }),
    binding(),
  ];
  assert.deepEqual(groupKeybindings(bindings).map((group) => group.scope), ["global", "chatInput", "tree"]);
  assert.deepEqual(hotkeyStats(bindings), { active: 1, custom: 1, conflicts: 1, unbound: 1 });
});
