import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { JSDOM } from "jsdom";
import { createElement } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";

const mockSources = new Map([
  ["next/navigation", `
    export function useRouter() { return { replace() {} }; }
    export function useSearchParams() { return new URLSearchParams(); }
  `],
  ["@/hooks/useTheme", `
    export function useTheme() { return { isDark: false, toggleTheme() {} }; }
  `],
  ["./SessionSidebar", `
    import { createElement, useEffect } from "react";
    const session = {
      id: "mounted-session", path: "/project/session.jsonl", cwd: "/project", projectRoot: "/project",
      created: "2026-07-11T00:00:00.000Z", modified: "2026-07-11T00:00:00.000Z", messageCount: 2,
      firstMessage: "Hydrated compact identity", name: "Hydrated compact identity with a long mounted title"
    };
    export function SessionSidebar(props) {
      useEffect(() => {
        props.onCwdChange("/project", "/project");
        props.onSelectSession(session, true);
        props.onInitialRestoreDone();
      }, []);
      return createElement("div", { "data-testid": "mounted-sidebar" });
    }
  `],
  ["./ChatWindow", `
    import { createElement, useEffect } from "react";
    const tree = [{
      entry: {
        type: "message", id: "mounted-entry", parentId: null, timestamp: "2026-07-11T00:00:00.000Z",
        message: { role: "user", content: "Mounted branch entry" }
      },
      children: []
    }];
    export function ChatWindow(props) {
      useEffect(() => props.onBranchDataChange(tree, "mounted-entry", () => {}), [props.onBranchDataChange]);
      return createElement("div", { "data-testid": "mounted-chat" });
    }
  `],
  ["./app-shell/InspectorFileSheet", "export function InspectorFileSheet() { return null; }"],
  ["./app-shell/SessionInfoPanel", "export function SessionInfoPanel() { return null; }"],
  ["./FileViewer", "export function FileViewer() { return null; }"],
  ["./GitChangesPanel", "export function GitChangesPanel() { return null; }"],
  ["./HotkeysModal", "export function HotkeysModal() { return null; }"],
  ["./ModelsConfig", "export function ModelsConfig() { return null; }"],
  ["./PluginsConfig", "export function PluginsConfig() { return null; }"],
  ["./ProjectTrustModal", "export function ProjectTrustModal() { return null; }"],
  ["./SettingsModal", "export function SettingsModal() { return null; }"],
  ["./SkillsConfig", "export function SkillsConfig() { return null; }"],
  ["./TabBar", "export function TabBar() { return null; }"],
  ["./TerminalPanel", "export function TerminalPanel() { return null; }"],
]);

const rootDirectory = process.cwd();
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (mockSources.has(specifier)) return { url: `mock:app-shell:${encodeURIComponent(specifier)}`, shortCircuit: true };
    if (specifier.startsWith("@/")) {
      return nextResolve(pathToFileURL(path.join(rootDirectory, specifier.slice(2))).href, context);
    }
    if (specifier.endsWith(".module.css")) {
      return { url: new URL(specifier, context.parentURL).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith("mock:app-shell:")) {
      const specifier = decodeURIComponent(url.slice("mock:app-shell:".length));
      return { format: "module", source: mockSources.get(specifier), shortCircuit: true };
    }
    if (url.endsWith(".module.css")) {
      return {
        format: "module",
        source: `export default new Proxy({}, { get: (_target, key) => key === "then" ? undefined : String(key) });`,
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});

const dom = new JSDOM("<!doctype html><html><head><title>Fixture</title></head><body><div id='root'></div></body></html>", {
  pretendToBeVisual: true,
  url: "http://localhost/",
});
const { window } = dom;
Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440, writable: true });
Object.defineProperty(window, "innerHeight", { configurable: true, value: 900, writable: true });
Object.defineProperty(window, "matchMedia", {
  configurable: true,
  value: (query) => ({
    matches: /max-width:\s*640px/.test(query) ? window.innerWidth <= 640 : /max-width:\s*1024px/.test(query) ? window.innerWidth <= 1024 : false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent() { return true; },
  }),
});
window.requestAnimationFrame = (callback) => window.setTimeout(() => callback(window.performance.now()), 0);
window.cancelAnimationFrame = (id) => window.clearTimeout(id);
window.HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
  if (this.classList.contains("center") || this.classList.contains("topBar")) {
    return new window.DOMRect(0, 0, 600, this.classList.contains("topBar") ? 48 : 700);
  }
  return new window.DOMRect(0, 0, 120, 44);
};
window.HTMLElement.prototype.getClientRects = function getClientRects() {
  const rect = this.getBoundingClientRect();
  return Object.assign([rect], { item: (index) => index === 0 ? rect : null });
};
class MountedResizeObserver {
  constructor(callback) { this.callback = callback; }
  observe(target) { this.callback([{ target }], this); }
  disconnect() {}
  unobserve() {}
}

Object.defineProperties(globalThis, {
  window: { configurable: true, value: window },
  document: { configurable: true, value: window.document },
  navigator: { configurable: true, value: window.navigator },
  Node: { configurable: true, value: window.Node },
  Element: { configurable: true, value: window.Element },
  HTMLElement: { configurable: true, value: window.HTMLElement },
  HTMLButtonElement: { configurable: true, value: window.HTMLButtonElement },
  KeyboardEvent: { configurable: true, value: window.KeyboardEvent },
  MouseEvent: { configurable: true, value: window.MouseEvent },
  MutationObserver: { configurable: true, value: window.MutationObserver },
  ResizeObserver: { configurable: true, value: MountedResizeObserver },
  getComputedStyle: { configurable: true, value: window.getComputedStyle.bind(window) },
  fetch: {
    configurable: true,
    value: async () => ({ ok: true, json: async () => ({ version: 1, displayName: "Mounted Pi" }) }),
  },
});

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const flush = async () => {
  await sleep(10);
  await sleep(10);
};
const buttonWithExactText = (root, label) => Array.from(root.querySelectorAll("button"))
  .find((button) => button.textContent.trim() === label) ?? null;

const hydrationErrors = [];
const originalConsoleError = console.error;
console.error = (...args) => hydrationErrors.push(args.map(String).join(" "));
let root;
try {
  const { AppShell } = await import("../components/AppShell");
  const container = window.document.getElementById("root");
  container.innerHTML = renderToString(createElement(AppShell));
  assert.equal(container.querySelector("header")?.getAttribute("data-chrome"), "desktop", "server snapshot must start in desktop density");

  root = hydrateRoot(container, createElement(AppShell));
  await flush();
  assert.equal(container.querySelector("header")?.getAttribute("data-chrome"), "compact", "measured center width must reconcile after hydration");
  assert.ok(container.textContent.includes("Hydrated compact identity with a long mounted title"), "hydrated session identity did not mount");

  const moreButton = buttonWithExactText(container, "More");
  assert.ok(moreButton, "mounted compact More action is missing");
  moreButton.click();
  await flush();

  const moreDialog = window.document.querySelector("[role='dialog']");
  assert.ok(moreDialog, "More did not open the mounted Workspace actions dialog");
  const sessionTreeButton = Array.from(moreDialog.querySelectorAll("button"))
    .find((button) => button.textContent.includes("Session tree"));
  assert.ok(sessionTreeButton && !sessionTreeButton.disabled, "Session tree action is unavailable in mounted More");
  sessionTreeButton.click();
  await flush();

  assert.equal(window.document.querySelector("[role='dialog']"), null, "More dialog stayed open after selecting Session tree");
  assert.ok(window.document.querySelector("section[aria-label='Session tree']"), "Session tree region did not mount from More");
  assert.equal(window.document.activeElement?.getAttribute("aria-label"), "Search conversation tree", "tree did not receive intentional focus");

  window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  await flush();
  assert.equal(window.document.querySelector("section[aria-label='Session tree']"), null, "Escape did not dismiss the mounted tree");
  assert.equal(window.document.activeElement, moreButton, "tree dismissal did not restore focus to More");
  assert.deepEqual(
    hydrationErrors.filter((message) => /hydration|did not match|server rendered/i.test(message)),
    [],
    `hydration warnings: ${hydrationErrors.join("\n")}`,
  );
} finally {
  root?.unmount();
  console.error = originalConsoleError;
  window.close();
}
