"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import type { SessionTreeNode } from "@/lib/types";
import { filterTreeRows, flattenTree, type TreeFilterMode, type TreeRow } from "@/lib/session-tree-view";

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
}

function hasBranch(nodes: SessionTreeNode[]): boolean {
  const stack = [...nodes];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.children.length > 1) return true;
    stack.push(...node.children);
  }
  return false;
}

function RoleBadge({ role }: { role?: string }) {
  if (!role) return null;
  const label = role === "user" ? "U" : role === "assistant" ? "A" : role.slice(0, 1).toUpperCase();
  return (
    <span style={{
      fontSize: 9,
      fontFamily: "var(--font-mono)",
      color: role === "user" ? "var(--accent)" : "var(--text-dim)",
      background: role === "user" ? "rgba(37,99,235,0.08)" : "var(--bg-hover)",
      border: `1px solid ${role === "user" ? "rgba(37,99,235,0.2)" : "var(--border)"}`,
      borderRadius: 3,
      padding: "0 4px",
      flexShrink: 0,
      lineHeight: "16px",
    }}>{label}</span>
  );
}

function TreeRowView({ row, onSelect, onToggleFold }: { row: TreeRow; onSelect: (id: string) => void; onToggleFold: (row: TreeRow) => void }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(row.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(row.id);
        }
      }}
      style={{
        display: "flex",
        alignItems: "center",
        height: 24,
        cursor: "pointer",
        gap: 5,
        color: row.isActive ? "var(--text)" : row.isOnPath ? "var(--text-muted)" : "var(--text-dim)",
      }}
      title={row.label ? `${row.title} · #${row.label}` : row.title}
    >
      <span style={{ width: Math.max(18, row.depth * 16 + 16), flexShrink: 0, color: row.isOnPath ? "var(--text-muted)" : "var(--text-dim)", fontFamily: "var(--font-mono)", whiteSpace: "pre", fontSize: 10 }}>{row.connector}</span>
      <button
        type="button"
        disabled={!row.hasChildren}
        onClick={(event) => { event.stopPropagation(); onToggleFold(row); }}
        style={{ width: 14, height: 18, border: "none", background: "transparent", padding: 0, color: row.hasChildren ? "var(--text-dim)" : "transparent", cursor: row.hasChildren ? "pointer" : "default", flexShrink: 0 }}
      >
        {row.hasChildren ? (row.isFolded ? "▸" : "▾") : "·"}
      </button>
      <span style={{
        width: 7,
        height: 7,
        borderRadius: "50%",
        flexShrink: 0,
        background: row.isActive ? "var(--accent)" : row.isOnPath ? "var(--text-muted)" : "var(--border)",
        border: row.isActive ? "none" : "1px solid var(--text-dim)",
      }} />
      <RoleBadge role={row.role} />
      {row.skipped > 0 && <span style={{ fontSize: 10, color: "var(--text-dim)", flexShrink: 0 }}>+{row.skipped}</span>}
      <span style={{ fontSize: 11, fontWeight: row.isActive ? 500 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
        {row.label ? <><span style={{ color: "var(--accent)" }}>#{row.label}</span><span style={{ color: "var(--text-dim)" }}> · </span></> : null}{row.title}
      </span>
      {row.childCount > 1 && <span style={{ color: "var(--accent)", fontFamily: "var(--font-mono)", fontSize: 9, flexShrink: 0 }}>{row.childCount}</span>}
    </div>
  );
}

export function BranchNavigator({ tree, activeLeafId, onLeafChange, inline, containerRef, open: openProp, onToggle, hasSession, compact }: Props) {
  const [openInternal, setOpenInternal] = useState(false);
  const open = openProp !== undefined ? openProp : openInternal;
  const btnRef = useRef<HTMLButtonElement>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const [query, setQuery] = useState("");
  const [filterMode, setFilterMode] = useState<TreeFilterMode>("default");
  const [foldedIds, setFoldedIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!open || !inline) return;
    const anchor = containerRef?.current ?? btnRef.current;
    if (!anchor) return;
    const update = () => {
      const rect = anchor.getBoundingClientRect();
      setDropdownPos({ top: rect.bottom, left: rect.left, width: rect.width });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(anchor);
    return () => ro.disconnect();
  }, [open, inline, containerRef]);

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
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: hasContent ? "var(--accent)" : "var(--text-dim)", flexShrink: 0 }}>
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  );

  const chevron = (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--text-dim)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 2, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>
      <polyline points="2 3.5 5 6.5 8 3.5" />
    </svg>
  );

  const panel = (
    <>
      {hasContent ? (
        <div style={{ display: "grid", gap: 8, padding: "8px 12px 10px 12px", maxHeight: 320, overflowY: "auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search tree…"
              style={{ flex: 1, minWidth: 120, border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)", padding: "6px 8px", fontSize: 11 }}
            />
            <select value={filterMode} onChange={(event) => setFilterMode(event.target.value as TreeFilterMode)} style={{ border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)", padding: "6px 6px", fontSize: 11 }}>
              <option value="default">Default</option>
              <option value="no-tools">No tools</option>
              <option value="user-only">Users</option>
              <option value="labeled-only">Labels</option>
              <option value="all">All</option>
            </select>
          </div>
          {noBranchReason && <div style={{ color: "var(--text-dim)", fontSize: 11, fontStyle: "italic" }}>{noBranchReason}</div>}
          <div style={{ display: "grid", gap: 1 }}>
            {filteredRows.length === 0 ? (
              <div style={{ padding: "8px 4px", fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>No matching tree entries</div>
            ) : filteredRows.map((row) => (
              <TreeRowView key={row.key} row={row} onSelect={handleSelect} onToggleFold={toggleFold} />
            ))}
          </div>
        </div>
      ) : (
        <div style={{ padding: "10px 16px", fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>
          {noBranchReason}
        </div>
      )}
    </>
  );

  if (inline) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "stretch" }}>
        <button
          ref={btnRef}
          onClick={() => onToggle ? onToggle() : setOpenInternal((v) => !v)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            height: "100%",
            padding: "0 12px",
            background: open ? "var(--bg-selected)" : "none",
            border: "none",
            borderTop: open ? "2px solid var(--accent)" : "2px solid transparent",
            borderRight: "1px solid var(--border)",
            cursor: "pointer",
            color: open ? "var(--text)" : "var(--text-muted)",
            fontSize: 11,
            whiteSpace: "nowrap",
            transition: "color 0.1s, background 0.1s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = open ? "var(--text)" : "var(--text-muted)"; }}
          title="Branches"
          aria-label="Branches"
          aria-pressed={open}
        >
          {branchIcon}
          {!compact && <span>Branches</span>}
        </button>
        {open && dropdownPos && (
          <div style={{
            position: "fixed",
            top: dropdownPos.top,
            left: dropdownPos.left,
            width: dropdownPos.width,
            background: "var(--bg-panel)",
            borderBottom: "1px solid var(--border)",
            zIndex: 500,
          }}>
            {panel}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ borderBottom: "1px solid var(--border)", background: "var(--bg)", flexShrink: 0, position: "relative" }}>
      <button
        onClick={() => setOpenInternal((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          width: "100%",
          padding: "5px 12px",
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "var(--text-muted)",
          fontSize: 11,
          textAlign: "left",
        }}
      >
        {branchIcon}
        <span style={{ color: "var(--text-muted)" }}>Branches</span>
        {chevron}
      </button>
      {open && (
        <div style={{
          position: "absolute",
          top: "100%",
          left: 0,
          right: 0,
          background: "var(--bg)",
          borderBottom: "1px solid var(--border)",
          boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
          zIndex: 100,
        }}>
          {panel}
        </div>
      )}
    </div>
  );
}
