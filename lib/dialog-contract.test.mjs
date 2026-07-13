import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const dialog = await readFile(new URL("../components/ui/Dialog.tsx", import.meta.url), "utf8");
const primitives = await readFile(new URL("../components/ui/primitives.css", import.meta.url), "utf8");

test("shared dialog owns portal layering, naming, background lock, and restoration", () => {
  assert.match(dialog, /createPortal\([\s\S]*?document\.body/);
  assert.match(dialog, /role="dialog"/);
  assert.match(dialog, /aria-modal="true"/);
  assert.match(dialog, /aria-labelledby=\{titleId\}/);
  assert.match(dialog, /aria-describedby=\{descriptionId\}/);
  assert.match(dialog, /openDialogStack\.push\(instanceId\)/);
  assert.match(dialog, /openDialogStack\[openDialogStack\.length - 1\] !== instanceId/);
  assert.match(dialog, /lockBody\(\)/);
  assert.match(dialog, /unlockBody\(\)/);
  assert.match(dialog, /focusWithoutScroll\(previouslyFocused\)/);
  assert.match(primitives, /background:\s*var\(--scrim\)/);
});

test("shared dialog validates focus entry and wraps Tab in both directions", () => {
  assert.match(dialog, /element\.isConnected/);
  assert.match(dialog, /element\.closest\("\[hidden\], \[inert\], \[aria-hidden='true'\]"\)/);
  assert.match(dialog, /getClientRects\(\)\.length > 0/);
  assert.match(dialog, /element\.focus\(\{ preventScroll: true \}\)/);
  assert.match(dialog, /explicitTarget \?\? policyTarget \?\? panel/);
  assert.match(dialog, /event\.shiftKey && activeElement === first/);
  assert.match(dialog, /!event\.shiftKey && activeElement === last/);
  assert.match(dialog, /!activeIsTabbable[\s\S]*?event\.shiftKey \? last : first/);
});

test("topmost Escape is consumed once and supports compatible terminal adapters", () => {
  assert.match(dialog, /event\.key === "Escape"/);
  assert.match(dialog, /onEscapeKeyDownRef\.current\?\.\(event\)/);
  assert.match(dialog, /!event\.defaultPrevented && dismissibleRef\.current/);
  assert.match(dialog, /onOpenChangeRef\.current\(false\)/);
  assert.match(dialog, /event\.stopImmediatePropagation\(\)/);
});

test("shared viewport contract follows visualViewport and safe areas", () => {
  assert.match(dialog, /const visualViewport = window\.visualViewport/);
  assert.match(dialog, /visualViewport\?\.addEventListener\("resize", updateViewport\)/);
  assert.match(dialog, /visualViewport\?\.addEventListener\("scroll", updateViewport\)/);
  assert.match(dialog, /--pi-dialog-viewport-height/);
  assert.match(dialog, /--pi-dialog-viewport-width/);
  assert.match(primitives, /height:\s*var\(--pi-dialog-viewport-height\)/);
  assert.match(primitives, /max-height:\s*calc\(var\(--pi-dialog-viewport-height\) - var\(--pi-safe-area-top\) - var\(--pi-safe-area-bottom\)/);
  assert.match(primitives, /data-height="viewport"/);
  assert.match(primitives, /data-layout="flush"/);
});

test("modal controls and motion retain the shared accessibility floor", () => {
  assert.match(primitives, /@media \(pointer: coarse\), \(max-width: 640px\)[\s\S]*?\.pi-button\[data-size="compact"\] \{ min-height: var\(--control-touch\); \}/);
  assert.match(primitives, /\.pi-icon-button\[data-size="compact"\] \{ width: var\(--control-touch\); min-width: var\(--control-touch\); height: var\(--control-touch\); min-height: var\(--control-touch\); \}/);
  assert.match(primitives, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation: none/);
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

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function connectCdp(chrome, userDataDir) {
  const chromeProcess = spawn(chrome, [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--no-first-run",
    "--remote-debugging-port=0",
    `--user-data-dir=${userDataDir}`,
    "about:blank",
  ], { stdio: "ignore" });

  const portFile = path.join(userDataDir, "DevToolsActivePort");
  for (let attempt = 0; attempt < 100 && !existsSync(portFile); attempt += 1) await wait(25);
  assert.ok(existsSync(portFile), "Chrome must expose a DevTools endpoint");
  const port = readFileSync(portFile, "utf8").split("\n")[0];
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
  const target = targets.find((candidate) => candidate.type === "page");
  assert.ok(target?.webSocketDebuggerUrl, "Chrome must expose a page target");

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const callback = pending.get(message.id);
    if (!callback) return;
    pending.delete(message.id);
    if (message.error) callback.reject(new Error(message.error.message));
    else callback.resolve(message.result);
  });

  return {
    process: chromeProcess,
    socket,
    send(method, params = {}) {
      const id = ++nextId;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
  };
}

async function closeCdp(cdp) {
  const exited = new Promise((resolve) => {
    if (cdp.process.exitCode !== null || cdp.process.signalCode !== null) resolve();
    else cdp.process.once("exit", resolve);
  });
  cdp.socket.close();
  if (cdp.process.exitCode === null && cdp.process.signalCode === null) cdp.process.kill("SIGKILL");
  await exited;
}

async function buildActualModalFixture(directory) {
  const entry = path.join(directory, "fixture.tsx");
  const script = path.join(directory, "fixture.js");
  const stylesheet = path.join(directory, "fixture.css");
  const html = path.join(directory, "fixture.html");
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const componentPath = (name) => JSON.stringify(path.join(projectRoot, "components", name));
  const entries = Array.from({ length: 64 }, (_, index) => ({
    name: `Directory ${String(index + 1).padStart(2, "0")} with an intentionally long path segment`,
    path: `/workspace/directory-${index + 1}-${"long-segment-".repeat(4)}`,
    modified: "2026-07-11T00:00:00.000Z",
  }));

  await writeFile(entry, `
    import { createRoot } from "react-dom/client";
    import { DirectoryPickerModal } from ${componentPath("DirectoryPickerModal.tsx")};
    import { ExtensionUiHost } from ${componentPath("ExtensionUiHost.tsx")};
    import { SessionTreeSelectorModal } from ${componentPath("SessionCommandModals.tsx")};

    const entries = ${JSON.stringify(entries)};
    const tree = Array.from({ length: 64 }, (_, index) => ({
      entry: {
        type: "message",
        id: \`entry-\${String(index + 1).padStart(3, "0")}\`,
        parentId: null,
        timestamp: "2026-07-11T00:00:00.000Z",
        message: { role: "user", content: \`Session row \${index + 1} \${"long-session-content-".repeat(5)}\` },
      },
      children: [],
    }));
    const standardRequest = {
      type: "extension_ui_request",
      id: "long-standard-extension",
      method: "select",
      title: "Extension selection",
      options: Array.from({ length: 64 }, (_, index) => \`Extension option \${index + 1} \${"long-option-content-".repeat(5)}\`),
    };
    const customRequest = {
      type: "extension_ui_request",
      id: "long-custom-extension",
      method: "custom",
      lines: Array.from({ length: 160 }, (_, index) => \`Terminal line \${index + 1} \${"wide-terminal-content-".repeat(8)}\`),
    };

    window.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ cwd: "/workspace", parent: "/", entries }),
    });

    function Fixture({ kind }) {
      if (kind === "directory") {
        return <DirectoryPickerModal initialPath="/workspace" homeDir="/home/tester" onClose={() => {}} onSelect={() => {}} />;
      }
      if (kind === "session") {
        return <SessionTreeSelectorModal tree={tree} activeLeafId={null} onClose={() => {}} onSelect={() => {}} />;
      }
      if (kind === "extension-standard") {
        return <ExtensionUiHost dialog={standardRequest} customUi={null} onRespond={() => {}} onCustomInput={() => {}} onCustomResize={() => {}} />;
      }
      return <ExtensionUiHost dialog={null} customUi={customRequest} onRespond={() => {}} onCustomInput={() => {}} onCustomResize={() => {}} />;
    }

    const root = createRoot(document.getElementById("mount"));
    window.renderModal = async (kind) => {
      root.render(<Fixture key={kind} kind={kind} />);
      for (let attempt = 0; attempt < 120; attempt += 1) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const dialog = document.querySelector("[role=dialog]");
        const count = kind === "directory"
          ? document.querySelectorAll("section[aria-label^='Directories in'] button").length
          : kind === "session"
            ? document.querySelectorAll("[data-tree-row-control='true']").length
            : kind === "extension-standard"
              ? document.querySelectorAll(".pi-dialog__body button").length
              : document.querySelector("section[aria-label='Extension terminal output']")?.scrollHeight > 0 ? 64 : 0;
        if (dialog && count >= 64) return true;
      }
      throw new Error(\`Timed out rendering actual \${kind} modal\`);
    };
    window.__fixtureReady = true;
  `);

  await build({
    absWorkingDir: projectRoot,
    entryPoints: [entry],
    outfile: script,
    bundle: true,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": "\"production\"" },
    nodePaths: [path.join(projectRoot, "node_modules")],
    logLevel: "silent",
  });
  assert.ok(existsSync(stylesheet), "actual component bundle must emit production CSS modules");

  const tokens = readFileSync(path.join(projectRoot, "app/design-tokens.css"), "utf8");
  await writeFile(html, `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>
${tokens}
${primitives}
* { box-sizing: border-box; animation: none !important; transition: none !important; }
html, body, #mount { width: 100%; height: 100%; margin: 0; overflow: hidden; }
body { color: var(--text); background: var(--bg); font-family: var(--font-sans); }
</style><link rel="stylesheet" href="fixture.css"></head><body><main id="mount"></main><script src="fixture.js"></script></body></html>`);
  return html;
}

test("actual long-content modals pass the complete theme, viewport, safe-area, and touch-scroll matrix", async (context) => {
  const chrome = findChrome();
  if (!chrome) return context.skip("Chrome/Chromium is required for rendered modal geometry assertions");

  const temp = mkdtempSync(path.join(os.tmpdir(), "pi-modal-contract-"));
  const fixture = await buildActualModalFixture(temp);
  const cdp = await connectCdp(chrome, path.join(temp, "chrome"));

  try {
    const viewportTiers = [
      { tier: "desktop", width: 1440, height: 560, screenHeight: 900, safeTop: 6, safeRight: 5, safeBottom: 8, safeLeft: 7 },
      { tier: "compact", width: 768, height: 460, screenHeight: 1024, safeTop: 8, safeRight: 7, safeBottom: 10, safeLeft: 6 },
      { tier: "phone", width: 390, height: 520, screenHeight: 844, safeTop: 20, safeRight: 4, safeBottom: 34, safeLeft: 3 },
    ];
    const themes = [
      { name: "light", dark: false },
      { name: "dark", dark: true },
    ];

    for (const kind of ["directory", "session", "extension-standard", "extension-custom"]) {
      for (const viewport of viewportTiers) {
        for (const theme of themes) {
          await cdp.send("Emulation.setDeviceMetricsOverride", {
            width: viewport.width,
            height: viewport.height,
            deviceScaleFactor: viewport.tier === "phone" ? 3 : 1,
            mobile: viewport.tier === "phone",
            screenWidth: viewport.width,
            screenHeight: viewport.screenHeight,
          });
          await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
          await cdp.send("Page.navigate", { url: `file://${fixture}` });

          const prepared = await cdp.send("Runtime.evaluate", {
            awaitPromise: true,
            returnByValue: true,
            expression: `(async () => {
              for (let attempt = 0; attempt < 120 && !window.__fixtureReady; attempt += 1) {
                await new Promise((resolve) => setTimeout(resolve, 16));
              }
              if (!window.__fixtureReady) throw new Error("fixture did not initialize");
              document.documentElement.className = ${JSON.stringify(theme.dark ? "dark" : "")};
              const root = document.documentElement.style;
              root.setProperty("--pi-safe-area-top", ${JSON.stringify(`${viewport.safeTop}px`)}, "important");
              root.setProperty("--pi-safe-area-right", ${JSON.stringify(`${viewport.safeRight}px`)}, "important");
              root.setProperty("--pi-safe-area-bottom", ${JSON.stringify(`${viewport.safeBottom}px`)}, "important");
              root.setProperty("--pi-safe-area-left", ${JSON.stringify(`${viewport.safeLeft}px`)}, "important");
              await window.renderModal(${JSON.stringify(kind)});
              await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

              const overlay = document.querySelector(".pi-dialog");
              const panel = document.querySelector(".pi-dialog__panel");
              const header = document.querySelector(".pi-dialog__header");
              const body = document.querySelector(".pi-dialog__body");
              const footer = document.querySelector(".pi-dialog__footer");
              const action = footer.querySelector("button");
              const scrollOwners = [...panel.querySelectorAll("*")].filter((element) => {
                const overflow = getComputedStyle(element).overflowY;
                return (overflow === "auto" || overflow === "scroll") && element.scrollHeight > element.clientHeight + 1;
              });
              const owner = scrollOwners[0];
              owner.scrollTop = 0;
              const ownerRect = owner.getBoundingClientRect();
              return {
                ownerCenter: { x: Math.round(ownerRect.left + ownerRect.width / 2), y: Math.round(ownerRect.top + ownerRect.height / 2) },
                maxScroll: owner.scrollHeight - owner.clientHeight,
              };
            })()`,
          });
          const start = prepared.result.value;
          const label = `${kind} ${viewport.tier} ${theme.name}`;
          assert.ok(start.maxScroll > 80, `${label} must exercise substantial overflow`);

          let touchScrolled = false;
          for (let attempt = 0; attempt < 3 && !touchScrolled; attempt += 1) {
            await cdp.send("Input.synthesizeScrollGesture", {
              x: start.ownerCenter.x,
              y: start.ownerCenter.y,
              yDistance: -Math.min(240, start.maxScroll),
              speed: 800,
              gestureSourceType: "touch",
            });
            for (let frame = 0; frame < 20 && !touchScrolled; frame += 1) {
              touchScrolled = Boolean((await cdp.send("Runtime.evaluate", {
                returnByValue: true,
                expression: `(() => {
                  const panel = document.querySelector(".pi-dialog__panel");
                  const owner = [...panel.querySelectorAll("*")].find((element) => {
                    const overflow = getComputedStyle(element).overflowY;
                    return (overflow === "auto" || overflow === "scroll") && element.scrollHeight > element.clientHeight + 1;
                  });
                  return owner?.scrollTop > 0;
                })()`,
              })).result.value);
              if (!touchScrolled) await wait(16);
            }
          }
          assert.equal(touchScrolled, true, `${label} touch gesture must move the production scroll owner`);

          const result = await cdp.send("Runtime.evaluate", {
            awaitPromise: true,
            returnByValue: true,
            expression: `(async () => {
              const overlay = document.querySelector(".pi-dialog");
              const panel = document.querySelector(".pi-dialog__panel");
              const header = document.querySelector(".pi-dialog__header");
              const body = document.querySelector(".pi-dialog__body");
              const footer = document.querySelector(".pi-dialog__footer");
              const action = footer.querySelector("button");
              const scrollOwners = [...panel.querySelectorAll("*")].filter((element) => {
                const overflow = getComputedStyle(element).overflowY;
                return (overflow === "auto" || overflow === "scroll") && element.scrollHeight > element.clientHeight + 1;
              });
              const owner = scrollOwners[0];
              const touchScrollTop = owner.scrollTop;
              owner.scrollTop = owner.scrollHeight;
              await new Promise((resolve) => requestAnimationFrame(resolve));
              const rows = ${JSON.stringify(kind)} === "directory"
                ? [...owner.querySelectorAll("button")]
                : ${JSON.stringify(kind)} === "session"
                  ? [...owner.querySelectorAll("[data-tree-row-control='true']")]
                  : ${JSON.stringify(kind)} === "extension-standard"
                    ? [...owner.querySelectorAll("button")]
                    : [];
              const lastRow = rows.at(-1) ?? null;
              const rect = (element) => {
                if (!element) return null;
                const value = element.getBoundingClientRect();
                return { top: value.top, right: value.right, bottom: value.bottom, left: value.left, width: value.width, height: value.height };
              };
              return {
                viewport: { width: innerWidth, height: innerHeight, visualHeight: visualViewport.height, screenHeight: screen.height },
                dark: document.documentElement.classList.contains("dark"),
                scrollOwnerCount: scrollOwners.length,
                ownerClass: owner.className,
                ownerClientHeight: owner.clientHeight,
                ownerScrollHeight: owner.scrollHeight,
                ownerScrollTop: owner.scrollTop,
                touchScrollTop,
                overlayPadding: {
                  top: parseFloat(getComputedStyle(overlay).paddingTop),
                  right: parseFloat(getComputedStyle(overlay).paddingRight),
                  bottom: parseFloat(getComputedStyle(overlay).paddingBottom),
                  left: parseFloat(getComputedStyle(overlay).paddingLeft),
                },
                overlay: rect(overlay), panel: rect(panel), header: rect(header), body: rect(body), footer: rect(footer), action: rect(action), owner: rect(owner), lastRow: rect(lastRow),
                horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
              };
            })()`,
          });
          const value = result.result.value;
          assert.deepEqual({ width: value.viewport.width, height: value.viewport.height }, { width: viewport.width, height: viewport.height }, label);
          assert.equal(value.dark, theme.dark, `${label} theme`);
          assert.ok(value.viewport.screenHeight > value.viewport.visualHeight, `${label} must exercise a reduced visual viewport`);
          assert.ok(Math.abs(value.viewport.visualHeight - viewport.height) <= 1, `${label} visual viewport height`);
          assert.equal(value.scrollOwnerCount, 1, `${label} must have exactly one active vertical scroller`);
          assert.ok(value.touchScrollTop > 0, `${label} must respond to touch-emulated scrolling`);
          assert.ok(value.ownerScrollTop + value.ownerClientHeight >= value.ownerScrollHeight - 1, `${label} final content must be reachable`);
          if (value.lastRow) {
            assert.ok(value.lastRow.top >= value.owner.top - 1 && value.lastRow.bottom <= value.owner.bottom + 1, `${label} final row must be visible at the scroll end`);
          }
          assert.ok(value.action.bottom <= viewport.height - viewport.safeBottom + 1, `${label} footer action must remain above the bottom safe area`);
          assert.ok(value.action.left >= viewport.safeLeft - 1 && value.action.right <= viewport.width - viewport.safeRight + 1, `${label} footer action must respect horizontal safe areas`);
          assert.ok(value.action.top >= value.footer.top - 1 && value.action.bottom <= value.footer.bottom + 1, `${label} footer must own its action`);
          assert.ok(value.horizontalOverflow <= 0, `${label} must not overflow horizontally`);

          const adaptive = kind === "directory" || kind === "session";
          if (viewport.tier === "phone" && adaptive) {
            assert.equal(value.overlayPadding.top, 0, `${label} adaptive overlay must not duplicate top safe area`);
            assert.equal(value.overlayPadding.bottom, 0, `${label} adaptive overlay must not duplicate bottom safe area`);
            assert.ok(value.header.height >= 56 + viewport.safeTop, `${label} header owns top safe area`);
            assert.ok(value.footer.height >= 56 + viewport.safeBottom, `${label} footer owns bottom safe area`);
          } else {
            assert.ok(value.overlayPadding.top >= viewport.safeTop + 8, `${label} centered overlay owns top safe area`);
            assert.ok(value.overlayPadding.bottom >= viewport.safeBottom + 8, `${label} centered overlay owns bottom safe area`);
          }
        }
      }
    }
  } finally {
    await closeCdp(cdp);
    rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});
