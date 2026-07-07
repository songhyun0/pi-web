import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./extension-ui-bridge.ts");
}

test("compat theme supports strikethrough in extension widgets", async () => {
  const { ExtensionUiBridge } = await loadSubject();
  const emitted = [];
  const bridge = new ExtensionUiBridge({ emit: (event) => emitted.push(event) });
  const ctx = bridge.createContext();

  ctx.setWidget("strike", (_tui, theme) => ({
    render: () => [theme.strikethrough("done")],
    invalidate: () => {},
  }));

  const widget = bridge.getWidgets().find((item) => item.key === "strike");
  assert.ok(widget);
  assert.deepEqual(widget.lines, ["\x1b[9mdone\x1b[0m"]);
  assert.doesNotMatch(widget.lines.join("\n"), /Extension UI render failed/);

  assert.ok(emitted.some((event) => event.method === "setWidget" && event.widgetKey === "strike"));
});
