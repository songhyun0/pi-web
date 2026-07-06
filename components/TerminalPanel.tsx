"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FitAddon as GhosttyFitAddon, Terminal as GhosttyTerminal } from "ghostty-web";

interface Props {
  cwd: string | null | undefined;
}

interface TerminalFontConfig {
  fontFamilies: string[];
  fontSize: number | null;
  configPath: string | null;
  wsUrl?: string;
  error?: string;
}

type TerminalStatus = "idle" | "loading" | "connecting" | "connected" | "disconnected" | "error";

function quoteFontFamily(name: string): string {
  return `"${name.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
}

function buildFontFamily(config: TerminalFontConfig | null): string {
  const families = config?.fontFamilies?.filter(Boolean) ?? [];
  const quoted = families.map(quoteFontFamily);
  return [...quoted, "var(--font-mono)", "monospace"].join(", ");
}

function basename(filePath: string | null | undefined): string {
  if (!filePath) return "";
  const normalized = filePath.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized.split("/").pop() || normalized;
}

function statusColor(status: TerminalStatus): string {
  if (status === "connected") return "#22c55e";
  if (status === "connecting" || status === "loading") return "#f59e0b";
  if (status === "error") return "#f87171";
  return "var(--text-dim)";
}

export function TerminalPanel({ cwd }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [fontConfig, setFontConfig] = useState<TerminalFontConfig | null>(null);
  const [status, setStatus] = useState<TerminalStatus>("idle");
  const [statusText, setStatusText] = useState("Idle");
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const fontFamily = useMemo(() => buildFontFamily(fontConfig), [fontConfig]);
  const fontSize = fontConfig?.fontSize ?? 16;

  useEffect(() => {
    let cancelled = false;
    fetch("/api/terminal/config", { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json() as TerminalFontConfig;
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        return data;
      })
      .then((data) => {
        if (!cancelled) setFontConfig(data);
      })
      .catch(() => {
        if (!cancelled) {
          setFontConfig({
            fontFamilies: ["MesloLGS NF", "D2CodingLigature Nerd Font Mono"],
            fontSize: 16,
            configPath: null,
          });
        }
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !cwd || !fontConfig) return;
    const terminalContainer = container;
    const terminalCwd = cwd;
    const terminalFontConfig = fontConfig;

    let cancelled = false;
    let term: GhosttyTerminal | null = null;
    let fitAddon: GhosttyFitAddon | null = null;
    let ws: WebSocket | null = null;
    let dataDisposable: { dispose?: () => void } | null = null;
    let resizeDisposable: { dispose?: () => void } | null = null;

    async function start() {
      setStatus("loading");
      setStatusText("Loading terminal…");
      setError(null);
      terminalContainer.innerHTML = "";

      try {
        const { Ghostty, Terminal, FitAddon } = await import("ghostty-web");
        const ghostty = await Ghostty.load("/api/terminal/wasm");
        if (cancelled) return;

        const rootStyles = window.getComputedStyle(document.documentElement);
        const background = rootStyles.getPropertyValue("--bg").trim() || "#111111";
        const foreground = rootStyles.getPropertyValue("--text").trim() || "#d4d4d4";
        const cursor = rootStyles.getPropertyValue("--accent").trim() || "#60a5fa";

        term = new Terminal({
          cursorBlink: true,
          fontSize,
          fontFamily,
          scrollback: 10000,
          ghostty,
          theme: {
            background,
            foreground,
            cursor,
            selectionBackground: "rgba(96, 165, 250, 0.35)",
          },
        });

        fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        await Promise.resolve(term.open(terminalContainer));
        fitAddon.fit();
        fitAddon.observeResize();

        const fallbackProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const wsUrl = new URL(terminalFontConfig.wsUrl || `${fallbackProtocol}//${window.location.host}/api/terminal/ws`);
        wsUrl.searchParams.set("cwd", terminalCwd);
        wsUrl.searchParams.set("cols", String(term.cols ?? 80));
        wsUrl.searchParams.set("rows", String(term.rows ?? 24));

        setStatus("connecting");
        setStatusText("Connecting…");
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          if (cancelled) return;
          setStatus("connected");
          setStatusText("Connected");
        };
        ws.onmessage = (event) => {
          if (typeof event.data === "string") term?.write(event.data);
        };
        ws.onerror = () => {
          if (cancelled) return;
          setStatus("error");
          setStatusText("WebSocket error");
        };
        ws.onclose = () => {
          if (cancelled) return;
          setStatus("disconnected");
          setStatusText("Disconnected");
        };

        dataDisposable = term.onData((data: string) => {
          if (ws?.readyState === WebSocket.OPEN) ws.send(data);
        });
        resizeDisposable = term.onResize(({ cols, rows }: { cols: number; rows: number }) => {
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "resize", cols, rows }));
          }
        });
      } catch (e) {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : String(e);
        setStatus("error");
        setStatusText("Error");
        setError(message);
      }
    }

    void start();

    return () => {
      cancelled = true;
      dataDisposable?.dispose?.();
      resizeDisposable?.dispose?.();
      try { ws?.close(); } catch {}
      try { term?.dispose?.(); } catch {}
      container.innerHTML = "";
    };
  }, [cwd, fontConfig, fontFamily, fontSize, reloadKey]);

  return (
    <div className="terminal-panel">
      <style>{`
        .terminal-panel { height: 100%; display: flex; flex-direction: column; min-width: 0; background: var(--bg); }
        .terminal-panel-body { flex: 1; min-height: 0; padding: 8px; background: var(--bg); }
        .terminal-panel-surface { width: 100%; height: 100%; overflow: hidden; border-radius: 8px; background: var(--bg); border: 1px solid var(--border); }
        .terminal-panel-surface canvas { display: block; }
      `}</style>

      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        minHeight: 36,
        padding: "0 10px",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg-panel)",
        flexShrink: 0,
        fontSize: 12,
      }}>
        <strong style={{ color: "var(--text)", fontSize: 12 }}>Terminal</strong>
        <span style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          color: "var(--text-muted)",
          minWidth: 0,
          overflow: "hidden",
          whiteSpace: "nowrap",
        }}>
          <span style={{ width: 7, height: 7, borderRadius: 999, background: statusColor(status), flexShrink: 0 }} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{statusText}</span>
        </span>
        {cwd && (
          <span title={cwd} style={{
            color: "var(--text-dim)",
            fontFamily: "var(--font-mono)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            minWidth: 0,
          }}>
            {basename(cwd)}
          </span>
        )}
        <button
          onClick={() => setReloadKey((key) => key + 1)}
          disabled={!cwd || status === "loading" || status === "connecting"}
          title="Start a new shell"
          style={{
            marginLeft: "auto",
            height: 24,
            padding: "0 8px",
            background: "transparent",
            border: "1px solid var(--border)",
            borderRadius: 5,
            color: "var(--text-muted)",
            cursor: !cwd || status === "loading" || status === "connecting" ? "default" : "pointer",
            opacity: !cwd ? 0.5 : 1,
            fontSize: 11,
          }}
        >
          New shell
        </button>
      </div>

      {!cwd ? (
        <div style={{ padding: 16, fontSize: 12, color: "var(--text-dim)" }}>Select a project to start a terminal</div>
      ) : error ? (
        <div style={{ padding: 16, fontSize: 12, color: "#f87171", lineHeight: 1.5 }}>
          {error}
        </div>
      ) : (
        <div className="terminal-panel-body">
          <div
            ref={containerRef}
            className="terminal-panel-surface"
            style={{ fontFamily, fontSize }}
          />
        </div>
      )}
    </div>
  );
}
