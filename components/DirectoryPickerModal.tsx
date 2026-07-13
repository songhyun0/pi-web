"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import styles from "./DirectoryPickerModal.module.css";
import { Button, Dialog } from "./ui";

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

function FolderIcon() {
  return (
    <svg className={styles.folderIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H10l2 2.5h6.5A2.5 2.5 0 0 1 21 9v8.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5v-11Z" />
    </svg>
  );
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
  const [dialogOpen, setDialogOpen] = useState(false);
  const [cwd, setCwd] = useState<string>(initialPath || homeDir || "");
  const [parent, setParent] = useState<string | null>(null);
  const [entries, setEntries] = useState<DirectoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const requestSeq = useRef(0);

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
    } catch (cause) {
      if (seq !== requestSeq.current) return;
      setBrowseError(cause instanceof Error ? cause.message : String(cause));
      setEntries([]);
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setDialogOpen(true);
  }, []);

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
  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setDialogOpen(nextOpen);
    if (!nextOpen) onClose();
  }, [onClose]);

  const footerMessage = error ?? (cwd ? `Selected: ${displayPath(cwd, homeDir)}` : "Choose a directory");

  return (
    <Dialog
      open={dialogOpen}
      onOpenChange={handleOpenChange}
      title={title}
      description={subtitle}
      closeLabel="Close directory picker"
      variant="adaptive"
      size="lg"
      height="viewport"
      bodyLayout="flush"
      initialFocus="panel"
      className={styles.dialog}
      bodyClassName={styles.body}
      footer={
        <div className={styles.footer}>
          <div
            className={styles.footerStatus}
            data-error={Boolean(error) || undefined}
            title={error ?? cwd}
            aria-live="polite"
          >
            {footerMessage}
          </div>
          <div className={styles.footerActions}>
            <Button onClick={() => handleOpenChange(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!cwd || loading || busy}
              loading={busy}
              onClick={selectCurrent}
            >
              {busy ? "Checking…" : selectLabel}
            </Button>
          </div>
        </div>
      }
    >
      <div className={styles.workspace}>
        <section className={styles.location} aria-label="Current directory">
          <code className={styles.currentPath} title={cwd}>
            {cwd ? displayPath(cwd, homeDir) : "Loading…"}
          </code>
          {quickLocations.length > 0 && (
            <nav className={styles.quickLocations} aria-label="Quick locations">
              {quickLocations.map((item) => {
                const current = item.path === cwd;
                return (
                  <Button
                    key={item.path}
                    variant="ghost"
                    size="compact"
                    className={styles.quickLocation}
                    data-current={current || undefined}
                    aria-current={current ? "location" : undefined}
                    onClick={() => void loadPath(item.path)}
                    disabled={loading && current}
                  >
                    {item.label}
                  </Button>
                );
              })}
            </nav>
          )}
        </section>

        <section
          className={styles.directoryList}
          aria-label={cwd ? `Directories in ${displayPath(cwd, homeDir)}` : "Directories"}
          aria-busy={loading || undefined}
        >
          {parent && (
            <Button
              variant="ghost"
              size="compact"
              className={styles.directoryRow}
              onClick={() => void loadPath(parent)}
              title={parent}
            >
              <span className={styles.parentGlyph} aria-hidden="true">..</span>
              <span className={styles.entryName}>Parent directory</span>
              <span className={styles.parentPath}>{displayPath(parent, homeDir)}</span>
            </Button>
          )}

          {loading ? (
            <output className={styles.state}>Loading directories…</output>
          ) : browseError ? (
            <div className={styles.state} data-error="true" role="alert">{browseError}</div>
          ) : entries.length === 0 ? (
            <div className={styles.state}>No subdirectories</div>
          ) : (
            entries.map((entry) => (
              <Button
                key={entry.path}
                variant="ghost"
                size="compact"
                className={styles.directoryRow}
                onClick={() => void loadPath(entry.path)}
                title={entry.path}
              >
                <FolderIcon />
                <span className={styles.entryName}>{entry.name}</span>
                <span className={styles.entryModified}>{formatModified(entry.modified)}</span>
              </Button>
            ))
          )}
        </section>
      </div>
    </Dialog>
  );
}
