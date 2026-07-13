"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { filterTreeRows, flattenTree, type TreeFilterMode, type TreeRow } from "@/lib/session-tree-view";
import type { SessionTreeNode } from "@/lib/types";
import styles from "./BranchNavigator.module.css";

interface Props {
  tree: SessionTreeNode[];
  activeLeafId: string | null;
  onLeafChange: (leafId: string | null) => void;
  /** When true, renders as a compact inline button for embedding in a top bar */
  inline?: boolean;
  /** When inline, use this ref's bounding rect to size/position the dropdown */
  containerRef?: React.RefObject<HTMLElement | null>;
  /** Controlled open state for inline mode */
  open?: boolean;
  /** Called when the button is clicked in inline mode */
  onToggle?: () => void;
  /** Whether a session is currently active (used to show appropriate empty reason) */
  hasSession?: boolean;
  /** When inline, render icon-only (no text label) to save horizontal space */
  compact?: boolean;
  /** Render only the controlled floating panel; used by compact overflow chrome. */
  popupOnly?: boolean;
  /** Focus target restored when a popup-only panel is dismissed. */
  restoreFocusRef?: React.RefObject<HTMLElement | null>;
}

function hasBranch(nodes: SessionTreeNode[]): boolean {
  const stack = [...nodes];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    if (node.children.length > 1) return true;
    stack.push(...node.children);
  }
  return false;
}

function RoleBadge({ role }: { role?: string }) {
  if (!role) return null;
  const label = role === "user" ? "U" : role === "assistant" ? "A" : role.slice(0, 1).toUpperCase();
  return <span className={styles.roleBadge} data-role={role}>{label}</span>;
}

function TreeRowView({ row, onSelect, onToggleFold }: { row: TreeRow; onSelect: (id: string) => void; onToggleFold: (row: TreeRow) => void }) {
  return (
    <li
      className={styles.treeRow}
      data-active={row.isActive || undefined}
      data-path={row.isOnPath || undefined}
      style={{ "--tree-depth-width": `${Math.max(18, row.depth * 16 + 16)}px` } as React.CSSProperties}
    >
      <span className={styles.connector} aria-hidden="true">{row.connector}</span>
      <button
        type="button"
        className={styles.foldButton}
        disabled={!row.hasChildren}
        onClick={() => onToggleFold(row)}
        aria-label={`${row.isFolded ? "Expand" : "Collapse"} ${row.title}`}
        aria-expanded={row.hasChildren ? !row.isFolded : undefined}
      >
        {row.hasChildren ? (row.isFolded ? "▸" : "▾") : "·"}
      </button>
      <button
        type="button"
        className={styles.rowSelect}
        onClick={() => onSelect(row.id)}
        aria-current={row.isActive ? "true" : undefined}
        title={row.label ? `${row.title} · #${row.label}` : row.title}
      >
        <span className={styles.nodeDot} aria-hidden="true" />
        <RoleBadge role={row.role} />
        {row.skipped > 0 && <span className={styles.skipped}>+{row.skipped}</span>}
        <span className={styles.rowTitle}>
          {row.label ? <><span className={styles.label}>#{row.label}</span><span className={styles.separator}> · </span></> : null}
          {row.title}
        </span>
        {row.childCount > 1 && <span className={styles.childCount} title={`${row.childCount} child branches`}>{row.childCount}</span>}
      </button>
    </li>
  );
}

export function BranchNavigator({ tree, activeLeafId, onLeafChange, inline, containerRef, open: openProp, onToggle, hasSession, compact, popupOnly, restoreFocusRef }: Props) {
  const [openInternal, setOpenInternal] = useState(false);
  const open = openProp !== undefined ? openProp : openInternal;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const panelId = useId();
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const [query, setQuery] = useState("");
  const [filterMode, setFilterMode] = useState<TreeFilterMode>("default");
  const [foldedIds, setFoldedIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!open || !inline) return;
    const anchor = containerRef?.current ?? buttonRef.current;
    if (!anchor) return;
    const update = () => {
      const rect = anchor.getBoundingClientRect();
      setDropdownPos({ top: rect.bottom, left: rect.left, width: rect.width });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(anchor);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [open, inline, containerRef]);

  const dismissInlinePanel = useCallback(() => {
    if (onToggle) onToggle();
    else setOpenInternal(false);
    window.requestAnimationFrame(() => restoreFocusRef?.current?.focus({ preventScroll: true }));
  }, [onToggle, restoreFocusRef]);

  useEffect(() => {
    if (!open || !inline || !popupOnly || !dropdownPos) return;
    const focusFrame = window.requestAnimationFrame(() => {
      (searchRef.current ?? panelRef.current)?.focus({ preventScroll: true });
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      dismissInlinePanel();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [dismissInlinePanel, dropdownPos, inline, open, popupOnly]);

  const rows = useMemo(() => flattenTree(tree, activeLeafId, { foldedIds, showLabelTimestamps: true }), [activeLeafId, foldedIds, tree]);
  const filteredRows = useMemo(() => filterTreeRows(rows, query, filterMode), [filterMode, query, rows]);
  const handleSelect = useCallback((id: string) => onLeafChange(id), [onLeafChange]);
  const toggleFold = useCallback((row: TreeRow) => {
    if (!row.hasChildren) return;
    setFoldedIds((current) => {
      const next = new Set(current);
      if (next.has(row.id)) next.delete(row.id);
      else next.add(row.id);
      return next;
    });
  }, []);

  const noBranchReason = !hasSession
    ? "No active session"
    : rows.length === 0
      ? "This session has no tree entries"
      : !hasBranch(tree)
        ? "This session has no branches; showing the linear tree"
        : null;
  const hasContent = hasSession !== false && rows.length > 0;

  const branchIcon = (
    <svg className={styles.icon} data-active={hasContent || undefined} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  );

  const chevron = (
    <svg className={styles.chevron} data-open={open || undefined} viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="2 3.5 5 6.5 8 3.5" />
    </svg>
  );

  const panel = hasContent ? (
    <div className={styles.panel}>
      <div className={styles.filters}>
        <input
          ref={searchRef}
          className={styles.search}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search tree…"
          aria-label="Search conversation tree"
        />
        <select className={styles.filterSelect} value={filterMode} onChange={(event) => setFilterMode(event.target.value as TreeFilterMode)} aria-label="Filter conversation tree">
          <option value="default">Default</option>
          <option value="no-tools">No tools</option>
          <option value="user-only">Users</option>
          <option value="labeled-only">Labels</option>
          <option value="all">All</option>
        </select>
      </div>
      {noBranchReason && <div className={styles.reason}>{noBranchReason}</div>}
      <ul className={styles.rows} aria-label="Conversation branches">
        {filteredRows.length === 0 ? (
          <li className={styles.empty}>No matching tree entries</li>
        ) : filteredRows.map((row) => (
          <TreeRowView key={row.key} row={row} onSelect={handleSelect} onToggleFold={toggleFold} />
        ))}
      </ul>
    </div>
  ) : (
    <div className={styles.noContent}>{noBranchReason}</div>
  );

  if (inline) {
    const floatingPanel = open && dropdownPos ? (
      <section
        ref={panelRef}
        id={panelId}
        className={styles.floatingPanel}
        style={{ top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width }}
        tabIndex={popupOnly ? -1 : undefined}
        aria-label="Session tree"
      >
        {panel}
      </section>
    ) : null;

    if (popupOnly) return floatingPanel;

    return (
      <div className={styles.inlineRoot}>
        <button
          type="button"
          ref={buttonRef}
          className={styles.inlineTrigger}
          data-open={open || undefined}
          onClick={() => onToggle ? onToggle() : setOpenInternal((value) => !value)}
          title="Branches"
          aria-label="Branches"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
        >
          {branchIcon}
          {!compact && <span>Branches</span>}
        </button>
        {floatingPanel}
      </div>
    );
  }

  return (
    <div className={styles.blockRoot}>
      <button
        type="button"
        className={styles.blockTrigger}
        onClick={() => setOpenInternal((value) => !value)}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
      >
        {branchIcon}
        <span>Branches</span>
        {chevron}
      </button>
      {open && (
        <div id={panelId} className={styles.blockPanel}>
          {panel}
        </div>
      )}
    </div>
  );
}
