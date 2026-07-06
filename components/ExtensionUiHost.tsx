"use client";

import { Fragment, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
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
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        style={{
          width: "min(560px, 100%)",
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

const ANSI_ESCAPE_RE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g;
const ANSI_ESCAPE_AT_START_RE = /^\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/;
const ANSI_SGR_RE = /\x1B\[([0-9;]*)m/g;

const ANSI_8_COLORS = [
  "#1f2937",
  "#dc2626",
  "#16a34a",
  "#d97706",
  "#2563eb",
  "#9333ea",
  "#0891b2",
  "#6b7280",
];

const ANSI_BRIGHT_COLORS = [
  "#9ca3af",
  "#ef4444",
  "#22c55e",
  "#f59e0b",
  "#3b82f6",
  "#a855f7",
  "#06b6d4",
  "#e5e7eb",
];

function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE_RE, "");
}

function visibleCharPositions(text: string): Array<{ start: number; end: number; char: string }> {
  const positions: Array<{ start: number; end: number; char: string }> = [];
  let i = 0;
  while (i < text.length) {
    if (text.charCodeAt(i) === 0x1b) {
      const match = text.slice(i).match(ANSI_ESCAPE_AT_START_RE);
      if (match) {
        i += match[0].length;
        continue;
      }
    }
    const codePoint = text.codePointAt(i);
    if (codePoint === undefined) break;
    const char = String.fromCodePoint(codePoint);
    positions.push({ start: i, end: i + char.length, char });
    i += char.length;
  }
  return positions;
}

function removeVisibleCharAt(text: string, index: number): string {
  const positions = visibleCharPositions(text);
  const pos = positions[index];
  if (!pos) return text;
  return text.slice(0, pos.start) + text.slice(pos.end);
}

function firstVisibleChar(text: string): string | undefined {
  return visibleCharPositions(text)[0]?.char;
}

function lastNonSpaceVisibleCharIndex(text: string): number {
  const positions = visibleCharPositions(text);
  for (let i = positions.length - 1; i >= 0; i--) {
    if (positions[i].char.trim() !== "") return i;
  }
  return -1;
}

function trimEndVisibleSpaces(text: string): string {
  let next = text;
  while (true) {
    const positions = visibleCharPositions(next);
    const last = positions[positions.length - 1];
    if (!last || last.char.trim() !== "") return next;
    next = next.slice(0, last.start) + next.slice(last.end);
  }
}

function normalizeCustomPanelLines(lines: string[]): string[] {
  const horizontalFrameLine = /^[┌├└╭╰][─┬┴┼]+[┐┤┘╮╯]$/;
  const normalized: string[] = [];

  for (const rawLine of lines) {
    const plain = stripAnsi(rawLine).trimEnd();
    if (horizontalFrameLine.test(plain)) continue;

    let line = rawLine;
    const first = firstVisibleChar(line);
    if (first === "│" || first === "┃") {
      line = removeVisibleCharAt(line, 0);
      if (firstVisibleChar(line) === " ") line = removeVisibleCharAt(line, 0);
    }

    const rightBorderIndex = lastNonSpaceVisibleCharIndex(line);
    const rightBorder = rightBorderIndex >= 0 ? visibleCharPositions(line)[rightBorderIndex]?.char : undefined;
    if (rightBorder === "│" || rightBorder === "┃") {
      line = removeVisibleCharAt(line, rightBorderIndex);
    }

    normalized.push(trimEndVisibleSpaces(line));
  }

  while (normalized.length > 0 && stripAnsi(normalized[0]).trim() === "") normalized.shift();
  while (normalized.length > 0 && stripAnsi(normalized[normalized.length - 1]).trim() === "") normalized.pop();
  return normalized.length ? normalized : lines;
}

function ansi256Color(index: number): string | undefined {
  if (index >= 0 && index < 8) return ANSI_8_COLORS[index];
  if (index >= 8 && index < 16) return ANSI_BRIGHT_COLORS[index - 8];
  if (index >= 16 && index <= 231) {
    const n = index - 16;
    const r = Math.floor(n / 36);
    const g = Math.floor((n % 36) / 6);
    const b = n % 6;
    const scale = (v: number) => v === 0 ? 0 : 55 + v * 40;
    return `rgb(${scale(r)}, ${scale(g)}, ${scale(b)})`;
  }
  if (index >= 232 && index <= 255) {
    const gray = 8 + (index - 232) * 10;
    return `rgb(${gray}, ${gray}, ${gray})`;
  }
  return undefined;
}

function applyAnsiCodes(style: CSSProperties, codes: number[]): CSSProperties {
  const next: CSSProperties = { ...style };
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];
    if (code === 0) {
      for (const key of Object.keys(next) as Array<keyof CSSProperties>) delete next[key];
    } else if (code === 1) {
      next.fontWeight = 700;
    } else if (code === 2) {
      next.opacity = 0.65;
    } else if (code === 3) {
      next.fontStyle = "italic";
    } else if (code === 4) {
      next.textDecoration = "underline";
    } else if (code === 22) {
      delete next.fontWeight;
      delete next.opacity;
    } else if (code === 23) {
      delete next.fontStyle;
    } else if (code === 24) {
      delete next.textDecoration;
    } else if (code === 39) {
      delete next.color;
    } else if (code === 49) {
      delete next.backgroundColor;
    } else if (code >= 30 && code <= 37) {
      next.color = ANSI_8_COLORS[code - 30];
    } else if (code >= 90 && code <= 97) {
      next.color = ANSI_BRIGHT_COLORS[code - 90];
    } else if (code >= 40 && code <= 47) {
      next.backgroundColor = ANSI_8_COLORS[code - 40];
    } else if (code >= 100 && code <= 107) {
      next.backgroundColor = ANSI_BRIGHT_COLORS[code - 100];
    } else if ((code === 38 || code === 48) && codes[i + 1] === 2) {
      const [r, g, b] = [codes[i + 2], codes[i + 3], codes[i + 4]];
      if ([r, g, b].every((value) => typeof value === "number" && Number.isFinite(value))) {
        if (code === 38) next.color = `rgb(${r}, ${g}, ${b})`;
        else next.backgroundColor = `rgb(${r}, ${g}, ${b})`;
      }
      i += 4;
    } else if ((code === 38 || code === 48) && codes[i + 1] === 5) {
      const color = ansi256Color(codes[i + 2]);
      if (color) {
        if (code === 38) next.color = color;
        else next.backgroundColor = color;
      }
      i += 2;
    }
  }
  return next;
}

function renderAnsiLine(line: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let style: CSSProperties = {};
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  ANSI_SGR_RE.lastIndex = 0;

  while ((match = ANSI_SGR_RE.exec(line)) !== null) {
    if (match.index > lastIndex) {
      const text = line.slice(lastIndex, match.index);
      nodes.push(Object.keys(style).length > 0
        ? <span key={`${keyPrefix}-${nodes.length}`} style={style}>{text}</span>
        : text);
    }
    const codes = match[1]
      ? match[1].split(";").map((part) => Number(part || "0"))
      : [0];
    style = applyAnsiCodes(style, codes);
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < line.length) {
    const text = line.slice(lastIndex);
    nodes.push(Object.keys(style).length > 0
      ? <span key={`${keyPrefix}-${nodes.length}`} style={style}>{text}</span>
      : text);
  }

  return nodes;
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
          maxHeight: "min(760px, calc(100vh - 40px))",
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
            maxHeight: "calc(min(760px, 100vh - 40px) - 48px)",
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
