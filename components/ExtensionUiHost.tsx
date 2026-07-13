"use client";

import { Fragment, type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { normalizeCustomPanelLines, parseAnsiLine } from "@/lib/ansi";
import type { ExtensionChromeState, ExtensionCompatibilityItem, ExtensionStatusItem, ExtensionUiRequest, ExtensionWidgetItem } from "@/lib/types";
import styles from "./ExtensionUiHost.module.css";

type ExtensionDialogRequest = Extract<ExtensionUiRequest, { method: "select" | "confirm" | "input" | "editor" }>;
type ExtensionCustomRequest = Extract<ExtensionUiRequest, { method: "custom" }>;

export function ExtensionUiHost({
  dialog,
  customUi,
  onRespond,
  onCustomInput,
  onCustomResize,
}: {
  dialog: ExtensionDialogRequest | null;
  customUi: ExtensionCustomRequest | null;
  onRespond: (request: ExtensionDialogRequest, response: { value: string } | { confirmed: boolean } | { cancelled: true }) => void;
  onCustomInput: (request: ExtensionCustomRequest, data: string) => void;
  onCustomResize: (request: ExtensionCustomRequest, size: { columns: number; rows: number }) => void;
}) {
  return (
    <>
      {dialog && (
        <ExtensionDialog
          key={dialog.id}
          request={dialog}
          onRespond={onRespond}
        />
      )}

      {customUi && (
        <ExtensionCustomPanel
          key={customUi.id}
          request={customUi}
          onInput={onCustomInput}
          onResize={onCustomResize}
        />
      )}
    </>
  );
}

export function ExtensionUiInline({
  statuses,
  widgets,
  chrome,
  compatibility,
}: {
  statuses?: ExtensionStatusItem[];
  widgets: ExtensionWidgetItem[];
  chrome?: ExtensionChromeState;
  compatibility?: ExtensionCompatibilityItem[];
}) {
  return (
    <>
      {chrome ? <ExtensionChrome chrome={chrome} /> : null}
      {statuses ? <ExtensionStatusBar statuses={statuses} /> : null}
      {compatibility ? <ExtensionCompatibility reports={compatibility} /> : null}
      <ExtensionWidgets widgets={widgets} />
    </>
  );
}

function ExtensionChrome({ chrome }: { chrome: ExtensionChromeState }) {
  const hasHeader = chrome.headerLines.length > 0;
  const hasFooter = chrome.footerLines.length > 0;
  const hasWorking = chrome.working.visible || !!chrome.working.message;
  if (!hasHeader && !hasFooter && !hasWorking) return null;
  return (
    <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
      {hasHeader && <ExtensionLineCard tone="accent" lines={chrome.headerLines} label="extension header" />}
      {hasWorking && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "6px 9px", border: "1px solid color-mix(in srgb, var(--accent) 25%, var(--border))",
          borderRadius: 7, background: "color-mix(in srgb, var(--accent) 6%, var(--bg))",
          color: "var(--text-muted)", fontSize: 12,
        }}>
          <span style={{ color: "var(--accent)", fontFamily: "var(--font-mono)" }}>●</span>
          <span>{chrome.working.message ?? "Extension working"}</span>
        </div>
      )}
      {hasFooter && <ExtensionLineCard tone="muted" lines={chrome.footerLines} label="extension footer" />}
    </div>
  );
}

function ExtensionLineCard({ lines, label, tone }: { lines: string[]; label: string; tone: "accent" | "muted" }) {
  return (
    <div style={{
      border: "1px solid var(--border)",
      borderRadius: 7,
      background: tone === "accent" ? "color-mix(in srgb, var(--accent) 5%, var(--bg-panel))" : "var(--bg-panel)",
      overflow: "hidden",
    }}>
      <div style={{ padding: "4px 8px", borderBottom: "1px solid var(--border)", color: "var(--text-dim)", fontSize: 10, fontFamily: "var(--font-mono)", textTransform: "uppercase" }}>{label}</div>
      <pre style={{ margin: 0, padding: "7px 8px", color: "var(--text-muted)", fontSize: 12, lineHeight: 1.45, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "var(--font-mono)" }}>
        {lines.map((line, index, allLines) => (
          <Fragment key={index}>
            {renderAnsiLine(line, `${label}-${index}`)}
            {index < allLines.length - 1 ? "\n" : null}
          </Fragment>
        ))}
      </pre>
    </div>
  );
}

function ExtensionCompatibility({ reports }: { reports: ExtensionCompatibilityItem[] }) {
  const visible = reports.filter((report) => report.status !== "supported").slice(0, 3);
  if (visible.length === 0) return null;
  return (
    <div style={{ display: "grid", gap: 5, marginBottom: 10 }}>
      {visible.map((report) => (
        <div key={`${report.api}:${report.status}`} style={{ padding: "5px 8px", border: "1px solid rgba(234,179,8,0.28)", borderRadius: 6, background: "rgba(234,179,8,0.07)", color: "var(--text-muted)", fontSize: 11 }}>
          <span style={{ fontFamily: "var(--font-mono)", color: "rgba(180,130,0,1)" }}>{report.api}</span> · {report.details}
        </div>
      ))}
    </div>
  );
}
function ExtensionStatusBar({ statuses }: { statuses: ExtensionStatusItem[] }) {
  if (statuses.length === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
      {statuses.map((status) => (
        <div
          key={status.key}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            maxWidth: "100%",
            padding: "4px 8px",
            border: "1px solid color-mix(in srgb, var(--accent) 24%, var(--border))",
            borderRadius: 6,
            background: "color-mix(in srgb, var(--accent) 7%, var(--bg))",
            color: "var(--text-muted)",
            fontSize: 12,
          }}
        >
          <span style={{ color: "var(--accent)", fontFamily: "var(--font-mono)", fontSize: 11 }}>{status.key}</span>
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {renderAnsiLine(status.text, `status-${status.key}`)}
          </span>
        </div>
      ))}
    </div>
  );
}

function ExtensionWidgets({ widgets }: { widgets: ExtensionWidgetItem[] }) {
  if (widgets.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
      {widgets.map((widget) => (
        <div
          key={widget.key}
          style={{
            border: "1px solid var(--border)",
            borderRadius: 7,
            background: "var(--bg-panel)",
            overflow: "hidden",
          }}
        >
          <div style={{ padding: "5px 9px", borderBottom: "1px solid var(--border)", color: "var(--text-dim)", fontSize: 11, fontFamily: "var(--font-mono)" }}>
            {widget.key}
          </div>
          <pre style={{ margin: 0, padding: "8px 9px", color: "var(--text-muted)", fontSize: 12, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "var(--font-mono)" }}>
            {widget.lines.map((line, index, allLines) => (
              <Fragment key={index}>
                {renderAnsiLine(line, `widget-${widget.key}-${index}`)}
                {index < allLines.length - 1 ? "\n" : null}
              </Fragment>
            ))}
          </pre>
        </div>
      ))}
    </div>
  );
}

function ExtensionDialog({
  request,
  onRespond,
}: {
  request: ExtensionDialogRequest;
  onRespond: (request: ExtensionDialogRequest, response: { value: string } | { confirmed: boolean } | { cancelled: true }) => void;
}) {
  const [value, setValue] = useState(request.method === "editor" ? request.prefill ?? "" : "");
  const initialFocusRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setValue(request.method === "editor" ? request.prefill ?? "" : "");
  }, [request]);

  const captureInitialFocus = (element: HTMLElement | null) => {
    initialFocusRef.current = element;
  };
  const cancel = () => onRespond(request, { cancelled: true });
  const submitValue = () => {
    if (request.method === "confirm") {
      onRespond(request, { confirmed: true });
    } else {
      onRespond(request, { value });
    }
  };

  const footer = (
    <div className={styles.dialogActions}>
      <Button
        ref={request.method === "confirm" || (request.method === "select" && request.options.length === 0) ? captureInitialFocus : undefined}
        variant="secondary"
        onClick={cancel}
      >
        Cancel
      </Button>
      {request.method === "confirm" ? (
        <Button variant="primary" onClick={submitValue}>Confirm</Button>
      ) : request.method !== "select" ? (
        <Button variant="primary" onClick={submitValue}>Submit</Button>
      ) : null}
    </div>
  );

  return (
    <Dialog
      open
      onOpenChange={(nextOpen) => { if (!nextOpen) cancel(); }}
      title={request.title}
      description="Extension request"
      size="md"
      closeLabel={`Cancel ${request.title}`}
      initialFocusRef={initialFocusRef}
      className={styles.dialog}
      bodyClassName={styles.dialogBody}
      footer={footer}
    >
      {request.method === "confirm" && (
        <p className={styles.confirmMessage}>{request.message}</p>
      )}
      {request.method === "select" && (
        <div className={styles.options}>
          {request.options.map((option, index) => (
            <Button
              key={option}
              ref={index === 0 ? captureInitialFocus : undefined}
              variant="secondary"
              className={styles.option}
              onClick={() => onRespond(request, { value: option })}
            >
              {option}
            </Button>
          ))}
        </div>
      )}
      {request.method === "input" && (
        <Field label="Response">
          <Input
            ref={captureInitialFocus}
            value={value}
            placeholder={request.placeholder}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) submitValue();
            }}
          />
        </Field>
      )}
      {request.method === "editor" && (
        <Field label="Response" hint="Press Ctrl+Enter or Command+Enter to submit.">
          <Textarea
            ref={captureInitialFocus}
            value={value}
            mono
            className={styles.editor}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && !event.nativeEvent.isComposing) submitValue();
            }}
          />
        </Field>
      )}
    </Dialog>
  );
}

function toTerminalKeyData(e: KeyboardEvent, options?: { includePrintable?: boolean }): string | null {
  if (e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1) {
    const ch = e.key.toLowerCase();
    if (ch >= "a" && ch <= "z") {
      return String.fromCharCode(ch.charCodeAt(0) - 96);
    }
  }

  const includePrintable = options?.includePrintable ?? true;

  switch (e.key) {
    case "ArrowUp":
      return "\x1b[A";
    case "ArrowDown":
      return "\x1b[B";
    case "ArrowRight":
      return "\x1b[C";
    case "ArrowLeft":
      return "\x1b[D";
    case "Enter":
      return "\r";
    case "Escape":
      return "\x1b";
    case "Backspace":
      return "\x7f";
    case "Delete":
      return "\x1b[3~";
    case "Home":
      return "\x1b[H";
    case "End":
      return "\x1b[F";
    case "PageUp":
      return "\x1b[5~";
    case "PageDown":
      return "\x1b[6~";
    case "Tab":
      return "\t";
    case " ":
      return includePrintable ? " " : null;
    default:
      if (includePrintable && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1) return e.key;
      return null;
  }
}

function renderAnsiLine(line: string, keyPrefix: string): ReactNode[] {
  return parseAnsiLine(line).map((segment, index) => (
    Object.keys(segment.style).length > 0
      ? <span key={`${keyPrefix}-${index}`} style={segment.style}>{segment.text}</span>
      : segment.text
  ));
}

function estimateTerminalSize(el: HTMLElement): { columns: number; rows: number } {
  const width = Math.max(0, el.clientWidth - 32);
  const height = Math.max(0, el.clientHeight - 32);
  return {
    columns: Math.max(40, Math.min(220, Math.floor(width / 8))),
    rows: Math.max(8, Math.min(100, Math.floor(height / 19))),
  };
}

function ExtensionCustomPanel({
  request,
  onInput,
  onResize,
}: {
  request: ExtensionCustomRequest;
  onInput: (request: ExtensionCustomRequest, data: string) => void;
  onResize: (request: ExtensionCustomRequest, size: { columns: number; rows: number }) => void;
}) {
  const panelRef = useRef<HTMLFieldSetElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const composingRef = useRef(false);
  const lastSizeRef = useRef<string>("");
  const displayLines = normalizeCustomPanelLines(request.lines);

  const sendTextInput = (text: string) => {
    if (!text) return;
    onInput(request, text);
    if (inputRef.current) inputRef.current.value = "";
  };

  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const sendSize = () => {
      const size = estimateTerminalSize(el);
      const key = `${size.columns}x${size.rows}`;
      if (lastSizeRef.current === key) return;
      lastSizeRef.current = key;
      onResize(request, size);
    };
    sendSize();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(sendSize);
    observer.observe(el);
    return () => observer.disconnect();
  }, [onResize, request]);

  return (
    <Dialog
      open
      onOpenChange={() => undefined}
      title="Extension panel"
      description="Interactive terminal. Escape and Tab are sent to the terminal; press F6 to move focus to Close."
      size="xl"
      height="viewport"
      bodyLayout="flush"
      dismissible={false}
      hideClose
      initialFocusRef={inputRef}
      onEscapeKeyDown={(event) => {
        event.preventDefault();
        onInput(request, "\x1b");
        inputRef.current?.focus({ preventScroll: true });
      }}
      className={styles.customDialog}
      bodyClassName={styles.customBody}
      footer={(
        <Button
          ref={closeRef}
          variant="secondary"
          onClick={() => onInput(request, "\x03")}
          onKeyDown={(event) => {
            if (event.key !== "F6") return;
            event.preventDefault();
            inputRef.current?.focus({ preventScroll: true });
          }}
        >
          Close
        </Button>
      )}
    >
      <fieldset
        ref={panelRef}
        aria-label="Extension terminal"
        className={styles.terminalShell}
        onPointerDown={() => inputRef.current?.focus({ preventScroll: true })}
      >
        <textarea
          ref={inputRef}
          aria-label="Extension terminal input"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className={styles.terminalInput}
          onKeyDown={(event) => {
            if (event.key === "F6") {
              event.preventDefault();
              event.stopPropagation();
              closeRef.current?.focus({ preventScroll: true });
              return;
            }
            if (event.nativeEvent.isComposing || composingRef.current) return;
            const data = toTerminalKeyData(event, { includePrintable: false });
            if (!data) return;
            event.preventDefault();
            event.stopPropagation();
            onInput(request, data);
            if (inputRef.current) inputRef.current.value = "";
          }}
          onBeforeInput={(event) => {
            const native = event.nativeEvent as InputEvent;
            if (native.isComposing || composingRef.current) return;
            if (native.inputType === "insertText" && native.data) {
              event.preventDefault();
              sendTextInput(native.data);
            }
          }}
          onInput={(event) => {
            if (composingRef.current) return;
            sendTextInput(event.currentTarget.value);
          }}
          onPaste={(event) => {
            const text = event.clipboardData.getData("text");
            if (!text) return;
            event.preventDefault();
            sendTextInput(text);
          }}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={(event) => {
            composingRef.current = false;
            sendTextInput(event.data || event.currentTarget.value);
          }}
        />
        <section className={styles.terminalOutput} aria-label="Extension terminal output">
          {(displayLines.length ? displayLines : [""]).map((line, index, allLines) => (
            <Fragment key={index}>
              {renderAnsiLine(line, `line-${index}`)}
              {index < allLines.length - 1 ? "\n" : null}
            </Fragment>
          ))}
        </section>
      </fieldset>
    </Dialog>
  );
}
