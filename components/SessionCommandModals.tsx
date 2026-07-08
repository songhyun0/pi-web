"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { SessionTreeNode } from "@/lib/types";
import { filterTreeRows, flattenTree, type TreeFilterMode, type TreeRow } from "@/lib/session-tree-view";
import type { ForkCandidate } from "@/hooks/useAgentSession";

type ModalShellProps = {
  title: string;
  subtitle: string;
  width?: string;
  children: ReactNode;
  footer: ReactNode;
  onClose: () => void;
  onKeyDownCapture?: (event: KeyboardEvent<HTMLDivElement>) => void;
};

function ModalShell({ title, subtitle, width = "min(760px, 100%)", children, footer, onClose, onKeyDownCapture }: ModalShellProps) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 95,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        background: "rgba(0,0,0,0.18)",
        boxSizing: "border-box",
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDownCapture={onKeyDownCapture}
    >
      <div
        role="dialog"
        aria-modal="true"
        style={{
          width,
          maxHeight: "min(720px, calc(100% - 40px))",
          display: "flex",
          flexDirection: "column",
          border: "1px solid var(--border)",
          borderRadius: 10,
          background: "var(--bg)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.28)",
          overflow: "hidden",
        }}
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
        {children}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 14px", borderTop: "1px solid var(--border)", background: "var(--bg-panel)" }}>
          {footer}
        </div>
      </div>
    </div>
  );
}

function PrimaryButton({ children, disabled, onClick }: { children: ReactNode; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        padding: "6px 10px",
        borderRadius: 6,
        border: disabled ? "1px solid var(--border)" : "1px solid var(--accent)",
        background: disabled ? "var(--bg-hover)" : "var(--accent)",
        color: disabled ? "var(--text-dim)" : "#fff",
        cursor: disabled ? "not-allowed" : "pointer",
        fontSize: 12,
      }}
    >
      {children}
    </button>
  );
}

function SecondaryButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
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
      {children}
    </button>
  );
}


function RoleBadge({ role }: { role?: string }) {
  if (!role) return null;
  const label = role === "user" ? "U" : role === "assistant" ? "A" : role.slice(0, 1).toUpperCase();
  const accent = role === "user" ? "var(--accent)" : "var(--text-dim)";
  return (
    <span style={{
      width: 18,
      height: 18,
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 5,
      border: role === "user" ? "1px solid color-mix(in srgb, var(--accent) 35%, var(--border))" : "1px solid var(--border)",
      background: role === "user" ? "color-mix(in srgb, var(--accent) 8%, var(--bg))" : "var(--bg-hover)",
      color: accent,
      fontFamily: "var(--font-mono)",
      fontSize: 10,
      flexShrink: 0,
    }}>{label}</span>
  );
}

export function SessionTreeSelectorModal({
  tree,
  activeLeafId,
  loading,
  error,
  onClose,
  onSelect,
  onLabelChange,
}: {
  tree: SessionTreeNode[];
  activeLeafId: string | null;
  loading?: boolean;
  error?: string | null;
  onClose: () => void;
  onSelect: (entryId: string, options?: { summarize?: boolean }) => void | Promise<void>;
  onLabelChange?: (entryId: string, label: string | undefined) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [filterMode, setFilterMode] = useState<TreeFilterMode>("default");
  const [activeIndex, setActiveIndex] = useState(0);
  const [summarize, setSummarize] = useState(false);
  const [showLabelTimestamps, setShowLabelTimestamps] = useState(false);
  const [foldedIds, setFoldedIds] = useState<Set<string>>(() => new Set());
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState("");
  const [labelSaving, setLabelSaving] = useState(false);
  const [labelError, setLabelError] = useState<string | null>(null);
  const [navigating, setNavigating] = useState(false);
  const rowRefs = useRef<Array<HTMLDivElement | null>>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const rows = useMemo(() => flattenTree(tree, activeLeafId, { foldedIds, showLabelTimestamps }), [tree, activeLeafId, foldedIds, showLabelTimestamps]);
  const filteredRows = useMemo(() => filterTreeRows(rows, query, filterMode), [filterMode, query, rows]);

  useEffect(() => {
    const activeRowIndex = filteredRows.findIndex((row) => row.isActive);
    setActiveIndex(activeRowIndex >= 0 ? activeRowIndex : 0);
  }, [filteredRows]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    rowRefs.current.length = filteredRows.length;
  }, [filteredRows.length]);

  useEffect(() => {
    rowRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const selected = filteredRows[activeIndex];
  const confirmRow = useCallback(async (row: TreeRow | undefined) => {
    if (!row || navigating) return;
    setNavigating(true);
    try {
      await onSelect(row.id, { summarize });
      onClose();
    } finally {
      setNavigating(false);
    }
  }, [navigating, onClose, onSelect, summarize]);
  const confirm = useCallback(() => confirmRow(selected), [confirmRow, selected]);
  const toggleFold = useCallback((row: TreeRow | undefined) => {
    if (!row?.hasChildren) return;
    setFoldedIds((current) => {
      const next = new Set(current);
      if (next.has(row.id)) next.delete(row.id);
      else next.add(row.id);
      return next;
    });
  }, []);
  const beginEditLabel = useCallback((row: TreeRow | undefined) => {
    if (!row || !onLabelChange) return;
    setEditingLabelId(row.id);
    setLabelDraft(row.label ?? "");
    setLabelError(null);
  }, [onLabelChange]);
  const saveLabel = useCallback(async (row: TreeRow, label: string | undefined) => {
    if (!onLabelChange || labelSaving) return;
    setLabelSaving(true);
    setLabelError(null);
    try {
      await onLabelChange(row.id, label);
      setEditingLabelId(null);
      setLabelDraft("");
    } catch (err) {
      setLabelError(err instanceof Error ? err.message : String(err));
    } finally {
      setLabelSaving(false);
    }
  }, [labelSaving, onLabelChange]);

  return (
    <ModalShell
      title="Navigate session tree"
      subtitle="CLI-style tree · ↑/↓ move · PgUp/PgDn jump · ←/→ fold · L label · Enter navigate"
      onClose={onClose}
      onKeyDownCapture={(event) => {
        if ((event.target as HTMLElement | null)?.dataset.treeLabelEditor === "true") return;
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        } else if (event.key === "ArrowDown") {
          event.preventDefault();
          setActiveIndex((idx) => Math.min(Math.max(0, filteredRows.length - 1), idx + 1));
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          setActiveIndex((idx) => Math.max(0, idx - 1));
        } else if (event.key === "PageDown") {
          event.preventDefault();
          setActiveIndex((idx) => Math.min(Math.max(0, filteredRows.length - 1), idx + 10));
        } else if (event.key === "PageUp") {
          event.preventDefault();
          setActiveIndex((idx) => Math.max(0, idx - 10));
        } else if (event.key === "Home") {
          event.preventDefault();
          setActiveIndex(0);
        } else if (event.key === "End") {
          event.preventDefault();
          setActiveIndex(Math.max(0, filteredRows.length - 1));
        } else if (event.key === "ArrowLeft") {
          event.preventDefault();
          if (selected?.hasChildren && !selected.isFolded) toggleFold(selected);
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          if (selected?.hasChildren && selected.isFolded) toggleFold(selected);
        } else if (event.key.toLowerCase() === "l") {
          event.preventDefault();
          beginEditLabel(selected);
        } else if (event.key === "Enter") {
          event.preventDefault();
          void confirm();
        }
      }}
      footer={(
        <>
          <label style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0, color: "var(--text-muted)", fontSize: 12 }}>
            <input type="checkbox" checked={summarize} onChange={(event) => setSummarize(event.target.checked)} />
            <span>Summarize abandoned branch</span>
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
            <PrimaryButton disabled={!selected || navigating} onClick={() => void confirm()}>{navigating ? "Navigating…" : "Navigate"}</PrimaryButton>
          </div>
        </>
      )}
    >
      <div style={{ padding: 14, borderBottom: "1px solid var(--border)", display: "grid", gap: 10 }}>
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search labels, text, tool names, roles, or ids…"
          style={{
            width: "100%",
            padding: "9px 10px",
            borderRadius: 7,
            border: "1px solid var(--border)",
            background: "var(--bg-panel)",
            color: "var(--text)",
            outline: "none",
            fontSize: 13,
          }}
        />
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <select
            value={filterMode}
            onChange={(event) => setFilterMode(event.target.value as TreeFilterMode)}
            style={{ border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)", padding: "6px 8px", fontSize: 12 }}
            title="Filter mode"
          >
            <option value="default">Default</option>
            <option value="no-tools">No tools</option>
            <option value="user-only">User only</option>
            <option value="labeled-only">Labeled only</option>
            <option value="all">All entries</option>
          </select>
          <label style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text-muted)", fontSize: 12 }}>
            <input type="checkbox" checked={showLabelTimestamps} onChange={(event) => setShowLabelTimestamps(event.target.checked)} />
            label timestamps
          </label>
          <button type="button" onClick={() => setFoldedIds(new Set(rows.filter((row) => row.hasChildren && !row.isOnPath).map((row) => row.id)))} style={{ border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text-muted)", borderRadius: 6, padding: "6px 8px", fontSize: 12, cursor: "pointer" }}>Fold all</button>
          <button type="button" onClick={() => setFoldedIds(new Set())} style={{ border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text-muted)", borderRadius: 6, padding: "6px 8px", fontSize: 12, cursor: "pointer" }}>Unfold all</button>
          <span style={{ marginLeft: "auto", color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 11 }}>{filteredRows.length}/{rows.length}</span>
        </div>
        {labelError && <div style={{ color: "#ef4444", fontSize: 12 }}>{labelError}</div>}
      </div>
      <div style={{ flex: 1, minHeight: 260, maxHeight: "min(520px, calc(100vh - 250px))", overflowY: "auto", padding: 10 }}>
        {loading ? (
          <div style={{ padding: 18, color: "var(--text-dim)", fontSize: 13, textAlign: "center" }}>Loading full session tree…</div>
        ) : error ? (
          <div style={{ padding: 18, color: "#ef4444", fontSize: 13, textAlign: "center" }}>{error}</div>
        ) : filteredRows.length === 0 ? (
          <div style={{ padding: 18, color: "var(--text-dim)", fontSize: 13, textAlign: "center" }}>
            {rows.length === 0 ? "No entries in this session yet" : "No matching tree entries"}
          </div>
        ) : filteredRows.map((row, index) => {
          const active = index === activeIndex;
          return (
            <div key={row.key}>
              <div
                ref={(node) => { rowRefs.current[index] = node; }}
                role="button"
                tabIndex={-1}
                onClick={() => setActiveIndex(index)}
                onDoubleClick={() => void confirmRow(row)}
                style={{
                  width: "100%",
                  minWidth: 0,
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  padding: "6px 8px",
                  borderRadius: 7,
                  border: active ? "1px solid color-mix(in srgb, var(--accent) 42%, var(--border))" : "1px solid transparent",
                  background: active ? "color-mix(in srgb, var(--accent) 9%, var(--bg))" : row.isActive ? "var(--bg-selected)" : "transparent",
                  color: row.isActive ? "var(--text)" : row.isOnPath ? "var(--text-muted)" : "var(--text-dim)",
                  cursor: "pointer",
                  textAlign: "left",
                  fontSize: 12,
                }}
              >
                <span style={{ width: Math.max(26, row.depth * 22 + 18), flexShrink: 0, color: row.isOnPath ? "var(--text-muted)" : "var(--text-dim)", fontFamily: "var(--font-mono)", whiteSpace: "pre" }}>{row.connector}</span>
                <button
                  type="button"
                  onClick={(event) => { event.stopPropagation(); toggleFold(row); }}
                  disabled={!row.hasChildren}
                  title={row.hasChildren ? (row.isFolded ? "Unfold" : "Fold") : "No children"}
                  style={{ width: 16, height: 16, border: "none", background: "transparent", color: row.hasChildren ? "var(--text-dim)" : "transparent", cursor: row.hasChildren ? "pointer" : "default", padding: 0, flexShrink: 0 }}
                >
                  {row.hasChildren ? (row.isFolded ? "▸" : "▾") : "·"}
                </button>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: row.isActive ? "var(--accent)" : row.isOnPath ? "var(--text-muted)" : "var(--border)", flexShrink: 0 }} />
                <RoleBadge role={row.role} />
                {row.skipped > 0 && <span style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 10, flexShrink: 0 }}>+{row.skipped}</span>}
                <span style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 6, overflow: "hidden", flex: 1 }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.title}</span>
                  {row.label && <span title={row.labelTimestampText ? `Labeled ${row.labelTimestampText}` : "Label"} style={{ border: "1px solid color-mix(in srgb, var(--accent) 38%, var(--border))", borderRadius: 999, color: "var(--accent)", padding: "1px 6px", fontSize: 10, fontFamily: "var(--font-mono)", flexShrink: 0 }}>#{row.label}{row.labelTimestampText ? ` · ${row.labelTimestampText}` : ""}</span>}
                </span>
                {row.childCount > 1 && <span style={{ color: "var(--accent)", fontFamily: "var(--font-mono)", fontSize: 10, flexShrink: 0 }}>{row.childCount} branches</span>}
                {onLabelChange && <button type="button" onClick={(event) => { event.stopPropagation(); beginEditLabel(row); }} style={{ border: "1px solid var(--border)", background: "var(--bg-panel)", color: "var(--text-dim)", borderRadius: 5, padding: "2px 5px", fontSize: 10, cursor: "pointer", flexShrink: 0 }}>label</button>}
                {row.isActive && <span style={{ color: "var(--accent)", fontFamily: "var(--font-mono)", fontSize: 10, flexShrink: 0 }}>current</span>}
              </div>
              {editingLabelId === row.id && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "4px 8px 8px", paddingLeft: Math.max(34, row.depth * 22 + 34) }}>
                  <input
                    data-tree-label-editor="true"
                    value={labelDraft}
                    onChange={(event) => setLabelDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") { event.preventDefault(); void saveLabel(row, labelDraft.trim() || undefined); }
                      if (event.key === "Escape") { event.preventDefault(); setEditingLabelId(null); }
                    }}
                    autoFocus
                    placeholder="Label/bookmark…"
                    style={{ minWidth: 180, flex: 1, border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-panel)", color: "var(--text)", padding: "6px 8px", fontSize: 12 }}
                  />
                  <button type="button" disabled={labelSaving} onClick={() => void saveLabel(row, labelDraft.trim() || undefined)} style={{ border: "1px solid var(--accent)", background: "var(--accent)", color: "white", borderRadius: 6, padding: "6px 8px", fontSize: 12, cursor: labelSaving ? "default" : "pointer" }}>{labelSaving ? "Saving…" : "Save"}</button>
                  {row.label && <button type="button" disabled={labelSaving} onClick={() => void saveLabel(row, undefined)} style={{ border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text-muted)", borderRadius: 6, padding: "6px 8px", fontSize: 12, cursor: labelSaving ? "default" : "pointer" }}>Clear</button>}
                  <button type="button" onClick={() => setEditingLabelId(null)} style={{ border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text-muted)", borderRadius: 6, padding: "6px 8px", fontSize: 12, cursor: "pointer" }}>Cancel</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </ModalShell>
  );
}

function filterForkCandidates(candidates: ForkCandidate[], query: string): ForkCandidate[] {
  const q = query.trim().toLowerCase();
  if (!q) return candidates;
  return candidates.filter((candidate) => `${candidate.text} ${candidate.entryId}`.toLowerCase().includes(q));
}

export function ForkSelectorModal({
  onClose,
  onLoadCandidates,
  onFork,
  busyEntryId,
  disabled,
  disabledReason,
}: {
  onClose: () => void;
  onLoadCandidates: () => Promise<ForkCandidate[]>;
  onFork: (entryId: string) => void | Promise<void>;
  busyEntryId?: string | null;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<ForkCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    onLoadCandidates()
      .then((items) => {
        if (cancelled) return;
        setCandidates(items);
        setActiveIndex(Math.max(0, items.length - 1));
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setCandidates([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [onLoadCandidates]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = useMemo(() => filterForkCandidates(candidates, query), [candidates, query]);

  useEffect(() => {
    setActiveIndex((index) => {
      if (filtered.length === 0) return 0;
      return Math.min(index, filtered.length - 1);
    });
  }, [filtered.length]);

  useEffect(() => {
    rowRefs.current.length = filtered.length;
  }, [filtered.length]);

  useEffect(() => {
    rowRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const selected = filtered[activeIndex];
  const confirmCandidate = useCallback(async (candidate: ForkCandidate | undefined) => {
    if (!candidate || disabled || busyEntryId) return;
    await onFork(candidate.entryId);
    onClose();
  }, [busyEntryId, disabled, onClose, onFork]);
  const confirm = useCallback(() => confirmCandidate(selected), [confirmCandidate, selected]);

  return (
    <ModalShell
      title="Fork from user message"
      subtitle="CLI-style fork selector · selected text is restored in the new session editor"
      onClose={onClose}
      onKeyDownCapture={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        } else if (event.key === "ArrowDown") {
          event.preventDefault();
          setActiveIndex((idx) => Math.min(Math.max(0, filtered.length - 1), idx + 1));
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          setActiveIndex((idx) => Math.max(0, idx - 1));
        } else if (event.key === "Enter") {
          event.preventDefault();
          void confirm();
        }
      }}
      footer={(
        <>
          <div style={{ color: "var(--text-dim)", fontSize: 11, fontFamily: "var(--font-mono)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {filtered.length} message{filtered.length === 1 ? "" : "s"}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
            <PrimaryButton disabled={!selected || disabled || Boolean(busyEntryId)} onClick={() => void confirm()}>
              {busyEntryId ? "Creating…" : "Fork"}
            </PrimaryButton>
          </div>
        </>
      )}
    >
      <div style={{ padding: 14, borderBottom: "1px solid var(--border)" }}>
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter user messages…"
          style={{
            width: "100%",
            padding: "9px 10px",
            borderRadius: 7,
            border: "1px solid var(--border)",
            background: "var(--bg-panel)",
            color: "var(--text)",
            outline: "none",
            fontSize: 13,
          }}
        />
      </div>
      <div style={{ flex: 1, minHeight: 260, maxHeight: "min(520px, calc(100vh - 250px))", overflowY: "auto", padding: 10 }}>
        {disabled ? (
          <div style={{ padding: 18, color: "var(--text-dim)", fontSize: 13, textAlign: "center" }}>{disabledReason ?? "Fork is not available right now."}</div>
        ) : loading ? (
          <div style={{ padding: 18, color: "var(--text-dim)", fontSize: 13, textAlign: "center" }}>Loading user messages…</div>
        ) : error ? (
          <div style={{ padding: 18, color: "#ef4444", fontSize: 13, textAlign: "center" }}>{error}</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 18, color: "var(--text-dim)", fontSize: 13, textAlign: "center" }}>
            {candidates.length === 0 ? "No messages to fork from" : "No matching user messages"}
          </div>
        ) : filtered.map((candidate, index) => {
          const active = index === activeIndex;
          const preview = candidate.text.trim() || "(empty message)";
          return (
            <button
              key={candidate.entryId}
              ref={(node) => { rowRefs.current[index] = node; }}
              type="button"
              onClick={() => setActiveIndex(index)}
              onDoubleClick={() => void confirmCandidate(candidate)}
              style={{
                width: "100%",
                minWidth: 0,
                display: "grid",
                gridTemplateColumns: "auto minmax(0, 1fr) auto",
                gap: 10,
                alignItems: "start",
                padding: "8px 9px",
                borderRadius: 8,
                border: active ? "1px solid color-mix(in srgb, var(--accent) 42%, var(--border))" : "1px solid transparent",
                background: active ? "color-mix(in srgb, var(--accent) 9%, var(--bg))" : "transparent",
                color: "var(--text)",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <span style={{ color: active ? "var(--accent)" : "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 11, paddingTop: 2 }}>{String(candidates.findIndex((item) => item.entryId === candidate.entryId) + 1).padStart(2, "0")}</span>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", color: active ? "var(--text)" : "var(--text-muted)", fontSize: 13, lineHeight: 1.45, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 76, overflow: "hidden" }}>{preview}</span>
                <span style={{ display: "block", marginTop: 4, color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 10 }}>{candidate.entryId}</span>
              </span>
              {busyEntryId === candidate.entryId && <span style={{ color: "var(--accent)", fontFamily: "var(--font-mono)", fontSize: 10, paddingTop: 2 }}>creating</span>}
            </button>
          );
        })}
      </div>
    </ModalShell>
  );
}
