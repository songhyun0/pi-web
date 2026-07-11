"use client";

import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { encodeFilePathForApi, getRelativeFilePath, joinFilePath } from "@/lib/file-paths";
import styles from "./FileExplorer.module.css";
import { FolderIcon, getFileIcon } from "./FileIcons";
import { Button, Skeleton } from "./ui";

interface FileEntry {
  name: string;
  isDir: boolean;
  size: number;
  modified: string;
}

interface FileNode {
  name: string;
  fullPath: string;
  isDir: boolean;
  size: number;
  children?: FileNode[];
  loaded?: boolean;
}

interface Props {
  cwd: string;
  onOpenFile: (filePath: string, fileName: string) => void;
  refreshKey?: number;
  onAtMention?: (relativePath: string, isDir: boolean) => void;
}

async function fetchEntries(dirPath: string): Promise<FileNode[]> {
  const encoded = encodeFilePathForApi(dirPath);
  const response = await fetch(`/api/files/${encoded}?type=list`);
  if (!response.ok) {
    let message = `Failed to load files (HTTP ${response.status})`;
    try {
      const data = await response.json() as { error?: string };
      if (data.error) message = data.error;
    } catch {
      // Ignore non-JSON error bodies.
    }
    throw new Error(message);
  }
  const data = await response.json() as { entries?: FileEntry[] };
  return (data.entries ?? []).map((entry) => ({
    name: entry.name,
    fullPath: joinFilePath(dirPath, entry.name),
    isDir: entry.isDir,
    size: entry.size,
    children: entry.isDir ? [] : undefined,
    loaded: !entry.isDir,
  }));
}

function TreeNode({
  node,
  depth,
  cwd,
  onOpenFile,
  onAtMention,
  expandedPaths,
  onToggleExpanded,
  refreshKey,
}: {
  node: FileNode;
  depth: number;
  cwd: string;
  onOpenFile: (filePath: string, fileName: string) => void;
  onAtMention?: (relativePath: string, isDir: boolean) => void;
  expandedPaths: Set<string>;
  onToggleExpanded: (fullPath: string, open: boolean) => void;
  refreshKey?: number;
}) {
  const open = expandedPaths.has(node.fullPath);
  const [children, setChildren] = useState<FileNode[]>(node.children ?? []);
  const [loaded, setLoaded] = useState(node.loaded ?? false);
  const [loading, setLoading] = useState(false);

  const loadChildren = useCallback(async (force = false) => {
    if (loaded && !force) return;
    setLoading(true);
    try {
      setChildren(await fetchEntries(node.fullPath));
      setLoaded(true);
    } catch {
      // Keep the directory closed on a nested load failure.
    } finally {
      setLoading(false);
    }
  }, [loaded, node.fullPath]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey intentionally reloads expanded directories.
  useEffect(() => {
    if (open && loaded) void loadChildren(true);
    // refreshKey intentionally requests a fresh listing for expanded directories.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const handleOpen = useCallback(() => {
    if (node.isDir) {
      const next = !open;
      onToggleExpanded(node.fullPath, next);
      if (next && !loaded) void loadChildren();
    } else {
      onOpenFile(node.fullPath, node.name);
    }
  }, [node.isDir, node.fullPath, node.name, open, loaded, loadChildren, onOpenFile, onToggleExpanded]);

  return (
    <div className={styles.node} style={{ "--file-depth": depth } as CSSProperties}>
      <div
        className={styles.row}
        role="treeitem"
        aria-selected={false}
        tabIndex={0}
        aria-expanded={node.isDir ? open : undefined}
        aria-label={`${node.isDir ? open ? "Collapse" : "Expand" : "Open"} ${node.name}`}
        onClick={handleOpen}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            handleOpen();
          }
        }}
      >
        <span className={styles.chevronSlot}>
          {node.isDir && (
            <svg className={styles.chevron} data-open={open || undefined} viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="3 2 7 5 3 8" /></svg>
          )}
        </span>
        <span className={styles.fileIcon}>{node.isDir ? <FolderIcon size={15} open={open} /> : getFileIcon(node.name, 15)}</span>
        <span className={styles.name} title={node.fullPath}>{node.name}</span>
        {loading && (
          <svg className={styles.spinner} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3.8-7.4" /></svg>
        )}
        <span className={styles.actions}>
          {onAtMention && (
            <button
              type="button"
              className={styles.action}
              aria-label={`Mention ${node.name} in chat`}
              title="Mention in chat"
              onClick={(event) => {
                event.stopPropagation();
                onAtMention(getRelativeFilePath(node.fullPath, cwd), node.isDir);
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" /></svg>
            </button>
          )}
          {!node.isDir && (
            <a
              className={styles.action}
              href={`/api/files/${encodeFilePathForApi(node.fullPath)}?type=download`}
              download
              aria-label={`Download ${node.name}`}
              title="Download file"
              onClick={(event) => event.stopPropagation()}
            >
              <span className="pi-sr-only">Download {node.name}</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
            </a>
          )}
        </span>
      </div>
      {node.isDir && open && (
        <div>
          {children.map((child) => (
            <TreeNode
              key={child.fullPath}
              node={child}
              depth={depth + 1}
              cwd={cwd}
              onOpenFile={onOpenFile}
              onAtMention={onAtMention}
              expandedPaths={expandedPaths}
              onToggleExpanded={onToggleExpanded}
              refreshKey={refreshKey}
            />
          ))}
          {children.length === 0 && loaded && (
            <div className={styles.emptyDirectory} style={{ "--file-depth": depth + 1 } as CSSProperties}>Empty directory</div>
          )}
        </div>
      )}
    </div>
  );
}

export function FileExplorer({ cwd, onOpenFile, refreshKey, onAtMention }: Props) {
  const [roots, setRoots] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [retryKey, setRetryKey] = useState(0);
  const previousCwdRef = useRef<string | null>(null);

  const handleToggleExpanded = useCallback((fullPath: string, open: boolean) => {
    setExpandedPaths((current) => {
      const next = new Set(current);
      if (open) next.add(fullPath);
      else next.delete(fullPath);
      return next;
    });
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey and retryKey intentionally reload the root listing.
  useEffect(() => {
    const cwdChanged = previousCwdRef.current !== cwd;
    previousCwdRef.current = cwd;
    if (cwdChanged) setExpandedPaths(new Set());

    setLoading(cwdChanged);
    setError(null);
    fetchEntries(cwd)
      .then((entries) => setRoots(entries))
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : String(loadError)))
      .finally(() => setLoading(false));
  }, [cwd, refreshKey, retryKey]);

  if (loading) {
    return (
      <div className={styles.state}>
        <div className={styles.skeletons}><Skeleton height={30} /><Skeleton height={30} /><Skeleton height={30} /><Skeleton height={30} /></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.state} data-tone="danger" role="alert">
        <span>{error}</span>
        <Button size="compact" onClick={() => setRetryKey((key) => key + 1)}>Retry</Button>
      </div>
    );
  }

  if (roots.length === 0) {
    return <div className={styles.state}>No files found in this directory.</div>;
  }

  return (
    <div className={styles.root} role="tree" aria-label="Project files">
      {roots.map((node) => (
        <TreeNode
          key={node.fullPath}
          node={node}
          depth={0}
          cwd={cwd}
          onOpenFile={onOpenFile}
          onAtMention={onAtMention}
          expandedPaths={expandedPaths}
          onToggleExpanded={handleToggleExpanded}
          refreshKey={refreshKey}
        />
      ))}
    </div>
  );
}
