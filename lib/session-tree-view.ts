import type { AgentMessage, SessionEntry, SessionTreeNode } from "@/lib/types";

export type TreeFilterMode = "default" | "no-tools" | "user-only" | "labeled-only" | "all";

export interface TreeRow {
  id: string;
  key: string;
  connector: string;
  depth: number;
  title: string;
  detail: string;
  role?: string;
  entryType: string;
  childCount: number;
  skipped: number;
  isActive: boolean;
  isOnPath: boolean;
  isFolded: boolean;
  hasChildren: boolean;
  label?: string;
  labelTimestamp?: string;
  labelTimestampText?: string;
  searchText: string;
}

interface TreeGutter {
  position: number;
  show: boolean;
}

export function extractMessageText(message: AgentMessage): string {
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

export function entryLabel(entry: SessionEntry): { role?: string; title: string; detail: string; toolName?: string } {
  if (entry.type === "message" && "message" in entry) {
    const role = (entry.message as AgentMessage).role;
    const text = extractMessageText(entry.message as AgentMessage).replace(/\s+/g, " ").trim();
    const toolName = role === "toolResult" ? (entry.message as { toolName?: string }).toolName : undefined;
    return {
      role,
      title: text || (toolName ? `[tool result: ${toolName}]` : role === "assistant" ? "[assistant]" : `[${role}]`),
      detail: toolName ? `${role} · ${toolName}` : role,
      toolName,
    };
  }
  if (entry.type === "branch_summary") return { title: entry.summary || "Branch summary", detail: "branch summary" };
  if (entry.type === "compaction") return { title: entry.summary || "Compaction", detail: "compaction" };
  if (entry.type === "model_change") return { title: `${entry.provider}/${entry.modelId}`, detail: "model" };
  if (entry.type === "thinking_level_change") return { title: entry.thinkingLevel, detail: "thinking" };
  if (entry.type === "session_info") return { title: entry.name || "Session info", detail: "session" };
  if (entry.type === "label") return { title: entry.label ? `Label: ${entry.label}` : "Clear label", detail: "label" };
  return { title: entry.type, detail: entry.type };
}

export function buildActivePath(nodes: SessionTreeNode[], activeLeafId: string | null): Set<string> {
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

function formatLabelTimestamp(timestamp: string | undefined): string | undefined {
  if (!timestamp) return undefined;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return date.toLocaleString(undefined, { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function rowMatchesFilter(row: TreeRow, mode: TreeFilterMode): boolean {
  switch (mode) {
    case "all":
      return true;
    case "labeled-only":
      return Boolean(row.label);
    case "user-only":
      return row.role === "user";
    case "no-tools":
      return row.role !== "toolResult" && row.entryType !== "custom" && row.entryType !== "custom_message" && row.entryType !== "label";
    case "default":
    default:
      return row.entryType !== "label";
  }
}

export function filterTreeRows(rows: TreeRow[], query: string, mode: TreeFilterMode): TreeRow[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((row) => {
    if (!rowMatchesFilter(row, mode)) return false;
    if (terms.length === 0) return true;
    return terms.every((term) => row.searchText.includes(term));
  });
}

export function flattenTree(
  nodes: SessionTreeNode[],
  activeLeafId: string | null,
  options: { foldedIds?: ReadonlySet<string>; showLabelTimestamps?: boolean } = {}
): TreeRow[] {
  const activePath = buildActivePath(nodes, activeLeafId);
  const containsActive = new Map<SessionTreeNode, boolean>();
  const rows: TreeRow[] = [];
  const multipleRoots = nodes.length > 1;
  const orderedRoots = orderActiveBranchFirst(nodes, activeLeafId, containsActive);
  const foldedIds = options.foldedIds ?? new Set<string>();
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
    const hasChildren = node.children.length > 0;
    const isFolded = hasChildren && foldedIds.has(node.entry.id) && !isOnPath;
    const labelTimestamp = (node as { labelTimestamp?: string }).labelTimestamp;

    rows.push({
      id: node.entry.id,
      key: node.entry.id,
      connector,
      depth: displayIndent,
      title: label.title,
      detail: label.detail,
      role: label.role,
      entryType: node.entry.type,
      childCount: node.children.length,
      skipped,
      isActive,
      isOnPath,
      isFolded,
      hasChildren,
      label: node.label,
      labelTimestamp,
      labelTimestampText: options.showLabelTimestamps ? formatLabelTimestamp(labelTimestamp) : undefined,
      searchText: `${label.title} ${label.detail} ${label.toolName ?? ""} ${node.label ?? ""} ${node.entry.id}`.toLowerCase(),
    });

    if (isFolded) continue;

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
