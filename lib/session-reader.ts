import { SessionManager, buildSessionContext as piBuildSessionContext, getAgentDir } from "@earendil-works/pi-coding-agent";
import type { AgentMessage, SessionEntry, SessionInfo, SessionContext, AssistantMessage, CompactionEntry } from "./types";
import type { SessionEntry as PiSessionEntry, SessionInfo as PiSessionInfo } from "@earendil-works/pi-coding-agent";
import { normalizeToolCalls } from "./normalize";
import { resolveProject, type ProjectInfo } from "./worktree";

export { getAgentDir };

export async function listAllSessions(): Promise<SessionInfo[]> {
  const piSessions: PiSessionInfo[] = await SessionManager.listAll();
  const pathToId = new Map<string, string>();
  for (const s of piSessions) pathToId.set(s.path, s.id);

  // Resolve each unique cwd to its project root (main repo shared by all
  // worktrees). resolveProject caches per-cwd, so this is cheap after warmup.
  const uniqueCwds = [...new Set(piSessions.map((s) => s.cwd).filter(Boolean))];
  const projectByCwd = new Map<string, ProjectInfo>();
  await Promise.all(uniqueCwds.map(async (cwd) => {
    projectByCwd.set(cwd, await resolveProject(cwd));
  }));

  const cache = getPathCache();
  return piSessions.map((s) => {
    // Populate path cache so resolveSessionPath works without a full scan
    cache.set(s.id, s.path);
    const project = s.cwd ? projectByCwd.get(s.cwd) : undefined;
    return {
      path: s.path,
      id: s.id,
      cwd: s.cwd,
      name: s.name,
      created: s.created instanceof Date ? s.created.toISOString() : String(s.created),
      modified: s.modified instanceof Date ? s.modified.toISOString() : String(s.modified),
      messageCount: s.messageCount,
      firstMessage: s.firstMessage || "(no messages)",
      parentSessionId: s.parentSessionPath ? pathToId.get(s.parentSessionPath) : undefined,
      projectRoot: project?.projectRoot ?? s.cwd,
      ...(project?.isWorktree && project.branch ? { worktreeBranch: project.branch } : {}),
    };
  });
}

// ============================================================================
// Session path cache: sessionId → absolute file path
// Stored in globalThis for hot-reload safety
// ============================================================================
declare global {
  var __piSessionPathCache: Map<string, string> | undefined;
}

function getPathCache(): Map<string, string> {
  if (!globalThis.__piSessionPathCache) globalThis.__piSessionPathCache = new Map();
  return globalThis.__piSessionPathCache;
}

export async function resolveSessionPath(sessionId: string): Promise<string | null> {
  const cached = getPathCache().get(sessionId);
  if (cached) return cached;

  // Cache miss: scan all sessions to populate cache, then retry
  await listAllSessions();
  return getPathCache().get(sessionId) ?? null;
}

export function cacheSessionPath(sessionId: string, filePath: string): void {
  getPathCache().set(sessionId, filePath);
}

export function invalidateSessionPathCache(sessionId: string): void {
  getPathCache().delete(sessionId);
}

export function buildSessionContext(entries: SessionEntry[], leafId?: string | null): SessionContext {
  const byId = new Map<string, SessionEntry>();
  for (const e of entries) byId.set(e.id, e);

  const piEntries = entries as unknown as PiSessionEntry[];
  const piCtx = piBuildSessionContext(piEntries, leafId, byId as unknown as Map<string, PiSessionEntry>);

  // Build entryIds: parallel array to messages[], mapping each message back to its entry id.
  // Needed for fork and navigate_tree calls from the UI.
  let targetLeaf: SessionEntry | undefined;
  if (leafId === null) {
    return { messages: [], entryIds: [], thinkingLevel: piCtx.thinkingLevel, model: piCtx.model };
  }
  if (leafId) targetLeaf = byId.get(leafId);
  if (!targetLeaf) targetLeaf = entries[entries.length - 1];
  if (!targetLeaf) {
    return { messages: [], entryIds: [], thinkingLevel: piCtx.thinkingLevel, model: piCtx.model };
  }

  // Walk path from target leaf to root
  const path: SessionEntry[] = [];
  let cur: SessionEntry | undefined = targetLeaf;
  while (cur) {
    path.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }

  // Find the last compaction on path (mirrors pi's buildSessionContext logic)
  let compactionId: string | undefined;
  let firstKeptEntryId: string | undefined;
  for (const e of path) {
    if (e.type === "compaction") {
      compactionId = e.id;
      firstKeptEntryId = (e as { firstKeptEntryId: string }).firstKeptEntryId;
    }
  }

  const contextEntryIds: string[] = [];
  if (compactionId) {
    // The first message in piCtx.messages is the synthetic compaction summary — map to compaction entry id
    contextEntryIds.push(compactionId);
    const compactionIdx = path.findIndex((e) => e.id === compactionId);
    const firstKeptIdx = firstKeptEntryId
      ? path.findIndex((e, i) => i < compactionIdx && e.id === firstKeptEntryId)
      : -1;
    const startIdx = firstKeptIdx >= 0 ? firstKeptIdx : compactionIdx;
    for (let i = startIdx; i < compactionIdx; i++) {
      if (isContextMessageEntry(path[i])) contextEntryIds.push(path[i].id);
    }
    for (let i = compactionIdx + 1; i < path.length; i++) {
      if (isContextMessageEntry(path[i])) contextEntryIds.push(path[i].id);
    }
  } else {
    for (const e of path) {
      if (isContextMessageEntry(e)) contextEntryIds.push(e.id);
    }
  }

  // For display, keep the retained chronological messages and insert a
  // display-only marker at the actual compaction entry. The session file and
  // runtime LLM context are unchanged; this only makes compaction visible in UI.
  if (compactionId) {
    const displayMessages: AgentMessage[] = [];
    const displayEntryIds: string[] = [];
    const appendDisplayEntry = (entry: SessionEntry) => {
      const message = entryToDisplayMessage(entry);
      if (!message) return;
      displayMessages.push(message);
      displayEntryIds.push(entry.id);
    };

    const compactionIdx = path.findIndex((e) => e.id === compactionId);
    const compactionEntry = path[compactionIdx] as CompactionEntry | undefined;
    const firstKeptIdx = firstKeptEntryId
      ? path.findIndex((e, i) => i < compactionIdx && e.id === firstKeptEntryId)
      : -1;
    const startIdx = firstKeptIdx >= 0 ? firstKeptIdx : compactionIdx;

    for (let i = startIdx; i < compactionIdx; i++) appendDisplayEntry(path[i]);
    if (compactionEntry?.type === "compaction") {
      displayMessages.push(createCompactionMarkerMessage(compactionEntry));
      displayEntryIds.push(compactionEntry.id);
    }
    for (let i = compactionIdx + 1; i < path.length; i++) appendDisplayEntry(path[i]);

    return {
      messages: displayMessages,
      entryIds: displayEntryIds,
      thinkingLevel: piCtx.thinkingLevel,
      model: piCtx.model,
    };
  }

  const contextMessages = (piCtx.messages as AssistantMessage[]).map((msg) => {
    const raw = msg as unknown as Record<string, unknown>;
    if (raw.role === "branchSummary") {
      return {
        role: "user" as const,
        content: `*The conversation briefly explored another branch and returned with this summary:*\n\n${raw.summary ?? ""}`,
        timestamp: raw.timestamp as number | undefined,
      };
    }
    return normalizeToolCalls(msg);
  });

  const display = filterDisplayMessages(contextMessages, contextEntryIds);

  return {
    messages: display.messages,
    entryIds: display.entryIds,
    thinkingLevel: piCtx.thinkingLevel,
    model: piCtx.model,
  };
}

function entryToDisplayMessage(entry: SessionEntry): AgentMessage | null {
  if (entry.type === "message") return normalizeToolCalls(entry.message);
  if (entry.type === "custom_message") {
    return {
      role: "custom",
      customType: entry.customType,
      content: entry.content,
      display: entry.display,
      details: entry.details,
      timestamp: timestampToMs(entry.timestamp),
    };
  }
  if (entry.type === "branch_summary" && entry.summary) {
    return {
      role: "user",
      content: `*The conversation briefly explored another branch and returned with this summary:*\n\n${entry.summary}`,
      timestamp: timestampToMs(entry.timestamp),
    };
  }
  return null;
}

function createCompactionMarkerMessage(entry: CompactionEntry): AgentMessage {
  return {
    role: "custom",
    customType: "compaction",
    content: entry.summary,
    display: true,
    details: {
      tokensBefore: entry.tokensBefore,
      firstKeptEntryId: entry.firstKeptEntryId,
      fromHook: entry.fromHook,
      details: entry.details,
    },
    timestamp: timestampToMs(entry.timestamp),
  };
}

function timestampToMs(timestamp?: string): number | undefined {
  if (!timestamp) return undefined;
  const ms = new Date(timestamp).getTime();
  return Number.isNaN(ms) ? undefined : ms;
}

function isContextMessageEntry(entry: SessionEntry): boolean {
  return entry.type === "message" || entry.type === "custom_message" || (entry.type === "branch_summary" && !!entry.summary);
}

function filterDisplayMessages(messages: AgentMessage[], entryIds: string[]): Pick<SessionContext, "messages" | "entryIds"> {
  const displayMessages: AgentMessage[] = [];
  const displayEntryIds: string[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    displayMessages.push(msg);
    displayEntryIds.push(entryIds[i] ?? "");
  }

  return {
    messages: displayMessages,
    entryIds: displayEntryIds,
  };
}
