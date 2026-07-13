import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { constants as fsConstants, readFileSync } from "node:fs";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, test } from "node:test";

import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { createRef, type ReactNode, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import WebSocket from "ws";

import { ForkSelectorModal, SessionTreeSelectorModal } from "../components/SessionCommandModals";
import { Dialog } from "../components/ui/Dialog";
import type { SessionTreeNode } from "./types";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "http://localhost/",
});
const nativeGetComputedStyle = dom.window.getComputedStyle.bind(dom.window);
const sharedPrimitives = readFileSync("components/ui/primitives.css", "utf8");
const designTokens = readFileSync("app/design-tokens.css", "utf8");
const globalStyles = readFileSync("app/globals.css", "utf8");

function cssBlockContents(source: string, marker: string): string {
  const markerIndex = source.indexOf(marker);
  assert.notEqual(markerIndex, -1, `missing CSS block ${marker}`);
  const openIndex = source.indexOf("{", markerIndex);
  assert.notEqual(openIndex, -1, `missing opening brace for ${marker}`);
  let depth = 1;
  for (let index = openIndex + 1; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(openIndex + 1, index);
  }
  throw new Error(`missing closing brace for ${marker}`);
}

function computedPixels(element: Element, property: "height" | "min-height" | "width"): number {
  const computed = getComputedStyle(element);
  const value = computed.getPropertyValue(property).trim();
  const variable = value.match(/^var\((--[^)]+)\)$/)?.[1];
  return Number.parseFloat(variable ? computed.getPropertyValue(variable) : value);
}

interface CdpMessage {
  id?: number;
  result?: unknown;
  error?: { message: string };
}

interface CdpClient {
  close: () => void;
  send: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
}

const sleep = (milliseconds: number) => new Promise<void>((resolveSleep) => setTimeout(resolveSleep, milliseconds));

async function findChrome(): Promise<string | null> {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {}
  }
  return null;
}

async function waitForValue<T>(readValue: () => Promise<T | null | undefined | false>, label: string): Promise<T> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const value = await readValue();
      if (value) return value;
    } catch {}
    await sleep(50);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function openCdp(webSocketUrl: string): Promise<CdpClient> {
  const socket = new WebSocket(webSocketUrl);
  await new Promise<void>((resolveOpen, rejectOpen) => {
    socket.once("open", resolveOpen);
    socket.once("error", rejectOpen);
  });

  let nextId = 0;
  const pending = new Map<number, (message: CdpMessage) => void>();
  socket.on("message", (data) => {
    const message = JSON.parse(data.toString()) as CdpMessage;
    if (message.id === undefined) return;
    const resolveMessage = pending.get(message.id);
    if (!resolveMessage) return;
    pending.delete(message.id);
    resolveMessage(message);
  });

  return {
    close: () => socket.close(),
    send(method, params = {}) {
      return new Promise<unknown>((resolveSend, rejectSend) => {
        const id = ++nextId;
        pending.set(id, (message) => {
          if (message.error) rejectSend(new Error(`${method}: ${message.error.message}`));
          else resolveSend(message.result);
        });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
  };
}

async function evaluate<T>(cdp: CdpClient, expression: string): Promise<T> {
  const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true }) as {
    result: { value: T };
    exceptionDetails?: { text: string };
  };
  if (result.exceptionDetails) throw new Error(`Browser evaluation failed: ${result.exceptionDetails.text}`);
  return result.result.value;
}

async function dispatchKey(cdp: CdpClient, key: string, code = key): Promise<void> {
  const virtualKeyCode = key === "Enter" ? 13 : key === "Tab" ? 9 : key === "Escape" ? 27 : key === "ArrowDown" ? 40 : 0;
  const event = {
    key,
    code,
    windowsVirtualKeyCode: virtualKeyCode,
    nativeVirtualKeyCode: virtualKeyCode,
  };
  await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...event });
  if (key === "Enter") {
    await cdp.send("Input.dispatchKeyEvent", { type: "char", text: "\r", unmodifiedText: "\r", ...event });
  }
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...event });
}

async function stopChrome(chrome: ChildProcess): Promise<void> {
  if (chrome.exitCode !== null) return;
  chrome.kill("SIGKILL");
  await Promise.race([
    new Promise<void>((resolveExit) => chrome.once("exit", () => resolveExit())),
    sleep(2000),
  ]);
}

async function buildMobileGateFixture(directory: string): Promise<string> {
  const entryPath = join(directory, "fixture.tsx");
  const bundlePath = join(directory, "fixture.js");
  const htmlPath = join(directory, "fixture.html");
  const dialogImport = resolve("components/ui/Dialog.tsx");
  const fieldImport = resolve("components/ui/Field.tsx");

  await writeFile(entryPath, `
    import { useState } from "react";
    import { createRoot } from "react-dom/client";
    import { Dialog } from ${JSON.stringify(dialogImport)};
    import { Select } from ${JSON.stringify(fieldImport)};

    const counters = { dialogAction: 0, dialogSubmit: 0, selectChanges: 0 };
    (window as Window & { __gateCounters?: typeof counters; __fixtureReady?: boolean }).__gateCounters = counters;

    function Fixture() {
      const [open, setOpen] = useState(false);
      const [value, setValue] = useState("auto");
      return <>
        <button id="opener" type="button" onClick={() => setOpen(true)}>Open mobile dialog</button>
        <div className="select-grid">
          <label htmlFor="select-default">Reasoning</label>
          <Select id="select-default" value={value} onChange={(event) => { counters.selectChanges += 1; setValue(event.target.value); }}>
            <option value="auto">Auto</option>
            <option value="balanced">Balanced</option>
          </Select>
          <label htmlFor="select-invalid">Invalid select</label>
          <Select id="select-invalid" aria-invalid="true" defaultValue="invalid"><option value="invalid">Invalid</option></Select>
          <label htmlFor="select-disabled">Disabled select</label>
          <Select id="select-disabled" disabled defaultValue="disabled"><option value="disabled">Disabled</option></Select>
        </div>
        <Dialog open={open} onOpenChange={setOpen} title="Mobile focus gate" description="Static focus prevents an unsolicited text keyboard." variant="sheet">
          <form onSubmit={(event) => { event.preventDefault(); counters.dialogSubmit += 1; }}>
            <input id="dialog-text" aria-label="Dialog text" />
            <button id="dialog-action" type="submit" onClick={() => { counters.dialogAction += 1; }}>Continue</button>
          </form>
        </Dialog>
      </>;
    }

    createRoot(document.getElementById("root")!).render(<Fixture />);
    requestAnimationFrame(() => { (window as Window & { __fixtureReady?: boolean }).__fixtureReady = true; });
  `);

  await build({
    entryPoints: [entryPath],
    outfile: bundlePath,
    bundle: true,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": "\"production\"" },
    nodePaths: [resolve("node_modules")],
    logLevel: "silent",
  });

  await writeFile(htmlPath, `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>
${designTokens}
${sharedPrimitives}
* { box-sizing: border-box; }
html, body { margin: 0; min-height: 1800px; background: var(--bg); color: var(--text); font-family: sans-serif; }
body { padding: 16px; }
.select-grid { width: min(100%, 420px); display: grid; gap: 8px; margin-top: 16px; }
</style></head><body><div id="root"></div><script src="./fixture.js"></script></body></html>`);
  return htmlPath;
}

Object.defineProperties(globalThis, {
  window: { configurable: true, value: dom.window },
  document: { configurable: true, value: dom.window.document },
  navigator: { configurable: true, value: dom.window.navigator },
  Node: { configurable: true, value: dom.window.Node },
  Element: { configurable: true, value: dom.window.Element },
  HTMLElement: { configurable: true, value: dom.window.HTMLElement },
  HTMLButtonElement: { configurable: true, value: dom.window.HTMLButtonElement },
  KeyboardEvent: { configurable: true, value: dom.window.KeyboardEvent },
  MouseEvent: { configurable: true, value: dom.window.MouseEvent },
  getComputedStyle: { configurable: true, value: nativeGetComputedStyle },
});
Object.defineProperty(dom.window, "getComputedStyle", {
  configurable: true,
  value: (element: Element) => {
    const style = element instanceof dom.window.HTMLElement ? element.style : null;
    return {
      display: style?.display || "block",
      visibility: style?.visibility || "visible",
      opacity: style?.opacity || "1",
    } as CSSStyleDeclaration;
  },
});

class MockVisualViewport extends dom.window.EventTarget {
  offsetTop = 0;
  offsetLeft = 0;
  width = 1024;
  height = 768;
  pageTop = 0;
  pageLeft = 0;
  scale = 1;

  set(rect: { offsetTop?: number; offsetLeft?: number; width?: number; height?: number }) {
    Object.assign(this, rect);
    this.dispatchEvent(new dom.window.Event("resize"));
  }
}
const visualViewport = new MockVisualViewport();
Object.defineProperty(dom.window, "visualViewport", { configurable: true, value: visualViewport });

async function act(callback: () => void | Promise<void>): Promise<void> {
  let pending!: void | Promise<void>;
  flushSync(() => { pending = callback(); });
  await pending;
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  flushSync(() => {});
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  flushSync(() => {});
}

let nextFrameId = 1;
const animationFrames = new Map<number, FrameRequestCallback>();
dom.window.requestAnimationFrame = (callback: FrameRequestCallback) => {
  const id = nextFrameId;
  nextFrameId += 1;
  animationFrames.set(id, callback);
  return id;
};
dom.window.cancelAnimationFrame = (id: number) => {
  animationFrames.delete(id);
};

const visibleRect = new dom.window.DOMRect(0, 0, 120, 40);
const emptyRectList = Object.assign([], { item: () => null }) as unknown as DOMRectList;
const visibleRectList = Object.assign([visibleRect], { item: () => visibleRect }) as unknown as DOMRectList;
dom.window.HTMLElement.prototype.getClientRects = function getClientRects() {
  return this.hasAttribute("data-no-rect") ? emptyRectList : visibleRectList;
};

Object.assign(dom.window.HTMLElement.prototype, {
  attachEvent() {},
  detachEvent() {},
});

const nativeFocus = dom.window.HTMLElement.prototype.focus;
const focusCalls: Array<{ element: HTMLElement; options?: FocusOptions }> = [];
dom.window.HTMLElement.prototype.focus = function focus(options?: FocusOptions) {
  focusCalls.push({ element: this, options });
  nativeFocus.call(this, options);
};

interface MountedView {
  container: HTMLDivElement;
  root: Root;
}

const mountedViews: MountedView[] = [];

async function flushAnimationFrames(): Promise<void> {
  await act(async () => {
    const pending = Array.from(animationFrames.values());
    animationFrames.clear();
    for (const callback of pending) callback(dom.window.performance.now());
  });
}

async function mount(ui: ReactNode, flushFocus = true): Promise<MountedView> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const view = { container, root };
  mountedViews.push(view);
  await act(async () => root.render(ui));
  if (flushFocus) await flushAnimationFrames();
  return view;
}

async function render(view: MountedView, ui: ReactNode, flushFocus = true): Promise<void> {
  await act(async () => view.root.render(ui));
  if (flushFocus) await flushAnimationFrames();
}

function dialogPanels(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[role='dialog']"));
}

function buttonNamed(name: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
    .find((candidate) => candidate.textContent?.trim() === name);
  assert.ok(button, `missing button named ${name}`);
  return button;
}

async function pressKey(key: string, shiftKey = false): Promise<KeyboardEvent> {
  const event = new dom.window.KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key,
    shiftKey,
  });
  await act(async () => {
    document.dispatchEvent(event);
  });
  await flushAnimationFrames();
  return event;
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => { element.click(); });
  await flushAnimationFrames();
}

function assertAccessibleName(panel: HTMLElement, title: string, description: string): void {
  const titleId = panel.getAttribute("aria-labelledby");
  const descriptionId = panel.getAttribute("aria-describedby");
  assert.ok(titleId);
  assert.ok(descriptionId);
  assert.equal(document.getElementById(titleId)?.textContent, title);
  assert.equal(document.getElementById(descriptionId)?.textContent, description);
}

const treeFixture: SessionTreeNode[] = [{
  entry: {
    type: "message",
    id: "user-entry",
    parentId: null,
    timestamp: "2026-07-11T00:00:00.000Z",
    message: { role: "user", content: "Fork or navigate from here" },
  },
  children: [],
}];

function focusedOpener(label: string): HTMLButtonElement {
  const opener = document.createElement("button");
  opener.textContent = label;
  document.body.append(opener);
  opener.focus();
  return opener;
}

function TreeHarness({ onSelect = async () => {} }: { onSelect?: (entryId: string) => void | Promise<void> }) {
  const [open, setOpen] = useState(true);
  return open ? (
    <SessionTreeSelectorModal
      tree={treeFixture}
      activeLeafId="user-entry"
      onClose={() => setOpen(false)}
      onSelect={onSelect}
    />
  ) : null;
}

function ForkHarness({ onFork = async () => {} }: { onFork?: (entryId: string) => void | Promise<void> }) {
  const [open, setOpen] = useState(true);
  return open ? (
    <ForkSelectorModal
      onClose={() => setOpen(false)}
      onLoadCandidates={async () => [{ entryId: "user-entry", text: "Fork or navigate from here" }]}
      onFork={onFork}
    />
  ) : null;
}

afterEach(async () => {
  while (mountedViews.length > 0) {
    const view = mountedViews.pop();
    if (!view) continue;
    await act(async () => view.root.unmount());
    view.container.remove();
  }
  animationFrames.clear();
  focusCalls.length = 0;
  document.body.replaceChildren();
  document.head.replaceChildren();
  document.body.style.overflow = "";
  document.documentElement.scrollTop = 0;
  visualViewport.set({ offsetTop: 0, offsetLeft: 0, width: 1024, height: 768 });
});

test("a conditionally mounted open dialog binds and follows visualViewport after its portal exists", async () => {
  function ConditionalDialog() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>Open viewport dialog</button>
        {open && (
          <Dialog
            open
            onOpenChange={setOpen}
            title="Viewport dialog"
            initialFocus="first-tabbable"
            footer={<button type="button">Footer action</button>}
          >
            <input aria-label="Viewport field" />
            <div style={{ height: 1200 }}>Long content</div>
          </Dialog>
        )}
      </>
    );
  }

  visualViewport.set({ offsetTop: 12, offsetLeft: 4, width: 390, height: 620 });
  await mount(<ConditionalDialog />);
  await click(buttonNamed("Open viewport dialog"));

  const overlay = document.querySelector<HTMLElement>(".pi-dialog");
  const field = document.querySelector<HTMLInputElement>("input[aria-label='Viewport field']");
  const footerAction = buttonNamed("Footer action");
  assert.ok(overlay);
  assert.ok(field);
  assert.equal(overlay.style.getPropertyValue("--pi-dialog-viewport-top"), "12px");
  assert.equal(overlay.style.getPropertyValue("--pi-dialog-viewport-left"), "4px");
  assert.equal(overlay.style.getPropertyValue("--pi-dialog-viewport-width"), "390px");
  assert.equal(overlay.style.getPropertyValue("--pi-dialog-viewport-height"), "620px");
  assert.equal(document.activeElement, field);

  await act(async () => {
    visualViewport.set({ offsetTop: 176, offsetLeft: 0, width: 390, height: 304 });
  });

  assert.equal(overlay.style.getPropertyValue("--pi-dialog-viewport-top"), "176px");
  assert.equal(overlay.style.getPropertyValue("--pi-dialog-viewport-height"), "304px");
  assert.equal(document.activeElement, field);
  assert.equal(field.closest("[role='dialog']"), footerAction.closest("[role='dialog']"));
  assert.equal(footerAction.isConnected, true);
});

test("the mobile-safe default focuses the panel without activating text or actions", async () => {
  let clicks = 0;
  let submissions = 0;

  visualViewport.set({ offsetTop: 0, offsetLeft: 0, width: 390, height: 844 });
  await mount(
    <Dialog open onOpenChange={() => {}} title="Static mobile focus" variant="sheet">
      <form onSubmit={(event) => { event.preventDefault(); submissions += 1; }}>
        <input aria-label="Optional mobile text" />
        <button type="submit" onClick={() => { clicks += 1; }}>Continue</button>
      </form>
    </Dialog>,
  );

  const panel = dialogPanels()[0];
  const text = document.querySelector<HTMLInputElement>("input[aria-label='Optional mobile text']");
  assert.ok(panel);
  assert.ok(text);
  assert.equal(document.activeElement, panel);
  assert.notEqual(document.activeElement, text);
  assert.equal(clicks, 0);
  assert.equal(submissions, 0);
  assert.deepEqual(focusCalls.at(-1)?.options, { preventScroll: true });

  visualViewport.set({ offsetTop: 420, height: 424 });
  assert.equal(document.activeElement, panel, "visual viewport reduction must not redirect focus to a text control");
  assert.equal(clicks, 0);
  assert.equal(submissions, 0);
});

test("Chromium phone emulation covers dialog focus/restoration and native Select closed presentation", async (context) => {
  const chromePath = await findChrome();
  if (!chromePath) {
    context.skip("Chrome/Chromium is unavailable; set CHROME_PATH to run deterministic phone-emulation gates");
    return;
  }

  assert.match(globalStyles, /@supports \(-webkit-touch-callout: none\)[\s\S]*select\s*\{[\s\S]*font-size:\s*16px\s*!important/, "iOS anti-zoom select rule is missing");
  assert.match(sharedPrimitives, /\.pi-select:focus-visible[\s\S]*background:\s*var\(--bg-hover\)/, "native Select focus must use the approved background-only treatment");
  for (const path of ["components/ChatInput.tsx", "components/SettingsModal.tsx", "components/models-config/ProviderEditor.tsx"]) {
    assert.match(readFileSync(path, "utf8"), /<Select\b/, `${path} must use the shared native Select`);
  }

  const tempDirectory = await mkdtemp(join(tmpdir(), "pi-dialog-mobile-gates-"));
  const profileDirectory = join(tempDirectory, "profile");
  const fixturePath = await buildMobileGateFixture(tempDirectory);
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
  let cdp: CdpClient | undefined;

  try {
    const port = await waitForValue(async () => {
      const contents = await readFile(join(profileDirectory, "DevToolsActivePort"), "utf8");
      return contents.trim().split("\n")[0];
    }, "Chrome DevTools port");
    const target = await waitForValue(async () => {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as Array<{ type: string; url: string; webSocketDebuggerUrl: string }>;
      return targets.find((candidate) => candidate.type === "page" && candidate.url.startsWith("file:"));
    }, "mobile dialog fixture target");
    cdp = await openCdp(target.webSocketDebuggerUrl);

    const setPhoneViewport = async (width: number, height: number, deviceScaleFactor: number) => {
      await cdp?.send("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        screenWidth: width,
        screenHeight: height,
        deviceScaleFactor,
        mobile: true,
      });
      await cdp?.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    };

    await setPhoneViewport(390, 844, 3);
    await cdp.send("Page.reload", { ignoreCache: true });
    await waitForValue(async () => evaluate<boolean>(cdp as CdpClient, "document.readyState === 'complete' && window.__fixtureReady === true"), "mobile fixture render");

    await evaluate(cdp, "document.getElementById('opener').focus(); document.documentElement.scrollTop = 120; true");
    await dispatchKey(cdp, "Enter");
    await waitForValue(
      async () => evaluate<boolean>(cdp as CdpClient, `(() => {
        const panel = document.querySelector('[role=dialog]');
        return document.activeElement === panel && panel.matches(':focus-visible');
      })()`),
      "documented requestAnimationFrame focus entry",
    );

    const opened = await evaluate<{
      activeId: string;
      activeRole: string | null;
      focusVisible: boolean;
      panelOutlineWidth: string;
      dialogAction: number;
      dialogSubmit: number;
      scrollTop: number;
      innerHeight: number;
      viewportHeight: number;
      overlayHeight: string;
      coarse: boolean;
    }>(cdp, `(() => {
      const active = document.activeElement;
      const panel = document.querySelector('[role=dialog]');
      const overlay = document.querySelector('.pi-dialog');
      return {
        activeId: active?.id ?? '',
        activeRole: active?.getAttribute('role') ?? null,
        focusVisible: panel.matches(':focus-visible'),
        panelOutlineWidth: getComputedStyle(panel).outlineWidth,
        dialogAction: window.__gateCounters.dialogAction,
        dialogSubmit: window.__gateCounters.dialogSubmit,
        scrollTop: document.documentElement.scrollTop,
        innerHeight,
        viewportHeight: visualViewport.height,
        overlayHeight: overlay.style.getPropertyValue('--pi-dialog-viewport-height'),
        coarse: matchMedia('(pointer: coarse)').matches,
      };
    })()`);

    assert.equal(opened.activeRole, "dialog");
    assert.equal(opened.activeId, "", "the default policy must not focus the text input");
    assert.equal(opened.focusVisible, true, "keyboard-opened panel must remain the focus target");
    assert.equal(opened.panelOutlineWidth, "0px", "the dialog panel must not paint a panel-wide focus outline");
    assert.equal(opened.dialogAction, 0, "focus entry must not click the dialog action");
    assert.equal(opened.dialogSubmit, 0, "focus entry must not submit the dialog form");
    assert.equal(opened.scrollTop, 120, "preventScroll must preserve the document position");
    assert.equal(opened.coarse, true);
    assert.ok(Math.abs(opened.viewportHeight - 844) <= 1, JSON.stringify(opened));
    assert.equal(opened.overlayHeight, `${opened.viewportHeight}px`);

    await setPhoneViewport(390, 420, 3);
    await waitForValue(async () => evaluate<boolean>(cdp as CdpClient, "document.querySelector('.pi-dialog')?.style.getPropertyValue('--pi-dialog-viewport-height') === `${visualViewport.height}px`"), "reduced visual viewport propagation");
    const reduced = await evaluate<{ activeRole: string | null; viewportHeight: number; overlayHeight: string; dialogAction: number; dialogSubmit: number }>(cdp, `(() => ({
      activeRole: document.activeElement?.getAttribute('role') ?? null,
      viewportHeight: visualViewport.height,
      overlayHeight: document.querySelector('.pi-dialog').style.getPropertyValue('--pi-dialog-viewport-height'),
      dialogAction: window.__gateCounters.dialogAction,
      dialogSubmit: window.__gateCounters.dialogSubmit,
    }))()`);
    assert.equal(reduced.activeRole, "dialog");
    assert.ok(Math.abs(reduced.viewportHeight - 420) <= 1, JSON.stringify(reduced));
    assert.equal(reduced.overlayHeight, `${reduced.viewportHeight}px`);
    assert.equal(reduced.dialogAction, 0);
    assert.equal(reduced.dialogSubmit, 0);

    await dispatchKey(cdp, "Escape");
    await waitForValue(async () => evaluate<boolean>(cdp as CdpClient, "!document.querySelector('[role=dialog]')"), "dialog dismissal");
    const restored = await evaluate<{ activeId: string; scrollTop: number; overflow: string }>(cdp, `({
      activeId: document.activeElement?.id ?? '',
      scrollTop: document.documentElement.scrollTop,
      overflow: document.body.style.overflow,
    })`);
    assert.equal(restored.activeId, "opener");
    assert.equal(restored.scrollTop, 120);
    assert.equal(restored.overflow, "");

    await evaluate(cdp, "document.documentElement.scrollTop = 0; document.getElementById('opener').focus(); true");
    await dispatchKey(cdp, "Tab");
    const keyboardFocus = await evaluate<{ activeId: string; outlineWidth: string }>(cdp, `(() => {
      const active = document.activeElement;
      const style = getComputedStyle(active);
      return { activeId: active.id, outlineWidth: style.outlineWidth };
    })()`);
    assert.equal(keyboardFocus.activeId, "select-default");
    assert.equal(keyboardFocus.outlineWidth, "0px");

    await dispatchKey(cdp, "ArrowDown");
    await waitForValue(async () => evaluate<boolean>(cdp as CdpClient, "document.getElementById('select-default').value === 'balanced'"), "native keyboard Select change");
    assert.equal(await evaluate<number>(cdp, "window.__gateCounters.selectChanges"), 1);

    const presentations: Array<{
      label: string;
      theme: string;
      width: number;
      coarse: boolean;
      appearance: string;
      webkitAppearance: string;
      selectHeight: number;
      selectWidth: number;
      shellWidth: number;
      indicatorCount: number;
      indicatorPointerEvents: string;
      indicatorInside: boolean;
      paddingInlineEnd: number;
      disabledOpacity: number;
      invalidIndicatorColor: string;
      errorColor: string;
      selectedValue: string;
      optionCount: number;
      overflowX: number;
      backgroundColor: string;
    }> = [];
    for (const device of [
      { label: "390x844 touch", width: 390, height: 844, scale: 3 },
      { label: "412x915 touch", width: 412, height: 915, scale: 2.625 },
    ]) {
      await setPhoneViewport(device.width, device.height, device.scale);
      for (const theme of ["light", "dark"]) {
        presentations.push(await evaluate(cdp, `(() => {
          document.documentElement.classList.toggle('dark', ${JSON.stringify(theme === "dark")});
          const select = document.getElementById('select-default');
          const shell = select.parentElement;
          const indicator = shell.querySelector('.pi-select__indicator');
          const disabledIndicator = document.querySelector('#select-disabled + .pi-select__indicator');
          const invalidIndicator = document.querySelector('#select-invalid + .pi-select__indicator');
          const selectRect = select.getBoundingClientRect();
          const shellRect = shell.getBoundingClientRect();
          const indicatorRect = indicator.getBoundingClientRect();
          const style = getComputedStyle(select);
          const errorProbe = document.createElement('span');
          errorProbe.style.color = 'var(--error)';
          document.body.append(errorProbe);
          const errorColor = getComputedStyle(errorProbe).color;
          errorProbe.remove();
          return {
            label: ${JSON.stringify(device.label)},
            theme: ${JSON.stringify(theme)},
            width: innerWidth,
            coarse: matchMedia('(pointer: coarse)').matches,
            appearance: style.appearance,
            webkitAppearance: style.webkitAppearance,
            selectHeight: selectRect.height,
            selectWidth: selectRect.width,
            shellWidth: shellRect.width,
            indicatorCount: shell.querySelectorAll('.pi-select__indicator').length,
            indicatorPointerEvents: getComputedStyle(indicator).pointerEvents,
            indicatorInside: indicatorRect.left >= selectRect.left && indicatorRect.right <= selectRect.right,
            paddingInlineEnd: parseFloat(style.paddingInlineEnd),
            disabledOpacity: parseFloat(getComputedStyle(disabledIndicator).opacity),
            invalidIndicatorColor: getComputedStyle(invalidIndicator).color,
            errorColor,
            selectedValue: select.value,
            optionCount: select.options.length,
            overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            backgroundColor: style.backgroundColor,
          };
        })()`));
      }
    }

    for (const presentation of presentations) {
      assert.equal(presentation.width, Number.parseInt(presentation.label, 10), JSON.stringify(presentation));
      assert.equal(presentation.coarse, true, JSON.stringify(presentation));
      assert.equal(presentation.appearance, "none", JSON.stringify(presentation));
      assert.equal(presentation.webkitAppearance, "none", JSON.stringify(presentation));
      assert.ok(presentation.selectHeight >= 44, JSON.stringify(presentation));
      assert.equal(presentation.selectWidth, presentation.shellWidth, JSON.stringify(presentation));
      assert.equal(presentation.indicatorCount, 1, JSON.stringify(presentation));
      assert.equal(presentation.indicatorPointerEvents, "none", JSON.stringify(presentation));
      assert.equal(presentation.indicatorInside, true, JSON.stringify(presentation));
      assert.ok(presentation.paddingInlineEnd >= 32, JSON.stringify(presentation));
      assert.ok(presentation.disabledOpacity > 0 && presentation.disabledOpacity < 1, JSON.stringify(presentation));
      assert.equal(presentation.invalidIndicatorColor, presentation.errorColor, JSON.stringify(presentation));
      assert.equal(presentation.selectedValue, "balanced", JSON.stringify(presentation));
      assert.equal(presentation.optionCount, 2, JSON.stringify(presentation));
      assert.ok(presentation.overflowX <= 0, JSON.stringify(presentation));
    }
    assert.notEqual(presentations[0].invalidIndicatorColor, presentations[1].invalidIndicatorColor, "light/dark Select states must resolve distinct theme tokens");
  } finally {
    cdp?.close();
    await stopChrome(chrome);
    await rm(tempDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("rendered compact session actions compute to the 44px touch target", async () => {
  const touchRules = cssBlockContents(sharedPrimitives, "@media (pointer: coarse), (max-width: 640px)");
  const style = document.createElement("style");
  style.textContent = `${designTokens}\n${sharedPrimitives}\n${touchRules}`;
  document.head.append(style);

  await mount(
    <SessionTreeSelectorModal
      tree={treeFixture}
      activeLeafId="user-entry"
      onClose={() => {}}
      onSelect={() => {}}
      onLabelChange={async () => {}}
    />,
  );

  const compactButtons = Array.from(document.querySelectorAll<HTMLElement>(".pi-button[data-size='compact']"));
  const compactIconButtons = Array.from(document.querySelectorAll<HTMLElement>(".pi-icon-button[data-size='compact']"));
  assert.ok(compactButtons.length >= 2, "expected rendered Fold all and Unfold all compact buttons");
  assert.ok(compactIconButtons.length >= 2, "expected rendered compact close and row icon buttons");
  for (const button of compactButtons) {
    assert.ok(computedPixels(button, "min-height") >= 44, `${button.textContent?.trim()} is below 44px`);
  }
  for (const button of compactIconButtons) {
    assert.ok(computedPixels(button, "width") >= 44, `${button.getAttribute("aria-label")} width is below 44px`);
    assert.ok(computedPixels(button, "height") >= 44, `${button.getAttribute("aria-label")} height is below 44px`);
  }
});

test("valid explicit focus preserves scroll and never activates the target action", async () => {
  const targetRef = createRef<HTMLButtonElement>();
  let clicks = 0;
  let submissions = 0;

  const view = await mount(
    <Dialog
      open
      onOpenChange={() => {}}
      title="Explicit focus"
      hideClose
      initialFocusRef={targetRef}
    >
      <form onSubmit={(event) => { event.preventDefault(); submissions += 1; }}>
        <button ref={targetRef} type="submit" onClick={() => { clicks += 1; }}>Continue</button>
      </form>
    </Dialog>,
    false,
  );

  const dialogBody = document.querySelector<HTMLElement>(".pi-dialog__body");
  assert.ok(dialogBody);
  document.documentElement.scrollTop = 180;
  dialogBody.scrollTop = 96;

  await flushAnimationFrames();

  assert.equal(document.activeElement, targetRef.current);
  assert.equal(clicks, 0);
  assert.equal(submissions, 0);
  assert.equal(document.documentElement.scrollTop, 180);
  assert.equal(dialogBody.scrollTop, 96);
  assert.deepEqual(focusCalls.at(-1)?.options, { preventScroll: true });

  await render(view, <Dialog open={false} onOpenChange={() => {}} title="Explicit focus">{null}</Dialog>);
});

test("invalid explicit refs fall back to the first validated body candidate", async (context) => {
  const cases: Array<{ name: string; target: HTMLElement }> = [
    { name: "disconnected", target: document.createElement("button") },
    { name: "outside panel", target: document.body.appendChild(document.createElement("button")) },
  ];

  for (const testCase of cases) {
    await context.test(testCase.name, async () => {
      const fallbackRef = createRef<HTMLButtonElement>();
      const view = await mount(
        <Dialog
          open
          onOpenChange={() => {}}
          title="Invalid explicit ref"
          hideClose
          initialFocus="first-tabbable"
          initialFocusRef={{ current: testCase.target }}
        >
          <button ref={fallbackRef} type="button">Fallback</button>
        </Dialog>,
      );

      assert.equal(document.activeElement, fallbackRef.current);
      await render(view, <Dialog open={false} onOpenChange={() => {}} title="Invalid explicit ref">{null}</Dialog>);
      const index = mountedViews.indexOf(view);
      if (index >= 0) mountedViews.splice(index, 1);
      await act(async () => view.root.unmount());
      view.container.remove();
    });
  }
});

test("first-tabbable policy skips hidden, disabled, inert, non-rendered, and roving-off candidates", async () => {
  const activeRovingRef = createRef<HTMLButtonElement>();

  await mount(
    <Dialog open onOpenChange={() => {}} title="Candidate filtering" hideClose initialFocus="first-tabbable">
      <button type="button" hidden>Hidden</button>
      <button type="button" disabled>Disabled</button>
      <button type="button" aria-disabled="true">ARIA disabled</button>
      <div hidden><button type="button">Hidden ancestor</button></div>
      <div ref={(element) => element?.setAttribute("inert", "")}><button type="button">Inert ancestor</button></div>
      <div aria-hidden="true"><button type="button">ARIA hidden ancestor</button></div>
      <button type="button" style={{ display: "none" }}>Display none</button>
      <button type="button" style={{ visibility: "hidden" }}>Visibility hidden</button>
      <button type="button" style={{ opacity: 0 }}>Transparent</button>
      <button type="button" data-no-rect>No client rect</button>
      <button type="button" tabIndex={-1}>Inactive roving item</button>
      <button ref={activeRovingRef} type="button" tabIndex={0}>Active roving item</button>
    </Dialog>,
  );

  assert.equal(document.activeElement, activeRovingRef.current);
  assert.deepEqual(focusCalls.at(-1)?.options, { preventScroll: true });
});

test("a control-free dialog focuses its panel and contains Tab in both directions", async () => {
  await mount(
    <Dialog open onOpenChange={() => {}} title="Static notice" hideClose>
      <p>Nothing actionable.</p>
    </Dialog>,
  );

  const panel = dialogPanels()[0];
  assert.equal(document.activeElement, panel);

  const forward = await pressKey("Tab");
  assert.equal(forward.defaultPrevented, true);
  assert.equal(document.activeElement, panel);

  const backward = await pressKey("Tab", true);
  assert.equal(backward.defaultPrevented, true);
  assert.equal(document.activeElement, panel);
});

test("Tab wrapping respects the active roving tabindex and excludes tabindex minus one", async () => {
  const activeRovingRef = createRef<HTMLButtonElement>();
  const lastRef = createRef<HTMLButtonElement>();

  await mount(
    <Dialog
      open
      onOpenChange={() => {}}
      title="Roving focus"
      hideClose
      initialFocus="first-tabbable"
      footer={<button ref={lastRef} type="button">Done</button>}
    >
      <button type="button" tabIndex={-1}>Inactive option</button>
      <button ref={activeRovingRef} type="button" tabIndex={0}>Active option</button>
    </Dialog>,
  );

  assert.equal(document.activeElement, activeRovingRef.current);
  lastRef.current?.focus();
  const forward = await pressKey("Tab");
  assert.equal(forward.defaultPrevented, true);
  assert.equal(document.activeElement, activeRovingRef.current);

  activeRovingRef.current?.focus();
  const backward = await pressKey("Tab", true);
  assert.equal(backward.defaultPrevented, true);
  assert.equal(document.activeElement, lastRef.current);
});

test("nested dialogs give Tab and Escape to the topmost dialog and restore each opener", async () => {
  function NestedDialogs() {
    const [parentOpen, setParentOpen] = useState(true);
    const [childOpen, setChildOpen] = useState(false);
    return (
      <Dialog
        open={parentOpen}
        onOpenChange={setParentOpen}
        title="Parent"
        hideClose
        initialFocus="first-tabbable"
      >
        <button type="button" onClick={() => setChildOpen(true)}>Open child</button>
        <Dialog
          open={childOpen}
          onOpenChange={setChildOpen}
          title="Child"
          hideClose
        >
          <p>Child content</p>
        </Dialog>
      </Dialog>
    );
  }

  const externalOpener = document.createElement("button");
  externalOpener.textContent = "External opener";
  document.body.append(externalOpener);
  externalOpener.focus();

  await mount(<NestedDialogs />);
  const childOpener = buttonNamed("Open child");
  assert.equal(document.activeElement, childOpener);
  assert.equal(document.body.style.overflow, "hidden");

  await act(async () => childOpener.click());
  await flushAnimationFrames();
  assert.equal(dialogPanels().length, 2);
  const childPanel = dialogPanels()[1];
  assert.equal(document.activeElement, childPanel);

  const trappedTab = await pressKey("Tab");
  assert.equal(trappedTab.defaultPrevented, true);
  assert.equal(document.activeElement, childPanel);

  await pressKey("Escape");
  assert.equal(dialogPanels().length, 1);
  assert.equal(document.activeElement, childOpener);
  assert.equal(document.body.style.overflow, "hidden");

  await pressKey("Escape");
  assert.equal(dialogPanels().length, 0);
  assert.equal(document.activeElement, externalOpener);
  assert.equal(document.body.style.overflow, "");
});

test("closing does not attempt to restore a disconnected opener", async () => {
  const opener = document.createElement("button");
  document.body.append(opener);
  opener.focus();

  const view = await mount(
    <Dialog open onOpenChange={() => {}} title="Detached opener" hideClose>
      <p>Content</p>
    </Dialog>,
  );
  const callsBeforeClose = focusCalls.length;
  opener.remove();

  await render(view, <Dialog open={false} onOpenChange={() => {}} title="Detached opener">{null}</Dialog>);

  assert.equal(focusCalls.length, callsBeforeClose);
  assert.notEqual(document.activeElement, opener);
});

test("both session selectors render accessible names and focus their search fields", async () => {
  const view = await mount(
    <SessionTreeSelectorModal
      tree={treeFixture}
      activeLeafId="user-entry"
      onClose={() => {}}
      onSelect={() => {}}
    />,
  );

  let panel = dialogPanels()[0];
  assert.ok(panel);
  assertAccessibleName(
    panel,
    "Navigate session tree",
    "Arrow keys move · Page keys jump · Left/Right fold · L labels · Enter navigates",
  );
  assert.equal(document.activeElement, panel.querySelector("input[aria-label='Search session tree']"));
  const treeClose = panel.querySelector<HTMLButtonElement>("button[aria-label='Close session tree']");
  const navigate = buttonNamed("Navigate");
  assert.ok(treeClose);
  navigate.focus();
  assert.equal((await pressKey("Tab")).defaultPrevented, true);
  assert.equal(document.activeElement, treeClose);
  assert.equal((await pressKey("Tab", true)).defaultPrevented, true);
  assert.equal(document.activeElement, navigate);

  await render(
    view,
    <ForkSelectorModal
      onClose={() => {}}
      onLoadCandidates={async () => [{ entryId: "user-entry", text: "Fork or navigate from here" }]}
      onFork={() => {}}
    />,
  );

  panel = dialogPanels()[0];
  assert.ok(panel);
  assertAccessibleName(
    panel,
    "Fork from user message",
    "Choose a user message to restore in the new session editor. Arrow keys move; Enter forks.",
  );
  assert.equal(document.activeElement, panel.querySelector("input[aria-label='Filter user messages']"));
  const forkClose = panel.querySelector<HTMLButtonElement>("button[aria-label='Close fork selector']");
  const fork = buttonNamed("Fork");
  assert.ok(forkClose);
  fork.focus();
  assert.equal((await pressKey("Tab")).defaultPrevented, true);
  assert.equal(document.activeElement, forkClose);
  assert.equal((await pressKey("Tab", true)).defaultPrevented, true);
  assert.equal(document.activeElement, fork);
});

test("session tree close button restores its opener", async () => {
  const opener = focusedOpener("Open tree");
  await mount(<TreeHarness />);

  const close = document.querySelector<HTMLButtonElement>("button[aria-label='Close session tree']");
  assert.ok(close);
  await click(close);

  assert.equal(dialogPanels().length, 0);
  assert.equal(document.activeElement, opener);
});

test("session tree backdrop restores its opener", async () => {
  const opener = focusedOpener("Open tree");
  await mount(<TreeHarness />);

  const overlay = document.querySelector<HTMLElement>(".pi-dialog");
  assert.ok(overlay);
  await act(async () => {
    overlay.dispatchEvent(new dom.window.MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
  });
  await flushAnimationFrames();

  assert.equal(dialogPanels().length, 0);
  assert.equal(document.activeElement, opener);
});

test("session tree successful navigation restores its opener", async () => {
  const opener = focusedOpener("Open tree");
  let selectedEntryId: string | null = null;
  await mount(<TreeHarness onSelect={async (entryId) => { selectedEntryId = entryId; }} />);

  await click(buttonNamed("Navigate"));

  assert.equal(selectedEntryId, "user-entry");
  assert.equal(dialogPanels().length, 0);
  assert.equal(document.activeElement, opener);
});

test("fork selector Cancel and Escape each restore their opener", async (context) => {
  for (const dismissal of ["Cancel", "Escape"] as const) {
    await context.test(dismissal, async () => {
      const opener = focusedOpener(`Open fork for ${dismissal}`);
      const view = await mount(<ForkHarness />);

      if (dismissal === "Cancel") await click(buttonNamed("Cancel"));
      else await pressKey("Escape");

      assert.equal(dialogPanels().length, 0);
      assert.equal(document.activeElement, opener);

      const index = mountedViews.indexOf(view);
      if (index >= 0) mountedViews.splice(index, 1);
      await act(async () => view.root.unmount());
      view.container.remove();
      document.body.replaceChildren();
    });
  }
});

test("fork selector successful action restores its connected opener", async () => {
  const opener = focusedOpener("Open fork");
  let forkedEntryId: string | null = null;
  await mount(<ForkHarness onFork={async (entryId) => { forkedEntryId = entryId; }} />);

  await click(buttonNamed("Fork"));

  assert.equal(forkedEntryId, "user-entry");
  assert.equal(dialogPanels().length, 0);
  assert.equal(document.activeElement, opener);
});
