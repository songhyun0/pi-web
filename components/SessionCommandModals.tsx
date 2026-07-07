"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { AgentMessage, SessionEntry, SessionTreeNode } from "@/lib/types";
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

function extractMessageText(message: AgentMessage): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) =>
      block && typeof block === "object"
        && (block as { type?: unknown }).type === "text"
        && typeof (block as { text?: unknown }).text === "string"
        ? (block as { text: string }).text
        : "")
    .filter(Boolean)
    .join("\n");
}

function entryLabel(entry: SessionEntry): { role?: string; title: string; detail: string } {
  if (entry.type === "message" && "message" in entry) {
    const role = (entry.message as AgentMessage).role;
    const text = extractMessageText(entry.message as AgentMessage).replace(/\s+/g, " ").trim();
    return {
      role,
      title: text || (role === "assistant" ? "[assistant]" : `[${role}]`),
      detail: role,
    };
  }
  if (entry.type === "branch_summary") return { title: entry.summary || "Branch summary", detail: "branch summary" };
  if (entry.type === "compaction") return { title: entry.summary || "Compaction", detail: "compaction" };
  if (entry.type === "model_change") return { title: `${entry.provider}/${entry.modelId}`, detail: "model" };
  if (entry.type === "thinking_level_change") return { title: entry.thinkingLevel, detail: "thinking" };
  if (entry.type === "session_info") return { title: entry.name || "Session info", detail: "session" };
  return { title: entry.type, detail: entry.type };
}

function buildActivePath(nodes: SessionTreeNode[], activeLeafId: string | null): Set<string> {
  if (!activeLeafId) return new Set();
  const stack = [...nodes].reverse().map((node) => ({ node, path: [] as string[] }));
  while (stack.length > 0) {
    const { node, path } = stack.pop()!;
    const nextPath = [...path, node.entry.id];
    if (node.entry.id === activeLeafId || node.compressedEntryIds?.includes(activeLeafId)) {
      return new Set(nextPath);
    }
    for (let i = node.children.length - 1; i >= 0; i -= 1) {
      stack.push({ node: node.children[i], path: nextPath });
    }
  }
  return new Set();
}

interface TreeRow {
  id: string;
  key: string;
  connector: string;
  depth: number;
  title: string;
  detail: string;
  role?: string;
  childCount: number;
  skipped: number;
  isActive: boolean;
  isOnPath: boolean;
  searchText: string;
}

interface TreeGutter {
  position: number;
  show: boolean;
}

function treeContainsActive(node: SessionTreeNode, activeLeafId: string | null, cache: Map<SessionTreeNode, boolean>): boolean {
  const cached = cache.get(node);
  if (cached !== undefined) return cached;
  const self = Boolean(activeLeafId && (node.entry.id === activeLeafId || node.compressedEntryIds?.includes(activeLeafId)));
  const child = node.children.some((child) => treeContainsActive(child, activeLeafId, cache));
  const result = self || child;
  cache.set(node, result);
  return result;
}

function orderActiveBranchFirst(nodes: SessionTreeNode[], activeLeafId: string | null, cache: Map<SessionTreeNode, boolean>): SessionTreeNode[] {
  return [...nodes].sort((a, b) => Number(treeContainsActive(b, activeLeafId, cache)) - Number(treeContainsActive(a, activeLeafId, cache)));
}

function buildCliConnector(displayIndent: number, showConnector: boolean, isVirtualRootChild: boolean, isLast: boolean, gutters: TreeGutter[]): string {
  const connectorDisplayed = showConnector && !isVirtualRootChild;
  const connectorPosition = connectorDisplayed ? displayIndent - 1 : -1;
  const totalChars = displayIndent * 3;
  const chars: string[] = [];

  for (let i = 0; i < totalChars; i += 1) {
    const level = Math.floor(i / 3);
    const posInLevel = i % 3;
    const gutter = gutters.find((g) => g.position === level);
    if (gutter) {
      chars.push(posInLevel === 0 && gutter.show ? "│" : " ");
    } else if (connectorDisplayed && level === connectorPosition) {
      chars.push(posInLevel === 0 ? (isLast ? "└" : "├") : posInLevel === 1 ? "─" : " ");
    } else {
      chars.push(" ");
    }
  }

  return chars.join("");
}

function flattenTree(nodes: SessionTreeNode[], activeLeafId: string | null): TreeRow[] {
  const activePath = buildActivePath(nodes, activeLeafId);
  const containsActive = new Map<SessionTreeNode, boolean>();
  const rows: TreeRow[] = [];
  const multipleRoots = nodes.length > 1;
  const orderedRoots = orderActiveBranchFirst(nodes, activeLeafId, containsActive);
  const stack: Array<{
    node: SessionTreeNode;
    indent: number;
    justBranched: boolean;
    showConnector: boolean;
    isLast: boolean;
    gutters: TreeGutter[];
    isVirtualRootChild: boolean;
  }> = [];

  for (let i = orderedRoots.length - 1; i >= 0; i -= 1) {
    stack.push({
      node: orderedRoots[i],
      indent: multipleRoots ? 1 : 0,
      justBranched: multipleRoots,
      showConnector: multipleRoots,
      isLast: i === orderedRoots.length - 1,
      gutters: [],
      isVirtualRootChild: multipleRoots,
    });
  }

  while (stack.length > 0) {
    const { node, indent, justBranched, showConnector, isLast, gutters, isVirtualRootChild } = stack.pop()!;
    const label = entryLabel(node.entry);
    const displayIndent = multipleRoots ? Math.max(0, indent - 1) : indent;
    const connector = buildCliConnector(displayIndent, showConnector, isVirtualRootChild, isLast, gutters);
    const skipped = node.compressedEntryIds?.length ?? 0;
    const isActive = node.entry.id === activeLeafId || Boolean(activeLeafId && node.compressedEntryIds?.includes(activeLeafId));
    const isOnPath = activePath.has(node.entry.id) || isActive;
    rows.push({
      id: node.entry.id,
      key: node.entry.id,
      connector,
      depth: displayIndent,
      title: label.title,
      detail: label.detail,
      role: label.role,
      childCount: node.children.length,
      skipped,
      isActive,
      isOnPath,
      searchText: `${label.title} ${label.detail} ${node.entry.id}`.toLowerCase(),
    });

    const children = node.children;
    const multipleChildren = children.length > 1;
    const orderedChildren = orderActiveBranchFirst(children, activeLeafId, containsActive);
    const childIndent = multipleChildren
      ? indent + 1
      : justBranched && indent > 0
        ? indent + 1
        : indent;

    const connectorDisplayed = showConnector && !isVirtualRootChild;
    const connectorPosition = Math.max(0, displayIndent - 1);
    const childGutters = connectorDisplayed
      ? [...gutters, { position: connectorPosition, show: !isLast }]
      : gutters;

    for (let i = orderedChildren.length - 1; i >= 0; i -= 1) {
      stack.push({
        node: orderedChildren[i],
        indent: childIndent,
        justBranched: multipleChildren,
        showConnector: multipleChildren,
        isLast: i === orderedChildren.length - 1,
        gutters: childGutters,
        isVirtualRootChild: false,
      });
    }
  }
  return rows;
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
}: {
  tree: SessionTreeNode[];
  activeLeafId: string | null;
  loading?: boolean;
  error?: string | null;
  onClose: () => void;
  onSelect: (entryId: string, options?: { summarize?: boolean }) => void | Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [summarize, setSummarize] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const rows = useMemo(() => flattenTree(tree, activeLeafId), [tree, activeLeafId]);
  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => row.searchText.includes(q));
  }, [query, rows]);

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

  return (
    <ModalShell
      title="Navigate session tree"
      subtitle="CLI-style branch selector · ↑/↓ move · Enter navigate · Esc cancel"
      onClose={onClose}
      onKeyDownCapture={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        } else if (event.key === "ArrowDown") {
          event.preventDefault();
          setActiveIndex((idx) => Math.min(Math.max(0, filteredRows.length - 1), idx + 1));
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
      <div style={{ padding: 14, borderBottom: "1px solid var(--border)" }}>
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter entries by text, role, or id…"
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
            <button
              key={row.key}
              ref={(node) => { rowRefs.current[index] = node; }}
              type="button"
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
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: row.isActive ? "var(--accent)" : row.isOnPath ? "var(--text-muted)" : "var(--border)", flexShrink: 0 }} />
              <RoleBadge role={row.role} />
              {row.skipped > 0 && <span style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 10, flexShrink: 0 }}>+{row.skipped}</span>}
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{row.title}</span>
              {row.childCount > 1 && <span style={{ color: "var(--accent)", fontFamily: "var(--font-mono)", fontSize: 10, flexShrink: 0 }}>{row.childCount} branches</span>}
              {row.isActive && <span style={{ color: "var(--accent)", fontFamily: "var(--font-mono)", fontSize: 10, flexShrink: 0 }}>current</span>}
            </button>
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
