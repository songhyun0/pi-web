import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { transform } from "lightningcss";

const root = process.cwd();

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

function compileModule(relativePath) {
  const filename = path.join(root, relativePath);
  const result = transform({ filename, code: Buffer.from(readFileSync(filename)), cssModules: true });
  return {
    css: result.code.toString(),
    className(name) {
      const value = result.exports?.[name]?.name;
      assert.ok(value, `${relativePath} must export .${name}`);
      return value;
    },
  };
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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

async function connectCdp(chrome, userDataDir) {
  const process = spawn(chrome, [
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
    process,
    socket,
    send(method, params = {}) {
      const id = ++nextId;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
  };
}

function fixtureHtml(chat, profile) {
  const optionRows = Array.from({ length: 40 }, (_, index) => `
    <button type="button" role="menuitemradio" class="${profile.className("option")}">
      <span class="${profile.className("checkmark")}"></span>
      <span class="${profile.className("optionCopy")}"><strong>Profile ${index + 1}</strong><span>Standard tools</span></span>
    </button>`).join("");

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>
:root {
  --pi-safe-area-top: 0px; --pi-safe-area-right: 0px; --pi-safe-area-bottom: 0px; --pi-safe-area-left: 0px;
  --bg: #f7f7f8; --bg-panel: #f0f0f1; --bg-raised: #fff; --bg-hover: #ececef; --bg-selected: #e4e4e7;
  --text: #18181b; --text-muted: #71717a; --text-dim: #a1a1aa; --accent: #27272a; --accent-contrast: #fff;
  --border: #e4e4e7; --focus-ring: #52525b; --warning: #a16207; --warning-soft: #fef9c3; --error: #b91c1c; --error-soft: #fee2e2;
  --state-disabled-opacity: .5; --font-mono: monospace;
  --space-half: 4px; --space-1: 8px; --space-1-5: 12px; --space-2: 16px; --space-3: 24px; --space-4: 32px;
  --radius-sm: 4px; --radius-md: 8px; --radius-lg: 12px; --radius-full: 999px;
  --control-touch: 44px; --motion-fast: 80ms; --motion-enter: 140ms; --ease-snap: ease; --ease-out: ease;
  --shadow-popover: 0 8px 24px rgb(0 0 0 / .15);
}
* { box-sizing: border-box; animation: none !important; transition: none !important; }
html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; font: 14px sans-serif; }
.dialog { position: fixed; inset: 0; padding-top: var(--pi-safe-area-top); display: flex; align-items: flex-end; }
.panel { width: 100%; height: min(680px, calc(100dvh - var(--pi-safe-area-top) - 16px)); display: flex; flex-direction: column; overflow: hidden; background: var(--bg-raised); }
.header { min-height: 72px; padding: 12px 16px; flex: 0 0 auto; border-bottom: 1px solid var(--border); }
.body { min-height: 0; flex: 1 1 auto; padding: 24px 16px calc(24px + var(--pi-safe-area-bottom)); overflow: auto; }
section { min-width: 0; }
h3 { line-height: 16px; }
@media (min-width: 641px) {
  .dialog { padding: 8px; align-items: center; justify-content: center; }
  .panel { width: 620px; height: auto; max-height: calc(100dvh - 16px); }
  .body { overflow: auto; }
}
${chat.css}
${profile.css}
</style></head><body>
<div class="dialog">
  <div id="panel" class="panel ${chat.className("controlsDialog")}">
    <div class="header"><strong>Run controls</strong><p>Reasoning, profile, compaction, and completion settings.</p></div>
    <div class="body ${chat.className("controlsDialogBody")}">
      <div id="controls" class="${chat.className("controlsSheet")}">
        <section class="${chat.className("controlsSection")} ${chat.className("reasoningSection")}">
          <div class="${chat.className("controlsRow")}"><span>Reasoning effort</span><select class="${chat.className("reasoningSelect")}"><option>Auto</option></select></div>
        </section>
        <section class="${chat.className("controlsSection")} ${chat.className("profileSection")}">
          <h3 class="${chat.className("controlsTitle")}">Capability profile</h3>
          <div class="${chat.className("profileControl")}">
            <div class="${profile.className("container")}" data-quick-controls="true">
              <button id="trigger" type="button" class="${profile.className("trigger")}" aria-expanded="false">Default profile</button>
              <div id="menu" role="menu" class="${profile.className("menu")}" hidden>
                <div class="${profile.className("optionList")}">${optionRows}</div>
                <button id="manage" type="button" role="menuitem" class="${profile.className("manageButton")}">Manage profiles</button>
              </div>
            </div>
          </div>
        </section>
        <section id="execution" class="${chat.className("controlsSection")} ${chat.className("executionSection")}">
          <h3 class="${chat.className("controlsTitle")}">Execution</h3>
          <div class="${chat.className("controlsActions")}">
            <button class="${chat.className("control")}">Prompt editor</button>
            <button class="${chat.className("control")}">OpenAI Fast</button>
            <button class="${chat.className("control")}">Compact context</button>
            <button class="${chat.className("control")}">Completion sound</button>
          </div>
        </section>
      </div>
    </div>
  </div>
</div>
<script>
const trigger = document.getElementById("trigger");
const menu = document.getElementById("menu");
function setOpen(open) {
  menu.hidden = !open;
  trigger.dataset.open = open ? "true" : "";
  trigger.setAttribute("aria-expanded", String(open));
}
trigger.addEventListener("click", () => setOpen(menu.hidden));
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || menu.hidden) return;
  event.preventDefault();
  setOpen(false);
  trigger.focus();
}, true);
menu.querySelector("[role=menuitemradio]").addEventListener("click", () => {
  setOpen(false);
  trigger.focus();
});
</script></body></html>`;
}

function assertRectStable(before, after, label) {
  for (const key of ["x", "y", "width", "height"]) {
    assert.ok(Math.abs(before[key] - after[key]) <= 0.5, `${label} ${key} moved from ${before[key]} to ${after[key]}`);
  }
}

test("phone profile replacement keeps run controls stable and reachable", async (context) => {
  const chrome = findChrome();
  if (!chrome) return context.skip("Chrome/Chromium is required for rendered profile layout assertions");

  const chat = compileModule("components/ChatInput.module.css");
  const profile = compileModule("components/ProfileSelector.module.css");
  const temp = mkdtempSync(path.join(os.tmpdir(), "pi-profile-layout-"));
  const fixture = path.join(temp, "fixture.html");
  writeFileSync(fixture, fixtureHtml(chat, profile));
  const cdp = await connectCdp(chrome, path.join(temp, "chrome"));

  try {
    for (const viewport of [
      { width: 390, height: 844, safeBottom: 34, name: "portrait safe area" },
      { width: 390, height: 520, safeBottom: 0, name: "keyboard-reduced portrait" },
      { width: 390, height: 520, safeBottom: 34, name: "keyboard-reduced safe area" },
      { width: 640, height: 360, safeBottom: 0, name: "short landscape boundary" },
      { width: 640, height: 844, safeBottom: 0, name: "phone boundary" },
      { width: 641, height: 844, safeBottom: 0, name: "anchored popover boundary" },
    ]) {
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: 1,
        mobile: true,
        screenWidth: viewport.width,
        screenHeight: viewport.height,
      });
      await cdp.send("Page.navigate", { url: `file://${fixture}` });
      await wait(50);
      await cdp.send("Runtime.evaluate", {
        expression: `document.documentElement.style.setProperty("--pi-safe-area-bottom", "${viewport.safeBottom}px")`,
      });
      const result = await cdp.send("Runtime.evaluate", {
        awaitPromise: true,
        returnByValue: true,
        expression: `(async () => {
          const panel = document.getElementById("panel");
          const controls = document.getElementById("controls");
          const execution = document.getElementById("execution");
          const trigger = document.getElementById("trigger");
          const menu = document.getElementById("menu");
          const readRect = (element) => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
          const scrollers = () => [...document.querySelectorAll("#panel, .body, #controls, #menu")].filter((element) => {
            const overflow = getComputedStyle(element).overflowY;
            return (overflow === "auto" || overflow === "scroll") && element.scrollHeight > element.clientHeight + 1;
          }).map((element) => element.id || "body");
          const before = { panel: readRect(panel), execution: readRect(execution) };
          trigger.click();
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const open = {
            panel: readRect(panel), execution: readRect(execution), controls: readRect(controls), menu: readRect(menu),
            menuClientHeight: menu.clientHeight, menuScrollHeight: menu.scrollHeight,
            menuPosition: getComputedStyle(menu).position, scrollers: scrollers(),
            horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
          };
          menu.scrollTop = menu.scrollHeight;
          await new Promise((resolve) => requestAnimationFrame(resolve));
          const options = menu.querySelectorAll("[role=menuitemradio]");
          const scrolled = {
            lastOption: readRect(options[options.length - 1]),
            manage: readRect(document.getElementById("manage")),
            menu: readRect(menu),
            scrollTop: menu.scrollTop,
          };
          document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
          const escapeFocus = document.activeElement.id;
          trigger.click();
          menu.querySelector("[role=menuitemradio]").click();
          const selectionFocus = document.activeElement.id;
          return { before, open, scrolled, escapeFocus, selectionFocus, viewport: { width: innerWidth, height: innerHeight } };
        })()`,
      });
      const value = result.result.value;
      assert.deepEqual(value.viewport, { width: viewport.width, height: viewport.height }, viewport.name);
      assertRectStable(value.before.panel, value.open.panel, `${viewport.name} panel`);
      assertRectStable(value.before.execution, value.open.execution, `${viewport.name} Execution`);
      assert.equal(value.escapeFocus, "trigger", `${viewport.name} Escape focus restoration`);
      assert.equal(value.selectionFocus, "trigger", `${viewport.name} selection focus restoration`);

      if (viewport.width <= 640) {
        assert.ok(value.open.menuClientHeight >= 100, `${viewport.name} must retain a usable profile viewport (got ${value.open.menuClientHeight}px)`);
        assert.ok(value.open.menuScrollHeight > value.open.menuClientHeight, `${viewport.name} long fixture must exercise profile scrolling`);
        assert.ok(value.scrolled.scrollTop > 0, `${viewport.name} profile menu must scroll to the end`);
        assert.deepEqual(value.open.scrollers, ["menu"], `${viewport.name} must have one vertical scroll owner while profiles are open`);
        assert.equal(value.open.menuPosition, "absolute");
        assert.ok(value.open.menu.y + value.open.menu.height <= value.open.execution.y + 0.5, `${viewport.name} profile menu must not cover Execution`);
        assert.ok(value.open.execution.y >= 0 && value.open.execution.y + value.open.execution.height <= viewport.height - viewport.safeBottom + 0.5, `${viewport.name} Execution must remain visible above the safe area`);
        assert.ok(value.scrolled.lastOption.y >= value.scrolled.menu.y - 0.5 && value.scrolled.lastOption.y + value.scrolled.lastOption.height <= value.scrolled.menu.y + value.scrolled.menu.height + 0.5, `${viewport.name} final profile must be reachable`);
        assert.ok(value.scrolled.manage.y >= value.scrolled.menu.y - 0.5 && value.scrolled.manage.y + value.scrolled.manage.height <= value.scrolled.menu.y + value.scrolled.menu.height + 0.5, `${viewport.name} Manage profiles must be reachable`);
        assert.ok(value.open.horizontalOverflow <= 0, `${viewport.name} must not overflow horizontally`);
      } else {
        assert.equal(value.open.menuPosition, "absolute");
        assert.ok(value.open.menu.width <= 340.5, "641px keeps the anchored desktop/compact popover width");
        assert.ok(Math.abs(value.open.menu.width - value.open.controls.width) > 1, "641px must not use the phone replacement view");
      }
    }
  } finally {
    await closeCdp(cdp);
    rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});
