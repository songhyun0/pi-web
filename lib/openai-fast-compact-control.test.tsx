import assert from "node:assert/strict";
import test from "node:test";

import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";

import {
  deriveOpenAIFastControlState,
  OpenAIFastCompactControl,
} from "../components/OpenAIFastCompactControl";

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
  IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
});

function accessibleName(button: HTMLButtonElement): string {
  return button.getAttribute("aria-label") ?? button.textContent?.trim() ?? "";
}

function buttonByAccessibleName(container: HTMLElement, name: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
    .find((candidate) => accessibleName(candidate) === name);
  assert.ok(button, `missing button with accessible name: ${name}`);
  return button;
}

test("compact OpenAI Fast uses a nonvisual unavailable state and switch presentation", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let toggleCalls = 0;
  const onToggle = () => { toggleCalls += 1; };

  try {
    const unavailableState = deriveOpenAIFastControlState(false, false);
    assert.deepEqual(deriveOpenAIFastControlState(false, true), unavailableState);
    await act(async () => root.render(
      <OpenAIFastCompactControl state={unavailableState} onToggle={onToggle} />,
    ));

    const unavailableButton = buttonByAccessibleName(container, "OpenAI Fast — Unavailable");
    assert.equal(unavailableState.active, false);
    assert.equal(unavailableButton.disabled, true);
    assert.equal(unavailableButton.getAttribute("aria-pressed"), "false");
    assert.equal(unavailableButton.hasAttribute("data-active"), false);
    assert.match(unavailableButton.textContent ?? "", /OpenAI Fast/);
    assert.doesNotMatch(unavailableButton.textContent ?? "", /Unavailable/);
    assert.equal(unavailableButton.lastElementChild?.textContent, "");
    unavailableButton.click();
    assert.equal(toggleCalls, 0);
    assert.equal(
      Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
        .some((button) => accessibleName(button) === "N/A"),
      false,
    );

    const offState = deriveOpenAIFastControlState(true, false);
    await act(async () => root.render(
      <OpenAIFastCompactControl state={offState} onToggle={onToggle} />,
    ));

    const offButton = buttonByAccessibleName(container, "OpenAI Fast — Off");
    assert.equal(offButton.disabled, false);
    assert.equal(offButton.getAttribute("aria-pressed"), "false");
    assert.equal(offButton.hasAttribute("data-active"), false);
    assert.equal(offButton.lastElementChild?.hasAttribute("data-checked"), false);
    offButton.click();
    assert.equal(toggleCalls, 1);

    const onState = deriveOpenAIFastControlState(true, true);
    await act(async () => root.render(
      <OpenAIFastCompactControl state={onState} onToggle={onToggle} />,
    ));

    const onButton = buttonByAccessibleName(container, "OpenAI Fast — On");
    assert.equal(onButton.disabled, false);
    assert.equal(onButton.getAttribute("aria-pressed"), "true");
    assert.equal(onButton.getAttribute("data-active"), "true");
    assert.equal(onButton.lastElementChild?.getAttribute("data-checked"), "true");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
