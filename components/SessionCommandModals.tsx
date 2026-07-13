"use client";

import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, IconButton } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Input, Select } from "@/components/ui/Field";
import type { ForkCandidate } from "@/hooks/useAgentSession";
import { filterTreeRows, flattenTree, type TreeFilterMode, type TreeRow } from "@/lib/session-tree-view";
import type { SessionTreeNode } from "@/lib/types";

function RoleBadge({ role }: { role?: string }) {
  if (!role) return null;
  const label = role === "user" ? "U" : role === "assistant" ? "A" : role.slice(0, 1).toUpperCase();
  const accent = role === "user" ? "var(--accent)" : "var(--text-dim)";
  return (
    <span style={{
      width: 20,
      height: 20,
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      borderRadius: "var(--radius-sm)",
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

  const handleTreeKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (target?.dataset.treeLabelEditor === "true") return;
    const interactiveTarget = target?.closest("button, input, select, textarea, a[href]");
    const handlesTreeCommands = !interactiveTarget
      || target === inputRef.current
      || target?.dataset.treeRowControl === "true";
    if (!handlesTreeCommands) return;
    if (event.key === "ArrowDown") {
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
  }, [beginEditLabel, confirm, filteredRows.length, selected, toggleFold]);

  return (
    <Dialog
      open
      onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}
      title="Navigate session tree"
      description="Arrow keys move · Page keys jump · Left/Right fold · L labels · Enter navigates"
      variant="adaptive"
      size="lg"
      height="viewport"
      bodyLayout="flush"
      initialFocusRef={inputRef}
      closeLabel="Close session tree"
      footer={(
        <div style={{ width: "100%", minWidth: 0, display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "center", gap: "var(--space-2)" }}>
          <label style={{ minWidth: 0, minHeight: "var(--control-touch)", display: "inline-flex", alignItems: "center", gap: "var(--space-1)", color: "var(--text-muted)", fontSize: 13, cursor: "pointer" }}>
            <input type="checkbox" checked={summarize} onChange={(event) => setSummarize(event.target.checked)} />
            <span style={{ overflowWrap: "anywhere" }}>Summarize abandoned branch</span>
          </label>
          <div style={{ display: "flex", gap: "var(--space-1)" }}>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={!selected || navigating} loading={navigating} onClick={() => void confirm()}>{navigating ? "Navigating" : "Navigate"}</Button>
          </div>
        </div>
      )}
    >
      <div style={{ width: "100%", maxWidth: "100%", minWidth: 0, minHeight: 0, height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }} onKeyDownCapture={handleTreeKeyDown}>
      <div style={{ width: "100%", minWidth: 0, padding: "var(--space-2) calc(var(--space-2) + var(--pi-safe-area-right)) var(--space-2) calc(var(--space-2) + var(--pi-safe-area-left))", boxSizing: "border-box", borderBottom: "1px solid var(--border)", display: "grid", gap: "var(--space-1-5)" }}>
        <Input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search session tree"
          placeholder="Search labels, text, tool names, roles, or IDs…"
        />
        <div style={{ width: "100%", minWidth: 0, display: "flex", gap: "var(--space-1)", alignItems: "center", flexWrap: "wrap" }}>
          <Select
            value={filterMode}
            onChange={(event) => setFilterMode(event.target.value as TreeFilterMode)}
            aria-label="Filter tree entries"
            title="Filter mode"
          >
            <option value="default">Default</option>
            <option value="no-tools">No tools</option>
            <option value="user-only">User only</option>
            <option value="labeled-only">Labeled only</option>
            <option value="all">All entries</option>
          </Select>
          <label style={{ minHeight: "var(--control-touch)", display: "inline-flex", alignItems: "center", gap: "var(--space-1)", color: "var(--text-muted)", fontSize: 13, cursor: "pointer" }}>
            <input type="checkbox" checked={showLabelTimestamps} onChange={(event) => setShowLabelTimestamps(event.target.checked)} />
            Label timestamps
          </label>
          <Button size="compact" onClick={() => setFoldedIds(new Set(rows.filter((row) => row.hasChildren && !row.isOnPath).map((row) => row.id)))}>Fold all</Button>
          <Button size="compact" onClick={() => setFoldedIds(new Set())}>Unfold all</Button>
          <span style={{ marginLeft: "auto", color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 11 }}>{filteredRows.length}/{rows.length}</span>
        </div>
        {labelError && <div role="alert" style={{ color: "var(--error)", fontSize: 13 }}>{labelError}</div>}
      </div>
      <div style={{ width: "100%", minWidth: 0, flex: "1 1 auto", minHeight: 0, overflowY: "auto", overscrollBehavior: "contain", padding: "var(--space-1) calc(var(--space-1) + var(--pi-safe-area-right)) var(--space-1) calc(var(--space-1) + var(--pi-safe-area-left))", boxSizing: "border-box" }}>
        {loading ? (
          <div style={{ padding: 18, color: "var(--text-dim)", fontSize: 13, textAlign: "center" }}>Loading full session tree…</div>
        ) : error ? (
          <div role="alert" style={{ padding: "var(--space-2)", color: "var(--error)", fontSize: 13, textAlign: "center" }}>{error}</div>
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
                style={{
                  width: "100%",
                  minWidth: 0,
                  minHeight: "var(--control-touch)",
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-1)",
                  padding: "var(--space-half) var(--space-1)",
                  borderRadius: "var(--radius-md)",
                  border: 0,
                  background: active || row.isActive ? "var(--bg-selected)" : "transparent",
                  color: row.isActive ? "var(--text)" : row.isOnPath ? "var(--text-muted)" : "var(--text-dim)",
                  fontSize: 12,
                  overflow: "hidden",
                }}
              >
                <span style={{ width: Math.min(56, Math.max(26, row.depth * 22 + 18)), overflow: "hidden", flexShrink: 0, color: row.isOnPath ? "var(--text-muted)" : "var(--text-dim)", fontFamily: "var(--font-mono)", whiteSpace: "pre" }}>{row.connector}</span>
                <IconButton
                  label={row.hasChildren ? (row.isFolded ? "Unfold branch" : "Fold branch") : "No child branches"}
                  size="compact"
                  onClick={(event) => { event.stopPropagation(); toggleFold(row); }}
                  disabled={!row.hasChildren}
                  style={{ flexShrink: 0 }}
                >
                  <span aria-hidden="true">{row.hasChildren ? (row.isFolded ? "▸" : "▾") : "·"}</span>
                </IconButton>
                <button
                  type="button"
                  onClick={() => setActiveIndex(index)}
                  onDoubleClick={() => void confirmRow(row)}
                  aria-current={row.isActive ? "true" : undefined}
                  data-tree-row-control="true"
                  style={{ minWidth: 0, minHeight: "var(--control-touch)", flex: 1, display: "flex", alignItems: "center", gap: "var(--space-1)", padding: 0, color: "inherit", background: "transparent", border: 0, cursor: "pointer", textAlign: "left" }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: row.isActive ? "var(--accent)" : row.isOnPath ? "var(--text-muted)" : "var(--border)", flexShrink: 0 }} />
                  <RoleBadge role={row.role} />
                  <span style={{ minWidth: 0, display: "flex", alignItems: "center", gap: "var(--space-half)", overflow: "hidden", flex: 1 }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.title}</span>
                    {row.skipped > 0 && <span style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 10, flexShrink: 0 }}>+{row.skipped}</span>}
                    {row.label && <span title={row.labelTimestampText ? `Labeled ${row.labelTimestampText}` : "Label"} style={{ color: "var(--text-muted)", fontSize: 10, fontFamily: "var(--font-mono)", flexShrink: 0 }}>#{row.label}{row.labelTimestampText ? ` · ${row.labelTimestampText}` : ""}</span>}
                    {row.childCount > 1 && <span style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 10, flexShrink: 0 }}>{row.childCount} branches</span>}
                    {row.isActive && <span style={{ color: "var(--text)", fontFamily: "var(--font-mono)", fontSize: 10, flexShrink: 0 }}>current</span>}
                  </span>
                </button>
                {onLabelChange && (
                  <IconButton
                    label="Edit entry label"
                    size="compact"
                    onClick={(event) => { event.stopPropagation(); beginEditLabel(row); }}
                    style={{ flexShrink: 0, fontFamily: "var(--font-mono)", fontSize: 12 }}
                  >
                    <span aria-hidden="true">L</span>
                  </IconButton>
                )}
              </div>
              {editingLabelId === row.id && (
                <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "var(--space-1)", margin: "var(--space-half) var(--space-1) var(--space-1)", paddingInlineStart: Math.min(72, Math.max(34, row.depth * 22 + 34)) }}>
                  <Input
                    data-tree-label-editor="true"
                    value={labelDraft}
                    onChange={(event) => setLabelDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        event.stopPropagation();
                        void saveLabel(row, labelDraft.trim() || undefined);
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        event.stopPropagation();
                        setEditingLabelId(null);
                      }
                    }}
                    autoFocus
                    aria-label="Entry label"
                    placeholder="Label or bookmark…"
                    style={{ minWidth: "min(180px, 100%)", flex: "1 1 180px" }}
                  />
                  <Button variant="primary" size="compact" loading={labelSaving} onClick={() => void saveLabel(row, labelDraft.trim() || undefined)}>Save</Button>
                  {row.label && <Button size="compact" disabled={labelSaving} onClick={() => void saveLabel(row, undefined)}>Clear</Button>}
                  <Button size="compact" disabled={labelSaving} onClick={() => setEditingLabelId(null)}>Cancel</Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      </div>
    </Dialog>
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
  const handleForkKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    const interactiveTarget = target?.closest("button, input, select, textarea, a[href]");
    const handlesForkCommands = !interactiveTarget
      || target === inputRef.current
      || target?.dataset.forkRowControl === "true";
    if (!handlesForkCommands) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((idx) => Math.min(Math.max(0, filtered.length - 1), idx + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((idx) => Math.max(0, idx - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      void confirm();
    }
  }, [confirm, filtered.length]);

  return (
    <Dialog
      open
      onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}
      title="Fork from user message"
      description="Choose a user message to restore in the new session editor. Arrow keys move; Enter forks."
      variant="adaptive"
      size="lg"
      height="viewport"
      bodyLayout="flush"
      initialFocusRef={inputRef}
      closeLabel="Close fork selector"
      footer={(
        <div style={{ width: "100%", minWidth: 0, display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "center", gap: "var(--space-2)" }}>
          <div aria-live="polite" style={{ color: "var(--text-dim)", fontSize: 12, fontFamily: "var(--font-mono)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {filtered.length} message{filtered.length === 1 ? "" : "s"}
          </div>
          <div style={{ display: "flex", gap: "var(--space-1)" }}>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={!selected || disabled || Boolean(busyEntryId)} loading={Boolean(busyEntryId)} onClick={() => void confirm()}>
              {busyEntryId ? "Creating" : "Fork"}
            </Button>
          </div>
        </div>
      )}
    >
      <div style={{ width: "100%", maxWidth: "100%", minWidth: 0, minHeight: 0, height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }} onKeyDownCapture={handleForkKeyDown}>
      <div style={{ width: "100%", minWidth: 0, padding: "var(--space-2) calc(var(--space-2) + var(--pi-safe-area-right)) var(--space-2) calc(var(--space-2) + var(--pi-safe-area-left))", boxSizing: "border-box", borderBottom: "1px solid var(--border)" }}>
        <Input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Filter user messages"
          placeholder="Filter user messages…"
        />
      </div>
      <div style={{ width: "100%", minWidth: 0, flex: "1 1 auto", minHeight: 0, overflowY: "auto", overscrollBehavior: "contain", padding: "var(--space-1) calc(var(--space-1) + var(--pi-safe-area-right)) var(--space-1) calc(var(--space-1) + var(--pi-safe-area-left))", boxSizing: "border-box" }}>
        {disabled ? (
          <div style={{ padding: 18, color: "var(--text-dim)", fontSize: 13, textAlign: "center" }}>{disabledReason ?? "Fork is not available right now."}</div>
        ) : loading ? (
          <div style={{ padding: 18, color: "var(--text-dim)", fontSize: 13, textAlign: "center" }}>Loading user messages…</div>
        ) : error ? (
          <div role="alert" style={{ padding: "var(--space-2)", color: "var(--error)", fontSize: 13, textAlign: "center" }}>{error}</div>
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
              data-fork-row-control="true"
              style={{
                width: "100%",
                minWidth: 0,
                minHeight: "var(--control-touch)",
                display: "grid",
                gridTemplateColumns: "auto minmax(0, 1fr) auto",
                gap: "var(--space-1-5)",
                alignItems: "start",
                padding: "var(--space-1) var(--space-1-5)",
                borderRadius: "var(--radius-md)",
                border: 0,
                background: active ? "var(--bg-selected)" : "transparent",
                color: "var(--text)",
                cursor: "pointer",
                textAlign: "left",
                overflow: "hidden",
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
      </div>
    </Dialog>
  );
}
