"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import type { GitChangeFile, GitChangesResponse, GitDiffResponse } from "@/lib/types";
import styles from "./GitChangesPanel.module.css";

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
  return `${prefix}${value === null ? "?" : value}`;
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

function isHeaderLine(line: string): boolean {
  return line.startsWith("diff --git") || line.startsWith("index ") || line.startsWith("--- ") || line.startsWith("+++ ");
}

function diffKind(line: string): "hunk" | "added" | "removed" | "header" | "binary" | "plain" {
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+") && !line.startsWith("+++")) return "added";
  if (line.startsWith("-") && !line.startsWith("---")) return "removed";
  if (isHeaderLine(line)) return "header";
  if (line.startsWith("Binary files ")) return "binary";
  return "plain";
}

function StateView({ title, description, loading = false, tone, action }: {
  title: string;
  description?: string;
  loading?: boolean;
  tone?: "danger";
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className={styles.state}>
      <div className={styles.stateCard} data-tone={tone}>
        {loading ? (
          <span className={styles.spinner} aria-hidden="true" />
        ) : (
          <svg className={styles.stateIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            {tone === "danger" ? <><line x1="12" y1="7" x2="12" y2="13" /><circle cx="12" cy="17" r="1" fill="currentColor" stroke="none" /></> : <line x1="8" y1="12" x2="16" y2="12" />}
          </svg>
        )}
        <h3 className={styles.stateTitle}>{title}</h3>
        {description && <p className={styles.stateDescription}>{description}</p>}
        {action && <button type="button" className={styles.stateAction} onClick={action.onClick}>{action.label}</button>}
      </div>
    </div>
  );
}

function UnifiedDiffView({ diff, loading, error, onRetry }: { diff: string | null; loading: boolean; error: string | null; onRetry: () => void }) {
  const lines = useMemo(() => diff?.split("\n") ?? [], [diff]);
  const maxLines = 5000;
  const visibleLines = lines.slice(0, maxLines);
  const truncated = lines.length > maxLines;

  if (loading) return <StateView title="Loading diff" description="Reading the selected file’s working-tree changes." loading />;
  if (error) return <StateView title="Diff unavailable" description={error} tone="danger" action={{ label: "Try again", onClick: onRetry }} />;
  if (!diff?.trim()) return <StateView title="No textual diff" description="This file is unchanged, binary, or has no displayable patch." />;

  return (
    <div className={styles.diffContent}>
      {visibleLines.map((line, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: unified diff lines have no stable identity beyond their ordered position.
        <div key={index} className={styles.diffLine} data-kind={diffKind(line)}>
          <span className={styles.lineNumber}>{index + 1}</span>
          <span className={styles.lineText}>{line || "\u00a0"}</span>
        </div>
      ))}
      {truncated && <div className={styles.truncated}>Diff truncated after {maxLines.toLocaleString()} lines.</div>}
    </div>
  );
}

export function GitChangesPanel({ cwd, refreshKey, onCountChange }: Props) {
  const [data, setData] = useState<GitChangesResponse | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
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
      setDetailOpen(false);
      setError(null);
      onCountChange?.(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/git/changes?cwd=${encodeURIComponent(cwd)}`, { cache: "no-store" });
      const json = await response.json() as GitChangesResponse;
      if (!response.ok) throw new Error(json.error ?? `HTTP ${response.status}`);
      setData(json);
      onCountChange?.(json.isGit ? json.totals.files : null);
      setSelectedPath((current) => current && json.files.some((file) => file.path === current) ? current : json.files[0]?.path ?? null);
      setDetailOpen(false);
      setReloadToken((value) => value + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setData(null);
      setSelectedPath(null);
      setDetailOpen(false);
      onCountChange?.(null);
    } finally {
      setLoading(false);
    }
  }, [cwd, onCountChange]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey intentionally triggers a server refresh.
  useEffect(() => { void fetchChanges(); }, [fetchChanges, refreshKey]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadToken intentionally retries the selected diff.
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
      .then(async (response) => {
        const json = await response.json() as GitDiffResponse;
        if (!response.ok) throw new Error(json.error ?? `HTTP ${response.status}`);
        return json;
      })
      .then((json) => { if (!cancelled) setDiff(json.diff); })
      .catch((caught) => {
        if (!cancelled) {
          setDiff(null);
          setDiffError(caught instanceof Error ? caught.message : String(caught));
        }
      })
      .finally(() => { if (!cancelled) setDiffLoading(false); });
    return () => { cancelled = true; };
  }, [cwd, selectedPath, data?.isGit, reloadToken]);

  const selectedFile = data?.files.find((file) => file.path === selectedPath) ?? null;

  let content: ReactNode;
  if (!cwd) {
    content = <StateView title="Choose a project" description="Select a workspace to inspect its uncommitted changes." />;
  } else if (loading && !data) {
    content = <StateView title="Loading changes" description="Reading git status and file statistics." loading />;
  } else if (error) {
    content = <StateView title="Changes unavailable" description={error} tone="danger" action={{ label: "Try again", onClick: () => { void fetchChanges(); } }} />;
  } else if (data && !data.isGit) {
    content = <StateView title="Not a git repository" description="The selected workspace has no git metadata." />;
  } else if (data && data.files.length === 0) {
    content = <StateView title="Working tree clean" description="There are no uncommitted changes in this scope." />;
  } else if (data) {
    content = (
      <div className={styles.body} data-detail={detailOpen}>
        <nav className={styles.list} aria-label="Changed files">
          {data.files.map((file) => {
            const active = file.path === selectedPath;
            return (
              <button
                type="button"
                key={`${file.status}:${file.path}:${file.oldPath ?? ""}`}
                className={styles.fileButton}
                aria-pressed={active}
                onClick={() => { setSelectedPath(file.path); setDetailOpen(true); }}
                title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
              >
                <span className={styles.status} data-status={file.status} title={statusTitle(file)}>{file.status}</span>
                <span className={styles.fileIdentity}>
                  <span className={styles.filePath}>{displayPath(file.path, data.scopePath)}</span>
                  {file.oldPath && <span className={styles.oldPath}>from {displayPath(file.oldPath, data.scopePath)}</span>}
                </span>
                <span className={styles.fileStats}>
                  <span className={styles.additions}>{formatStat(file.additions, "+")}</span>
                  <span className={styles.deletions}>{formatStat(file.deletions, "-")}</span>
                </span>
              </button>
            );
          })}
        </nav>
        <section className={styles.diff} aria-label="Selected file diff">
          {selectedFile && (
            <header className={styles.diffHeader}>
              <button type="button" className={styles.back} onClick={() => setDetailOpen(false)} aria-label="Back to changed files">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg>
              </button>
              <span className={styles.status} data-status={selectedFile.status} title={statusTitle(selectedFile)}>{selectedFile.status}</span>
              <span className={styles.diffPath}>{displayPath(selectedFile.path, data.scopePath)}</span>
              {selectedFile.binary && <span className={styles.binary}>binary</span>}
            </header>
          )}
          <UnifiedDiffView diff={diff} loading={diffLoading} error={diffError} onRetry={() => setReloadToken((value) => value + 1)} />
        </section>
      </div>
    );
  } else {
    content = null;
  }

  return (
    <div className={styles.panel}>
      <header className={styles.header}>
        <h2 className={styles.heading}>Changes</h2>
        {data?.isGit && (
          <div className={styles.summary}>
            <span>{data.totals.files} files</span>
            <span className={styles.additions}>+{data.totals.additions}</span>
            <span className={styles.deletions}>-{data.totals.deletions}</span>
            <span className={styles.summaryBranch}>{data.branch ?? "detached"}</span>
          </div>
        )}
        <button type="button" className={styles.refresh} data-loading={loading || undefined} onClick={() => { void fetchChanges(); }} disabled={loading || !cwd} aria-label="Refresh changes">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 0 1-15.5 6.3L3 16" /><path d="M3 21v-5h5" /><path d="M3 12A9 9 0 0 1 18.5 5.7L21 8" /><path d="M21 3v5h-5" /></svg>
        </button>
      </header>
      {content}
    </div>
  );
}
