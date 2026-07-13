import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import postcss from "postcss";
import { transform } from "lightningcss";

const root = process.cwd();
const hoverQuery = "@media (hover: hover) and (pointer: fine)";

function cssFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return cssFiles(absolute);
    return entry.name.endsWith(".css") ? [absolute] : [];
  });
}

function hasHoverCapabilityAncestor(rule) {
  for (let parent = rule.parent; parent; parent = parent.parent) {
    if (
      parent.type === "atrule" &&
      parent.name === "media" &&
      /hover\s*:\s*hover/.test(parent.params) &&
      /pointer\s*:\s*fine/.test(parent.params)
    ) return true;
  }
  return false;
}

test("application hover visuals are limited to fine hover-capable pointers", () => {
  const failures = [];
  for (const directory of ["app", "components"]) {
    for (const file of cssFiles(path.join(root, directory))) {
      const css = postcss.parse(readFileSync(file, "utf8"), { from: file });
      css.walkRules((rule) => {
        if (rule.selector.includes(":hover") && !hasHoverCapabilityAncestor(rule)) {
          failures.push(`${path.relative(root, file)}:${rule.source.start.line} ${rule.selector}`);
        }
      });
    }
  }
  assert.deepEqual(failures, []);
});

function findChrome() {
  const candidates = [
    process.env.CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  return candidates.find(existsSync);
}

function compileModule(relativePath, pointerMode = "fine") {
  const filename = path.join(root, relativePath);
  let source = readFileSync(filename, "utf8")
    .replaceAll(hoverQuery, pointerMode === "fine" ? "@media all" : "@media not all")
    .replaceAll(":hover", "[data-simulate-hover]")
    .replaceAll(":focus-visible", "[data-simulate-focus-visible]")
    .replaceAll(":focus-within", "[data-simulate-focus-within]");
  const result = transform({ filename, code: Buffer.from(source), cssModules: true });
  return {
    css: result.code.toString(),
    className(name) {
      const value = result.exports?.[name]?.name;
      assert.ok(value, `${relativePath} must export .${name}`);
      return value;
    },
  };
}

function runComputedFixture(chrome, modules, body, palette = {}, viewport = { width: 1440, height: 900 }) {
  const temp = mkdtempSync(path.join(os.tmpdir(), "pi-interaction-state-"));
  try {
    const styles = modules.map((module) => module.css).join("\n");
    const bg = palette.bg ?? "rgb(5, 5, 5)";
    const bgPanel = palette.bgPanel ?? "rgb(10, 10, 10)";
    const bgRaised = palette.bgRaised ?? "rgb(12, 12, 12)";
    const bgHover = palette.bgHover ?? "rgb(20, 20, 20)";
    const bgSelected = palette.bgSelected ?? "rgb(40, 40, 40)";
    const errorSoft = palette.errorSoft ?? "rgb(60, 0, 0)";
    const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
:root {
  --bg: ${bg}; --bg-panel: ${bgPanel}; --bg-raised: ${bgRaised};
  --bg-hover: ${bgHover}; --bg-selected: ${bgSelected}; --error-soft: ${errorSoft};
  --text: rgb(240, 240, 240); --text-muted: rgb(180, 180, 180); --text-dim: rgb(120, 120, 120);
  --accent: rgb(230, 230, 230); --accent-soft: rgb(30, 30, 30); --accent-contrast: rgb(0, 0, 0);
  --border: rgb(70, 70, 70); --border-strong: rgb(90, 90, 90); --focus-ring: rgb(0, 120, 255);
  --error: rgb(220, 40, 40); --state-disabled-opacity: .5;
  --space-half: 4px; --space-1: 8px; --space-1-5: 12px; --space-2: 16px; --space-3: 24px; --space-4: 32px;
  --radius-sm: 4px; --radius-md: 8px; --radius-lg: 12px; --radius-full: 999px;
  --control-compact: 32px; --control-default: 40px; --control-touch: 44px;
  --motion-fast: 80ms; --motion-enter: 140ms; --motion-press: 80ms; --ease-snap: ease;
  --font-mono: monospace;
}
${styles}</style></head><body>${body}
<script>
const ids = [...document.querySelectorAll("[id]")];
const result = Object.fromEntries(ids.map((element) => {
  const style = getComputedStyle(element);
  return [element.id, {
    background: style.backgroundColor,
    color: style.color,
    borderTop: style.borderTopColor,
    borderRight: style.borderRightColor,
    borderBottom: style.borderBottomColor,
    borderLeft: style.borderLeftColor,
    boxShadow: style.boxShadow,
    outlineWidth: style.outlineWidth,
    outlineColor: style.outlineColor,
    fontWeight: style.fontWeight,
    opacity: style.opacity,
  }];
}));
result.__viewportWidth = document.documentElement.clientWidth;
document.body.dataset.result = btoa(JSON.stringify(result));
</script></body></html>`;
    const fixture = path.join(temp, "fixture.html");
    writeFileSync(fixture, html);
    const output = execFileSync(chrome, [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--allow-file-access-from-files",
      `--window-size=${viewport.width},${viewport.height}`,
      "--dump-dom",
      `file://${fixture}`,
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const encoded = output.match(/data-result="([^"]+)"/)?.[1];
    assert.ok(encoded, "headless fixture must publish computed styles");
    return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

function assertNoAccentMarker(style, label) {
  assert.equal(style.boxShadow, "none", `${label} must not restore an inset selected marker`);
  for (const side of ["borderTop", "borderRight", "borderBottom", "borderLeft"]) {
    assert.notEqual(style[side], "rgb(230, 230, 230)", `${label} must not restore an accent border`);
  }
}

test("persistent state hierarchy survives the full interaction matrix", (context) => {
  const chrome = findChrome();
  if (!chrome) return context.skip("Chrome/Chromium is required for computed-style assertions");

  const palettes = [
    {
      name: "dark",
      values: {},
      raised: "rgb(12, 12, 12)",
      selected: "rgb(40, 40, 40)",
      hover: "rgb(20, 20, 20)",
      danger: "rgb(60, 0, 0)",
    },
    {
      name: "light",
      values: {
        bg: "rgb(250, 250, 250)",
        bgPanel: "rgb(245, 245, 245)",
        bgRaised: "rgb(255, 255, 255)",
        bgHover: "rgb(236, 236, 239)",
        bgSelected: "rgb(227, 227, 231)",
        errorSoft: "rgb(255, 230, 230)",
      },
      raised: "rgb(255, 255, 255)",
      selected: "rgb(227, 227, 231)",
      hover: "rgb(236, 236, 239)",
      danger: "rgb(255, 230, 230)",
    },
  ];
  const scenarios = [
    { name: "desktop fine", pointer: "fine", viewport: { width: 1440, height: 900 } },
    { name: "desktop touch", pointer: "touch", viewport: { width: 1440, height: 900 } },
    { name: "mobile fine", pointer: "fine", viewport: { width: 390, height: 844 } },
    { name: "mobile touch", pointer: "touch", viewport: { width: 390, height: 844 } },
  ];

  for (const scenario of scenarios) {
    const compile = (relativePath) => compileModule(relativePath, scenario.pointer);
    const primitives = compile("components/ui/primitives.css");
    const session = compile("components/SessionSidebar.module.css");
    const shell = compile("components/AppShell.module.css");
    const models = compile("components/ModelsConfig.module.css");
    const plugins = compile("components/PluginsConfig.module.css");
    const skills = compile("components/SkillsConfig.module.css");
    const profiles = compile("components/ProfileManagerModal.module.css");
    const settings = compile("components/SettingsModal.module.css");
    const tabs = compile("components/TabBar.module.css");
    const viewer = compile("components/FileViewer.module.css");
    const inspectorSheet = compile("components/app-shell/InspectorFileSheet.module.css");
    const terminal = compile("components/TerminalPanel.module.css");
    const git = compile("components/GitChangesPanel.module.css");
    const chatInput = compile("components/ChatInput.module.css");
    const buttonClass = primitives.className("pi-button");
    const segmentedClass = primitives.className("pi-segmented__option");
    const body = `
<button id="secondary-default" class="${buttonClass}" data-variant="secondary"></button>
<button id="secondary-hover" class="${buttonClass}" data-variant="secondary" data-simulate-hover></button>
<button id="secondary-selected" class="${buttonClass}" data-variant="secondary" aria-pressed="true" data-simulate-hover></button>
<button id="secondary-selected-focus" class="${buttonClass}" data-variant="secondary" aria-pressed="true" data-simulate-hover data-simulate-focus-visible></button>
<button id="secondary-disabled" class="${buttonClass}" data-variant="secondary" disabled data-simulate-hover></button>
<button id="danger-hover" class="${buttonClass}" data-variant="danger" data-simulate-hover></button>
<button id="danger-disabled" class="${buttonClass}" data-variant="danger" disabled data-simulate-hover></button>
<button id="composer-inactive-hover" class="${chatInput.className("control")}" data-simulate-hover></button>
<button id="composer-active-hover" class="${chatInput.className("control")}" data-active="true" data-simulate-hover></button>
<button id="composer-open-hover" class="${chatInput.className("control")}" data-open="true" data-simulate-hover></button>
<button id="composer-danger-hover" class="${chatInput.className("control")}" data-danger="true" data-simulate-hover></button>
<div id="session-selected" class="${session.className("sessionRow")}" data-selected="true" data-simulate-hover data-simulate-focus-within data-simulate-focus-visible></div>
<div id="session-hover" class="${session.className("sessionRow")}" data-simulate-hover></div>
<div id="session-danger" class="${session.className("sessionRow")}" data-selected="true" data-confirm="true" data-simulate-hover data-simulate-focus-within></div>
<button id="top-open" class="${shell.className("topTool")}" aria-pressed="true" data-simulate-hover data-simulate-focus-visible></button>
<button id="nav-open" class="${shell.className("compactNavButton")}" aria-pressed="true" data-simulate-hover data-simulate-focus-visible></button>
<button id="model-selected" class="${models.className("modelRow")} ${models.className("navRowSelected")}" data-simulate-hover data-simulate-focus-visible></button>
<button id="plugin-selected" class="${plugins.className("packageRow")} ${plugins.className("packageRowSelected")}" data-simulate-hover></button>
<button id="skill-selected" class="${skills.className("skillRow")} ${skills.className("skillRowSelected")}" data-simulate-hover></button>
<button id="profile-selected" class="${profiles.className("profileRow")} ${profiles.className("profileRowSelected")}" data-simulate-hover></button>
<button id="plugin-add" class="${buttonClass} ${plugins.className("addButton")} ${plugins.className("addButtonSelected")}" data-variant="secondary" aria-pressed="true" data-simulate-hover data-simulate-focus-visible></button>
<button id="skill-add" class="${buttonClass} ${skills.className("addButton")} ${skills.className("addButtonSelected")}" data-variant="secondary" aria-pressed="true" data-simulate-hover data-simulate-focus-visible></button>
<button id="profile-add" class="${buttonClass} ${profiles.className("addButton")} ${profiles.className("addButtonSelected")}" data-variant="secondary" aria-pressed="true" data-simulate-hover data-simulate-focus-visible></button>
<button id="profile-choice" class="${profiles.className("choiceCard")}" data-selected="true" data-simulate-hover data-simulate-focus-visible></button>
<div class="${settings.className("navigation")}"><button id="settings-selected" class="${segmentedClass}" aria-pressed="true" data-simulate-hover data-simulate-focus-visible></button></div>
<button id="segment-selected" class="${segmentedClass}" aria-pressed="true" data-simulate-hover data-simulate-focus-visible></button>
<button id="inspector-tab" class="${shell.className("inspectorTab")}" aria-pressed="true" data-simulate-hover data-simulate-focus-visible></button>
<button id="terminal-tab" class="${terminal.className("tabSelect")}" aria-selected="true" data-simulate-hover data-simulate-focus-visible></button>
<button id="git-file" class="${git.className("fileButton")}" aria-pressed="true" data-simulate-hover data-simulate-focus-visible></button>
<div id="tab-selected" class="${tabs.className("tab")}" data-active="true" data-simulate-hover><button id="tab-focus" class="${tabs.className("select")}" data-simulate-focus-visible></button></div>
<fieldset class="${viewer.className("segmented")}"><button id="viewer-segment-selected" aria-pressed="true" data-simulate-hover data-simulate-focus-visible></button></fieldset>
<button id="viewer-selected" class="${viewer.className("control")}" aria-pressed="true" data-simulate-hover data-simulate-focus-visible></button>
<div id="sheet-selected" class="${inspectorSheet.className("row")}" data-active="true"><button id="sheet-select" class="${inspectorSheet.className("select")}" data-simulate-hover data-simulate-focus-visible></button></div>`;
    const modules = [primitives, session, shell, models, plugins, skills, profiles, settings, tabs, viewer, inspectorSheet, terminal, git, chatInput];

    for (const palette of palettes) {
      const label = `${palette.name} ${scenario.name}`;
      const result = runComputedFixture(chrome, modules, body, palette.values, scenario.viewport);
      assert.equal(result.__viewportWidth <= 640, scenario.viewport.width <= 640, `${label} responsive fixture tier`);
      assert.equal(result["secondary-default"].background, palette.raised, `${label} default secondary`);
      assert.equal(result["secondary-hover"].background, scenario.pointer === "fine" ? palette.hover : palette.raised, `${label} secondary hover capability`);
      assert.equal(result["secondary-disabled"].background, palette.raised, `${label} disabled precedence`);
      assert.equal(result["secondary-disabled"].opacity, "1", `${label} disabled content remains readable`);
      assert.equal(result["danger-disabled"].background, palette.danger, `${label} disabled danger precedence`);
      assert.equal(result["danger-disabled"].opacity, "1", `${label} disabled danger content remains readable`);
      assert.equal(result["danger-hover"].color, "rgb(220, 40, 40)", `${label} danger identity`);
      assert.notEqual(result["danger-hover"].background, palette.hover, `${label} danger must not become neutral hover`);
      assert.notEqual(result["danger-hover"].background, palette.selected, `${label} danger must not become selected`);
      assert.equal(result["composer-inactive-hover"].background, scenario.pointer === "fine" ? palette.hover : "rgba(0, 0, 0, 0)", `${label} composer hover capability`);
      assert.equal(result["composer-active-hover"].background, "rgba(0, 0, 0, 0)", `${label} composer active surface precedence`);
      assert.equal(result["composer-active-hover"].color, "rgb(230, 230, 230)", `${label} composer active color precedence`);
      assert.notEqual(result["composer-active-hover"].color, result["composer-inactive-hover"].color, `${label} active composer control must remain distinct from inactive hover`);
      assert.equal(result["composer-open-hover"].background, palette.selected, `${label} composer open surface precedence`);
      assert.equal(result["composer-danger-hover"].background, palette.danger, `${label} composer danger surface precedence`);
      assert.equal(result["composer-danger-hover"].color, "rgb(220, 40, 40)", `${label} composer danger color precedence`);
      assert.equal(result["session-hover"].background, scenario.pointer === "fine" ? palette.hover : "rgba(0, 0, 0, 0)", `${label} session hover capability`);
      assert.equal(result["session-danger"].background, palette.danger, `${label} confirmation precedence`);

      const persistentIds = [
        "secondary-selected", "secondary-selected-focus", "session-selected", "top-open", "nav-open",
        "model-selected", "plugin-selected", "skill-selected", "profile-selected", "plugin-add", "skill-add",
        "profile-add", "profile-choice", "settings-selected", "segment-selected", "inspector-tab", "terminal-tab",
        "git-file", "tab-selected", "viewer-segment-selected", "viewer-selected", "sheet-selected",
      ];
      for (const id of persistentIds) {
        assert.equal(result[id].background, palette.selected, `${label} ${id} must retain its persistent selected/open surface`);
      }
      for (const id of [
        "secondary-selected-focus", "session-selected", "top-open", "nav-open", "model-selected", "plugin-add", "skill-add",
        "profile-add", "profile-choice", "settings-selected", "segment-selected", "inspector-tab", "terminal-tab",
        "git-file", "tab-focus", "viewer-segment-selected", "viewer-selected", "sheet-select",
      ]) {
        assert.equal(result[id].outlineWidth, "0px", `${label} ${id} must use the approved background-only focus treatment`);
      }
      for (const id of ["plugin-add", "skill-add", "profile-add"]) {
        assert.equal(result[id].color, "rgb(240, 240, 240)", `${label} ${id} must use neutral selected text`);
        assert.equal(result[id].borderTop, "rgb(70, 70, 70)", `${label} ${id} must keep its neutral boundary`);
      }
      for (const id of ["segment-selected", "inspector-tab", "terminal-tab", "git-file", "tab-selected", "viewer-segment-selected", "viewer-selected"]) {
        assertNoAccentMarker(result[id], `${label} ${id}`);
      }
    }
  }
});

test("coarse/touch mode does not apply hover-only primitive styling", (context) => {
  const chrome = findChrome();
  if (!chrome) return context.skip("Chrome/Chromium is required for computed-style assertions");

  const primitives = compileModule("components/ui/primitives.css", "touch");
  const body = `<button id="touch-ghost" class="${primitives.className("pi-button")}" data-variant="ghost" data-simulate-hover></button>`;
  const result = runComputedFixture(chrome, [primitives], body);
  assert.equal(result["touch-ghost"].background, "rgba(0, 0, 0, 0)");
  assert.equal(result["touch-ghost"].color, "rgb(180, 180, 180)");
});
