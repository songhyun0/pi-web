"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface DirectoryEntry {
  name: string;
  path: string;
  modified: string;
}

interface BrowseResponse {
  cwd?: string;
  parent?: string | null;
  entries?: DirectoryEntry[];
  error?: string;
}

interface Props {
  initialPath?: string | null;
  homeDir?: string;
  title?: string;
  subtitle?: string;
  selectLabel?: string;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onSelect: (path: string) => void | Promise<void>;
}

function displayPath(filePath: string, homeDir?: string): string {
  return homeDir && filePath.startsWith(homeDir) ? `~${filePath.slice(homeDir.length)}` : filePath;
}

function formatModified(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function DirectoryPickerModal({
  initialPath,
  homeDir,
  title = "Choose directory",
  subtitle = "Browse folders and select a workspace directory.",
  selectLabel = "Select this folder",
  busy = false,
  error,
  onClose,
  onSelect,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [cwd, setCwd] = useState<string>(initialPath || homeDir || "");
  const [parent, setParent] = useState<string | null>(null);
  const [entries, setEntries] = useState<DirectoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const requestSeq = useRef(0);
  const dialogRef = useRef<HTMLDivElement>(null);

  const loadPath = useCallback(async (pathToLoad?: string | null) => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setBrowseError(null);
    try {
      const query = pathToLoad ? `?cwd=${encodeURIComponent(pathToLoad)}` : "";
      const res = await fetch(`/api/cwd/browse${query}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({})) as BrowseResponse;
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      if (seq !== requestSeq.current) return;
      setCwd(data.cwd ?? pathToLoad ?? "");
      setParent(data.parent ?? null);
      setEntries(data.entries ?? []);
    } catch (e) {
      if (seq !== requestSeq.current) return;
      setBrowseError(e instanceof Error ? e.message : String(e));
      setEntries([]);
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted) dialogRef.current?.focus();
  }, [mounted]);

  useEffect(() => {
    void loadPath(initialPath || homeDir || null);
  }, [homeDir, initialPath, loadPath]);

  const quickLocations = useMemo(() => {
    const items: Array<{ label: string; path: string }> = [];
    if (initialPath) items.push({ label: "Current", path: initialPath });
    if (homeDir) items.push({ label: "Home", path: homeDir });
    if (cwd.startsWith("/")) items.push({ label: "Root", path: "/" });

    const seen = new Set<string>();
    return items.filter((item) => {
      if (!item.path || seen.has(item.path)) return false;
      seen.add(item.path);
      return true;
    });
  }, [cwd, homeDir, initialPath]);

  const selectCurrent = useCallback(() => {
    if (!cwd || busy) return;
    void onSelect(cwd);
  }, [busy, cwd, onSelect]);

  if (!mounted) return null;

  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        background: "rgba(0,0,0,0.18)",
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onKeyDownCapture={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
        style={{
          width: "min(760px, 100%)",
          maxHeight: "min(720px, calc(100vh - 40px))",
          display: "flex",
          flexDirection: "column",
          border: "1px solid var(--border)",
          borderRadius: 10,
          background: "var(--bg)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.28)",
          overflow: "hidden",
          outline: "none",
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: "var(--text)", fontSize: 14, fontWeight: 650 }}>{title}</div>
            <div style={{ marginTop: 3, color: "var(--text-dim)", fontSize: 11, fontFamily: "var(--font-mono)" }}>{subtitle}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="Close"
            style={{
              width: 26,
              height: 26,
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "var(--bg-panel)",
              color: "var(--text-muted)",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", background: "var(--bg-panel)" }}>
          <div
            title={cwd}
            style={{
              padding: "7px 9px",
              border: "1px solid var(--border)",
              borderRadius: 6,
              background: "var(--bg)",
              color: "var(--text)",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {cwd ? displayPath(cwd, homeDir) : "Loading…"}
          </div>
          {quickLocations.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
              {quickLocations.map((item) => (
                <button
                  key={item.path}
                  type="button"
                  onClick={() => void loadPath(item.path)}
                  disabled={loading && item.path === cwd}
                  style={{
                    padding: "4px 8px",
                    border: "1px solid var(--border)",
                    borderRadius: 999,
                    background: item.path === cwd ? "var(--bg-selected)" : "var(--bg)",
                    color: item.path === cwd ? "var(--accent)" : "var(--text-muted)",
                    cursor: "pointer",
                    fontSize: 11,
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={{ flex: 1, minHeight: 280, overflowY: "auto", padding: 10 }}>
          {parent && (
            <button
              type="button"
              onClick={() => void loadPath(parent)}
              style={{
                width: "100%",
                minWidth: 0,
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 10px",
                border: "none",
                borderRadius: 7,
                background: "transparent",
                color: "var(--text-muted)",
                cursor: "pointer",
                textAlign: "left",
                fontSize: 12,
              }}
            >
              <span style={{ width: 18, color: "var(--text-dim)", fontFamily: "var(--font-mono)", flexShrink: 0 }}>..</span>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Parent directory</span>
              <span style={{ maxWidth: "45%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 11 }}>
                {displayPath(parent, homeDir)}
              </span>
            </button>
          )}

          {loading ? (
            <div style={{ padding: 18, color: "var(--text-dim)", fontSize: 12, textAlign: "center" }}>Loading directories…</div>
          ) : browseError ? (
            <div style={{ padding: 18, color: "#ef4444", fontSize: 12, textAlign: "center", overflowWrap: "anywhere" }}>{browseError}</div>
          ) : entries.length === 0 ? (
            <div style={{ padding: 18, color: "var(--text-dim)", fontSize: 12, textAlign: "center" }}>No subdirectories</div>
          ) : (
            entries.map((entry) => (
              <button
                key={entry.path}
                type="button"
                onClick={() => void loadPath(entry.path)}
                title={entry.path}
                style={{
                  width: "100%",
                  minWidth: 0,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 10px",
                  border: "none",
                  borderRadius: 7,
                  background: "transparent",
                  color: "var(--text)",
                  cursor: "pointer",
                  textAlign: "left",
                  fontSize: 12,
                }}
                onMouseEnter={(event) => { event.currentTarget.style.background = "var(--bg-hover)"; }}
                onMouseLeave={(event) => { event.currentTarget.style.background = "transparent"; }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H10l2 2.5h6.5A2.5 2.5 0 0 1 21 9v8.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5v-11Z" />
                </svg>
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.name}</span>
                <span style={{ color: "var(--text-dim)", fontSize: 11, flexShrink: 0 }}>{formatModified(entry.modified)}</span>
              </button>
            ))
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 14px", borderTop: "1px solid var(--border)", background: "var(--bg-panel)" }}>
          <div style={{ flex: 1, minWidth: 0, color: error ? "#ef4444" : "var(--text-dim)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={error ?? cwd}>
            {error ?? (cwd ? `Selected: ${displayPath(cwd, homeDir)}` : "Choose a directory")}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: "6px 10px",
                borderRadius: 6,
                border: "1px solid var(--border)",
                background: "var(--bg)",
                color: "var(--text-muted)",
                cursor: "pointer",
                fontSize: 12,
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!cwd || loading || busy}
              onClick={selectCurrent}
              style={{
                padding: "6px 10px",
                borderRadius: 6,
                border: !cwd || loading || busy ? "1px solid var(--border)" : "1px solid var(--accent)",
                background: !cwd || loading || busy ? "var(--bg-hover)" : "var(--accent)",
                color: !cwd || loading || busy ? "var(--text-dim)" : "#fff",
                cursor: !cwd || loading || busy ? "not-allowed" : "pointer",
                fontSize: 12,
              }}
            >
              {busy ? "Checking…" : selectLabel}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
