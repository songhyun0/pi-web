"use client";

import type { FitAddon as GhosttyFitAddon, Terminal as GhosttyTerminal } from "ghostty-web";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./TerminalPanel.module.css";
import { Button, Dialog } from "./ui";

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

function terminalErrorMessage(caught: unknown): string {
  const message = caught instanceof Error ? caught.message : String(caught);
  return /failed to fetch|networkerror/i.test(message)
    ? "The companion terminal service could not be reached."
    : message;
}

function TerminalState({ title, description, tone, loading = false, actions }: { title: string; description: string; tone?: "danger"; loading?: boolean; actions?: ReactNode }) {
  return (
    <div className={styles.state}>
      <div className={styles.stateCard} data-tone={tone}>
        {loading ? <span className={styles.stateSpinner} aria-hidden="true" /> : (
        <svg className={styles.stateIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="4" width="18" height="16" rx="2" />
          {tone === "danger" ? <><line x1="12" y1="8" x2="12" y2="13" /><circle cx="12" cy="16" r="1" fill="currentColor" stroke="none" /></> : <><polyline points="7 9 10 12 7 15" /><line x1="12" y1="15" x2="17" y2="15" /></>}
        </svg>
)}
        <h3 className={styles.stateTitle}>{title}</h3>
        <p className={styles.stateDescription}>{description}</p>
        {actions && <div className={styles.stateActions}>{actions}</div>}
      </div>
    </div>
  );
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
  const [pendingAction, setPendingAction] = useState<{ kind: "kill" | "restart"; shell: ShellTab } | null>(null);

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
    if (!scopeId) {
      setShellTabs([]);
      setActiveShellId(null);
      setStatus("idle");
      setStatusText("No shell");
      return;
    }
    if (!fontConfig) {
      setStatus("loading");
      setStatusText("Loading configuration…");
      return;
    }
    if (!fontConfig.shellsUrl) {
      setShellTabs([]);
      setActiveShellId(null);
      setStatus("error");
      setStatusText("Service unavailable");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    setStatusText("Loading shells…");
    refreshShells(readActiveShellId(scopeId))
      .then((shells) => {
        if (!cancelled && shells.length === 0) { setStatus("idle"); setStatusText("No shell"); }
      })
      .catch((caught) => {
        if (!cancelled) {
          setError(terminalErrorMessage(caught));
          setStatus("error");
          setStatusText("Service unavailable");
        }
      });
    return () => { cancelled = true; };
  }, [fontConfig, refreshShells, scopeId]);

  const retryShellInventory = useCallback(() => {
    setError(null);
    setStatus("loading");
    setStatusText("Loading shells…");
    void refreshShells(scopeId ? readActiveShellId(scopeId) : null)
      .then((shells) => { if (shells.length === 0) { setStatus("idle"); setStatusText("No shell"); } })
      .catch((caught) => {
        setError(terminalErrorMessage(caught));
        setStatus("error");
        setStatusText("Service unavailable");
      });
  }, [refreshShells, scopeId]);

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
      setError(terminalErrorMessage(e));
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
      if (shells.length === 0) { setStatus("idle"); setStatusText("No shell"); }
      setActiveShellId((current) => {
        if (current && current !== shellId && shells.some((shell) => shell.shellId === current)) return current;
        const next = shells[shells.length - 1]?.shellId ?? null;
        writeActiveShellId(scopeId, next);
        return next;
      });
    } catch (e) {
      setError(terminalErrorMessage(e));
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
      setError(terminalErrorMessage(e));
    }
  }, [activeShell, cwd, fontConfig?.shellsUrl, scopeId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: connectVersion intentionally rebuilds the Ghostty/WebSocket attachment.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !cwd || !fontConfig || !scopeId || !activeShellId) {
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
        const bodyStyles = window.getComputedStyle(document.body);
        const background = rootStyles.getPropertyValue("--bg").trim() || bodyStyles.backgroundColor;
        const foreground = rootStyles.getPropertyValue("--text").trim() || bodyStyles.color;
        const cursor = rootStyles.getPropertyValue("--accent").trim() || foreground;
        const selectionBackground = rootStyles.getPropertyValue("--bg-selected").trim() || background;

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
            selectionBackground,
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
        setStatus("error");
        setStatusText("Error");
        setError(terminalErrorMessage(e));
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

  const confirmPendingAction = () => {
    const pending = pendingAction;
    setPendingAction(null);
    if (!pending) return;
    if (pending.kind === "restart") void restartActiveShell();
    else void killShell(pending.shell.shellId);
  };

  return (
    <div className={styles.panel}>
      <Dialog
        open={pendingAction !== null}
        onOpenChange={(open) => { if (!open) setPendingAction(null); }}
        title={pendingAction?.kind === "restart" ? "Restart shell?" : "Kill shell?"}
        description="Running processes in this shell may be interrupted."
        variant="sheet"
        size="sm"
        footer={
          <>
            <Button onClick={() => setPendingAction(null)}>Cancel</Button>
            <Button variant="danger" onClick={confirmPendingAction}>{pendingAction?.kind === "restart" ? "Restart shell" : "Kill shell"}</Button>
          </>
        }
      >
        <div className={styles.confirmCopy}>
          <p>{pendingAction?.kind === "restart" ? "The active shell will be terminated and recreated in the same workspace." : "This shell and its running processes will be terminated."}</p>
          {pendingAction && <div className={styles.confirmPath}>{pendingAction.shell.title} · {pendingAction.shell.cwd}</div>}
        </div>
      </Dialog>

      <header className={styles.header}>
        <h2 className={styles.heading}>Terminal</h2>
        <output className={styles.status} data-status={status} aria-live="polite">
          <span className={styles.statusDot} aria-hidden="true" />
          <span className={styles.statusText}>{statusText}</span>
        </output>
        {cwd && <span className={styles.cwd} title={cwd}>{basename(cwd)}</span>}
        <div className={styles.headerActions}>
          <button type="button" className={styles.action} onClick={() => { void createShell(); }} disabled={!cwd || !scopeId || !fontConfig?.shellsUrl}>New shell</button>
          <button
            type="button"
            className={styles.action}
            onClick={() => { if (activeShell) setPendingAction({ kind: "restart", shell: activeShell }); }}
            disabled={!activeShell || status === "loading" || status === "connecting"}
          >
            Restart
          </button>
        </div>
      </header>

      {shellTabs.length > 0 && (
        <div className={styles.tabs} role="tablist" aria-label="Terminal shells">
        {shellTabs.map((tab) => {
          const active = tab.shellId === activeShellId;
          return (
            <div key={tab.shellId} className={styles.tabItem}>
              <button
                type="button"
                role="tab"
                className={styles.tabSelect}
                aria-selected={active}
                onClick={() => setActiveShellId(tab.shellId)}
                title={`${tab.title} · ${tab.attached ? "attached" : "detached"}`}
              >
                <span>{tab.title}</span>
                {!tab.attached && <span className={styles.detached}>detached</span>}
              </button>
              <button
                type="button"
                className={styles.tabClose}
                aria-label={`Kill ${tab.title}`}
                title={`Kill ${tab.title}`}
                onClick={() => setPendingAction({ kind: "kill", shell: tab })}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><line x1="7" y1="7" x2="17" y2="17" /><line x1="17" y1="7" x2="7" y2="17" /></svg>
              </button>
            </div>
          );
        })}
        </div>
      )}

      {!cwd ? (
        <TerminalState title="Choose a project" description="Select a workspace before starting a terminal." />
      ) : !fontConfig ? (
        <TerminalState title="Loading terminal" description="Reading terminal service and font configuration." loading />
      ) : !scopeId || !fontConfig.shellsUrl ? (
        <TerminalState title="Terminal service unavailable" description="Start the companion terminal service, then reopen this view." tone="danger" />
      ) : error ? (
        <TerminalState
          title="Terminal unavailable"
          description={error}
          tone="danger"
          actions={
            <>
              {activeShell && <button type="button" className={styles.action} onClick={() => setPendingAction({ kind: "restart", shell: activeShell })}>Restart shell</button>}
              <button type="button" className={styles.action} onClick={retryShellInventory}>Try again</button>
            </>
          }
        />
      ) : !activeShell ? (
        <TerminalState
          title="No shell open"
          description="Create a shell to start an interactive terminal in this workspace."
          actions={<button type="button" className={styles.action} onClick={() => { void createShell(); }}>New shell</button>}
        />
      ) : (
        <div className={styles.body}>
          <div ref={containerRef} className={styles.surface} style={{ fontFamily, fontSize }} />
        </div>
      )}
    </div>
  );
}
