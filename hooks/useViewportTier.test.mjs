import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import postcss from "postcss";
import {
  DESKTOP_CENTER_MIN_WIDTH,
  fitDesktopPanelWidths,
  getCenterChromeDensity,
  getDesktopPanelMaxWidths,
} from "./useViewportTier.ts";

test("center chrome density changes at the measured-width threshold", () => {
  assert.equal(getCenterChromeDensity(null), "desktop");
  assert.equal(getCenterChromeDensity(719), "compact");
  assert.equal(getCenterChromeDensity(720), "compact");
  assert.equal(getCenterChromeDensity(721), "desktop");
});

test("desktop panel fitting reserves the center at the 1024/1025 boundary", () => {
  const overlay = fitDesktopPanelWidths(1024, { sidebar: 520, right: 960 }, true, true);
  assert.deepEqual(overlay, { sidebar: 520, right: 960 });

  const desktop = fitDesktopPanelWidths(1025, { sidebar: 520, right: 960 }, true, true);
  assert.equal(desktop.sidebar + desktop.right + DESKTOP_CENTER_MIN_WIDTH, 1025);
  assert.deepEqual(desktop, { sidebar: 245, right: 300 });
});

test("opening order and persisted extremes converge on valid panel widths", () => {
  const persisted = { sidebar: 9999, right: 9999 };
  const sidebarFirst = fitDesktopPanelWidths(
    1025,
    fitDesktopPanelWidths(1025, persisted, true, false),
    true,
    true,
  );
  const inspectorFirst = fitDesktopPanelWidths(
    1025,
    fitDesktopPanelWidths(1025, persisted, false, true),
    true,
    true,
  );
  assert.deepEqual(sidebarFirst, inspectorFirst);
  assert.equal(sidebarFirst.sidebar + sidebarFirst.right, 1025 - DESKTOP_CENTER_MIN_WIDTH);
});

test("effective maxima account for the other open panel", () => {
  const widths = fitDesktopPanelWidths(1440, { sidebar: 520, right: 960 }, true, true);
  const maxima = getDesktopPanelMaxWidths(1440, widths, true, true);
  assert.ok(maxima.sidebar + widths.right <= 1440 - DESKTOP_CENTER_MIN_WIDTH);
  assert.ok(maxima.right + widths.sidebar <= 1440 - DESKTOP_CENTER_MIN_WIDTH);
});

const WIDE_COARSE_RULE_INVENTORY = {
  "components/AppShell.module.css": [
    ".sidebar[data-open=\"true\"], .inspector[data-open=\"true\"]",
    ".sidebarInner, .inspectorInner",
    ".resizeHandle",
    ".sidebarResizeHandle",
    ".inspectorResizeHandle",
  ],
  "components/BranchNavigator.module.css": [
    ".inlineTrigger, .blockTrigger, .treeRow, .rowSelect",
    ".foldButton",
    ".search, .filterSelect",
  ],
  "components/ChatInput.module.css": [
    ".attachmentRemove",
    ".menuItem, .commandItem, .modelOption, .reasoningOption",
    ".sendButton, .steerButton, .followButton",
    ".toolbar",
    ".control, .modelTrigger",
    ".control[data-icon-only=\"true\"]",
  ],
  "components/ChatWindow.module.css": [
    ".processToggle, .stateAction",
  ],
  "components/DirectoryPickerModal.module.css": [
    ".quickLocation:global(.pi-button), .directoryRow:global(.pi-button)",
  ],
  "components/FileExplorer.module.css": [
    ".actions",
    ".action",
  ],
  "components/FileViewer.module.css": [
    ".download",
    ".segmented, .segmented button, .control, .stateAction",
    ".segmented button",
  ],
  "components/GitChangesPanel.module.css": [
    ".refresh",
    ".stateAction",
    ".header",
  ],
  "components/MessageView.module.css": [
    ".actions",
    ".action",
    ".messageMeta, .assistantFooter",
    ".detailToggle, .toolToggle, .compactionToggle, .customPreview",
    ".customHeader",
    ".customFooter",
  ],
  "components/ModelsConfig.module.css": [
    ".navRow, .modelRow, .addModelButton, .providerCard",
  ],
  "components/PluginsConfig.module.css": [
    ".packageRow, .exampleButton",
  ],
  "components/ProfileManagerModal.module.css": [
    ".profileRow, .choiceCard, .stepButton",
  ],
  "components/ProfileSelector.module.css": [
    ".trigger, .option, .manageButton",
  ],
  "components/ProjectTrustModal.module.css": [
    ".actionCard, .resourceDetails summary",
    ".resourceDetails summary",
  ],
  "components/SessionSidebar.module.css": [
    ".newButton, .pickerTrigger, .worktreeTrigger, .worktreeGuide",
    ".headerIcon",
  ],
  "components/SkillsConfig.module.css": [
    ".skillRow, .resultCard",
  ],
  "components/TerminalPanel.module.css": [
    ".action",
    ".tabClose",
    ".header",
    ".tabs",
    ".tabSelect",
  ],
  "components/ui/primitives.css": [
    ".pi-button, .pi-button[data-size=\"compact\"]",
    ".pi-icon-button, .pi-icon-button[data-size=\"compact\"]",
    ".pi-input, .pi-select",
    ".pi-switch",
    ".pi-segmented",
    ".pi-segmented__option",
  ],
};

const ALLOWED_WIDE_COARSE_OVERRIDES = new Set([
  "components/AppShell.module.css|.sidebar[data-open=\"true\"], .inspector[data-open=\"true\"]|overflow|visible",
  "components/AppShell.module.css|.sidebarInner, .inspectorInner|overflow|hidden",
  "components/AppShell.module.css|.resizeHandle|inset-block|auto",
  "components/AppShell.module.css|.resizeHandle|top|50%",
  "components/AppShell.module.css|.resizeHandle|transform|translateY(-50%)",
  "components/AppShell.module.css|.sidebarResizeHandle|right|calc(var(--control-touch) / -2)",
  "components/AppShell.module.css|.inspectorResizeHandle|left|calc(var(--control-touch) / -2)",
  "components/ChatInput.module.css|.control[data-icon-only=\"true\"]|padding|0",
  "components/FileExplorer.module.css|.row|padding-right|2px",
  "components/FileExplorer.module.css|.actions|opacity|1",
  "components/FileExplorer.module.css|.actions|pointer-events|auto",
  "components/FileExplorer.module.css|.action|background|transparent",
  "components/FileExplorer.module.css|.action|border-color|transparent",
  "components/FileViewer.module.css|.segmented button|padding-inline|var(--space-1-5)",
  "components/GitChangesPanel.module.css|.header|padding-block|0",
  "components/MessageView.module.css|.actions|opacity|1",
  "components/MessageView.module.css|.actions|pointer-events|auto",
  "components/MessageView.module.css|.action|padding-inline|var(--space-1)",
  "components/MessageView.module.css|.action|justify-content|center",
  "components/MessageView.module.css|.customFooter|padding-block|0",
  "components/MessageView.module.css|.customFooter|border-top|0",
  "components/MessageView.module.css|.customFooter|box-shadow|inset 0 1px 0 var(--border)",
  "components/ProjectTrustModal.module.css|.resourceDetails summary|display|inline-flex",
  "components/ProjectTrustModal.module.css|.resourceDetails summary|align-items|center",
  "components/TerminalPanel.module.css|.header|padding-block|0",
  "components/TerminalPanel.module.css|.header|border-bottom|0",
  "components/TerminalPanel.module.css|.header|box-shadow|inset 0 -1px 0 var(--border)",
  "components/TerminalPanel.module.css|.tabs|border-bottom|0",
  "components/TerminalPanel.module.css|.tabs|box-shadow|inset 0 -1px 0 var(--border)",
]);

const STATIC_WIDE_COARSE_SELECTORS = {
  "components/ChatInput.module.css": new Set([".queueHeader", ".queueRow", ".feedback"]),
  "components/ChatWindow.module.css": new Set([".noticeItem"]),
};

const normalizeSelector = (selector) => selector.replace(/\s+/g, " ").trim();

function mediaAppliesToWideCoarsePointer(params) {
  return params.split(",").some((branch) => {
    if (!/\(pointer:\s*coarse\)/.test(branch)) return false;
    const maximum = branch.match(/\(max-width:\s*(\d+)px\)/);
    return !maximum || Number(maximum[1]) > 1024;
  });
}

async function collectCssFiles(directory, relativeDirectory = "components") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      files.push(...await collectCssFiles(new URL(`${entry.name}/`, directory), `${relativeDirectory}/${entry.name}`));
    } else if (entry.name.endsWith(".css")) {
      files.push({ path: `${relativeDirectory}/${entry.name}`, url: new URL(entry.name, directory) });
    }
  }
  return files;
}

test("every wide coarse-pointer stylesheet is inventoried and action-scoped", async () => {
  const coarseStylesheets = [];
  for (const file of await collectCssFiles(new URL("../components/", import.meta.url))) {
    const css = await readFile(file.url, "utf8");
    const root = postcss.parse(css, { from: file.path });
    const coarseRules = [];

    root.walkAtRules("media", (atRule) => {
      if (!atRule.params.includes("pointer: coarse")) return;
      coarseStylesheets.push(file.path);
      if (!mediaAppliesToWideCoarsePointer(atRule.params)) return;
      atRule.walkRules((rule) => {
        const selector = normalizeSelector(rule.selector);
        const staticSelectors = STATIC_WIDE_COARSE_SELECTORS[file.path];
        for (const ruleSelector of rule.selectors.map(normalizeSelector)) {
          assert.ok(
            !staticSelectors?.has(ruleSelector),
            `static content must not be inflated for wide coarse pointers: ${file.path}|${ruleSelector}`,
          );
        }
        coarseRules.push(selector);
        rule.walkDecls((declaration) => {
          const isTouchDimension = ["width", "min-width", "height", "min-height"].includes(declaration.prop)
            && declaration.value === "var(--control-touch)";
          const overrideKey = `${file.path}|${selector}|${declaration.prop}|${declaration.value}`;
          assert.ok(
            isTouchDimension || ALLOWED_WIDE_COARSE_OVERRIDES.has(overrideKey),
            `unapproved wide coarse-pointer layout override: ${overrideKey}`,
          );
        });
      });
    });

    if (coarseRules.length > 0) {
      assert.deepEqual(
        [...new Set(coarseRules)].sort(),
        [...WIDE_COARSE_RULE_INVENTORY[file.path]].sort(),
        `${file.path} wide coarse-pointer rules changed without review`,
      );
    }
  }

  assert.deepEqual(
    [...new Set(coarseStylesheets)].sort(),
    Object.keys(WIDE_COARSE_RULE_INVENTORY).sort(),
    "coarse-pointer stylesheet inventory is incomplete",
  );
});

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {}
  }
  return null;
}

async function waitForValue(read, label) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const value = await read();
      if (value) return value;
    } catch {}
    await sleep(50);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function openCdp(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  let nextId = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const resolve = pending.get(message.id);
    if (!resolve) return;
    pending.delete(message.id);
    resolve(message);
  });

  return {
    close: () => socket.close(),
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        pending.set(id, (message) => {
          if (message.error) reject(new Error(`${method}: ${message.error.message}`));
          else resolve(message.result);
        });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
  };
}

async function renderWideCoarseTerminalFixture(chromePath, terminalCss) {
  const tempDirectory = await mkdtemp(join(tmpdir(), "pi-terminal-coarse-density-"));
  const profileDirectory = join(tempDirectory, "profile");
  const fixturePath = join(tempDirectory, "fixture.html");
  await writeFile(fixturePath, `<!doctype html>
<html><head><meta charset="utf-8"><style>
:root {
  --space-half: 4px; --space-1: 8px; --space-1-5: 12px; --control-touch: 44px;
  --bg: white; --bg-panel: #fafafa; --bg-selected: #f0f0f0; --border: #ddd;
  --text: #18181b; --text-muted: #52525b; --text-dim: #71717a;
  --focus-ring: #18181b; --font-mono: monospace; --radius-sm: 4px; --radius-md: 8px;
}
* { box-sizing: border-box; }
html, body { width: 100%; margin: 0; }
${terminalCss}
</style></head><body>
<section class="panel">
  <header id="terminal-header" class="header">
    <h2 class="heading">Terminal</h2>
    <div class="headerActions"><button id="terminal-action" class="action" type="button">New</button></div>
  </header>
  <div id="terminal-tabs" class="tabs" role="tablist">
    <div id="terminal-tab-item" class="tabItem">
      <button id="terminal-tab-select" class="tabSelect" role="tab" type="button" aria-selected="true">i</button>
      <button id="terminal-tab-close" class="tabClose" type="button" aria-label="Close">×</button>
    </div>
  </div>
</section>
</body></html>`);

  const chrome = spawn(chromePath, [
    "--headless=new",
    "--disable-background-networking",
    "--disable-extensions",
    "--no-first-run",
    "--no-sandbox",
    "--remote-debugging-port=0",
    `--user-data-dir=${profileDirectory}`,
    `file://${fixturePath}`,
  ], { stdio: "ignore" });
  let cdp;

  const measure = async () => {
    const evaluated = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const rectangle = (id) => {
          const value = document.getElementById(id).getBoundingClientRect();
          return { left: value.left, right: value.right, top: value.top, bottom: value.bottom, width: value.width, height: value.height };
        };
        return {
          coarse: matchMedia("(pointer: coarse)").matches,
          viewportWidth: innerWidth,
          header: rectangle("terminal-header"),
          action: rectangle("terminal-action"),
          tabs: rectangle("terminal-tabs"),
          tabItem: rectangle("terminal-tab-item"),
          tabSelect: rectangle("terminal-tab-select"),
          tabClose: rectangle("terminal-tab-close"),
        };
      })()`,
      returnByValue: true,
    });
    return evaluated.result.value;
  };

  try {
    const port = await waitForValue(async () => {
      const contents = await readFile(join(profileDirectory, "DevToolsActivePort"), "utf8");
      return contents.trim().split("\n")[0];
    }, "Chrome DevTools port");
    const target = await waitForValue(async () => {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      return targets.find((candidate) => candidate.type === "page" && candidate.url.startsWith("file:"));
    }, "terminal coarse-density fixture target");
    cdp = await openCdp(target.webSocketDebuggerUrl);
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
    await cdp.send("Page.reload", { ignoreCache: true });
    await waitForValue(async () => {
      const state = await cdp.send("Runtime.evaluate", { expression: "document.readyState === 'complete' && matchMedia('(pointer: fine)').matches", returnByValue: true });
      return state.result.value;
    }, "fine terminal fixture render");
    const fine = await measure();

    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
    await cdp.send("Page.reload", { ignoreCache: true });
    await waitForValue(async () => {
      const state = await cdp.send("Runtime.evaluate", { expression: "document.readyState === 'complete' && matchMedia('(pointer: coarse)').matches", returnByValue: true });
      return state.result.value;
    }, "coarse terminal fixture render");
    return { fine, coarse: await measure() };
  } finally {
    cdp?.close();
    if (chrome.exitCode === null) {
      chrome.kill("SIGKILL");
      await Promise.race([
        new Promise((resolve) => chrome.once("exit", resolve)),
        sleep(2000),
      ]);
    }
    await rm(tempDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

test("wide coarse terminal chrome stays compact around 44px targets", async (context) => {
  const chromePath = await findChrome();
  if (!chromePath) {
    context.skip("Chrome/Chromium is unavailable; set CHROME_PATH to run rendered terminal density checks");
    return;
  }

  const terminalCss = await readFile(new URL("../components/TerminalPanel.module.css", import.meta.url), "utf8");
  const { fine, coarse } = await renderWideCoarseTerminalFixture(chromePath, terminalCss);
  assert.equal(fine.viewportWidth, 1440);
  assert.equal(fine.coarse, false);
  assert.equal(coarse.viewportWidth, 1440);
  assert.equal(coarse.coarse, true);
  assert.equal(coarse.header.height, 44, `terminal header chrome inflated: ${JSON.stringify(coarse)}`);
  assert.equal(coarse.tabs.height, 44, `terminal tab strip inflated: ${JSON.stringify(coarse)}`);
  for (const [name, target] of Object.entries({ action: coarse.action, tabSelect: coarse.tabSelect, tabClose: coarse.tabClose })) {
    assert.ok(target.width >= 44 && target.height >= 44, `${name} is below 44x44px: ${JSON.stringify(coarse)}`);
  }
  assert.equal(coarse.tabSelect.right, coarse.tabClose.left, `terminal tab targets overlap or leave a dead gap: ${JSON.stringify(coarse)}`);
  assert.equal(coarse.tabItem.width, coarse.tabSelect.width + coarse.tabClose.width, `terminal tab item geometry is inconsistent: ${JSON.stringify(coarse)}`);
  assert.ok(coarse.header.height <= fine.header.height, `coarse terminal header is less dense than fine: ${JSON.stringify({ fine, coarse })}`);
  assert.ok(coarse.tabs.height <= fine.tabs.height + 6, `coarse terminal tabs exceed the 44px target allowance: ${JSON.stringify({ fine, coarse })}`);
});

async function renderResizeHandleFixture(chromePath, shellCss) {
  const tempDirectory = await mkdtemp(join(tmpdir(), "pi-resize-hit-region-"));
  const profileDirectory = join(tempDirectory, "profile");
  const fixturePath = join(tempDirectory, "fixture.html");
  await writeFile(fixturePath, `<!doctype html>
<html><head><meta charset="utf-8"><style>
:root {
  --control-touch: 44px;
  --pi-safe-area-top: 0px;
  --z-base: 1;
  --z-sidebar: 10;
  --z-inspector: 10;
  --bg: white;
  --bg-panel: white;
  --border: #ddd;
}
html, body { width: 100%; height: 100%; margin: 0; }
${shellCss}
.sidebarInner, .center, .inspectorInner { position: relative; }
.fixtureProbe { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; padding: 0; border: 0; }
</style></head><body>
<div class="shell" style="--shell-desktop-center-min-width: ${DESKTOP_CENTER_MIN_WIDTH}px">
  <aside id="sidebar" class="sidebar" data-open="true" style="--shell-sidebar-width: 288px">
    <div class="sidebarInner"><button id="sidebar-probe" class="fixtureProbe" type="button"></button></div>
    <div id="sidebar-handle" role="separator" class="resizeHandle sidebarResizeHandle"></div>
  </aside>
  <main class="center"><button id="center-probe" class="fixtureProbe" type="button"></button></main>
  <aside id="inspector" class="inspector" data-open="true" style="--shell-inspector-width: 560px">
    <div id="inspector-handle" role="separator" class="resizeHandle inspectorResizeHandle"></div>
    <div class="inspectorInner"><button id="inspector-probe" class="fixtureProbe" type="button"></button></div>
  </aside>
</div>
</body></html>`);

  const chrome = spawn(chromePath, [
    "--headless=new",
    "--disable-background-networking",
    "--disable-extensions",
    "--no-first-run",
    "--no-sandbox",
    "--remote-debugging-port=0",
    `--user-data-dir=${profileDirectory}`,
    `file://${fixturePath}`,
  ], { stdio: "ignore" });
  let cdp;

  try {
    const port = await waitForValue(async () => {
      const contents = await readFile(join(profileDirectory, "DevToolsActivePort"), "utf8");
      return contents.trim().split("\n")[0];
    }, "Chrome DevTools port");
    const target = await waitForValue(async () => {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      return targets.find((candidate) => candidate.type === "page" && candidate.url.startsWith("file:"));
    }, "resize fixture target");
    cdp = await openCdp(target.webSocketDebuggerUrl);
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
    await cdp.send("Page.reload", { ignoreCache: true });
    await waitForValue(async () => {
      const state = await cdp.send("Runtime.evaluate", { expression: "document.readyState === 'complete' && matchMedia('(pointer: coarse)').matches", returnByValue: true });
      return state.result.value;
    }, "coarse-pointer fixture render");

    const wide = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const hit = (x, y) => document.elementFromPoint(x, y)?.id ?? null;
        const inspect = (handleId, panelId, beforeId, afterId) => {
          const handle = document.getElementById(handleId);
          const rect = handle.getBoundingClientRect();
          const panelRect = document.getElementById(panelId).getBoundingClientRect();
          const boundary = panelId === "sidebar" ? panelRect.right : panelRect.left;
          const centerY = rect.top + rect.height / 2;
          const sampleXs = Array.from({ length: Math.floor(rect.width) }, (_, index) => rect.left + index + 0.5);
          const outsideY = rect.top - 4;
          return {
            rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height },
            horizontalHits: sampleXs.map((x) => hit(x, centerY)),
            adjacentHits: [hit(boundary - 10, outsideY), hit(boundary + 10, outsideY)],
            expectedAdjacentHits: [beforeId, afterId],
          };
        };
        return {
          coarse: matchMedia("(pointer: coarse)").matches,
          viewportWidth: innerWidth,
          sidebar: inspect("sidebar-handle", "sidebar", "sidebar-probe", "center-probe"),
          inspector: inspect("inspector-handle", "inspector", "center-probe", "inspector-probe"),
        };
      })()`,
      returnByValue: true,
    });

    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1024, height: 900, deviceScaleFactor: 1, mobile: false });
    const compact = await waitForValue(async () => {
      const result = await cdp.send("Runtime.evaluate", {
        expression: `innerWidth === 1024 && ({
          sidebarHandleDisplay: getComputedStyle(document.getElementById("sidebar-handle")).display,
          inspectorHandleDisplay: getComputedStyle(document.getElementById("inspector-handle")).display,
          sidebarPosition: getComputedStyle(document.getElementById("sidebar")).position,
        })`,
        returnByValue: true,
      });
      return result.result.value;
    }, "compact fixture render");

    return { wide: wide.result.value, compact };
  } finally {
    cdp?.close();
    if (chrome.exitCode === null) {
      chrome.kill("SIGKILL");
      await Promise.race([
        new Promise((resolve) => chrome.once("exit", resolve)),
        sleep(2000),
      ]);
    }
    await rm(tempDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

test("tablet and coarse desktop resize handles remain available", async (context) => {
  const chromePath = await findChrome();
  if (!chromePath) {
    context.skip("Chrome/Chromium is unavailable; set CHROME_PATH to run rendered hit testing");
    return;
  }

  const shellCss = await readFile(new URL("../components/AppShell.module.css", import.meta.url), "utf8");
  const appShellSource = await readFile(new URL("../components/AppShell.tsx", import.meta.url), "utf8");
  const inspectorSection = appShellSource.slice(appShellSource.indexOf("ref={inspectorPanelRef}"), appShellSource.indexOf("<MobileMoreSheet"));
  assert.ok(inspectorSection.indexOf("styles.inspectorResizeHandle") < inspectorSection.indexOf("styles.inspectorInner"), "inspector handle must remain outside the clipped inner panel");

  const rendered = await renderResizeHandleFixture(chromePath, shellCss);
  assert.equal(rendered.wide.coarse, true);
  assert.equal(rendered.wide.viewportWidth, 1440);
  for (const [name, result] of Object.entries({ sidebar: rendered.wide.sidebar, inspector: rendered.wide.inspector })) {
    assert.equal(result.rect.width, 44, `${name} handle width`);
    assert.equal(result.rect.height, 44, `${name} handle height`);
    assert.deepEqual(result.horizontalHits, Array(44).fill(`${name}-handle`), `${name} handle must own its full cross-axis hit span`);
    assert.deepEqual(result.adjacentHits, result.expectedAdjacentHits, `${name} handle must not intercept controls outside its 44px target`);
  }
  assert.deepEqual(rendered.compact, {
    sidebarHandleDisplay: "block",
    inspectorHandleDisplay: "block",
    sidebarPosition: "fixed",
  });
});

async function renderDesktopNarrowingFixture(chromePath, shellCss) {
  const tempDirectory = await mkdtemp(join(tmpdir(), "pi-desktop-center-reservation-"));
  const profileDirectory = join(tempDirectory, "profile");
  const fixturePath = join(tempDirectory, "fixture.html");
  const initialWidths = fitDesktopPanelWidths(1920, { sidebar: 520, right: 960 }, true, true);
  await writeFile(fixturePath, `<!doctype html>
<html><head><meta charset="utf-8"><style>
:root {
  --motion-fast: 80ms;
  --motion-enter: 140ms;
  --ease-snap: cubic-bezier(.2, 0, 0, 1);
  --pi-safe-area-top: 0px;
  --pi-safe-area-bottom: 0px;
  --z-base: 1;
  --z-sidebar: 10;
  --z-inspector: 10;
  --bg: white;
  --bg-panel: white;
  --border: #ddd;
}
* { box-sizing: border-box; }
html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
${shellCss}
.fixtureContent { width: 100%; height: 100%; }
</style></head><body>
<div id="shell" class="shell" style="--shell-desktop-center-min-width: ${DESKTOP_CENTER_MIN_WIDTH}px">
  <aside id="sidebar" class="sidebar" data-open="true" style="--shell-sidebar-width: ${initialWidths.sidebar}px">
    <div id="sidebar-inner" class="sidebarInner"><div class="fixtureContent"></div></div>
  </aside>
  <main id="center" class="center"><div class="fixtureContent"></div></main>
  <aside id="inspector" class="inspector" data-open="true" style="--shell-inspector-width: ${initialWidths.right}px">
    <div id="inspector-inner" class="inspectorInner"><div class="fixtureContent"></div></div>
  </aside>
</div>
</body></html>`);

  const chrome = spawn(chromePath, [
    "--headless=new",
    "--disable-background-networking",
    "--disable-extensions",
    "--no-first-run",
    "--no-sandbox",
    "--remote-debugging-port=0",
    `--user-data-dir=${profileDirectory}`,
    `file://${fixturePath}`,
  ], { stdio: "ignore" });
  let cdp;

  const sample = async (label) => {
    const result = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const rectangle = (id) => {
          const rect = document.getElementById(id).getBoundingClientRect();
          return { left: rect.left, right: rect.right, width: rect.width };
        };
        const shell = document.getElementById("shell");
        return {
          label: ${JSON.stringify(label)},
          viewportWidth: innerWidth,
          documentScrollWidth: document.documentElement.scrollWidth,
          shellClientWidth: shell.clientWidth,
          shellScrollWidth: shell.scrollWidth,
          shell: rectangle("shell"),
          sidebar: rectangle("sidebar"),
          sidebarInner: {
            ...rectangle("sidebar-inner"),
            clientWidth: document.getElementById("sidebar-inner").clientWidth,
            scrollWidth: document.getElementById("sidebar-inner").scrollWidth,
          },
          center: rectangle("center"),
          inspector: rectangle("inspector"),
          inspectorInner: {
            ...rectangle("inspector-inner"),
            clientWidth: document.getElementById("inspector-inner").clientWidth,
            scrollWidth: document.getElementById("inspector-inner").scrollWidth,
          },
        };
      })()`,
      returnByValue: true,
    });
    return result.result.value;
  };

  try {
    const port = await waitForValue(async () => {
      const contents = await readFile(join(profileDirectory, "DevToolsActivePort"), "utf8");
      return contents.trim().split("\n")[0];
    }, "Chrome DevTools port");
    const target = await waitForValue(async () => {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      return targets.find((candidate) => candidate.type === "page" && candidate.url.startsWith("file:"));
    }, "desktop center fixture target");
    cdp = await openCdp(target.webSocketDebuggerUrl);
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 900, deviceScaleFactor: 1, mobile: false });
    await waitForValue(async () => {
      const state = await cdp.send("Runtime.evaluate", { expression: "document.readyState === 'complete'", returnByValue: true });
      return state.result.value;
    }, "desktop center fixture render");

    const frames = [await sample("wide settled")];
    let widths = initialWidths;
    for (const viewportWidth of [1600, 1440, 1200, 1025]) {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: viewportWidth, height: 900, deviceScaleFactor: 1, mobile: false });
      frames.push(await sample(`${viewportWidth}px stale widths`));

      widths = fitDesktopPanelWidths(viewportWidth, widths, true, true);
      await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          document.getElementById("sidebar").style.setProperty("--shell-sidebar-width", "${widths.sidebar}px");
          document.getElementById("inspector").style.setProperty("--shell-inspector-width", "${widths.right}px");
        })()`,
      });
      frames.push(await sample(`${viewportWidth}px transition start`));
      let elapsed = 0;
      for (const delay of [35, 70, 140, 210]) {
        await sleep(delay - elapsed);
        elapsed = delay;
        frames.push(await sample(`${viewportWidth}px +${delay}ms`));
      }
    }
    return frames;
  } finally {
    cdp?.close();
    if (chrome.exitCode === null) {
      chrome.kill("SIGKILL");
      await Promise.race([
        new Promise((resolve) => chrome.once("exit", resolve)),
        sleep(2000),
      ]);
    }
    await rm(tempDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

test("desktop center reservation survives stale and animated widths while narrowing", async (context) => {
  const chromePath = await findChrome();
  if (!chromePath) {
    context.skip("Chrome/Chromium is unavailable; set CHROME_PATH to run rendered narrowing regression");
    return;
  }

  const shellCss = await readFile(new URL("../components/AppShell.module.css", import.meta.url), "utf8");
  const appShellSource = await readFile(new URL("../components/AppShell.tsx", import.meta.url), "utf8");
  assert.match(appShellSource, /--shell-desktop-center-min-width[^\n]+DESKTOP_CENTER_MIN_WIDTH/);

  const frames = await renderDesktopNarrowingFixture(chromePath, shellCss);
  for (const frame of frames) {
    const label = `${frame.label}: ${JSON.stringify(frame)}`;
    assert.ok(frame.center.width >= DESKTOP_CENTER_MIN_WIDTH - 0.5, `center reservation failed at ${label}`);
    assert.ok(frame.shellScrollWidth <= frame.shellClientWidth, `shell overflowed at ${label}`);
    assert.ok(frame.documentScrollWidth <= frame.viewportWidth, `page overflowed at ${label}`);
    assert.ok(frame.sidebar.left >= frame.shell.left - 0.5, `sidebar clipped at ${label}`);
    assert.ok(frame.inspector.right <= frame.shell.right + 0.5, `inspector clipped at ${label}`);
    assert.ok(Math.abs(frame.sidebarInner.width - frame.sidebar.width) <= 1.5, `sidebar inner width diverged beyond its border at ${label}`);
    assert.ok(Math.abs(frame.inspectorInner.width - frame.inspector.width) <= 1.5, `inspector inner width diverged beyond its border at ${label}`);
    assert.ok(frame.sidebarInner.scrollWidth <= frame.sidebarInner.clientWidth, `sidebar inner content clipped at ${label}`);
    assert.ok(frame.inspectorInner.scrollWidth <= frame.inspectorInner.clientWidth, `inspector inner content clipped at ${label}`);
  }
});

test("compact AppShell source keeps the branch popup outside hidden chrome", async () => {
  const appShellSource = await readFile(new URL("../components/AppShell.tsx", import.meta.url), "utf8");
  const branchSource = await readFile(new URL("../components/BranchNavigator.tsx", import.meta.url), "utf8");
  const compactStart = appShellSource.indexOf('<div className={styles.compactChrome}>');
  const compactEnd = appShellSource.indexOf("</header>", compactStart);
  assert.ok(compactStart >= 0 && compactEnd > compactStart, "compact chrome markup must exist");
  const compactMarkup = appShellSource.slice(compactStart, compactEnd);

  assert.doesNotMatch(compactMarkup, /BranchNavigator|styles\.branchHost/, "compact chrome must not retain a hidden Branches trigger");
  assert.match(appShellSource, /popupOnly[\s\S]*restoreFocusRef=\{compactMoreButtonRef\}/, "overflow branch popup must restore focus to More");
  assert.match(appShellSource, /open=\{chromeDensity === "compact" && activeTopPanel === "branches"\}/, "popup-only branch surface must be compact-only");
  assert.match(branchSource, /<section[\s\S]*aria-label="Session tree"/, "popup-only branch surface must use a labeled semantic section");
  assert.match(branchSource, /searchRef\.current \?\? panelRef\.current/, "popup-only branch surface must receive intentional focus");
  assert.match(branchSource, /event\.key !== "Escape"[\s\S]*dismissInlinePanel\(\)/, "popup-only branch surface must support dismissal and focus restoration");
});

async function renderCompactOverflowFixture(chromePath, shellCss, branchCss) {
  const tempDirectory = await mkdtemp(join(tmpdir(), "pi-compact-overflow-contract-"));
  const profileDirectory = join(tempDirectory, "profile");
  const fixturePath = join(tempDirectory, "fixture.html");
  await writeFile(fixturePath, `<!doctype html>
<html><head><meta charset="utf-8"><style>
:root {
  --space-half: 4px; --space-1: 8px; --space-1-5: 12px; --space-2: 16px; --space-3: 24px;
  --control-touch: 44px; --pi-safe-area-top: 0px; --pi-safe-area-left: 0px; --pi-safe-area-right: 0px;
  --panel-top: 48px; --z-popover: 100; --bg: white; --bg-panel: white; --bg-raised: #fafafa;
  --bg-hover: #f4f4f5; --bg-selected: #e4e4e7; --border: #d4d4d8; --text: #18181b;
  --text-muted: #52525b; --text-dim: #71717a; --font-mono: monospace; --font-sans: sans-serif;
  --radius-sm: 4px; --radius-md: 8px; --radius-full: 999px; --shadow-popover: 0 8px 20px #0002;
}
* { box-sizing: border-box; }
html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
${shellCss}
${branchCss}
#fixture-topbar { position: fixed; inset: 0 auto auto 0; width: var(--center-width); }
#branch-region, #session-host { left: 0; width: var(--center-width); }
#branch-region { top: 48px; }
#session-host { top: 48px; }
.fixturePath { overflow-wrap: anywhere; }
</style></head><body>
<header id="fixture-topbar" class="topBar" data-chrome="compact">
  <div class="compactChrome">
    <button id="sessions" class="compactNavButton" type="button">Sessions</button>
    <button id="current" class="currentSession" type="button"><span class="currentSessionTitle">Session</span></button>
    <button id="more" class="compactNavButton" type="button">More</button>
    <button id="inspector" class="compactNavButton" type="button">Inspector</button>
  </div>
</header>
<section id="branch-region" class="floatingPanel" aria-label="Session tree" tabindex="-1">
  <div class="panel">
    <div class="filters">
      <input id="tree-search" class="search" aria-label="Search conversation tree">
      <select id="tree-filter" class="filterSelect" aria-label="Filter conversation tree"><option>Default</option></select>
    </div>
    <ul class="rows" aria-label="Conversation branches">
      <li class="treeRow"><button id="tree-fold" class="foldButton" type="button">▾</button><button id="tree-select" class="rowSelect" type="button">Conversation branch</button></li>
    </ul>
  </div>
</section>
<div id="session-host" class="topPanelHost" data-chrome="compact" style="display:none">
  <section class="topPanel" aria-label="Session info">
    <div class="sessionInfo"><div id="session-grid" class="sessionInfoGrid">
      <section class="infoSection"><h3 class="infoSectionTitle">Session info</h3><div class="sessionRows">
        <span class="infoLabel">File</span><span class="infoValue fixturePath">/a/very/long/project/path/that/must/wrap/without/forcing/the/compact/session/panel/to/overflow/session.jsonl</span><button id="copy-file" class="copyButton" type="button" aria-label="Copy file path"><svg width="12" height="12"></svg></button>
        <span class="infoLabel">ID</span><span class="infoValue fixturePath">01234567-89ab-cdef-0123-456789abcdef</span><button id="copy-id" class="copyButton" type="button" aria-label="Copy session ID"><svg width="12" height="12"></svg></button>
      </div></section>
      <section class="infoSection"><h3 class="infoSectionTitle">Messages</h3><div class="infoRows"><span class="infoLabel">User</span><span class="infoValue">281,600</span><span class="infoLabel">Assistant</span><span class="infoValue">281,600</span></div></section>
      <section class="infoSection"><h3 class="infoSectionTitle">Tokens</h3><div class="infoRows" data-compact="true"><span class="infoLabel">Input</span><span class="infoValue" data-align="right">999,999,999</span><span class="infoLabel">Context</span><span class="infoValue" data-align="right">100.0% / 1.0M</span></div></section>
    </div></div>
  </section>
</div>
</body></html>`);

  const chrome = spawn(chromePath, [
    "--headless=new", "--disable-background-networking", "--disable-extensions", "--no-first-run", "--no-sandbox",
    "--remote-debugging-port=0", `--user-data-dir=${profileDirectory}`, `file://${fixturePath}`,
  ], { stdio: "ignore" });
  let cdp;

  try {
    const port = await waitForValue(async () => {
      const contents = await readFile(join(profileDirectory, "DevToolsActivePort"), "utf8");
      return contents.trim().split("\n")[0];
    }, "Chrome DevTools port");
    const target = await waitForValue(async () => {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      return targets.find((candidate) => candidate.type === "page" && candidate.url.startsWith("file:"));
    }, "compact overflow fixture target");
    cdp = await openCdp(target.webSocketDebuggerUrl);

    const results = [];
    for (const viewportWidth of [1025, 1440, 1920]) {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: viewportWidth, height: 900, deviceScaleFactor: 1, mobile: false });
      const openingOrders = [
        fitDesktopPanelWidths(viewportWidth, fitDesktopPanelWidths(viewportWidth, { sidebar: 9999, right: 9999 }, true, false), true, true),
        fitDesktopPanelWidths(viewportWidth, fitDesktopPanelWidths(viewportWidth, { sidebar: 9999, right: 9999 }, false, true), true, true),
      ];
      for (const [orderIndex, widths] of openingOrders.entries()) {
        const centerWidth = viewportWidth - widths.sidebar - widths.right;
        const evaluated = await cdp.send("Runtime.evaluate", {
          expression: `(() => {
            document.documentElement.style.setProperty("--center-width", ${JSON.stringify(`${centerWidth}px`)});
            const branch = document.getElementById("branch-region");
            const session = document.getElementById("session-host");
            branch.style.display = "block";
            session.style.display = "none";
            const focusables = [...document.querySelectorAll("#fixture-topbar button, #branch-region input, #branch-region select, #branch-region button")];
            document.getElementById("tree-search").focus({ preventScroll: true });
            const branchState = focusables.map((element) => {
              const rect = element.getBoundingClientRect();
              const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
              return {
                id: element.id,
                width: rect.width,
                height: rect.height,
                inBounds: rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight,
                hiddenAncestor: Boolean(element.closest("[aria-hidden='true'], [inert]")),
                tabbable: element.tabIndex >= 0,
                centerHit: hit === element || element.contains(hit),
              };
            });
            const activeId = document.activeElement?.id;
            branch.style.display = "none";
            session.style.display = "block";
            const host = document.getElementById("session-host");
            const grid = document.getElementById("session-grid");
            const sessionState = {
              hostClientWidth: host.clientWidth,
              hostScrollWidth: host.scrollWidth,
              gridClientWidth: grid.clientWidth,
              gridScrollWidth: grid.scrollWidth,
              copyControlsInBounds: [...host.querySelectorAll("button")].every((button) => {
                const rect = button.getBoundingClientRect();
                const hostRect = host.getBoundingClientRect();
                return rect.left >= hostRect.left && rect.right <= hostRect.right;
              }),
            };
            return {
              viewportWidth: innerWidth,
              documentScrollWidth: document.documentElement.scrollWidth,
              activeId,
              branchState,
              sessionState,
            };
          })()`,
          returnByValue: true,
        });
        results.push({ viewportWidth, orderIndex, widths, centerWidth, ...evaluated.result.value });
      }
    }
    return results;
  } finally {
    cdp?.close();
    if (chrome.exitCode === null) {
      chrome.kill("SIGKILL");
      await Promise.race([new Promise((resolve) => chrome.once("exit", resolve)), sleep(2000)]);
    }
    await rm(tempDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

test("compact branch and Session info surfaces remain accessible at desktop panel extremes", async (context) => {
  const chromePath = await findChrome();
  if (!chromePath) {
    context.skip("Chrome/Chromium is unavailable; set CHROME_PATH to run compact overflow rendering checks");
    return;
  }

  const shellCss = await readFile(new URL("../components/AppShell.module.css", import.meta.url), "utf8");
  const branchCss = await readFile(new URL("../components/BranchNavigator.module.css", import.meta.url), "utf8");
  assert.match(shellCss, /topPanelHost\[data-chrome="compact"\] \.sessionInfoGrid/);
  const results = await renderCompactOverflowFixture(chromePath, shellCss, branchCss);

  for (const result of results) {
    const label = `${result.viewportWidth}px order ${result.orderIndex}: ${JSON.stringify(result)}`;
    assert.ok(result.centerWidth >= DESKTOP_CENTER_MIN_WIDTH, `center width failed at ${label}`);
    assert.equal(result.activeId, "tree-search", `branch popup focus entry failed at ${label}`);
    assert.deepEqual(
      result.branchState.map((control) => control.id),
      ["sessions", "current", "more", "inspector", "tree-search", "tree-filter", "tree-fold", "tree-select"],
      `compact focus order changed or regained a hidden Branches trigger at ${label}`,
    );
    assert.ok(result.branchState.every((control) => control.width > 0 && control.height > 0), `zero-size control at ${label}`);
    assert.ok(result.branchState.every((control) => control.inBounds && !control.hiddenAncestor && control.tabbable && control.centerHit), `inaccessible branch control at ${label}`);
    assert.equal(result.sessionState.hostScrollWidth, result.sessionState.hostClientWidth, `Session info host overflowed at ${label}`);
    assert.equal(result.sessionState.gridScrollWidth, result.sessionState.gridClientWidth, `Session info grid overflowed at ${label}`);
    assert.equal(result.sessionState.copyControlsInBounds, true, `Session info control escaped at ${label}`);
    assert.ok(result.documentScrollWidth <= result.viewportWidth, `document overflowed at ${label}`);
  }
});

async function renderPhoneTopBarFixture(chromePath, shellCss) {
  const tempDirectory = await mkdtemp(join(tmpdir(), "pi-phone-topbar-contract-"));
  const profileDirectory = join(tempDirectory, "profile");
  const fixturePath = join(tempDirectory, "fixture.html");
  await writeFile(fixturePath, `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>
:root {
  --space-half: 4px; --space-1: 8px; --control-touch: 44px;
  --pi-safe-area-left: 0px; --pi-safe-area-right: 0px;
  --bg-raised: white; --bg-hover: #f4f4f5; --bg-selected: #e4e4e7;
  --border: #d4d4d8; --text: #18181b; --text-muted: #52525b; --text-dim: #71717a;
  --focus-ring: #18181b; --font-mono: monospace;
}
* { box-sizing: border-box; }
html, body { width: 100%; min-width: 0; margin: 0; overflow-x: hidden; }
${shellCss}
html[data-text-zoom="200"] .compactNavButton { font-size: 20px; }
html[data-text-zoom="200"] .currentSessionTitle { font-size: 26px; }
html[data-text-zoom="200"] .currentSessionMeta { font-size: 20px; }
</style></head><body>
<header id="topbar" class="topBar" data-chrome="desktop">
  <div class="desktopChrome"></div>
  <div id="chrome" class="compactChrome">
    <button id="sessions" type="button" class="compactNavButton mobileSessionsButton" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" /></svg><span id="sessions-label">Sessions</span></button>
    <button id="current" type="button" class="currentSession">
      <span id="title" class="currentSessionTitle">An exceptionally long current session title that must truncate</span>
      <span id="meta" class="currentSessionMeta">streaming · an exceptionally long status description with model, branch, and context details</span>
    </button>
    <button id="more" type="button" class="compactNavButton mobileMoreButton" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="2" /></svg><span id="more-label">More</span></button>
    <button id="inspector" type="button" class="compactNavButton mobileInspectorButton" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" /></svg><span id="inspector-label">Inspector</span></button>
  </div>
</header>
</body></html>`);

  const chrome = spawn(chromePath, [
    "--headless=new", "--disable-background-networking", "--disable-extensions", "--no-first-run", "--no-sandbox",
    "--remote-debugging-port=0", `--user-data-dir=${profileDirectory}`, `file://${fixturePath}`,
  ], { stdio: "ignore" });
  let cdp;

  try {
    const port = await waitForValue(async () => {
      const contents = await readFile(join(profileDirectory, "DevToolsActivePort"), "utf8");
      return contents.trim().split("\n")[0];
    }, "Chrome DevTools port");
    const target = await waitForValue(async () => {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      return targets.find((candidate) => candidate.type === "page" && candidate.url.startsWith("file:"));
    }, "phone top-bar fixture target");
    cdp = await openCdp(target.webSocketDebuggerUrl);

    const measureDensity = async (viewportWidth, mobile, density, textZoom = 100) => {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: viewportWidth, height: 844, deviceScaleFactor: 1, mobile });
      const evaluated = await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          document.documentElement.dataset.textZoom = ${JSON.stringify(String(textZoom))};
          document.documentElement.style.setProperty("--pi-safe-area-left", "0px");
          document.documentElement.style.setProperty("--pi-safe-area-right", "0px");
          const topbar = document.getElementById("topbar");
          topbar.dataset.chrome = ${JSON.stringify(density)};
          const rect = (element) => {
            const value = element.getBoundingClientRect();
            return { top: value.top, bottom: value.bottom, width: value.width, height: value.height };
          };
          const current = document.getElementById("current");
          const title = document.getElementById("title");
          const meta = document.getElementById("meta");
          return {
            viewportWidth: innerWidth,
            textZoom: ${JSON.stringify(textZoom)},
            pointerFine: matchMedia("(pointer: fine)").matches,
            pointerCoarse: matchMedia("(pointer: coarse)").matches,
            desktopDisplay: getComputedStyle(document.querySelector(".desktopChrome")).display,
            compactDisplay: getComputedStyle(document.getElementById("chrome")).display,
            topbar: rect(topbar),
            current: { ...rect(current), clientHeight: current.clientHeight, scrollHeight: current.scrollHeight },
            title: rect(title),
            meta: rect(meta),
            actions: ["sessions", "more", "inspector"].map((id) => rect(document.getElementById(id))),
          };
        })()`,
        returnByValue: true,
      });
      return evaluated.result.value;
    };

    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
    const densityResults = [
      await measureDensity(1025, false, "desktop"),
      await measureDensity(1024, false, "compact"),
    ];
    const compactIdentityGrowthResults = [
      await measureDensity(1024, false, "compact", 200),
      await measureDensity(768, false, "compact", 200),
    ];
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
    await cdp.send("Page.reload", { ignoreCache: true });
    await waitForValue(async () => {
      const state = await cdp.send("Runtime.evaluate", { expression: "document.readyState === 'complete' && matchMedia('(pointer: coarse)').matches", returnByValue: true });
      return state.result.value;
    }, "coarse phone top-bar fixture render");
    densityResults.push(
      await measureDensity(768, true, "compact"),
      await measureDensity(390, true, "compact"),
    );

    const results = [];
    for (const viewportWidth of [320, 375, 390, 430, 568, 640]) {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: viewportWidth, height: 844, deviceScaleFactor: 1, mobile: true });
      for (const [safeLeft, safeRight] of [[0, 0], [12, 12], [0, 24], [24, 0]]) {
        for (const density of ["desktop", "compact"]) {
          for (const state of ["idle", "sessions", "more", "inspector"]) {
            const textZooms = [320, 390].includes(viewportWidth) && safeLeft === 0 && safeRight === 0 && density === "compact" && state === "idle"
              ? [100, 200]
              : [100];
            for (const textZoom of textZooms) {
              const evaluated = await cdp.send("Runtime.evaluate", {
                expression: `(() => {
                  document.documentElement.dataset.textZoom = ${JSON.stringify(String(textZoom))};
                  document.documentElement.style.setProperty("--pi-safe-area-left", ${JSON.stringify(`${safeLeft}px`)});
                  document.documentElement.style.setProperty("--pi-safe-area-right", ${JSON.stringify(`${safeRight}px`)});
                  const topbar = document.getElementById("topbar");
                  topbar.dataset.chrome = ${JSON.stringify(density)};
                  const controls = ["sessions", "more", "inspector"].map((id) => document.getElementById(id));
                  for (const control of controls) control.setAttribute("aria-pressed", String(control.id === ${JSON.stringify(state)}));
                  if (${JSON.stringify(state)} !== "idle") document.getElementById(${JSON.stringify(state)}).focus({ preventScroll: true });
                  else document.activeElement?.blur();
                  const rectangle = (id) => {
                    const rect = document.getElementById(id).getBoundingClientRect();
                    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height, center: rect.left + rect.width / 2, centerY: rect.top + rect.height / 2 };
                  };
                  const title = document.getElementById("title");
                  const meta = document.getElementById("meta");
                  return {
                    viewportWidth: innerWidth,
                    density: topbar.dataset.chrome,
                    activeId: document.activeElement?.id || null,
                    documentScrollWidth: document.documentElement.scrollWidth,
                    topbar: rectangle("topbar"),
                    chrome: rectangle("chrome"),
                    current: rectangle("current"),
                    sessions: rectangle("sessions"),
                    more: rectangle("more"),
                    inspector: rectangle("inspector"),
                    sessionsLabel: rectangle("sessions-label"),
                    moreLabel: rectangle("more-label"),
                    inspectorLabel: rectangle("inspector-label"),
                    title: { ...rectangle("title"), clientWidth: title.clientWidth, scrollWidth: title.scrollWidth, overflow: getComputedStyle(title).overflow, textOverflow: getComputedStyle(title).textOverflow },
                    meta: { ...rectangle("meta"), clientWidth: meta.clientWidth, scrollWidth: meta.scrollWidth, overflow: getComputedStyle(meta).overflow, textOverflow: getComputedStyle(meta).textOverflow },
                  };
                })()`,
                returnByValue: true,
              });
              results.push({ safeLeft, safeRight, state, textZoom, ...evaluated.result.value });
            }
          }
        }
      }
    }
    return { compactIdentityGrowthResults, densityResults, results };
  } finally {
    cdp?.close();
    if (chrome.exitCode === null) {
      chrome.kill("SIGKILL");
      await Promise.race([new Promise((resolve) => chrome.once("exit", resolve)), sleep(2000)]);
    }
    await rm(tempDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

test("phone top bar stays centered before and after chrome-density hydration", async (context) => {
  const chromePath = await findChrome();
  if (!chromePath) {
    context.skip("Chrome/Chromium is unavailable; set CHROME_PATH to run phone top-bar rendering checks");
    return;
  }

  const shellCss = await readFile(new URL("../components/AppShell.module.css", import.meta.url), "utf8");
  const phoneMedia = shellCss.slice(shellCss.indexOf("@media (max-width: 640px)"), shellCss.indexOf("@media (min-width: 641px) and (pointer: coarse)"));
  assert.match(phoneMedia, /\.compactChrome\s*\{[^}]*grid-template-columns:/s, "phone grid must not depend on hydrated data-chrome");
  assert.doesNotMatch(phoneMedia, /data-chrome[^}]*grid-template-columns:/s, "phone grid must apply to the server density snapshot");

  const { compactIdentityGrowthResults, densityResults, results } = await renderPhoneTopBarFixture(chromePath, shellCss);
  const [desktopFine, compactFine, tabletCoarse, phoneCoarse] = densityResults;
  assert.equal(desktopFine.pointerFine, true, `1025px fixture did not emulate a fine pointer: ${JSON.stringify(desktopFine)}`);
  assert.equal(compactFine.pointerFine, true, `1024px fixture did not emulate a fine pointer: ${JSON.stringify(compactFine)}`);
  assert.equal(desktopFine.desktopDisplay, "flex", `1025px did not use desktop chrome: ${JSON.stringify(desktopFine)}`);
  assert.equal(desktopFine.compactDisplay, "none", `1025px exposed compact chrome: ${JSON.stringify(desktopFine)}`);
  assert.equal(compactFine.desktopDisplay, "none", `1024px exposed desktop chrome: ${JSON.stringify(compactFine)}`);
  assert.notEqual(compactFine.compactDisplay, "none", `1024px did not use compact chrome: ${JSON.stringify(compactFine)}`);
  assert.equal(desktopFine.topbar.height, 48, `1025px fine-pointer top bar changed height: ${JSON.stringify(desktopFine)}`);
  assert.equal(compactFine.topbar.height, 48, `1024px fine-pointer compact mode increased height: ${JSON.stringify(compactFine)}`);
  for (const coarse of [tabletCoarse, phoneCoarse]) {
    assert.equal(coarse.pointerCoarse, true, `coarse-pointer fixture was not coarse: ${JSON.stringify(coarse)}`);
    assert.equal(coarse.topbar.height, 56, `coarse-pointer top-bar policy changed: ${JSON.stringify(coarse)}`);
    assert.ok(coarse.actions.every((action) => action.width >= 44 && action.height >= 44), `coarse top-bar action fell below 44x44px: ${JSON.stringify(coarse)}`);
  }
  for (const result of compactIdentityGrowthResults) {
    const label = `${result.viewportWidth}px ${result.textZoom}% compact identity: ${JSON.stringify(result)}`;
    assert.equal(result.pointerFine, true, `compact text-zoom fixture did not retain a fine pointer at ${label}`);
    assert.ok(result.topbar.height > 48, `compact top bar did not grow intrinsically at ${label}`);
    assert.equal(result.current.scrollHeight, result.current.clientHeight, `compact session identity clipped at ${label}`);
    assert.ok(result.title.top >= result.topbar.top - 0.5 && result.meta.bottom <= result.topbar.bottom + 0.5, `compact identity escaped top bar at ${label}`);
    assert.ok(result.title.bottom <= result.meta.top + 0.5, `compact identity lines overlap at ${label}`);
    assert.ok(result.actions.every((action) => action.height === result.topbar.height), `compact actions did not track intrinsic bar growth at ${label}`);
  }

  for (const result of results) {
    const label = `${result.viewportWidth}px ${result.safeLeft}/${result.safeRight}px ${result.density} ${result.state} ${result.textZoom}% text: ${JSON.stringify(result)}`;
    const viewportCenter = result.viewportWidth / 2;
    assert.ok(Math.abs(result.current.center - viewportCenter) <= 1, `title region is not viewport-centered at ${label}`);
    assert.equal(result.chrome.left, 0, `chrome escaped viewport left at ${label}`);
    assert.equal(result.chrome.right, result.viewportWidth, `chrome escaped viewport right at ${label}`);
    assert.ok(result.current.left >= result.sessions.right - 0.5, `title overlaps left control at ${label}`);
    assert.ok(result.current.right <= result.more.left + 0.5, `title overlaps right controls at ${label}`);
    for (const control of [result.sessions, result.more, result.inspector]) {
      assert.equal(control.width, 64, `control width changed at ${label}`);
      assert.ok(control.height >= 56, `control height fell below the phone policy at ${label}`);
      assert.equal(control.height, result.topbar.height, `control did not follow the intrinsic top-bar height at ${label}`);
    }
    for (const [control, text] of [[result.sessions, result.sessionsLabel], [result.more, result.moreLabel], [result.inspector, result.inspectorLabel]]) {
      assert.ok(text.left >= control.left - 0.5 && text.right <= control.right + 0.5, `label escaped its action horizontally at ${label}`);
      assert.ok(text.top >= control.top - 0.5 && text.bottom <= control.bottom + 0.5, `label escaped its action vertically at ${label}`);
      assert.ok(Math.abs(text.center - control.center) <= 0.5, `label is not centered in its action at ${label}`);
    }
    assert.ok(result.title.top >= result.topbar.top - 0.5 && result.meta.bottom <= result.topbar.bottom + 0.5, `session identity escaped the top bar at ${label}`);
    assert.ok(result.title.bottom <= result.meta.top + 0.5, `session identity lines overlap at ${label}`);
    assert.ok(result.title.scrollWidth > result.title.clientWidth, `long title did not truncate at ${label}`);
    assert.ok(result.meta.scrollWidth > result.meta.clientWidth, `long metadata did not truncate at ${label}`);
    assert.deepEqual([result.title.overflow, result.title.textOverflow], ["hidden", "ellipsis"], `title truncation styles changed at ${label}`);
    assert.deepEqual([result.meta.overflow, result.meta.textOverflow], ["hidden", "ellipsis"], `metadata truncation styles changed at ${label}`);
    if (result.textZoom === 100) assert.equal(result.topbar.height, 56, `normal phone top-bar height changed at ${label}`);
    else assert.ok(result.topbar.height > 56, `200% text did not receive intrinsic vertical space at ${label}`);
    assert.ok(result.documentScrollWidth <= result.viewportWidth, `phone top bar overflowed at ${label}`);
    assert.equal(result.activeId, result.state === "idle" ? null : result.state, `focus state changed geometry at ${label}`);
  }
});


test("mounted AppShell hydrates compact chrome and opens More → Session tree", async () => {
  const fixturePath = new URL("./app-shell-mounted.fixture.mjs", import.meta.url);
  const child = spawn(process.execPath, ["--import", "tsx", fixturePath.pathname], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: "test" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  assert.equal(exitCode, 0, `mounted AppShell fixture failed:
${stdout}
${stderr}`);
});
