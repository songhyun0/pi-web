"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FitAddon as GhosttyFitAddon, Terminal as GhosttyTerminal } from "ghostty-web";

interface Props {
  cwd: string | null | undefined;
  scopeId: string | null | undefined;
}

interface TerminalFontFace {
  cssFamily: string;
  sourceFamily: string;
  url: string;
  weight: number;
  style: "normal" | "italic";
}

interface TerminalFontConfig {
  fontFamilies: string[];
  fontSize: number | null;
  configPath: string | null;
  wsUrl?: string;
  controlUrl?: string;
  shellsUrl?: string;
  fontFaces?: TerminalFontFace[];
  error?: string;
}

interface ShellTab {
  key: string;
  scope: string;
  shellId: string;
  title: string;
  cwd: string;
  cols: number;
  rows: number;
  createdAt: number;
  lastUsed: number;
  attached: number;
}

type TerminalStatus = "idle" | "loading" | "connecting" | "connected" | "disconnected" | "error";

const loadedFontFamilies = new Set<string>();

function quoteFontFamily(name: string): string {
  return `"${name.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function buildFontFamily(config: TerminalFontConfig | null): string {
  const cssFamilies = unique(config?.fontFaces?.map((face) => face.cssFamily) ?? []);
  if (cssFamilies.length > 0) return cssFamilies.map(quoteFontFamily).join(", ");

  const configuredFamilies = unique(config?.fontFamilies ?? []);
  if (configuredFamilies.length > 0) return configuredFamilies.map(quoteFontFamily).join(", ");

  return "monospace";
}

async function loadTerminalFontFaces(faces: TerminalFontFace[] | undefined, fontSize: number): Promise<void> {
  if (!faces?.length || typeof FontFace === "undefined" || !document.fonts) return;

  const styleId = "pi-terminal-font-faces";
  let styleEl = document.getElementById(styleId) as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = styleId;
    document.head.appendChild(styleEl);
  }

  const cssRules: string[] = [];
  for (const face of faces) {
    const absoluteUrl = new URL(face.url, window.location.href).href;
    cssRules.push(`@font-face{font-family:${quoteFontFamily(face.cssFamily)};src:url(${JSON.stringify(absoluteUrl)});font-weight:${face.weight};font-style:${face.style};font-display:block;}`);
  }
  styleEl.textContent = cssRules.join("\n");

  await Promise.all(faces.map(async (face) => {
    const cacheKey = `${face.cssFamily}:${face.weight}:${face.style}`;
    if (loadedFontFamilies.has(cacheKey)) return;
    const absoluteUrl = new URL(face.url, window.location.href).href;
    try {
      const font = new FontFace(face.cssFamily, `url(${JSON.stringify(absoluteUrl)})`, {
        weight: String(face.weight),
        style: face.style,
        display: "block",
      });
      await font.load();
      document.fonts.add(font);
      await document.fonts.load(`${face.style} ${face.weight} ${fontSize}px ${quoteFontFamily(face.cssFamily)}`);
      loadedFontFamilies.add(cacheKey);
    } catch (error) {
      console.warn("Failed to load terminal font", face, error);
    }
  }));

  await document.fonts.ready;
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

function activeShellStorageKey(scopeId: string): string {
  return `pi-terminal-active-shell:${encodeURIComponent(scopeId)}`;
}

function readActiveShellId(scopeId: string): string | null {
  try {
    return window.localStorage.getItem(activeShellStorageKey(scopeId));
  } catch {
    return null;
  }
}

function writeActiveShellId(scopeId: string, shellId: string | null): void {
  try {
    if (shellId) window.localStorage.setItem(activeShellStorageKey(scopeId), shellId);
    else window.localStorage.removeItem(activeShellStorageKey(scopeId));
  } catch {
    // Ignore storage failures.
  }
}

function shellLabel(index: number): string {
  return `Shell ${index}`;
}

export function TerminalPanel({ cwd, scopeId }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [fontConfig, setFontConfig] = useState<TerminalFontConfig | null>(null);
  const [status, setStatus] = useState<TerminalStatus>("idle");
  const [statusText, setStatusText] = useState("Idle");
  const [error, setError] = useState<string | null>(null);
  const [shellTabs, setShellTabs] = useState<ShellTab[]>([]);
  const [activeShellId, setActiveShellId] = useState<string | null>(null);
  const [connectVersion, setConnectVersion] = useState(0);

  const fontFamily = useMemo(() => buildFontFamily(fontConfig), [fontConfig]);
  const fontSize = fontConfig?.fontSize ?? 14;
  const activeShell = shellTabs.find((tab) => tab.shellId === activeShellId) ?? null;
  const activeShellTitle = activeShell?.title ?? "Shell";

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
            fontSize: 14,
            configPath: null,
          });
        }
      });
    return () => { cancelled = true; };
  }, []);

  const refreshShells = useCallback(async (preferredShellId?: string | null): Promise<ShellTab[]> => {
    if (!scopeId || !fontConfig?.shellsUrl) {
      setShellTabs([]);
      setActiveShellId(null);
      return [];
    }

    const url = new URL(fontConfig.shellsUrl);
    url.searchParams.set("scope", scopeId);
    const res = await fetch(url, { cache: "no-store" });
    const data = await res.json() as { shells?: ShellTab[]; error?: string };
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);

    const shells = data.shells ?? [];
    setShellTabs(shells);
    setActiveShellId((current) => {
      const preferred = preferredShellId ?? current ?? readActiveShellId(scopeId);
      const next = preferred && shells.some((shell) => shell.shellId === preferred)
        ? preferred
        : shells[0]?.shellId ?? null;
      writeActiveShellId(scopeId, next);
      return next;
    });
    return shells;
  }, [fontConfig?.shellsUrl, scopeId]);

  useEffect(() => {
    if (!scopeId || !fontConfig?.shellsUrl) {
      setShellTabs([]);
      setActiveShellId(null);
      return;
    }
    let cancelled = false;
    refreshShells(readActiveShellId(scopeId)).catch((e) => {
      if (!cancelled) setError(e instanceof Error ? e.message : String(e));
    });
    return () => { cancelled = true; };
  }, [fontConfig?.shellsUrl, refreshShells, scopeId]);

  useEffect(() => {
    if (scopeId) writeActiveShellId(scopeId, activeShellId);
  }, [activeShellId, scopeId]);

  const createShell = useCallback(async () => {
    if (!cwd || !scopeId || !fontConfig?.shellsUrl) return;
    setError(null);
    const title = shellLabel(shellTabs.length + 1);
    try {
      const res = await fetch(fontConfig.shellsUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: scopeId, cwd, title }),
      });
      const data = await res.json() as { shell?: ShellTab; shells?: ShellTab[]; error?: string };
      if (!res.ok || !data.shell) throw new Error(data.error ?? `HTTP ${res.status}`);
      setShellTabs(data.shells ?? [data.shell]);
      setActiveShellId(data.shell.shellId);
      writeActiveShellId(scopeId, data.shell.shellId);
      setConnectVersion((key) => key + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [cwd, fontConfig?.shellsUrl, scopeId, shellTabs.length]);

  const killShell = useCallback(async (shellId: string) => {
    if (!scopeId || !fontConfig?.shellsUrl) return;
    setError(null);
    try {
      const url = new URL(fontConfig.shellsUrl);
      url.searchParams.set("scope", scopeId);
      url.searchParams.set("shellId", shellId);
      const res = await fetch(url, { method: "DELETE" });
      const data = await res.json() as { shells?: ShellTab[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      const shells = data.shells ?? [];
      setShellTabs(shells);
      setActiveShellId((current) => {
        if (current && current !== shellId && shells.some((shell) => shell.shellId === current)) return current;
        const next = shells[shells.length - 1]?.shellId ?? null;
        writeActiveShellId(scopeId, next);
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [fontConfig?.shellsUrl, scopeId]);

  const restartActiveShell = useCallback(async () => {
    if (!cwd || !scopeId || !fontConfig?.shellsUrl || !activeShell) return;
    setError(null);
    try {
      const res = await fetch(fontConfig.shellsUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: scopeId,
          cwd,
          shellId: activeShell.shellId,
          title: activeShell.title,
          restart: true,
        }),
      });
      const data = await res.json() as { shell?: ShellTab; shells?: ShellTab[]; error?: string };
      if (!res.ok || !data.shell) throw new Error(data.error ?? `HTTP ${res.status}`);
      setShellTabs(data.shells ?? [data.shell]);
      setActiveShellId(data.shell.shellId);
      setConnectVersion((key) => key + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [activeShell, cwd, fontConfig?.shellsUrl, scopeId]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !cwd || !fontConfig || !scopeId || !activeShellId) {
      if (!activeShellId) {
        setStatus("idle");
        setStatusText("No shell");
      }
      return;
    }
    const terminalContainer = container;
    const terminalCwd = cwd;
    const terminalScope = scopeId;
    const terminalShellId = activeShellId;
    const terminalShellTitle = activeShellTitle;
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
        await loadTerminalFontFaces(terminalFontConfig.fontFaces, fontSize);
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
        wsUrl.searchParams.set("scope", terminalScope);
        wsUrl.searchParams.set("shellId", terminalShellId);
        wsUrl.searchParams.set("title", terminalShellTitle);
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
          setShellTabs((prev) => prev.map((shell) => shell.shellId === terminalShellId ? { ...shell, attached: Math.max(shell.attached, 1) } : shell));
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
          setShellTabs((prev) => prev.map((shell) => shell.shellId === terminalShellId ? { ...shell, attached: 0 } : shell));
          if (cancelled) return;
          setStatus("disconnected");
          setStatusText("Detached");
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
      setShellTabs((prev) => prev.map((shell) => shell.shellId === terminalShellId ? { ...shell, attached: 0 } : shell));
      try { ws?.close(); } catch {}
      try { term?.dispose?.(); } catch {}
      terminalContainer.innerHTML = "";
    };
  }, [cwd, fontConfig, fontFamily, fontSize, activeShellId, activeShellTitle, scopeId, connectVersion]);

  return (
    <div className="terminal-panel">
      <style>{`
        .terminal-panel { height: 100%; display: flex; flex-direction: column; min-width: 0; background: var(--bg); }
        .terminal-panel-body { flex: 1; min-height: 0; padding: 8px; background: var(--bg); }
        .terminal-panel-surface { width: 100%; height: 100%; overflow: hidden; border-radius: 8px; background: var(--bg); border: 1px solid var(--border); }
        .terminal-panel-surface canvas { display: block; }
        .terminal-shell-tabs { display: flex; align-items: center; min-height: 32px; overflow-x: auto; overflow-y: hidden; border-bottom: 1px solid var(--border); background: var(--bg-panel); }
        .terminal-shell-tab { height: 31px; display: inline-flex; align-items: center; gap: 6px; padding: 0 8px; border: 0; border-right: 1px solid var(--border); background: transparent; color: var(--text-muted); font-size: 11px; cursor: pointer; white-space: nowrap; flex-shrink: 0; }
        .terminal-shell-tab.active { background: var(--bg); color: var(--text); }
        .terminal-shell-close { width: 16px; height: 16px; border: 0; border-radius: 4px; background: transparent; color: var(--text-dim); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
        .terminal-shell-close:hover { background: var(--bg-hover); color: var(--text); }
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
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--text-muted)", minWidth: 0, overflow: "hidden", whiteSpace: "nowrap" }}>
          <span style={{ width: 7, height: 7, borderRadius: 999, background: statusColor(status), flexShrink: 0 }} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{statusText}</span>
        </span>
        {cwd && (
          <span title={cwd} style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
            {basename(cwd)}
          </span>
        )}
        <button
          onClick={() => void createShell()}
          disabled={!cwd || !scopeId || !fontConfig?.shellsUrl}
          title="Create a new shell tab"
          style={{ marginLeft: "auto", height: 24, padding: "0 8px", background: "transparent", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text-muted)", cursor: !cwd || !scopeId ? "default" : "pointer", opacity: !cwd || !scopeId ? 0.5 : 1, fontSize: 11 }}
        >
          New shell
        </button>
        <button
          onClick={() => void restartActiveShell()}
          disabled={!activeShell || status === "loading" || status === "connecting"}
          title="Kill and restart the active shell"
          style={{ height: 24, padding: "0 8px", background: "transparent", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text-muted)", cursor: !activeShell || status === "loading" || status === "connecting" ? "default" : "pointer", opacity: !activeShell ? 0.5 : 1, fontSize: 11 }}
        >
          Restart
        </button>
      </div>

      <div className="terminal-shell-tabs">
        {shellTabs.map((tab) => {
          const active = tab.shellId === activeShellId;
          return (
            <div
              key={tab.shellId}
              className={`terminal-shell-tab${active ? " active" : ""}`}
              onClick={() => setActiveShellId(tab.shellId)}
              title={`${tab.title} · ${tab.attached ? "attached" : "detached"}`}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setActiveShellId(tab.shellId);
                }
              }}
            >
              <span>{tab.title}</span>
              {!tab.attached && <span style={{ color: "var(--text-dim)", fontSize: 10 }}>detached</span>}
              <button
                type="button"
                className="terminal-shell-close"
                title={`Kill ${tab.title}`}
                onClick={(e) => {
                  e.stopPropagation();
                  void killShell(tab.shellId);
                }}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>

      {!cwd ? (
        <div style={{ padding: 16, fontSize: 12, color: "var(--text-dim)" }}>Select a project to start a terminal</div>
      ) : error ? (
        <div style={{ padding: 16, fontSize: 12, color: "#f87171", lineHeight: 1.5 }}>{error}</div>
      ) : !activeShell ? (
        <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 10, color: "var(--text-dim)", fontSize: 12 }}>
          <div>No shell tab open</div>
          <button onClick={() => void createShell()} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-panel)", color: "var(--text-muted)", cursor: "pointer", fontSize: 12 }}>
            New shell
          </button>
        </div>
      ) : (
        <div className="terminal-panel-body">
          <div ref={containerRef} className="terminal-panel-surface" style={{ fontFamily, fontSize }} />
        </div>
      )}
    </div>
  );
}
