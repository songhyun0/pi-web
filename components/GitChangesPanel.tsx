"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { GitChangeFile, GitChangesResponse, GitDiffResponse } from "@/lib/types";

interface Props {
  cwd: string | null | undefined;
  refreshKey?: number;
  onCountChange?: (count: number | null) => void;
}

function displayPath(filePath: string, scopePath?: string | null): string {
  if (scopePath && filePath.startsWith(`${scopePath}/`)) return filePath.slice(scopePath.length + 1);
  return filePath;
}

function formatStat(value: number | null, prefix: "+" | "-"): string {
  if (value === null) return `${prefix}?`;
  return `${prefix}${value}`;
}

function statusTitle(file: GitChangeFile): string {
  if (file.untracked) return "Untracked";
  if (file.status === "M") return "Modified";
  if (file.status === "A") return "Added";
  if (file.status === "D") return "Deleted";
  if (file.status === "R") return "Renamed";
  if (file.status === "C") return "Copied";
  if (file.status === "U") return "Unmerged";
  return "Changed";
}

function statusColor(status: GitChangeFile["status"]): string {
  if (status === "?") return "#a78bfa";
  if (status === "A") return "#22c55e";
  if (status === "D") return "#f87171";
  if (status === "R" || status === "C") return "#60a5fa";
  if (status === "U") return "#f59e0b";
  return "var(--text-dim)";
}

function isHeaderLine(line: string): boolean {
  return line.startsWith("diff --git") || line.startsWith("index ") || line.startsWith("--- ") || line.startsWith("+++ ");
}

function lineStyle(line: string): { bg: string; color: string; border: string; fontWeight?: number } {
  if (line.startsWith("@@")) {
    return { bg: "rgba(96,165,250,0.12)", color: "var(--accent)", border: "var(--accent)", fontWeight: 600 };
  }
  if (line.startsWith("+") && !line.startsWith("+++")) {
    return { bg: "rgba(34,197,94,0.12)", color: "var(--text)", border: "#22c55e" };
  }
  if (line.startsWith("-") && !line.startsWith("---")) {
    return { bg: "rgba(248,113,113,0.13)", color: "var(--text)", border: "#f87171" };
  }
  if (isHeaderLine(line)) {
    return { bg: "var(--bg-panel)", color: "var(--text-muted)", border: "transparent", fontWeight: line.startsWith("diff --git") ? 700 : 400 };
  }
  if (line.startsWith("Binary files ")) {
    return { bg: "rgba(96,165,250,0.10)", color: "var(--text-muted)", border: "var(--accent)" };
  }
  return { bg: "transparent", color: "var(--text)", border: "transparent" };
}

function UnifiedDiffView({ diff, loading, error }: { diff: string | null; loading: boolean; error: string | null }) {
  const lines = useMemo(() => diff?.split("\n") ?? [], [diff]);
  const maxLines = 5000;
  const visibleLines = lines.slice(0, maxLines);
  const truncated = lines.length > maxLines;

  if (loading) {
    return <div style={{ padding: 14, fontSize: 12, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>Loading diff…</div>;
  }
  if (error) {
    return <div style={{ padding: 14, fontSize: 12, color: "#f87171", lineHeight: 1.5 }}>{error}</div>;
  }
  if (!diff?.trim()) {
    return <div style={{ padding: 14, fontSize: 12, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>No diff for this file</div>;
  }

  return (
    <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: 1.55, minWidth: 0 }}>
      {visibleLines.map((line, index) => {
        const style = lineStyle(line);
        return (
          <div
            key={index}
            style={{
              display: "flex",
              minWidth: 0,
              background: style.bg,
              borderLeft: `3px solid ${style.border}`,
            }}
          >
            <span
              style={{
                width: 44,
                padding: "0 8px",
                color: "var(--text-dim)",
                background: isHeaderLine(line) ? "var(--bg-panel)" : "color-mix(in srgb, var(--bg-panel) 70%, transparent)",
                borderRight: "1px solid var(--border)",
                textAlign: "right",
                userSelect: "none",
                flexShrink: 0,
              }}
            >
              {index + 1}
            </span>
            <span
              style={{
                flex: 1,
                minWidth: 0,
                padding: "0 10px",
                color: style.color,
                fontWeight: style.fontWeight ?? 400,
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
              }}
            >
              {line || "\u00a0"}
            </span>
          </div>
        );
      })}
      {truncated && (
        <div style={{ padding: "8px 12px", color: "var(--text-dim)", background: "var(--bg-panel)", borderTop: "1px solid var(--border)" }}>
          Diff truncated after {maxLines.toLocaleString()} lines
        </div>
      )}
    </div>
  );
}

export function GitChangesPanel({ cwd, refreshKey, onCountChange }: Props) {
  const [data, setData] = useState<GitChangesResponse | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const fetchChanges = useCallback(async () => {
    if (!cwd) {
      setData(null);
      setSelectedPath(null);
      setError(null);
      onCountChange?.(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/git/changes?cwd=${encodeURIComponent(cwd)}`, { cache: "no-store" });
      const json = await res.json() as GitChangesResponse;
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setData(json);
      onCountChange?.(json.isGit ? json.totals.files : null);
      setSelectedPath((prev) => {
        if (prev && json.files.some((file) => file.path === prev)) return prev;
        return json.files[0]?.path ?? null;
      });
      setReloadToken((v) => v + 1);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      setData(null);
      setSelectedPath(null);
      onCountChange?.(null);
    } finally {
      setLoading(false);
    }
  }, [cwd, onCountChange]);

  useEffect(() => {
    void fetchChanges();
  }, [fetchChanges, refreshKey]);

  useEffect(() => {
    if (!cwd || !selectedPath || !data?.isGit) {
      setDiff(null);
      setDiffError(null);
      setDiffLoading(false);
      return;
    }

    let cancelled = false;
    setDiffLoading(true);
    setDiffError(null);
    fetch(`/api/git/diff?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(selectedPath)}`, { cache: "no-store" })
      .then(async (res) => {
        const json = await res.json() as GitDiffResponse;
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
        return json;
      })
      .then((json) => {
        if (!cancelled) setDiff(json.diff);
      })
      .catch((e) => {
        if (!cancelled) {
          setDiff(null);
          setDiffError(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => {
        if (!cancelled) setDiffLoading(false);
      });

    return () => { cancelled = true; };
  }, [cwd, selectedPath, data?.isGit, reloadToken]);

  const selectedFile = data?.files.find((file) => file.path === selectedPath) ?? null;

  return (
    <div className="git-changes-panel">
      <style>{`
        .git-changes-panel { height: 100%; display: flex; flex-direction: column; min-width: 0; background: var(--bg); }
        .git-changes-body { flex: 1; min-height: 0; display: flex; }
        .git-changes-list { width: 230px; min-width: 190px; overflow: auto; border-right: 1px solid var(--border); background: var(--bg-panel); }
        .git-changes-diff { flex: 1; min-width: 0; overflow: auto; background: var(--bg); }
        @media (max-width: 1100px) {
          .git-changes-body { flex-direction: column; }
          .git-changes-list { width: auto; min-width: 0; max-height: 178px; border-right: none; border-bottom: 1px solid var(--border); }
        }
      `}</style>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          minHeight: 36,
          padding: "0 10px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-panel)",
          flexShrink: 0,
          fontSize: 12,
        }}
      >
        <strong style={{ color: "var(--text)", fontSize: 12 }}>Changes</strong>
        {data?.isGit && (
          <>
            <span style={{ color: "var(--text-dim)" }}>{data.totals.files} files</span>
            <span style={{ color: "#22c55e", fontFamily: "var(--font-mono)" }}>+{data.totals.additions}</span>
            <span style={{ color: "#f87171", fontFamily: "var(--font-mono)" }}>-{data.totals.deletions}</span>
            <span style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {data.branch ?? "detached"} · {data.base}
            </span>
          </>
        )}
        <button
          onClick={() => void fetchChanges()}
          disabled={loading || !cwd}
          title="Refresh changes"
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 24,
            height: 24,
            padding: 0,
            background: "transparent",
            border: "1px solid var(--border)",
            borderRadius: 5,
            color: loading ? "var(--text-dim)" : "var(--text-muted)",
            cursor: loading || !cwd ? "default" : "pointer",
            opacity: !cwd ? 0.45 : 1,
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12a9 9 0 0 1-15.5 6.3L3 16" />
            <path d="M3 21v-5h5" />
            <path d="M3 12A9 9 0 0 1 18.5 5.7L21 8" />
            <path d="M21 3v5h-5" />
          </svg>
        </button>
      </div>

      {!cwd ? (
        <div style={{ padding: 16, fontSize: 12, color: "var(--text-dim)" }}>Select a project to view changes</div>
      ) : loading && !data ? (
        <div style={{ padding: 16, fontSize: 12, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>Loading changes…</div>
      ) : error ? (
        <div style={{ padding: 16, fontSize: 12, color: "#f87171", lineHeight: 1.5 }}>{error}</div>
      ) : data && !data.isGit ? (
        <div style={{ padding: 16, fontSize: 12, color: "var(--text-dim)" }}>Not a git repository</div>
      ) : data && data.files.length === 0 ? (
        <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontSize: 12 }}>
          No uncommitted changes
        </div>
      ) : data ? (
        <div className="git-changes-body">
          <div className="git-changes-list">
            {data.files.map((file) => {
              const active = file.path === selectedPath;
              return (
                <button
                  key={`${file.status}:${file.path}:${file.oldPath ?? ""}`}
                  onClick={() => setSelectedPath(file.path)}
                  title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
                  style={{
                    width: "100%",
                    display: "grid",
                    gridTemplateColumns: "18px minmax(0, 1fr) auto",
                    gap: 7,
                    alignItems: "center",
                    padding: "7px 10px",
                    border: "none",
                    borderBottom: "1px solid var(--border)",
                    background: active ? "var(--bg-selected)" : "transparent",
                    color: active ? "var(--text)" : "var(--text-muted)",
                    cursor: "pointer",
                    textAlign: "left",
                    fontSize: 11,
                  }}
                >
                  <span
                    title={statusTitle(file)}
                    style={{
                      width: 18,
                      color: statusColor(file.status),
                      fontFamily: "var(--font-mono)",
                      fontWeight: 700,
                      textAlign: "center",
                    }}
                  >
                    {file.status}
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--font-mono)", color: active ? "var(--text)" : "var(--text-muted)" }}>
                      {displayPath(file.path, data.scopePath)}
                    </span>
                    {file.oldPath && (
                      <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-dim)", marginTop: 2, fontFamily: "var(--font-mono)" }}>
                        from {displayPath(file.oldPath, data.scopePath)}
                      </span>
                    )}
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: "var(--font-mono)", fontSize: 10 }}>
                    <span style={{ color: "#22c55e" }}>{formatStat(file.additions, "+")}</span>
                    <span style={{ color: "#f87171" }}>{formatStat(file.deletions, "-")}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="git-changes-diff">
            {selectedFile && (
              <div style={{
                position: "sticky",
                top: 0,
                zIndex: 2,
                display: "flex",
                alignItems: "center",
                gap: 8,
                minHeight: 30,
                padding: "0 10px",
                borderBottom: "1px solid var(--border)",
                background: "var(--bg-panel)",
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--text-muted)",
              }}>
                <span style={{ color: statusColor(selectedFile.status), fontWeight: 700 }}>{selectedFile.status}</span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{displayPath(selectedFile.path, data.scopePath)}</span>
                {selectedFile.binary && <span style={{ marginLeft: "auto", color: "var(--text-dim)" }}>binary</span>}
              </div>
            )}
            <UnifiedDiffView diff={diff} loading={diffLoading} error={diffError} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
