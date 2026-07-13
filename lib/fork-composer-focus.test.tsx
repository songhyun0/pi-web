import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { JSDOM } from "jsdom";
import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";

import { type ForkComposerHandle, useForkComposerFocus } from "../hooks/useForkComposerFocus";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "http://localhost/",
});

Object.defineProperties(globalThis, {
  window: { configurable: true, value: dom.window },
  document: { configurable: true, value: dom.window.document },
  navigator: { configurable: true, value: dom.window.navigator },
  HTMLElement: { configurable: true, value: dom.window.HTMLElement },
});
Object.assign(dom.window.HTMLElement.prototype, {
  attachEvent() {},
  detachEvent() {},
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  flushSync(() => {});
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  flushSync(() => {});
}

function ForkRemountHarness({ selectedText }: { selectedText?: string }) {
  const [session, setSession] = useState({ id: "old-session", key: 0 });
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composerRef = useRef<ForkComposerHandle | null>(null);
  composerRef.current = {
    focus: () => textareaRef.current?.focus({ preventScroll: true }),
    insertIfEmpty: (text) => {
      if (textareaRef.current && !textareaRef.current.value.trim()) textareaRef.current.value = text;
    },
  };
  const queueFocus = useForkComposerFocus(composerRef, session.id);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          queueFocus("fork-session", selectedText);
          setSession({ id: "fork-session", key: 1 });
        }}
      >
        Complete fork
      </button>
      <textarea key={session.key} ref={textareaRef} aria-label="Message" defaultValue="" />
    </>
  );
}

async function completeFork(selectedText?: string): Promise<HTMLTextAreaElement> {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  flushSync(() => root?.render(<ForkRemountHarness selectedText={selectedText} />));
  await settle();

  const trigger = document.querySelector<HTMLButtonElement>("button");
  assert.ok(trigger);
  trigger.focus();
  flushSync(() => trigger.click());
  await settle();

  const composer = document.querySelector<HTMLTextAreaElement>("textarea[aria-label='Message']");
  assert.ok(composer);
  return composer;
}

afterEach(async () => {
  if (root) flushSync(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  document.body.replaceChildren();
  await settle();
});

test("successful fork remount focuses the replacement composer without selected text", async () => {
  const composer = await completeFork();

  assert.equal(document.activeElement, composer);
  assert.equal(composer.value, "");
});

test("successful fork remount restores selected text and focuses the replacement composer", async () => {
  const composer = await completeFork("Selected user text");

  assert.equal(document.activeElement, composer);
  assert.equal(composer.value, "Selected user text");
});
