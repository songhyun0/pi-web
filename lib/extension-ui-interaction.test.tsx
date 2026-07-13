import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterEach, test } from "node:test";

import { JSDOM } from "jsdom";
import { type ReactNode, act as reactAct, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";

import type { ExtensionUiRequest } from "./types";

const require = createRequire(import.meta.url);
require.extensions[".css"] = (module) => {
  module.exports = new Proxy({}, {
    get: (_target, property) => property === "__esModule" ? false : String(property),
  });
};

const { ExtensionUiHost } = require("../components/ExtensionUiHost.tsx") as typeof import("../components/ExtensionUiHost");
const extensionStyles = readFileSync("components/ExtensionUiHost.module.css", "utf8");
const sharedPrimitives = readFileSync("components/ui/primitives.css", "utf8");
const designTokens = readFileSync("app/design-tokens.css", "utf8");

const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", {
  pretendToBeVisual: true,
  url: "http://localhost/",
});
const nativeGetComputedStyle = dom.window.getComputedStyle.bind(dom.window);

Object.defineProperties(globalThis, {
  window: { configurable: true, value: dom.window },
  document: { configurable: true, value: dom.window.document },
  navigator: { configurable: true, value: dom.window.navigator },
  Node: { configurable: true, value: dom.window.Node },
  Element: { configurable: true, value: dom.window.Element },
  HTMLElement: { configurable: true, value: dom.window.HTMLElement },
  HTMLButtonElement: { configurable: true, value: dom.window.HTMLButtonElement },
  HTMLInputElement: { configurable: true, value: dom.window.HTMLInputElement },
  HTMLTextAreaElement: { configurable: true, value: dom.window.HTMLTextAreaElement },
  KeyboardEvent: { configurable: true, value: dom.window.KeyboardEvent },
  MouseEvent: { configurable: true, value: dom.window.MouseEvent },
  InputEvent: { configurable: true, value: dom.window.InputEvent },
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

class MockResizeObserver {
  observe() {}
  disconnect() {}
  unobserve() {}
}
Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, value: MockResizeObserver });
Object.defineProperty(dom.window, "ResizeObserver", { configurable: true, value: MockResizeObserver });

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
});

interface MountedView {
  container: HTMLDivElement;
  root: Root;
}

const mountedViews: MountedView[] = [];

type DialogRequest = Extract<ExtensionUiRequest, { method: "select" | "confirm" | "input" | "editor" }>;
type CustomRequest = Extract<ExtensionUiRequest, { method: "custom" }>;
type DialogResponse = { value: string } | { confirmed: boolean } | { cancelled: true };

const noopCustomInput = () => {};
const noopCustomResize = () => {};

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
  return view;
}

async function render(view: MountedView, ui: ReactNode): Promise<void> {
  await act(async () => view.root.render(ui));
  await flushAnimationFrames();
}

async function dispose(view: MountedView): Promise<void> {
  const index = mountedViews.indexOf(view);
  if (index >= 0) mountedViews.splice(index, 1);
  await act(async () => view.root.unmount());
  view.container.remove();
}

async function pressKey(target: EventTarget, key: string, options: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean } = {}): Promise<KeyboardEvent> {
  const event = new dom.window.KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key,
    ...options,
  });
  await act(async () => { target.dispatchEvent(event); });
  await flushAnimationFrames();
  return event;
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => { element.click(); });
  await flushAnimationFrames();
}

async function setControlValue(control: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> {
  const prototype = control instanceof dom.window.HTMLTextAreaElement
    ? dom.window.HTMLTextAreaElement.prototype
    : dom.window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  assert.ok(setter, "missing native value setter");
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  try {
    await reactAct(async () => {
      setter.call(control, value);
      const propsKey = Object.keys(control).find((key) => key.startsWith("__reactProps$"));
      assert.ok(propsKey, "missing mounted React control props");
      const props = (control as unknown as Record<string, { onChange?: (event: { target: typeof control; currentTarget: typeof control }) => void }>)[propsKey];
      assert.equal(typeof props.onChange, "function");
      props.onChange?.({ target: control, currentTarget: control });
    });
  } finally {
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: false });
  }
  await flushAnimationFrames();
}

function host(
  dialog: DialogRequest | null,
  customUi: CustomRequest | null = null,
  onRespond: (request: DialogRequest, response: DialogResponse) => void = () => {},
  onCustomInput: (request: CustomRequest, data: string) => void = noopCustomInput,
) {
  return (
    <ExtensionUiHost
      dialog={dialog}
      customUi={customUi}
      onRespond={onRespond}
      onCustomInput={onCustomInput}
      onCustomResize={noopCustomResize}
    />
  );
}

function currentDialog(): HTMLElement {
  const panel = document.querySelector<HTMLElement>("[role='dialog']");
  assert.ok(panel, "missing rendered dialog");
  return panel;
}

function buttonNamed(root: ParentNode, name: string): HTMLButtonElement {
  const button = Array.from(root.querySelectorAll<HTMLButtonElement>("button"))
    .find((candidate) => candidate.textContent?.trim() === name);
  assert.ok(button, `missing button named ${name}`);
  return button;
}

function assertAccessibleName(panel: HTMLElement, title: string, description: string): void {
  const titleId = panel.getAttribute("aria-labelledby");
  const descriptionId = panel.getAttribute("aria-describedby");
  assert.ok(titleId);
  assert.ok(descriptionId);
  assert.equal(document.getElementById(titleId)?.textContent, title);
  assert.equal(document.getElementById(descriptionId)?.textContent, description);
  assert.equal(panel.getAttribute("aria-modal"), "true");
}

function focusedOpener(label: string): HTMLButtonElement {
  const opener = document.createElement("button");
  opener.textContent = label;
  document.body.append(opener);
  opener.focus();
  return opener;
}

function parseToken(block: string, name: string): string {
  const match = block.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "i"));
  assert.ok(match, `missing ${name} token`);
  return match[1];
}

function parseRgb(value: string): [number, number, number] {
  const match = value.match(/rgba?\(\s*(\d+)[, ]+\s*(\d+)[, ]+\s*(\d+)/);
  assert.ok(match, `expected computed rgb color, received ${value}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function contrastRatio(foreground: [number, number, number], background: [number, number, number]): number {
  const luminance = ([red, green, blue]: [number, number, number]) => {
    const channels = [red, green, blue].map((channel) => {
      const srgb = channel / 255;
      return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const first = luminance(foreground);
  const second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

afterEach(async () => {
  while (mountedViews.length > 0) {
    const view = mountedViews.pop();
    if (!view) continue;
    await act(async () => view.root.unmount());
    view.container.remove();
  }
  animationFrames.clear();
  document.body.replaceChildren();
  document.head.replaceChildren();
  document.body.style.overflow = "";
  document.documentElement.className = "";
  visualViewport.set({ offsetTop: 0, offsetLeft: 0, width: 1024, height: 768 });
});

test("every standard extension request renders an accessible name and purposeful initial focus", async (context) => {
  const cases: Array<{
    name: string;
    request: DialogRequest;
    expectedFocus: (panel: HTMLElement) => HTMLElement | null;
  }> = [
    {
      name: "confirm",
      request: { type: "extension_ui_request", id: "confirm-1", method: "confirm", title: "Confirm change", message: "Continue?" },
      expectedFocus: (panel) => buttonNamed(panel, "Cancel"),
    },
    {
      name: "populated select",
      request: { type: "extension_ui_request", id: "select-1", method: "select", title: "Choose profile", options: ["Alpha", "Beta"] },
      expectedFocus: (panel) => buttonNamed(panel, "Alpha"),
    },
    {
      name: "empty select",
      request: { type: "extension_ui_request", id: "select-empty", method: "select", title: "Choose profile", options: [] },
      expectedFocus: (panel) => buttonNamed(panel, "Cancel"),
    },
    {
      name: "input",
      request: { type: "extension_ui_request", id: "input-1", method: "input", title: "Enter value", placeholder: "Value" },
      expectedFocus: (panel) => panel.querySelector("input"),
    },
    {
      name: "editor",
      request: { type: "extension_ui_request", id: "editor-1", method: "editor", title: "Edit value", prefill: "seed" },
      expectedFocus: (panel) => panel.querySelector("textarea"),
    },
  ];

  for (const testCase of cases) {
    await context.test(testCase.name, async () => {
      const view = await mount(host(testCase.request));
      const panel = currentDialog();
      assertAccessibleName(panel, testCase.request.title, "Extension request");
      assert.equal(document.activeElement, testCase.expectedFocus(panel));
      await dispose(view);
      document.body.replaceChildren();
      document.body.style.overflow = "";
    });
  }
});

test("request ID transitions remount controls with fresh state and focus", async () => {
  const first: DialogRequest = {
    type: "extension_ui_request",
    id: "input-first",
    method: "input",
    title: "First request",
    placeholder: "First",
  };
  const second: DialogRequest = {
    type: "extension_ui_request",
    id: "input-second",
    method: "input",
    title: "Second request",
    placeholder: "Second",
  };

  const view = await mount(host(first));
  const firstInput = currentDialog().querySelector<HTMLInputElement>("input");
  assert.ok(firstInput);
  firstInput.value = "stale value";

  await render(view, host(second));

  const panel = currentDialog();
  const secondInput = panel.querySelector<HTMLInputElement>("input");
  assert.ok(secondInput);
  assert.notEqual(secondInput, firstInput);
  assert.equal(firstInput.isConnected, false);
  assert.equal(secondInput.value, "");
  assert.equal(document.activeElement, secondInput);
  assertAccessibleName(panel, "Second request", "Extension request");
});

test("standard dialogs wrap forward and reverse Tab at their rendered boundaries", async () => {
  const request: DialogRequest = {
    type: "extension_ui_request",
    id: "select-tabs",
    method: "select",
    title: "Pick one",
    options: ["Alpha", "Beta"],
  };
  await mount(host(request));
  const panel = currentDialog();
  const close = panel.querySelector<HTMLButtonElement>("button[aria-label='Cancel Pick one']");
  const cancel = buttonNamed(panel, "Cancel");
  assert.ok(close);

  cancel.focus();
  const forward = await pressKey(document, "Tab");
  assert.equal(forward.defaultPrevented, true);
  assert.equal(document.activeElement, close);

  const reverse = await pressKey(document, "Tab", { shiftKey: true });
  assert.equal(reverse.defaultPrevented, true);
  assert.equal(document.activeElement, cancel);
});

test("Escape cancels once, removes the modal, and restores its opener", async () => {
  const request: DialogRequest = {
    type: "extension_ui_request",
    id: "confirm-escape",
    method: "confirm",
    title: "Close safely",
    message: "Cancel this request?",
  };
  const responses: DialogResponse[] = [];

  function Harness() {
    const [current, setCurrent] = useState<DialogRequest | null>(request);
    return host(current, null, (_request, response) => {
      responses.push(response);
      setCurrent(null);
    });
  }

  const opener = focusedOpener("Open extension request");
  await mount(<Harness />);
  assert.equal(document.body.style.overflow, "hidden");

  await pressKey(document, "Escape");

  assert.deepEqual(responses, [{ cancelled: true }]);
  assert.equal(document.querySelector("[role='dialog']"), null);
  assert.equal(document.activeElement, opener);
  assert.equal(document.body.style.overflow, "");
});

test("the topmost custom dialog alone consumes Escape before the standard request", async () => {
  const dialog: DialogRequest = {
    type: "extension_ui_request",
    id: "confirm-under-terminal",
    method: "confirm",
    title: "Underlying request",
    message: "Keep open",
  };
  const custom: CustomRequest = {
    type: "extension_ui_request",
    id: "terminal-topmost",
    method: "custom",
    lines: ["interactive"],
  };
  const responses: DialogResponse[] = [];
  const terminalData: string[] = [];
  const view = await mount(host(
    dialog,
    custom,
    (_request, response) => responses.push(response),
    (_request, data) => terminalData.push(data),
  ));

  assert.equal(document.querySelectorAll("[role='dialog']").length, 2);
  await pressKey(document, "Escape");
  assert.deepEqual(terminalData, ["\x1b"]);
  assert.equal(responses.length, 0);
  assert.equal(document.querySelectorAll("[role='dialog']").length, 2);

  await render(view, host(dialog, null, (_request, response) => responses.push(response)));
  await pressKey(document, "Escape");
  assert.deepEqual(responses, [{ cancelled: true }]);
});

test("custom terminal exposes focus-within and F6 routes while retaining terminal Tab and Escape", async () => {
  const request: CustomRequest = {
    type: "extension_ui_request",
    id: "terminal-keys",
    method: "custom",
    lines: ["ready"],
  };
  const terminalData: string[] = [];
  await mount(host(null, request, () => {}, (_request, data) => terminalData.push(data)));

  const panel = currentDialog();
  assertAccessibleName(
    panel,
    "Extension panel",
    "Interactive terminal. Escape and Tab are sent to the terminal; press F6 to move focus to Close.",
  );
  const shell = panel.querySelector<HTMLElement>(".terminalShell");
  const input = panel.querySelector<HTMLTextAreaElement>("textarea[aria-label='Extension terminal input']");
  const close = buttonNamed(panel, "Close");
  assert.ok(shell);
  assert.ok(input);
  assert.equal(document.activeElement, input);
  assert.equal(shell.contains(document.activeElement), true);
  assert.match(extensionStyles, /\.terminalShell:focus-within\s*\{[\s\S]*?box-shadow:\s*inset 0 0 0 2px var\(--focus-ring\)/);

  await pressKey(input, "F6");
  assert.equal(document.activeElement, close);
  await pressKey(close, "F6");
  assert.equal(document.activeElement, input);

  const tab = await pressKey(input, "Tab");
  assert.equal(tab.defaultPrevented, true);
  assert.equal(document.activeElement, input);
  const escapeEvent = await pressKey(input, "Escape");
  assert.equal(escapeEvent.defaultPrevented, true);
  assert.equal(document.activeElement, input);
  assert.deepEqual(terminalData, ["\t", "\x1b"]);

  await click(close);
  assert.deepEqual(terminalData, ["\t", "\x1b", "\x03"]);
});

test("body portal blocks the background, follows visualViewport, and keeps 44px controls reachable", async () => {
  visualViewport.set({ offsetTop: 12, offsetLeft: 4, width: 320, height: 360 });
  const request: DialogRequest = {
    type: "extension_ui_request",
    id: "mobile-confirm",
    method: "confirm",
    title: "Mobile confirmation",
    message: "Confirm on a short viewport",
  };
  const view = await mount(host(request));
  const overlay = document.querySelector<HTMLElement>(".pi-dialog");
  const panel = currentDialog();
  assert.ok(overlay);
  assert.equal(overlay.parentElement, document.body);
  assert.equal(view.container.contains(overlay), false);
  assert.equal(document.body.style.overflow, "hidden");
  assert.equal(panel.getAttribute("aria-modal"), "true");
  assert.equal(overlay.style.getPropertyValue("--pi-dialog-viewport-top"), "12px");
  assert.equal(overlay.style.getPropertyValue("--pi-dialog-viewport-left"), "4px");
  assert.equal(overlay.style.getPropertyValue("--pi-dialog-viewport-width"), "320px");
  assert.equal(overlay.style.getPropertyValue("--pi-dialog-viewport-height"), "360px");

  const focusedAction = document.activeElement;
  await act(async () => {
    visualViewport.set({ offsetTop: 148, offsetLeft: 0, width: 320, height: 212 });
  });
  assert.equal(overlay.style.getPropertyValue("--pi-dialog-viewport-top"), "148px");
  assert.equal(overlay.style.getPropertyValue("--pi-dialog-viewport-left"), "0px");
  assert.equal(overlay.style.getPropertyValue("--pi-dialog-viewport-height"), "212px");
  assert.equal(document.activeElement, focusedAction);
  assert.equal(buttonNamed(panel, "Confirm").isConnected, true);

  const touchValue = designTokens.match(/--control-touch:\s*(\d+)px/)?.[1];
  assert.equal(touchValue, "44");
  assert.match(sharedPrimitives, /@media \(pointer: coarse\), \(max-width: 640px\)[\s\S]*?\.pi-button\[data-size="compact"\] \{ min-height: var\(--control-touch\); \}/);
  const mobileStyle = document.createElement("style");
  mobileStyle.textContent = `
    .pi-dialog .pi-button { min-height: ${touchValue}px; }
    .pi-dialog .pi-icon-button { width: ${touchValue}px; min-width: ${touchValue}px; height: ${touchValue}px; min-height: ${touchValue}px; }
    .pi-dialog__panel { max-height: calc(360px - 20px - 34px - 16px); }
  `;
  document.head.append(mobileStyle);

  for (const button of panel.querySelectorAll<HTMLButtonElement>(".pi-button")) {
    assert.ok(Number.parseFloat(getComputedStyle(button).minHeight) >= 44);
  }
  const close = panel.querySelector<HTMLElement>(".pi-icon-button");
  assert.ok(close);
  assert.ok(Number.parseFloat(getComputedStyle(close).width) >= 44);
  assert.ok(Number.parseFloat(getComputedStyle(close).height) >= 44);
  assert.equal(getComputedStyle(panel).maxHeight, "calc(290px)");
});

test("rendered primary actions retain computed AA contrast in light and dark themes", async () => {
  const request: DialogRequest = {
    type: "extension_ui_request",
    id: "contrast-confirm",
    method: "confirm",
    title: "Contrast",
    message: "Check primary action",
  };
  await mount(host(request));
  const primary = currentDialog().querySelector<HTMLButtonElement>(".pi-button[data-variant='primary']");
  assert.ok(primary);

  const lightBlock = designTokens.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1];
  const darkBlock = designTokens.match(/html\.dark\s*\{([\s\S]*?)\n\}/)?.[1];
  assert.ok(lightBlock);
  assert.ok(darkBlock);
  const lightAccent = parseToken(lightBlock, "accent");
  const lightContrast = parseToken(lightBlock, "accent-contrast");
  const darkAccent = parseToken(darkBlock, "accent");
  const darkContrast = parseToken(darkBlock, "accent-contrast");
  assert.match(sharedPrimitives, /\.pi-button\[data-variant="primary"\] \{ color: var\(--accent-contrast\); background: var\(--accent\)/);

  const style = document.createElement("style");
  style.textContent = `
    html:not(.dark) .pi-button[data-variant="primary"] { color: ${lightContrast}; background-color: ${lightAccent}; }
    html.dark .pi-button[data-variant="primary"] { color: ${darkContrast}; background-color: ${darkAccent}; }
  `;
  document.head.append(style);

  for (const theme of ["light", "dark"] as const) {
    document.documentElement.className = theme === "dark" ? "dark" : "";
    const computed = getComputedStyle(primary);
    const ratio = contrastRatio(parseRgb(computed.color), parseRgb(computed.backgroundColor));
    assert.ok(ratio >= 4.5, `${theme} primary contrast ${ratio.toFixed(2)}:1 is below AA`);
  }
});

test("select, confirm, input, and editor submit the values produced by mounted controls", async (context) => {
  const cases: Array<{
    name: string;
    request: DialogRequest;
    interact: (panel: HTMLElement) => Promise<void>;
    expected: DialogResponse;
  }> = [
    {
      name: "select option",
      request: { type: "extension_ui_request", id: "submit-select", method: "select", title: "Select target", options: ["Alpha", "Beta value"] },
      interact: async (panel) => click(buttonNamed(panel, "Beta value")),
      expected: { value: "Beta value" },
    },
    {
      name: "confirm action",
      request: { type: "extension_ui_request", id: "submit-confirm", method: "confirm", title: "Confirm target", message: "Proceed?" },
      interact: async (panel) => click(buttonNamed(panel, "Confirm")),
      expected: { confirmed: true },
    },
    {
      name: "input value",
      request: { type: "extension_ui_request", id: "submit-input", method: "input", title: "Input target", placeholder: "Type a value" },
      interact: async (panel) => {
        const input = panel.querySelector<HTMLInputElement>("input");
        assert.ok(input);
        await setControlValue(input, "typed response");
        await pressKey(input, "Enter");
      },
      expected: { value: "typed response" },
    },
    {
      name: "editor value",
      request: { type: "extension_ui_request", id: "submit-editor", method: "editor", title: "Editor target", prefill: "seed" },
      interact: async (panel) => {
        const editor = panel.querySelector<HTMLTextAreaElement>("textarea");
        assert.ok(editor);
        assert.equal(editor.value, "seed");
        await setControlValue(editor, "edited\nresponse");
        await pressKey(editor, "Enter", { ctrlKey: true });
      },
      expected: { value: "edited\nresponse" },
    },
  ];

  for (const testCase of cases) {
    await context.test(testCase.name, async () => {
      const responses: Array<{ requestId: string; response: DialogResponse }> = [];
      const view = await mount(host(testCase.request, null, (request, response) => {
        responses.push({ requestId: request.id, response });
      }));

      await testCase.interact(currentDialog());
      assert.deepEqual(responses, [{ requestId: testCase.request.id, response: testCase.expected }]);

      await dispose(view);
      document.body.replaceChildren();
      document.body.style.overflow = "";
    });
  }
});
