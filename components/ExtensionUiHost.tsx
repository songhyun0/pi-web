"use client";

import { Fragment, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { normalizeCustomPanelLines, parseAnsiLine } from "@/lib/ansi";
import type { ExtensionStatusItem, ExtensionUiRequest, ExtensionWidgetItem } from "@/lib/types";

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
          request={dialog}
          onRespond={onRespond}
        />
      )}

      {customUi && (
        <ExtensionCustomPanel
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
}: {
  statuses?: ExtensionStatusItem[];
  widgets: ExtensionWidgetItem[];
}) {
  return (
    <>
      {statuses ? <ExtensionStatusBar statuses={statuses} /> : null}
      <ExtensionWidgets widgets={widgets} />
    </>
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

  useEffect(() => {
    setValue(request.method === "editor" ? request.prefill ?? "" : "");
  }, [request]);

  const submitValue = () => {
    if (request.method === "confirm") {
      onRespond(request, { confirmed: true });
    } else {
      onRespond(request, { value });
    }
  };

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 90,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        background: "rgba(0,0,0,0.18)",
        boxSizing: "border-box",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        style={{
          width: "min(560px, 100%)",
          maxHeight: "calc(100% - 40px)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          background: "var(--bg)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.28)",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ color: "var(--text)", fontSize: 14, fontWeight: 650 }}>{request.title}</div>
          <div style={{ marginTop: 3, color: "var(--text-dim)", fontSize: 11, fontFamily: "var(--font-mono)" }}>extension request</div>
        </div>

        <div style={{ padding: 14 }}>
          {request.method === "confirm" && (
            <div style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{request.message}</div>
          )}
          {request.method === "select" && (
            <div style={{ display: "grid", gap: 8 }}>
              {request.options.map((option) => (
                <button
                  key={option}
                  onClick={() => onRespond(request, { value: option })}
                  style={{
                    width: "100%",
                    padding: "9px 10px",
                    borderRadius: 7,
                    border: "1px solid var(--border)",
                    background: "var(--bg-panel)",
                    color: "var(--text)",
                    cursor: "pointer",
                    textAlign: "left",
                    fontSize: 13,
                  }}
                >
                  {option}
                </button>
              ))}
            </div>
          )}
          {request.method === "input" && (
            <input
              autoFocus
              value={value}
              placeholder={request.placeholder}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitValue();
                if (e.key === "Escape") onRespond(request, { cancelled: true });
              }}
              style={{
                width: "100%",
                padding: "9px 10px",
                borderRadius: 7,
                border: "1px solid var(--border)",
                background: "var(--bg-panel)",
                color: "var(--text)",
                outline: "none",
                fontSize: 13,
              }}
            />
          )}
          {request.method === "editor" && (
            <textarea
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") onRespond(request, { cancelled: true });
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submitValue();
              }}
              style={{
                width: "100%",
                minHeight: 220,
                padding: 10,
                borderRadius: 7,
                border: "1px solid var(--border)",
                background: "var(--bg-panel)",
                color: "var(--text)",
                outline: "none",
                resize: "vertical",
                fontSize: 13,
                lineHeight: 1.55,
                fontFamily: "var(--font-mono)",
              }}
            />
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "10px 14px", borderTop: "1px solid var(--border)", background: "var(--bg-panel)" }}>
          <button
            onClick={() => onRespond(request, { cancelled: true })}
            style={{
              padding: "6px 10px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "var(--bg)",
              color: "var(--text-muted)",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          {request.method === "confirm" ? (
            <button
              onClick={submitValue}
              style={{
                padding: "6px 10px",
                borderRadius: 6,
                border: "1px solid var(--accent)",
                background: "var(--accent)",
                color: "#fff",
                cursor: "pointer",
              }}
            >
              Confirm
            </button>
          ) : request.method !== "select" ? (
            <button
              onClick={submitValue}
              style={{
                padding: "6px 10px",
                borderRadius: 6,
                border: "1px solid var(--accent)",
                background: "var(--accent)",
                color: "#fff",
                cursor: "pointer",
              }}
            >
              Submit
            </button>
          ) : null}
        </div>
      </div>
    </div>
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
  const width = Math.max(0, el.clientWidth - 28);
  const height = Math.max(0, el.clientHeight - 48);
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
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const lastSizeRef = useRef<string>("");
  const displayLines = normalizeCustomPanelLines(request.lines);

  const focusInput = () => {
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const sendTextInput = (text: string) => {
    if (!text) return;
    onInput(request, text);
    if (inputRef.current) inputRef.current.value = "";
  };

  useEffect(() => {
    lastSizeRef.current = "";
    focusInput();
  }, [request.id]);

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
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 95,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        background: "rgba(0,0,0,0.18)",
        boxSizing: "border-box",
      }}
    >
      <div
        ref={panelRef}
        tabIndex={0}
        role="dialog"
        aria-modal="true"
        onMouseDown={() => focusInput()}
        style={{
          width: "min(920px, 100%)",
          maxHeight: "min(760px, calc(100% - 40px))",
          display: "flex",
          flexDirection: "column",
          border: "1px solid var(--border)",
          borderRadius: 8,
          background: "var(--bg)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.28)",
          overflow: "hidden",
          outline: "none",
        }}
      >
        <textarea
          ref={inputRef}
          aria-label="Extension terminal input"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing || composingRef.current) return;
            const data = toTerminalKeyData(e, { includePrintable: false });
            if (!data) return;
            e.preventDefault();
            e.stopPropagation();
            onInput(request, data);
            if (inputRef.current) inputRef.current.value = "";
          }}
          onBeforeInput={(e) => {
            const native = e.nativeEvent as InputEvent;
            if (native.isComposing || composingRef.current) return;
            if (native.inputType === "insertText" && native.data) {
              e.preventDefault();
              sendTextInput(native.data);
            }
          }}
          onInput={(e) => {
            if (composingRef.current) return;
            sendTextInput(e.currentTarget.value);
          }}
          onPaste={(e) => {
            const text = e.clipboardData.getData("text");
            if (!text) return;
            e.preventDefault();
            sendTextInput(text);
          }}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={(e) => {
            composingRef.current = false;
            sendTextInput(e.data || e.currentTarget.value);
          }}
          style={{
            position: "absolute",
            width: 1,
            height: 1,
            opacity: 0,
            resize: "none",
            border: 0,
            padding: 0,
            margin: 0,
            outline: "none",
            pointerEvents: "none",
          }}
        />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ color: "var(--text)", fontSize: 13, fontWeight: 650 }}>Extension panel</div>
          <button
            onClick={() => onInput(request, "\x03")}
            style={{
              padding: "5px 9px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "var(--bg-panel)",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            Close
          </button>
        </div>
        <pre
          style={{
            margin: 0,
            padding: 14,
            flex: 1,
            minHeight: 0,
            overflow: "auto",
            background: "var(--bg-panel)",
            color: "var(--text)",
            fontFamily: "var(--font-mono)",
            fontSize: 13,
            lineHeight: 1.45,
            whiteSpace: "pre",
          }}
        >
          {(displayLines.length ? displayLines : [""]).map((line, index, allLines) => (
            <Fragment key={index}>
              {renderAnsiLine(line, `line-${index}`)}
              {index < allLines.length - 1 ? "\n" : null}
            </Fragment>
          ))}
        </pre>
      </div>
    </div>
  );
}
