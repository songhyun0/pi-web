import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, afterEach, test } from "node:test";

import { JSDOM } from "jsdom";
import { type ReactNode, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";

const require = createRequire(import.meta.url);
require.extensions[".css"] = (module) => {
  module.exports = new Proxy({}, {
    get: (_target, property) => property === "__esModule" ? false : String(property),
  });
};

const { DirectoryPickerModal } = require("../components/DirectoryPickerModal.tsx") as typeof import("../components/DirectoryPickerModal");

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "http://localhost/",
});

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
}
Object.defineProperty(dom.window, "visualViewport", { configurable: true, value: new MockVisualViewport() });

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

const visibleRect = new dom.window.DOMRect(0, 0, 120, 44);
const visibleRectList = Object.assign([visibleRect], { item: () => visibleRect }) as unknown as DOMRectList;
dom.window.HTMLElement.prototype.getClientRects = () => visibleRectList;
Object.assign(dom.window.HTMLElement.prototype, {
  attachEvent() {},
  detachEvent() {},
  scrollIntoView() {},
});

interface MountedView {
  container: HTMLDivElement;
  root: Root;
}

interface BrowseResult {
  cwd?: string;
  parent?: string | null;
  entries?: Array<{ name: string; path: string; modified: string }>;
  error?: string;
}

const mountedViews: MountedView[] = [];
let fetchCalls: string[] = [];
let fetchQueue: Array<() => Promise<{ ok: boolean; status: number; json: () => Promise<BrowseResult> }>> = [];

function response(data: BrowseResult, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  };
}

function deferredResponse() {
  let resolve!: (value: ReturnType<typeof response>) => void;
  const promise = new Promise<ReturnType<typeof response>>((next) => { resolve = next; });
  return { promise, resolve };
}

Object.defineProperty(globalThis, "fetch", {
  configurable: true,
  value: async (input: string | URL | Request) => {
    fetchCalls.push(String(input));
    const next = fetchQueue.shift();
    assert.ok(next, `unexpected fetch for ${String(input)}`);
    return next();
  },
});

async function act(callback: () => void | Promise<void>): Promise<void> {
  let pending!: void | Promise<void>;
  flushSync(() => { pending = callback(); });
  await pending;
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  flushSync(() => {});
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  flushSync(() => {});
}

async function flushAnimationFrames(): Promise<void> {
  await act(async () => {
    const pending = Array.from(animationFrames.values());
    animationFrames.clear();
    for (const callback of pending) callback(dom.window.performance.now());
  });
}

async function mount(ui: ReactNode): Promise<MountedView> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const view = { container, root };
  mountedViews.push(view);
  await act(async () => root.render(ui));
  await flushAnimationFrames();
  await flushAnimationFrames();
  return view;
}

async function render(view: MountedView, ui: ReactNode): Promise<void> {
  await act(async () => view.root.render(ui));
  await flushAnimationFrames();
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => { element.click(); });
  await flushAnimationFrames();
}

async function pressEscape(): Promise<void> {
  await act(async () => {
    document.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Escape",
    }));
  });
  await flushAnimationFrames();
}

function buttonNamed(name: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
    .find((candidate) => candidate.textContent?.trim() === name);
  assert.ok(button, `missing button named ${name}`);
  return button;
}

function buttonContaining(text: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
    .find((candidate) => candidate.textContent?.includes(text));
  assert.ok(button, `missing button containing ${text}`);
  return button;
}

function focusedOpener(label: string): HTMLButtonElement {
  const opener = document.createElement("button");
  opener.textContent = label;
  document.body.append(opener);
  opener.focus();
  return opener;
}

function picker(props: Partial<React.ComponentProps<typeof DirectoryPickerModal>> = {}) {
  return (
    <DirectoryPickerModal
      initialPath="/workspace"
      homeDir="/home/tester"
      onClose={() => {}}
      onSelect={() => {}}
      {...props}
    />
  );
}

after(() => {
  dom.window.close();
});

afterEach(async () => {
  while (mountedViews.length > 0) {
    const view = mountedViews.pop();
    if (!view) continue;
    await act(async () => view.root.unmount());
    view.container.remove();
  }
  animationFrames.clear();
  fetchCalls = [];
  fetchQueue = [];
  document.body.replaceChildren();
  document.body.style.overflow = "";
});

test("mounted directory picker covers loading, success, navigation, empty, and selection states", { timeout: 5_000 }, async () => {
  const initial = deferredResponse();
  fetchQueue.push(() => initial.promise);
  let selectedPath: string | null = null;

  await mount(picker({ onSelect: async (path) => { selectedPath = path; } }));

  const panel = document.querySelector<HTMLElement>("[role='dialog']");
  const list = document.querySelector<HTMLElement>("section[aria-busy='true']");
  assert.ok(panel);
  assert.ok(list);
  assert.equal(panel.getAttribute("aria-modal"), "true");
  assert.equal(document.activeElement === panel, true);
  assert.equal(document.body.style.overflow, "hidden");
  assert.match(document.body.textContent ?? "", /Loading directories…/);
  assert.equal(buttonNamed("Select this folder").disabled, true);
  assert.deepEqual(fetchCalls, ["/api/cwd/browse?cwd=%2Fworkspace"]);

  await act(async () => {
    initial.resolve(response({
      cwd: "/workspace",
      parent: "/",
      entries: [{ name: "project", path: "/workspace/project", modified: "2026-07-11T00:00:00.000Z" }],
    }));
  });

  assert.equal(document.querySelector("section[aria-busy='true']"), null);
  assert.ok(buttonContaining("Parent directory"));
  assert.ok(buttonContaining("project"));
  assert.equal(buttonNamed("Select this folder").disabled, false);

  fetchQueue.push(async () => response({ cwd: "/workspace/project", parent: "/workspace", entries: [] }));
  await click(buttonContaining("project"));
  assert.equal(fetchCalls.at(-1), "/api/cwd/browse?cwd=%2Fworkspace%2Fproject");
  assert.match(document.body.textContent ?? "", /No subdirectories/);
  assert.match(document.body.textContent ?? "", /Selected: \/workspace\/project/);

  await click(buttonNamed("Select this folder"));
  assert.equal(selectedPath, "/workspace/project");
});

test("mounted directory picker renders browse failures and external busy errors without losing actions", { timeout: 5_000 }, async () => {
  fetchQueue.push(async () => response({ error: "Permission denied" }, 403));
  const view = await mount(picker());

  const browseAlert = document.querySelector<HTMLElement>("[role='alert']");
  assert.ok(browseAlert);
  assert.equal(browseAlert.textContent, "Permission denied");
  assert.equal(buttonNamed("Select this folder").disabled, false);

  fetchQueue.push(async () => response({ cwd: "/workspace", parent: "/", entries: [] }));
  await render(view, picker({ busy: true, error: "Workspace validation failed" }));

  const status = document.querySelector<HTMLElement>("[data-error='true'][aria-live='polite']");
  assert.ok(status);
  assert.equal(status.textContent, "Workspace validation failed");
  assert.equal(buttonNamed("Checking…").disabled, true);
});

test("directory Cancel, backdrop, and Escape each close once and restore the opener", { timeout: 15_000 }, async (context) => {
  for (const dismissal of ["Cancel", "backdrop", "Escape"] as const) {
    await context.test(dismissal, async () => {
      fetchQueue.push(async () => response({ cwd: "/workspace", parent: "/", entries: [] }));
      const closeEvents: string[] = [];

      function Harness() {
        const [open, setOpen] = useState(true);
        return open ? picker({ onClose: () => { closeEvents.push(dismissal); setOpen(false); } }) : null;
      }

      const opener = focusedOpener(`Open picker for ${dismissal}`);
      const view = await mount(<Harness />);

      if (dismissal === "Cancel") await click(buttonNamed("Cancel"));
      else if (dismissal === "Escape") await pressEscape();
      else {
        const overlay = document.querySelector<HTMLElement>(".pi-dialog");
        assert.ok(overlay);
        await act(async () => {
          overlay.dispatchEvent(new dom.window.MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
        });
        await flushAnimationFrames();
      }

      assert.deepEqual(closeEvents, [dismissal]);
      assert.equal(document.querySelector("[role='dialog']"), null);
      assert.equal(document.activeElement === opener, true);
      assert.equal(document.body.style.overflow, "");

      const index = mountedViews.indexOf(view);
      if (index >= 0) mountedViews.splice(index, 1);
      await act(async () => view.root.unmount());
      view.container.remove();
      document.body.replaceChildren();
    });
  }
});
