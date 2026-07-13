import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

const rootDirectory = process.cwd();

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return nextResolve(pathToFileURL(path.join(rootDirectory, specifier.slice(2))).href, context);
    }
    if (specifier.endsWith(".module.css")) {
      return { url: new URL(specifier, context.parentURL).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith(".module.css")) {
      return {
        format: "module",
        source: "export default new Proxy({}, { get: (_target, key) => String(key) });",
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});

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
  MouseEvent: { configurable: true, value: dom.window.MouseEvent },
  KeyboardEvent: { configurable: true, value: dom.window.KeyboardEvent },
  IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
});

const baseProps = {
  profiles: [],
  mode: "new" as const,
  displayName: "Use global default",
  onSelectProfile: () => {},
  onOpenManager: () => {},
};

test("profile errors remain live while the selector and diagnostics are closed", async () => {
  const { ProfileSelector } = await import("../components/ProfileSelector");
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  try {
    await act(async () => root.render(createElement(ProfileSelector, baseProps)));
    const trigger = container.querySelector<HTMLButtonElement>("button[aria-haspopup='menu']");
    assert.ok(trigger);
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    assert.equal(container.querySelector("[role='menu']"), null);
    assert.equal(container.querySelector("details"), null);
    assert.equal(container.querySelector("[role='alert']"), null);

    await act(async () => root.render(createElement(ProfileSelector, {
      ...baseProps,
      error: "Profile could not be applied.",
    })));

    const runtimeAlert = container.querySelector<HTMLElement>("[role='alert']");
    assert.ok(runtimeAlert);
    assert.equal(runtimeAlert.textContent, "Profile error: Profile could not be applied.");
    assert.equal(runtimeAlert.getAttribute("aria-atomic"), "true");
    assert.equal(runtimeAlert.closest("details"), null);
    assert.equal(container.querySelector("[role='menu']"), null);
    assert.equal(container.querySelector("details"), null);

    await act(async () => root.render(createElement(ProfileSelector, {
      ...baseProps,
      diagnostics: [{ type: "error", message: "Configured extension is unavailable." }],
    })));

    const diagnosticAlert = container.querySelector<HTMLElement>("[role='alert']");
    assert.ok(diagnosticAlert);
    assert.equal(diagnosticAlert.textContent, "Profile error: Configured extension is unavailable.");
    assert.equal(diagnosticAlert.closest("details"), null);
    assert.equal(container.querySelector("[role='menu']"), null);

    await act(async () => trigger.click());
    const details = container.querySelector<HTMLDetailsElement>("details");
    assert.ok(details);
    assert.equal(details.open, false);
    assert.equal(diagnosticAlert.closest("details"), null);
    assert.equal(container.querySelectorAll("[role='alert']").length, 1);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
