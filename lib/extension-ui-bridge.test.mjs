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
  assert.equal(ctx.theme.getColorMode(), "truecolor");
  assert.equal(typeof ctx.theme.getThinkingBorderColor("medium"), "function");

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

test("extension chrome and editor text APIs emit web-compatible requests", async () => {
  const { ExtensionUiBridge } = await loadSubject();
  const emitted = [];
  const bridge = new ExtensionUiBridge({ emit: (event) => emitted.push(event) });
  const ctx = bridge.createContext();

  ctx.setHeader(["header"]);
  ctx.setWorkingMessage("working");
  ctx.setWorkingVisible(true);
  ctx.setFooter("footer");
  ctx.setEditorText("replace me");
  ctx.pasteToEditor(" plus more");
  bridge.setEditorTextSnapshot("browser text");

  assert.deepEqual(bridge.getChrome().headerLines, ["header"]);
  assert.deepEqual(bridge.getChrome().footerLines, ["footer"]);
  assert.equal(bridge.getChrome().working.message, "working");
  assert.equal(bridge.getChrome().working.visible, true);
  assert.equal(ctx.getEditorText(), "browser text");
  assert.ok(emitted.some((event) => event.method === "setChrome"));
  assert.ok(emitted.some((event) => event.method === "set_editor_text" && event.text === "replace me"));
  assert.ok(emitted.some((event) => event.method === "paste_editor_text" && event.text === " plus more"));
});

test("extension autocomplete providers can be queried and unregistered", async () => {
  const { ExtensionUiBridge } = await loadSubject();
  const emitted = [];
  const bridge = new ExtensionUiBridge({ emit: (event) => emitted.push(event) });
  const ctx = bridge.createContext();

  const dispose = ctx.addAutocompleteProvider((current) => ({
    label: "issues",
    getSuggestions: async (lines, cursorLine, cursorColumn, options) => {
      assert.ok(current);
      assert.equal(options.signal, undefined);
      assert.equal(lines[cursorLine].slice(0, cursorColumn), "see #");
      return {
        prefix: "#",
        items: [{ label: "#12", value: "#12", description: "Fix bug" }],
      };
    },
  }));

  const result = await bridge.queryAutocomplete("see #", 5);
  assert.equal(result.providerId, bridge.getAutocompleteProviders()[0].id);
  assert.equal(result.label, "issues");
  assert.deepEqual(result.items, [{
    id: `${result.providerId}:0`,
    label: "#12",
    value: "#12",
    description: "Fix bug",
    prefix: "#",
  }]);
  assert.ok(emitted.some((event) => event.method === "autocomplete_provider" && event.active === true));

  dispose();
  assert.equal(bridge.getAutocompleteProviders().length, 0);
  assert.ok(emitted.some((event) => event.method === "autocomplete_provider" && event.active === false));
});

test("degraded editor component and theme APIs produce compatibility reports", async () => {
  const { ExtensionUiBridge } = await loadSubject();
  const emitted = [];
  const bridge = new ExtensionUiBridge({ emit: (event) => emitted.push(event) });
  const ctx = bridge.createContext();

  ctx.setEditorComponent({ render: () => ["custom"] });
  assert.deepEqual(ctx.getAllThemes(), ["system", "light", "dark"]);
  assert.equal(ctx.setTheme("dark").success, true);
  assert.equal(ctx.setTheme("custom").success, false);

  const reports = bridge.getCompatibilityReports();
  assert.ok(reports.some((report) => report.api === "ctx.ui.setEditorComponent" && report.status === "degraded"));
  assert.ok(reports.some((report) => report.api === "ctx.ui.setTheme" && report.status === "degraded"));
  assert.ok(emitted.some((event) => event.method === "compatibility_report"));
  assert.ok(emitted.some((event) => event.method === "setTheme" && event.themeName === "dark"));
});
