"use client";

import { useEffect, useLayoutEffect, useState, useCallback, useRef, type CSSProperties, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { DEFAULT_APP_DISPLAY_NAME } from "@/lib/app-settings";
import {
  readMobileSessionProject,
  withMobileSessionProject,
  withoutMobileSessionProject,
} from "@/lib/mobile-workspace";
import type { SessionInfo } from "@/lib/types";
import { DirectoryPickerModal } from "./DirectoryPickerModal";
import { FileExplorer } from "./FileExplorer";
import styles from "./SessionSidebar.module.css";
import { Button, cx, IconButton, Input, SegmentedControl, Skeleton } from "./ui";

interface Props {
  appName?: string;
  selectedSessionId: string | null;
  onSelectSession: (session: SessionInfo, isRestore?: boolean) => void;
  onNewSession?: (sessionId: string, cwd: string) => void;
  initialSessionId?: string | null;
  onInitialRestoreDone?: () => void;
  refreshKey?: number;
  onSessionDeleted?: (sessionId: string) => void;
  selectedCwd?: string | null;
  onCwdChange?: (cwd: string | null, projectRoot?: string | null) => void;
  onOpenFile?: (filePath: string, fileName: string) => void;
  explorerRefreshKey?: number;
  onAtMention?: (relativePath: string, isDir: boolean) => void;
  onRequestClose?: () => void;
}

interface WorktreeEntry {
  path: string;
  branch: string | null;
  isMain: boolean;
}

interface WorktreeState {
  /** The cwd this data was fetched for — guards against stale responses */
  forCwd: string;
  projectRoot: string;
  isGit: boolean;
  /** False when forCwd is a repo subdirectory — the switcher is hidden there
   *  because subdir sessions keep their own project identity */
  isTopLevel: boolean;
  worktrees: WorktreeEntry[];
}

const UNREAD_SESSIONS_STORAGE_KEY = "pi-web:unread-session-ids";
const ALL_PROJECTS_LABEL = "All projects";

function loadUnreadSessionIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(UNREAD_SESSIONS_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return new Set(parsed.filter((id): id is string => typeof id === "string"));
    return new Set();
  } catch {
    return new Set();
  }
}

function saveUnreadSessionIds(ids: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    if (ids.size === 0) window.localStorage.removeItem(UNREAD_SESSIONS_STORAGE_KEY);
    else window.localStorage.setItem(UNREAD_SESSIONS_STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // ignore storage quota / privacy-mode errors
  }
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

/**
 * Return all projects (deduped by projectRoot so worktrees collapse into their
 * main repo) sorted by most recent session activity.
 */
function getRecentProjects(sessions: SessionInfo[]): string[] {
  const latestByRoot = new Map<string, string>(); // projectRoot -> most recent modified
  for (const s of sessions) {
    const root = s.projectRoot ?? s.cwd;
    if (!root) continue;
    const prev = latestByRoot.get(root);
    if (!prev || s.modified > prev) {
      latestByRoot.set(root, s.modified);
    }
  }
  return [...latestByRoot.entries()]
    .sort((a, b) => b[1].localeCompare(a[1]))
    .map(([root]) => root);
}

interface ProjectSessionGroup {
  projectRoot: string;
  sessions: SessionInfo[];
  tree: SessionTreeNode[];
  latestModified: string;
}

function groupSessionsByProject(sessions: SessionInfo[]): ProjectSessionGroup[] {
  const byProject = new Map<string, SessionInfo[]>();
  for (const session of sessions) {
    const root = session.projectRoot ?? session.cwd;
    if (!root) continue;
    const group = byProject.get(root);
    if (group) group.push(session);
    else byProject.set(root, [session]);
  }

  return [...byProject.entries()]
    .map(([projectRoot, projectSessions]) => ({
      projectRoot,
      sessions: projectSessions,
      tree: buildSessionTree(projectSessions),
      latestModified: projectSessions.reduce((latest, session) => session.modified > latest ? session.modified : latest, ""),
    }))
    .sort((a, b) => b.latestModified.localeCompare(a.latestModified));
}

/** Substitute the home dir prefix with ~ (no path truncation — see PathLabel) */
function displayCwd(cwd: string, homeDir?: string): string {
  return homeDir && cwd.startsWith(homeDir) ? `~${cwd.slice(homeDir.length)}` : cwd;
}

/**
 * Path label that ellipsizes on the LEFT, keeping the (most relevant) trailing
 * segments visible: "…orkspace/pi-web". Shows as much of the path as fits
 * instead of a fixed number of segments. The rtl container moves the ellipsis
 * to the left edge; the inner plaintext bidi isolation keeps the path itself
 * rendered strictly left-to-right (no punctuation reordering).
 */
function PathLabel({ text, className }: { text: string; className?: string }) {
  return (
    <span className={cx(styles.pathLabel, className)}>
      <span className={styles.pathLabelText}>{text}</span>
    </span>
  );
}

const DROPDOWN_ANIMATION_MS = 140;
const SESSION_SWIPE_ACTION_WIDTH = 88;
const SESSION_SWIPE_AXIS_LOCK_PX = 8;
const SESSION_SWIPE_AXIS_RATIO = 1.2;
const SESSION_SWIPE_OPEN_THRESHOLD = 44;
const SESSION_SWIPE_SUPPRESS_CLICK_MS = 350;
const SESSION_SWIPE_OPEN_EVENT = "pi-web:session-swipe-open";

type SessionSwipeAxis = "x" | "y";

interface SessionSwipeGesture {
  pointerId: number;
  startX: number;
  startY: number;
  startOffset: number;
  axis: SessionSwipeAxis | null;
  moved: boolean;
}

function clampSessionSwipeOffset(value: number): number {
  return Math.max(0, Math.min(SESSION_SWIPE_ACTION_WIDTH, value));
}

function isInteractiveSwipeTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest("button,input,textarea,select,a,[role='button']"));
}

function AnimatedDropdown({ open, children, className }: { open: boolean; children: ReactNode; className?: string }) {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(open);

  useEffect(() => {
    let frame: number | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    if (open) {
      setMounted(true);
      setVisible(false);
      frame = window.requestAnimationFrame(() => {
        frame = window.requestAnimationFrame(() => setVisible(true));
      });
    } else {
      setVisible(false);
      timeout = setTimeout(() => setMounted(false), DROPDOWN_ANIMATION_MS);
    }

    return () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      if (timeout) clearTimeout(timeout);
    };
  }, [open]);

  if (!mounted) return null;

  return (
    <div className={cx(styles.dropdown, className)} data-visible={visible && open || undefined}>
      {children}
    </div>
  );
}



interface SessionTreeNode {
  session: SessionInfo;
  children: SessionTreeNode[];
}

function buildSessionTree(sessions: SessionInfo[]): SessionTreeNode[] {
  const byId = new Map<string, SessionTreeNode>();
  for (const s of sessions) {
    byId.set(s.id, { session: s, children: [] });
  }

  // Build a map of parentSessionId chains so we can resolve missing ancestors
  const parentOf = new Map<string, string>();
  for (const s of sessions) {
    if (s.parentSessionId) parentOf.set(s.id, s.parentSessionId);
  }

  // Walk up the parentSessionId chain to find the nearest ancestor that exists in byId
  function resolveAncestor(id: string): string | null {
    let cur = parentOf.get(id);
    const visited = new Set<string>();
    while (cur) {
      if (visited.has(cur)) return null; // cycle guard
      visited.add(cur);
      if (byId.has(cur)) return cur;
      cur = parentOf.get(cur);
    }
    return null;
  }

  const roots: SessionTreeNode[] = [];
  for (const node of byId.values()) {
    const ancestor = resolveAncestor(node.session.id);
    if (ancestor) {
      const parent = byId.get(ancestor);
      if (parent) parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Sort each level by modified desc
  const sort = (nodes: SessionTreeNode[]) => {
    nodes.sort((a, b) => b.session.modified.localeCompare(a.session.modified));
    nodes.forEach((node) => { sort(node.children); });
  };
  sort(roots);
  return roots;
}

const SCRAMBLE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";

function useScramble(target: string, running: boolean): string {
  const [display, setDisplay] = useState(target);
  const frameRef = useRef<number | null>(null);
  const iterRef = useRef(0);

  useEffect(() => {
    if (!running) {
      setDisplay(target);
      return;
    }
    iterRef.current = 0;
    const totalFrames = target.length * 4;

    const step = () => {
      iterRef.current += 1;
      const progress = iterRef.current / totalFrames;
      const resolved = Math.floor(progress * target.length);

      setDisplay(
        target
          .split("")
          .map((char, i) => {
            if (char === " ") return " ";
            if (i < resolved) return char;
            return SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
          })
          .join("")
      );

      if (iterRef.current < totalFrames) {
        frameRef.current = requestAnimationFrame(step);
      } else {
        setDisplay(target);
      }
    };

    frameRef.current = requestAnimationFrame(step);
    return () => { if (frameRef.current) cancelAnimationFrame(frameRef.current); };
  }, [target, running]);

  return display;
}

function PiAgentTitle({ appName }: { appName: string }) {
  const [showVersion, setShowVersion] = useState(false);
  const [scrambling, setScrambling] = useState(false);
  const revertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const target = showVersion ? `${process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0"}p${process.env.NEXT_PUBLIC_PI_VERSION ?? "0.0.0"}` : appName;
  const display = useScramble(target, scrambling);

  const triggerScramble = useCallback((toVersion: boolean) => {
    setShowVersion(toVersion);
    setScrambling(true);
    setTimeout(() => setScrambling(false), (toVersion ? 6 : 8) * 4 * (1000 / 60) + 100);
  }, []);

  const handleClick = useCallback(() => {
    if (revertTimerRef.current) clearTimeout(revertTimerRef.current);

    const next = !showVersion;
    triggerScramble(next);

    if (next) {
      revertTimerRef.current = setTimeout(() => triggerScramble(false), 3000);
    }
  }, [showVersion, triggerScramble]);

  useEffect(() => () => { if (revertTimerRef.current) clearTimeout(revertTimerRef.current); }, []);

  return (
    <button
      type="button"
      onClick={handleClick}
      title={showVersion ? "Show app name" : "Show versions"}
      className={styles.titleButton}
      data-version={showVersion || undefined}
    >
      {display}
    </button>
  );
}

export function SessionSidebar({
  appName = DEFAULT_APP_DISPLAY_NAME,
  selectedSessionId,
  onSelectSession,
  onNewSession,
  initialSessionId,
  onInitialRestoreDone,
  refreshKey,
  onSessionDeleted,
  selectedCwd: selectedCwdProp,
  onCwdChange,
  onOpenFile,
  explorerRefreshKey,
  onAtMention,
  onRequestClose,
}: Props) {
  const isMobile = useIsMobile();
  const [allSessions, setAllSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCwd, setSelectedCwd] = useState<string | null>(null);
  const [allProjectsMode, setAllProjectsMode] = useState(true);
  const [homeDir, setHomeDir] = useState<string>("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [projectFilter, setProjectFilter] = useState("");
  const [directoryPickerOpen, setDirectoryPickerOpen] = useState(false);
  const [customPathError, setCustomPathError] = useState<string | null>(null);
  const [customPathValidating, setCustomPathValidating] = useState(false);
  const [newSessionPickMode, setNewSessionPickMode] = useState(false);
  const directoryPickerOpenRef = useRef(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  // Worktree switcher state
  const [worktreeState, setWorktreeState] = useState<WorktreeState | null>(null);
  const [wtDropdownOpen, setWtDropdownOpen] = useState(false);
  const [wtNewOpen, setWtNewOpen] = useState(false);
  const [wtNewBranch, setWtNewBranch] = useState("");
  const [wtError, setWtError] = useState<string | null>(null);
  const [wtBusy, setWtBusy] = useState(false);
  const [wtConfirmRemove, setWtConfirmRemove] = useState<string | null>(null);
  const [worktreeLoadingCwd, setWorktreeLoadingCwd] = useState<string | null>(null);
  const wtDropdownRef = useRef<HTMLDivElement>(null);
  const wtNewInputRef = useRef<HTMLInputElement>(null);
  const [explorerOpen, setExplorerOpen] = useState(true);
  const [mobileMode, setMobileMode] = useState<"sessions" | "explorer">("sessions");
  const [explorerKey, setExplorerKey] = useState(0);
  const [sessionRefreshDone, setSessionRefreshDone] = useState(false);
  const [explorerRefreshDone, setExplorerRefreshDone] = useState(false);
  const [runningSessionIds, setRunningSessionIds] = useState<Set<string>>(() => new Set());
  const [unreadSessionIds, setUnreadSessionIds] = useState<Set<string>>(() => loadUnreadSessionIds());
  const previousRunningSessionIdsRef = useRef<Set<string>>(new Set());
  // Once the SSE stream has delivered a frame it is the source of truth for
  // running state; late /api/sessions responses must not overwrite it.
  const sseAuthoritativeRef = useRef(false);
  const sessionRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const explorerRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const restoreDirectoryPickerFocus = useCallback(() => {
    window.setTimeout(() => {
      const trigger = dropdownRef.current?.querySelector<HTMLButtonElement>("button[aria-expanded]");
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    }, 50);
  }, []);

  useEffect(() => {
    const wasOpen = directoryPickerOpenRef.current;
    directoryPickerOpenRef.current = directoryPickerOpen;
    if (wasOpen && !directoryPickerOpen) restoreDirectoryPickerFocus();
  }, [directoryPickerOpen, restoreDirectoryPickerFocus]);

  useEffect(() => {
    if (isMobile && mobileMode === "explorer" && !selectedCwd && !selectedCwdProp) setMobileMode("sessions");
  }, [isMobile, mobileMode, selectedCwd, selectedCwdProp]);

  const applyMobileProjectState = useCallback((projectRoot: string | null) => {
    if (projectRoot) {
      setAllProjectsMode(false);
      setSelectedCwd(projectRoot);
    } else {
      setAllProjectsMode(true);
    }
  }, []);

  const openProject = useCallback((projectRoot: string, targetMode: "sessions" | "explorer" = "sessions") => {
    if (isMobile && targetMode === "sessions") {
      const currentProject = readMobileSessionProject(window.history.state);
      const nextState = withMobileSessionProject(window.history.state, projectRoot);
      if (currentProject) window.history.replaceState(nextState, "", window.location.href);
      else window.history.pushState(nextState, "", window.location.href);
    } else if (isMobile) {
      window.history.replaceState(withoutMobileSessionProject(window.history.state), "", window.location.href);
    }
    setAllProjectsMode(false);
    setSelectedCwd(projectRoot);
    setMobileMode(targetMode);
  }, [isMobile]);

  const showProjectIndex = useCallback(() => {
    if (isMobile && readMobileSessionProject(window.history.state)) {
      window.history.back();
      return;
    }
    if (isMobile) {
      window.history.replaceState(withoutMobileSessionProject(window.history.state), "", window.location.href);
    }
    setAllProjectsMode(true);
  }, [isMobile]);

  useEffect(() => {
    if (!isMobile) return;
    const syncProject = () => applyMobileProjectState(readMobileSessionProject(window.history.state));
    syncProject();
    window.addEventListener("popstate", syncProject);
    return () => window.removeEventListener("popstate", syncProject);
  }, [applyMobileProjectState, isMobile]);

  const loadSessions = useCallback(async (showLoading = false) => {
    try {
      if (showLoading) setLoading(true);
      const res = await fetch("/api/sessions");
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: unknown } | null;
        throw new Error(typeof body?.error === "string" ? body.error : `HTTP ${res.status}`);
      }
      const data = await res.json() as { sessions: SessionInfo[]; runningSessionIds?: string[] };
      setAllSessions(data.sessions);
      // Treat the fetched running set as an initial fallback only. Once SSE is
      // live it owns this state, so a slow fetch can't revive a stale snapshot.
      if (!sseAuthoritativeRef.current) {
        setRunningSessionIds(new Set(data.runningSessionIds ?? []));
      }
      // Drop unread markers for sessions that no longer exist (e.g. deleted).
      const existingIds = new Set(data.sessions.map((s) => s.id));
      setUnreadSessionIds((prev) => {
        if (prev.size === 0) return prev;
        const next = new Set([...prev].filter((id) => existingIds.has(id)));
        return next.size === prev.size ? prev : next;
      });
      setError(null);
      if (!showLoading) {
        setSessionRefreshDone(true);
        if (sessionRefreshTimerRef.current) clearTimeout(sessionRefreshTimerRef.current);
        sessionRefreshTimerRef.current = setTimeout(() => setSessionRefreshDone(false), 2000);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  const initialLoadDone = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey intentionally requests a fresh server snapshot.
  useEffect(() => {
    const isFirst = !initialLoadDone.current;
    initialLoadDone.current = true;
    loadSessions(isFirst);
  }, [loadSessions, refreshKey]);

  // Persist unread markers so they survive a browser refresh before the user
  // has actually opened the completed session.
  useEffect(() => {
    saveUnreadSessionIds(unreadSessionIds);
  }, [unreadSessionIds]);

  useEffect(() => {
    // Live running status via SSE — no polling. The server pushes the current
    // set of running session ids whenever any session starts/stops working.
    const source = new EventSource("/api/agent/running/events");

    source.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as { type?: string; runningSessionIds?: string[] };
        if (data.type === "running") {
          sseAuthoritativeRef.current = true;
          setRunningSessionIds(new Set(data.runningSessionIds ?? []));
        }
      } catch {
        // ignore malformed frames
      }
    };

    // On error EventSource auto-reconnects; keep the last known state meanwhile.
    return () => source.close();
  }, []);

  useEffect(() => {
    const previous = previousRunningSessionIdsRef.current;
    const completedInBackground = [...previous].filter((id) => !runningSessionIds.has(id) && id !== selectedSessionId);
    const newlyRunning = [...runningSessionIds];

    if (completedInBackground.length > 0 || newlyRunning.length > 0) {
      setUnreadSessionIds((prev) => {
        const next = new Set(prev);
        newlyRunning.forEach((id) => { next.delete(id); });
        completedInBackground.forEach((id) => { next.add(id); });
        return next;
      });
    }

    previousRunningSessionIdsRef.current = runningSessionIds;
  }, [runningSessionIds, selectedSessionId]);

  useEffect(() => {
    if (!selectedSessionId) return;
    setUnreadSessionIds((prev) => {
      if (!prev.has(selectedSessionId)) return prev;
      const next = new Set(prev);
      next.delete(selectedSessionId);
      return next;
    });
  }, [selectedSessionId]);

  useEffect(() => {
    if (explorerRefreshKey !== undefined) setExplorerKey((k) => k + 1);
  }, [explorerRefreshKey]);

  useEffect(() => {
    fetch("/api/home").then((r) => r.json()).then((d: { home?: string }) => {
      if (d.home) setHomeDir(d.home);
    }).catch(() => {});
  }, []);

  const restoredRef = useRef(false);

  /** Resolve the project root for a cwd from the freshest data available */
  const projectRootFor = useCallback((cwd: string | null): string | null => {
    if (!cwd) return null;
    if (worktreeState && worktreeState.forCwd === cwd) return worktreeState.projectRoot;
    // Any path in the loaded worktree list belongs to that project — covers
    // worktrees without sessions, so switching to them keeps the row mounted.
    if (worktreeState?.worktrees.some((w) => w.path === cwd)) return worktreeState.projectRoot;
    const match = allSessions.find((s) => s.cwd === cwd);
    return match?.projectRoot ?? cwd;
  }, [worktreeState, allSessions]);

  // Notify parent only when the effective cwd actually changes (not when
  // projectRootFor identity changes due to session/worktree refreshes).
  const lastNotifiedCwdRef = useRef<string | null>(null);
  useEffect(() => {
    if (lastNotifiedCwdRef.current === selectedCwd) return;
    lastNotifiedCwdRef.current = selectedCwd;
    onCwdChange?.(selectedCwd, projectRootFor(selectedCwd));
  }, [selectedCwd, onCwdChange, projectRootFor]);

  // Sync the worktree switcher to the selected session's cwd. Sessions of all
  // worktrees in a project share one list, so clicking a session from another
  // worktree should move the effective cwd there. Only fires when the prop
  // value changes, so a manual switcher change is not snapped back.
  const lastSyncedCwdPropRef = useRef<string | null>(null);
  useEffect(() => {
    if (selectedCwdProp && selectedCwdProp !== lastSyncedCwdPropRef.current) {
      lastSyncedCwdPropRef.current = selectedCwdProp;
      setSelectedCwd(selectedCwdProp);
    }
  }, [selectedCwdProp]);

  // Load worktrees for the current effective cwd
  const [wtRefreshKey, setWtRefreshKey] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh keys intentionally re-run worktree discovery.
  useLayoutEffect(() => {
    if (!selectedCwd) {
      setWorktreeState(null);
      setWorktreeLoadingCwd(null);
      return;
    }
    let cancelled = false;
    setWorktreeLoadingCwd(selectedCwd);
    fetch(`/api/worktrees?cwd=${encodeURIComponent(selectedCwd)}`)
      .then((r) => r.json())
      .then((d: { projectRoot?: string; isGit?: boolean; isTopLevel?: boolean; worktrees?: WorktreeEntry[]; error?: string }) => {
        if (cancelled) return;
        setWorktreeLoadingCwd(null);
        if (d.error || !d.projectRoot) {
          setWorktreeState(null);
          return;
        }
        setWorktreeState({
          forCwd: selectedCwd,
          projectRoot: d.projectRoot,
          isGit: d.isGit ?? false,
          isTopLevel: d.isTopLevel ?? false,
          worktrees: d.worktrees ?? [],
        });
      })
      .catch(() => {
        if (!cancelled) {
          setWorktreeLoadingCwd(null);
          setWorktreeState(null);
        }
      });
    return () => { cancelled = true; };
  }, [selectedCwd, wtRefreshKey, refreshKey]);

  // Auto-select cwd and restore session from URL on first load
  useEffect(() => {
    if (allSessions.length === 0) return;

    if (selectedCwd === null) {
      // If restoring a session, set cwd to match that session
      if (initialSessionId && !restoredRef.current) {
        restoredRef.current = true;
        const target = allSessions.find((s) => s.id === initialSessionId);
        if (target) {
          setAllProjectsMode(false);
          setSelectedCwd(target.cwd);
          onSelectSession(target, true);
          return;
        }
        // Session not found — notify parent so it can show the placeholder
        onInitialRestoreDone?.();
      }
      const projects = getRecentProjects(allSessions);
      if (projects.length > 0) setSelectedCwd(projects[0]);
    }
  }, [allSessions, selectedCwd, initialSessionId, onSelectSession, onInitialRestoreDone]);

  const startNewSessionInCwd = useCallback((cwd: string) => {
    const start = () => {
      // Generate a temporary UUID client-side — no backend call needed.
      // Pi will be spawned lazily when the user sends the first message.
      const tempId = typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
      setAllProjectsMode(false);
      setSelectedCwd(cwd);
      setNewSessionPickMode(false);
      setDropdownOpen(false);
      setProjectFilter("");
      setDirectoryPickerOpen(false);
      setCustomPathError(null);
      onNewSession?.(tempId, cwd);
    };

    if (isMobile && readMobileSessionProject(window.history.state)) {
      let completed = false;
      const finishAfterPop = () => {
        if (completed) return;
        completed = true;
        window.removeEventListener("popstate", finishAfterPop);
        start();
      };
      window.addEventListener("popstate", finishAfterPop, { once: true });
      window.history.back();
      window.setTimeout(finishAfterPop, 250);
      return;
    }

    start();
  }, [isMobile, onNewSession]);

  const commitCustomPath = useCallback(async (path: string) => {
    const trimmedPath = path.trim();
    if (!trimmedPath || customPathValidating) return;

    setCustomPathValidating(true);
    setCustomPathError(null);
    try {
      const res = await fetch("/api/cwd/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: trimmedPath }),
      });
      const data = await res.json().catch(() => ({})) as { cwd?: string; error?: string };
      if (!res.ok || data.error) {
        setCustomPathError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      const normalized = data.cwd ?? trimmedPath;
      if (newSessionPickMode) {
        startNewSessionInCwd(normalized);
        return;
      }
      setAllProjectsMode(false);
      setSelectedCwd(normalized);
      setDirectoryPickerOpen(false);
      setDropdownOpen(false);
    } catch (e) {
      setCustomPathError(e instanceof Error ? e.message : String(e));
    } finally {
      setCustomPathValidating(false);
    }
  }, [customPathValidating, newSessionPickMode, startNewSessionInCwd]);

  const handleDefaultCwd = useCallback(async () => {
    try {
      const res = await fetch("/api/default-cwd", { method: "POST" });
      const data = await res.json() as { cwd?: string; error?: string };
      if (data.cwd) {
        if (newSessionPickMode) {
          startNewSessionInCwd(data.cwd);
          return;
        }
        setAllProjectsMode(false);
        setSelectedCwd(data.cwd);
        setDirectoryPickerOpen(false);
        setCustomPathError(null);
        setDropdownOpen(false);
      }
    } catch {
      // ignore
    }
  }, [newSessionPickMode, startNewSessionInCwd]);

  const handleCreateWorktree = useCallback(async () => {
    const branch = wtNewBranch.trim();
    if (!branch || wtBusy || !worktreeState) return;
    setWtBusy(true);
    setWtError(null);
    try {
      const res = await fetch("/api/worktrees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: worktreeState.projectRoot, branch }),
      });
      const data = await res.json().catch(() => ({})) as { path?: string; error?: string };
      if (!res.ok || data.error || !data.path) {
        setWtError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      const createdPath = data.path;
      setWtNewOpen(false);
      setWtNewBranch("");
      setWtDropdownOpen(false);
      // Optimistically register the new worktree so projectRootFor() resolves
      // it to the main repo before the refetch lands (keeps AppShell from
      // treating the new cwd as a different project).
      setWorktreeState((prev) => prev ? {
        ...prev,
        forCwd: createdPath,
        worktrees: [...prev.worktrees, { path: createdPath, branch, isMain: false }],
      } : prev);
      setSelectedCwd(createdPath);
      setWtRefreshKey((k) => k + 1);
    } catch (e) {
      setWtError(e instanceof Error ? e.message : String(e));
    } finally {
      setWtBusy(false);
    }
  }, [wtNewBranch, wtBusy, worktreeState]);

  const handleRemoveWorktree = useCallback(async (path: string, force: boolean) => {
    if (!worktreeState || wtBusy) return;
    setWtBusy(true);
    setWtError(null);
    try {
      const res = await fetch("/api/worktrees", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: worktreeState.projectRoot, path, force }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string; dirty?: boolean };
      if (!res.ok) {
        if (data.dirty && !force) {
          // Dirty worktree — ask the user to confirm a force removal
          setWtConfirmRemove(path);
          return;
        }
        setWtError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setWtConfirmRemove(null);
      if (selectedCwd === path) setSelectedCwd(worktreeState.projectRoot);
      setWtRefreshKey((k) => k + 1);
    } catch (e) {
      setWtError(e instanceof Error ? e.message : String(e));
    } finally {
      setWtBusy(false);
    }
  }, [worktreeState, wtBusy, selectedCwd]);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!directoryPickerOpenRef.current && dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
        setNewSessionPickMode(false);
        setProjectFilter("");
        setDirectoryPickerOpen(false);
        setCustomPathError(null);
      }
      if (wtDropdownRef.current && !wtDropdownRef.current.contains(e.target as Node)) {
        setWtDropdownOpen(false);
        setWtNewOpen(false);
        setWtNewBranch("");
        setWtError(null);
        setWtConfirmRemove(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Clicking a session moves the effective cwd to that session's worktree.
  // Done on the click path (not via the selectedCwd prop sync) so it also
  // works when the prop value won't change — e.g. re-clicking the already
  // open session after manually switching worktrees.
  const handleSelectSessionFromList = useCallback((session: SessionInfo) => {
    const select = () => {
      if (session.cwd) setSelectedCwd(session.cwd);
      onSelectSession(session);
    };

    if (isMobile && readMobileSessionProject(window.history.state)) {
      let completed = false;
      const finishAfterPop = () => {
        if (completed) return;
        completed = true;
        window.removeEventListener("popstate", finishAfterPop);
        select();
      };
      window.addEventListener("popstate", finishAfterPop, { once: true });
      window.history.back();
      window.setTimeout(finishAfterPop, 250);
      return;
    }

    select();
  }, [isMobile, onSelectSession]);

  const handleNewSession = useCallback(() => {
    setNewSessionPickMode(true);
    setDropdownOpen(true);
    setDirectoryPickerOpen(false);
    setCustomPathError(null);
  }, []);

  const recentProjects = getRecentProjects(allSessions);
  const showProjectFilter = recentProjects.length > 8;
  const visibleProjects = projectFilter.trim()
    ? recentProjects.filter((p) => p.toLowerCase().includes(projectFilter.trim().toLowerCase()))
    : recentProjects;

  // Sessions of every worktree in the selected project are shown together.
  // In All Projects mode the sidebar keeps every project visible at once.
  const selectedProject = projectRootFor(selectedCwd);
  const filteredSessions = allProjectsMode || !selectedProject
    ? allSessions
    : allSessions.filter((s) => (s.projectRoot ?? s.cwd) === selectedProject);
  const showWorktreeSwitcher = Boolean(
    worktreeState?.isGit
    && worktreeState.isTopLevel
    && selectedCwd
    && selectedProject === worktreeState.projectRoot
  );
  const worktreeGuide = selectedCwd
    && worktreeState
    && selectedProject === worktreeState.projectRoot
    && !showWorktreeSwitcher
    ? (worktreeState.isGit
        ? {
            label: "Open repo root",
            title: "Open the repository root to manage worktrees.",
          }
        : {
            label: "Git repo root only",
            title: "Worktrees are available in Git repository roots.",
          })
    : null;
  const worktreeLoading = Boolean(selectedCwd && worktreeLoadingCwd === selectedCwd);
  const inactiveWorktreeSelector = worktreeGuide
    ?? (worktreeLoading && !showWorktreeSwitcher
      ? {
          label: "Worktrees...",
          title: "Checking worktrees for this directory.",
        }
      : null);

  // Build parent-child tree within the filtered set
  const sessionTree = buildSessionTree(filteredSessions);
  const groupedSessionTrees = allProjectsMode ? groupSessionsByProject(filteredSessions) : [];

  const currentWorktree = showWorktreeSwitcher && worktreeState
    ? worktreeState.worktrees.find((worktree) => worktree.path === selectedCwd) ?? worktreeState.worktrees.find((worktree) => worktree.isMain)
    : null;
  const selectedProjectLabel = selectedProject ? displayCwd(selectedProject, homeDir) : "Projects";
  const showMobileProjects = isMobile && allProjectsMode;
  const sessionResultCount = showMobileProjects ? groupedSessionTrees.length : filteredSessions.length;
  const explorerCwd = selectedCwd ?? selectedCwdProp ?? null;
  const projectTriggerLabel = isMobile && mobileMode === "explorer" && explorerCwd
    ? displayCwd(projectRootFor(explorerCwd) ?? explorerCwd, homeDir)
    : allProjectsMode
      ? ALL_PROJECTS_LABEL
      : selectedCwd
        ? displayCwd(selectedProject ?? selectedCwd, homeDir)
        : initialSessionId && !restoredRef.current
          ? "Restoring session…"
          : "Choose project";

  return (
    <div className={styles.root} data-mobile-mode={mobileMode}>
      <header className={styles.header}>
        <div className={styles.topRow}>
          <PiAgentTitle appName={appName} />
          <div className={styles.headerActions}>
            <IconButton
              label="New session"
              size={isMobile ? "touch" : "compact"}
              className={styles.newButton}
              onClick={handleNewSession}
            >
              <svg width="16" height="16" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><line x1="6" y1="1" x2="6" y2="11" /><line x1="1" y1="6" x2="11" y2="6" /></svg>
            </IconButton>
            {(!isMobile || mobileMode === "sessions") && (
              <IconButton
                label={sessionRefreshDone ? "Sessions refreshed" : "Refresh sessions"}
                tooltip={false}
                size={isMobile ? "touch" : "compact"}
                className={styles.headerIcon}
                data-complete={sessionRefreshDone || undefined}
                onClick={() => loadSessions(false)}
              >
                {sessionRefreshDone ? (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>
                ) : (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></svg>
                )}
              </IconButton>
            )}
            {onRequestClose && (
              <IconButton label="Close workspace navigator" size={isMobile ? "touch" : "compact"} className={styles.headerIcon} onClick={onRequestClose}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></svg>
              </IconButton>
            )}
          </div>
        </div>

        <div className={styles.mobileModes}>
          <SegmentedControl
            value={mobileMode}
            label="Workspace navigator mode"
            fullWidth
            options={[
              { value: "sessions", label: "Sessions" },
              { value: "explorer", label: "Explorer", disabled: !selectedCwd && !selectedCwdProp },
            ]}
            onValueChange={(value) => setMobileMode(value as "sessions" | "explorer")}
          />
        </div>

        <div className={styles.projectArea} ref={dropdownRef}>
          <button
            type="button"
            className={styles.pickerTrigger}
            data-empty={!selectedCwd || undefined}
            title={selectedProject ?? selectedCwd ?? "Choose project"}
            aria-expanded={dropdownOpen}
            onClick={() => {
              setNewSessionPickMode(false);
              setDropdownOpen((open) => !open);
            }}
          >
            <span className={styles.triggerIcon}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /></svg>
            </span>
            <PathLabel text={projectTriggerLabel} />
            <svg className={styles.chevron} data-open={dropdownOpen || undefined} viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="2 3.5 5 6.5 8 3.5" /></svg>
          </button>

          <AnimatedDropdown open={dropdownOpen}>
            {newSessionPickMode && <div className={styles.dropdownHeader}>Choose a directory for the new session</div>}
            {showProjectFilter && (
              <div className={styles.filterWrap}>
                <Input
                  className={styles.projectFilter}
                  value={projectFilter}
                  onChange={(event) => setProjectFilter(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      setProjectFilter("");
                      setDropdownOpen(false);
                    }
                  }}
                  placeholder="Filter projects…"
                  aria-label="Filter projects"
                  autoFocus
                />
              </div>
            )}
            <div className={styles.dropdownScroll}>
              {!newSessionPickMode && (
                <button
                  type="button"
                  className={styles.dropdownOption}
                  data-selected={allProjectsMode && mobileMode === "sessions" || undefined}
                  onClick={() => {
                    showProjectIndex();
                    setProjectFilter("");
                    setDirectoryPickerOpen(false);
                    setCustomPathError(null);
                    setDropdownOpen(false);
                    setMobileMode("sessions");
                  }}
                >
                  <span className={styles.checkSlot}>{allProjectsMode && mobileMode === "sessions" && <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="1.5 5 4 7.5 8.5 2.5" /></svg>}</span>
                  <span>{ALL_PROJECTS_LABEL}</span>
                </button>
              )}
              {visibleProjects.map((project) => {
                const selected = project === selectedProject && (!allProjectsMode || mobileMode === "explorer");
                return (
                  <button
                    type="button"
                    key={project}
                    className={styles.dropdownOption}
                    data-selected={selected || undefined}
                    title={project}
                    onClick={() => {
                      if (newSessionPickMode) {
                        startNewSessionInCwd(project);
                        return;
                      }
                      openProject(project, mobileMode);
                      setProjectFilter("");
                      setDirectoryPickerOpen(false);
                      setCustomPathError(null);
                      setDropdownOpen(false);
                    }}
                  >
                    <span className={styles.checkSlot}>{selected && <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="1.5 5 4 7.5 8.5 2.5" /></svg>}</span>
                    <PathLabel text={displayCwd(project, homeDir)} />
                  </button>
                );
              })}
              {visibleProjects.length === 0 && projectFilter.trim() && <div className={styles.dropdownEmpty}>No matching projects</div>}
            </div>
            <div className={styles.dropdownFooter}>
              <button type="button" className={styles.dropdownOption} onClick={(event) => { event.stopPropagation(); void handleDefaultCwd(); }}>
                <span className={styles.checkSlot}>
                  <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M1 3a1 1 0 0 1 1-1h2l1 1.5h3.5A.5.5 0 0 1 9 4v4a.5.5 0 0 1-.5.5h-7A.5.5 0 0 1 1 8Z" /></svg>
                </span>
                <span>Use default directory</span>
              </button>
              <button
                type="button"
                className={styles.dropdownOption}
                onClick={(event) => {
                  event.stopPropagation();
                  setCustomPathError(null);
                  setDropdownOpen(false);
                  setDirectoryPickerOpen(true);
                }}
              >
                <span className={styles.checkSlot}>
                  <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M1 3a1 1 0 0 1 1-1h2l1 1.5h3.5A.5.5 0 0 1 9 4v4a.5.5 0 0 1-.5.5h-7A.5.5 0 0 1 1 8Z" /><path d="M5 5.2v2.2M3.9 6.3h2.2" /></svg>
                </span>
                <span>Browse custom directory…</span>
              </button>
            </div>
          </AnimatedDropdown>
        </div>

        {showWorktreeSwitcher && worktreeState && (
          <div className={styles.worktreeArea} ref={wtDropdownRef}>
            <button type="button" className={styles.worktreeTrigger} title={currentWorktree ? `Switch worktree: ${currentWorktree.path}` : "Switch worktree"} aria-expanded={wtDropdownOpen} onClick={() => setWtDropdownOpen((open) => !open)}>
              <span className={styles.triggerIcon} data-active={currentWorktree && !currentWorktree.isMain || undefined}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" /></svg>
              </span>
              <PathLabel text={currentWorktree ? currentWorktree.branch ?? displayCwd(currentWorktree.path, homeDir) : "Loading worktree…"} />
              <svg className={styles.chevron} data-open={wtDropdownOpen || undefined} viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="2 3.5 5 6.5 8 3.5" /></svg>
            </button>

            <AnimatedDropdown open={wtDropdownOpen} className={styles.worktreeDropdown}>
              <div className={styles.dropdownScroll}>
                {worktreeState.worktrees.map((worktree) => {
                  const current = worktree.path === selectedCwd || worktree.isMain && !worktreeState.worktrees.some((candidate) => candidate.path === selectedCwd);
                  if (wtConfirmRemove === worktree.path) {
                    return (
                      <div key={worktree.path} className={styles.worktreeConfirm}>
                        <p>Uncommitted changes were found. Force-remove this checkout? The branch is kept.</p>
                        <div className={styles.worktreeConfirmActions}>
                          <Button variant="danger" size="compact" loading={wtBusy} onClick={() => void handleRemoveWorktree(worktree.path, true)}>Force remove</Button>
                          <Button size="compact" onClick={() => setWtConfirmRemove(null)}>Cancel</Button>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div key={worktree.path} className={styles.worktreeRow}>
                      <button
                        type="button"
                        className={styles.dropdownOption}
                        data-selected={current || undefined}
                        title={worktree.path}
                        onClick={() => {
                          setSelectedCwd(worktree.path);
                          setWtDropdownOpen(false);
                          setWtError(null);
                        }}
                      >
                        <span className={styles.checkSlot}>{current && <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="1.5 5 4 7.5 8.5 2.5" /></svg>}</span>
                        <PathLabel text={worktree.branch ?? displayCwd(worktree.path, homeDir)} />
                        {worktree.isMain && <span className={styles.triggerMeta}>main</span>}
                      </button>
                      {!worktree.isMain && (
                        <IconButton label={`Remove worktree ${worktree.branch ?? worktree.path}`} size={isMobile ? "touch" : "compact"} className={styles.worktreeRemove} disabled={wtBusy} onClick={() => void handleRemoveWorktree(worktree.path, false)}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6" /><path d="m19 6-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg>
                        </IconButton>
                      )}
                    </div>
                  );
                })}
              </div>
              {!wtNewOpen ? (
                <button type="button" className={styles.dropdownOption} onClick={(event) => { event.stopPropagation(); setWtNewOpen(true); setWtError(null); setTimeout(() => wtNewInputRef.current?.focus(), 0); }}>
                  <span className={styles.checkSlot}>
                    <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" aria-hidden="true"><line x1="5" y1="1" x2="5" y2="9" /><line x1="1" y1="5" x2="9" y2="5" /></svg>
                  </span>
                  <span>New worktree…</span>
                </button>
              ) : (
                <div className={styles.worktreeNew}>
                  <Input
                    ref={wtNewInputRef}
                    className="pi-control--mono"
                    value={wtNewBranch}
                    onChange={(event) => { setWtNewBranch(event.target.value); setWtError(null); }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") { event.preventDefault(); void handleCreateWorktree(); }
                      if (event.key === "Escape") { setWtNewOpen(false); setWtNewBranch(""); setWtError(null); }
                    }}
                    placeholder="branch name"
                    aria-label="New worktree branch"
                  />
                  <div className={styles.worktreeNewActions}>
                    <Button variant="primary" size="compact" loading={wtBusy} disabled={!wtNewBranch.trim()} onClick={() => void handleCreateWorktree()}>Create</Button>
                    <Button size="compact" onClick={() => { setWtNewOpen(false); setWtNewBranch(""); setWtError(null); }}>Cancel</Button>
                  </div>
                </div>
              )}
              {wtError && <div className={styles.worktreeError} role="alert">{wtError}</div>}
            </AnimatedDropdown>
          </div>
        )}
        {inactiveWorktreeSelector && (
          <div className={styles.worktreeGuide} title={inactiveWorktreeSelector.title}>
            <span className={styles.triggerIcon}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" /></svg>
            </span>
            <span>{inactiveWorktreeSelector.label}</span>
          </div>
        )}
      </header>

      <section className={styles.sessionList} role={showMobileProjects ? "region" : "tree"} aria-label="Sessions">
        <div className={styles.mobileSessionHeader}>
          {!allProjectsMode && (
            <IconButton
              label="Back to projects"
              size="compact"
              className={styles.mobileBack}
              onClick={() => { showProjectIndex(); setDropdownOpen(false); }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg>
            </IconButton>
          )}
          <h2>{allProjectsMode ? "Projects" : selectedProjectLabel}</h2>
          <span className={styles.mobileSessionCount}>{sessionResultCount}</span>
        </div>

        {loading && (
          <div className={styles.state}>
            <div className={styles.stateSkeleton}><Skeleton height={52} /><Skeleton height={52} /><Skeleton height={52} /></div>
          </div>
        )}
        {error && (
          <div className={styles.state} data-tone="danger" role="alert">
            <strong>Could not load sessions.</strong>
            <span className={styles.stateDetail}>{error}</span>
            <Button size={isMobile ? "touch" : "compact"} onClick={() => loadSessions(true)}>Retry</Button>
          </div>
        )}
        {!loading && !error && sessionResultCount === 0 && (
          <div className={styles.state}>
            <strong>{showMobileProjects ? "No projects yet" : "No sessions in this project"}</strong>
            <span>{showMobileProjects ? "Start a session to add the first project." : "Start a clean session in the selected directory."}</span>
            <Button variant="primary" size={isMobile ? "touch" : "compact"} onClick={handleNewSession}>New session</Button>
          </div>
        )}

        {showMobileProjects && !loading && !error && (
          <div className={styles.projectList}>
            {groupedSessionTrees.map((group) => (
              <button
                type="button"
                key={group.projectRoot}
                className={styles.projectCard}
                onClick={() => openProject(group.projectRoot)}
              >
                <span className={styles.projectCardCopy}>
                  <PathLabel text={displayCwd(group.projectRoot, homeDir)} className={styles.projectCardPath} />
                  <span className={styles.projectCardMeta}>Updated {formatRelativeTime(group.latestModified)}</span>
                </span>
                <span className={styles.projectCardCount}>{group.sessions.length}</span>
              </button>
            ))}
          </div>
        )}

        {!isMobile && allProjectsMode && groupedSessionTrees.map((group) => (
          <div key={group.projectRoot} className={styles.projectGroup}>
            <button type="button" className={styles.projectHeading} title={`Focus ${group.projectRoot}`} onClick={() => openProject(group.projectRoot)}>
              <PathLabel text={displayCwd(group.projectRoot, homeDir)} />
              <span className={styles.projectHeadingCount}>{group.sessions.length}</span>
            </button>
            {group.tree.map((node) => (
              <SessionTreeItem
                key={node.session.id}
                node={node}
                selectedSessionId={selectedSessionId}
                runningSessionIds={runningSessionIds}
                unreadSessionIds={unreadSessionIds}
                isMobile={isMobile}
                onSelectSession={handleSelectSessionFromList}
                onRenamed={loadSessions}
                onSessionDeleted={(id) => { onSessionDeleted?.(id); void loadSessions(); }}
                depth={0}
              />
            ))}
          </div>
        ))}
        {!allProjectsMode && !loading && !error && sessionTree.map((node) => (
          <SessionTreeItem
            key={node.session.id}
            node={node}
            selectedSessionId={selectedSessionId}
            runningSessionIds={runningSessionIds}
            unreadSessionIds={unreadSessionIds}
            isMobile={isMobile}
            onSelectSession={handleSelectSessionFromList}
            onRenamed={loadSessions}
            onSessionDeleted={(id) => { onSessionDeleted?.(id); void loadSessions(); }}
            depth={0}
          />
        ))}
      </section>

      {explorerCwd && (
        <section className={styles.explorerSection} data-open={isMobile || explorerOpen} aria-label="File explorer">
          <div className={styles.explorerHeader}>
            <button type="button" className={styles.explorerToggle} onClick={() => { if (!isMobile) setExplorerOpen((open) => !open); }} aria-expanded={isMobile || explorerOpen}>
              {!isMobile && (
                <svg className={styles.explorerChevron} data-open={explorerOpen || undefined} viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="3 2 7 5 3 8" /></svg>
              )}
              Explorer
            </button>
            <IconButton
              label={explorerRefreshDone ? "Explorer refreshed" : "Refresh explorer"}
              tooltip={false}
              size={isMobile ? "touch" : "compact"}
              className={styles.explorerRefresh}
              data-complete={explorerRefreshDone || undefined}
              onClick={() => {
                setExplorerKey((key) => key + 1);
                setExplorerRefreshDone(true);
                if (explorerRefreshTimerRef.current) clearTimeout(explorerRefreshTimerRef.current);
                explorerRefreshTimerRef.current = setTimeout(() => setExplorerRefreshDone(false), 2000);
              }}
            >
              {explorerRefreshDone ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></svg>
              )}
            </IconButton>
          </div>
          {(isMobile || explorerOpen) && (
            <div className={styles.explorerBody}>
              <FileExplorer
                cwd={explorerCwd}
                onOpenFile={onOpenFile ?? (() => {})}
                refreshKey={explorerKey}
                onAtMention={onAtMention}
              />
            </div>
          )}
        </section>
      )}
      {directoryPickerOpen && (
        <DirectoryPickerModal
          initialPath={selectedCwd ?? selectedCwdProp ?? homeDir}
          homeDir={homeDir}
          title={newSessionPickMode ? "Choose new session directory" : "Choose project directory"}
          subtitle={newSessionPickMode ? "Browse folders and start a new session in the selected directory." : "Browse folders and switch the navigator to the selected project directory."}
          selectLabel={newSessionPickMode ? "Start session here" : "Open this directory"}
          busy={customPathValidating}
          error={customPathError}
          onClose={() => {
            setDirectoryPickerOpen(false);
            setNewSessionPickMode(false);
            setCustomPathError(null);
          }}
          onSelect={commitCustomPath}
        />
      )}
    </div>
  );
}

function SessionTreeItem({
  node,
  selectedSessionId,
  runningSessionIds,
  unreadSessionIds,
  isMobile,
  onSelectSession,
  onRenamed,
  onSessionDeleted,
  depth,
}: {
  node: SessionTreeNode;
  selectedSessionId: string | null;
  runningSessionIds: Set<string>;
  unreadSessionIds: Set<string>;
  isMobile: boolean;
  onSelectSession: (s: SessionInfo) => void;
  onRenamed?: () => void;
  onSessionDeleted?: (id: string) => void;
  depth: number;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const hasChildren = node.children.length > 0;

  return (
    <div className={styles.treeNode} style={{ "--tree-depth": depth } as CSSProperties}>
      {depth > 0 && <div className={styles.indentLine} aria-hidden="true" />}
      <SessionItem
        session={node.session}
        isSelected={node.session.id === selectedSessionId}
        isRunning={runningSessionIds.has(node.session.id)}
        isUnread={unreadSessionIds.has(node.session.id)}
        isMobile={isMobile}
        onClick={() => onSelectSession(node.session)}
        onRenamed={onRenamed}
        onDeleted={(id) => onSessionDeleted?.(id)}
        depth={depth}
        hasChildren={hasChildren}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((value) => !value)}
      />
      {hasChildren && !collapsed && node.children.map((child) => (
        <SessionTreeItem
          key={child.session.id}
          node={child}
          selectedSessionId={selectedSessionId}
          runningSessionIds={runningSessionIds}
          unreadSessionIds={unreadSessionIds}
          isMobile={isMobile}
          onSelectSession={onSelectSession}
          onRenamed={onRenamed}
          onSessionDeleted={onSessionDeleted}
          depth={depth + 1}
        />
      ))}
    </div>
  );
}

function RunningSessionIndicator() {
  return (
    <output className={styles.indicator} title="Agent running…" aria-label="Agent running">
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <g className={styles.runningSpinner}>
          <path d="M21 12a9 9 0 1 1-3.8-7.4" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" />
        </g>
      </svg>
    </output>
  );
}

function UnreadSessionIndicator() {
  return (
    <output className={`${styles.indicator} ${styles.unreadPulse}`} title="New activity" aria-label="New session activity">
      <svg viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <circle cx="7" cy="7" r="2.5" fill="currentColor" />
        <circle className={styles.unreadPulseRing} cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    </output>
  );
}

function SessionItem({
  session,
  isSelected,
  isRunning,
  isUnread,
  isMobile,
  onClick,
  onRenamed,
  onDeleted,
  depth = 0,
  hasChildren = false,
  collapsed = false,
  onToggleCollapse,
}: {
  session: SessionInfo;
  isSelected: boolean;
  isRunning?: boolean;
  isUnread?: boolean;
  isMobile: boolean;
  onClick: () => void;
  onRenamed?: () => void;
  onDeleted?: (id: string) => void;
  depth?: number;
  hasChildren?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [swipeOpen, setSwipeOpen] = useState(false);
  const [swipeDragging, setSwipeDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const swipeRef = useRef<SessionSwipeGesture | null>(null);
  const suppressSwipeClickRef = useRef(false);
  const suppressSwipeClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const title = session.name || session.firstMessage.slice(0, 50) || session.id.slice(0, 12);

  const closeSwipe = useCallback(() => {
    setSwipeOpen(false);
    setSwipeOffset(0);
  }, []);

  const openSwipe = useCallback(() => {
    window.dispatchEvent(new CustomEvent(SESSION_SWIPE_OPEN_EVENT, { detail: { id: session.id } }));
    setSwipeOpen(true);
    setSwipeOffset(SESSION_SWIPE_ACTION_WIDTH);
  }, [session.id]);

  const clearSwipeClickSuppression = useCallback(() => {
    if (suppressSwipeClickTimerRef.current) {
      clearTimeout(suppressSwipeClickTimerRef.current);
      suppressSwipeClickTimerRef.current = null;
    }
    suppressSwipeClickRef.current = false;
  }, []);

  const suppressNextSwipeClick = useCallback(() => {
    suppressSwipeClickRef.current = true;
    if (suppressSwipeClickTimerRef.current) clearTimeout(suppressSwipeClickTimerRef.current);
    suppressSwipeClickTimerRef.current = setTimeout(() => {
      suppressSwipeClickRef.current = false;
      suppressSwipeClickTimerRef.current = null;
    }, SESSION_SWIPE_SUPPRESS_CLICK_MS);
  }, []);

  useEffect(() => {
    if (isMobile) return;
    setMobileActionsOpen(false);
    closeSwipe();
  }, [isMobile, closeSwipe]);

  useEffect(() => {
    if (!isMobile) return;
    const handleOtherSwipeOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: string }>).detail;
      if (detail?.id !== session.id) closeSwipe();
    };
    window.addEventListener(SESSION_SWIPE_OPEN_EVENT, handleOtherSwipeOpen);
    return () => window.removeEventListener(SESSION_SWIPE_OPEN_EVENT, handleOtherSwipeOpen);
  }, [isMobile, session.id, closeSwipe]);

  useEffect(() => {
    if (isSelected || confirmDelete || renaming || deleting) {
      closeSwipe();
      setMobileActionsOpen(false);
    }
  }, [isSelected, confirmDelete, renaming, deleting, closeSwipe]);

  const startRename = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    closeSwipe();
    setMobileActionsOpen(false);
    setRenameValue(session.name ?? "");
    setRenaming(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }, [session.name, closeSwipe]);

  const commitRename = useCallback(async () => {
    const name = renameValue.trim();
    setRenaming(false);
    if (name === (session.name ?? "")) return;
    try {
      await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      onRenamed?.();
    } catch {
      // ignore
    }
  }, [renameValue, session.id, session.name, onRenamed]);

  const handleDeleteClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    closeSwipe();
    setMobileActionsOpen(false);
    setConfirmDelete(true);
  }, [closeSwipe]);

  const handleDeleteConfirm = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDelete(false);
    setDeleting(true);
    try {
      await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, { method: "DELETE" });
      onDeleted?.(session.id);
    } catch {
      setDeleting(false);
    }
  }, [session.id, onDeleted]);

  const handleDeleteCancel = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDelete(false);
  }, []);

  const handleRowClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (suppressSwipeClickRef.current) {
      e.preventDefault();
      e.stopPropagation();
      clearSwipeClickSuppression();
      return;
    }
    if (mobileActionsOpen) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (isMobile && swipeOpen) {
      e.preventDefault();
      e.stopPropagation();
      closeSwipe();
      return;
    }
    onClick();
  }, [clearSwipeClickSuppression, closeSwipe, isMobile, mobileActionsOpen, onClick, swipeOpen]);

  const handlePointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!isMobile || confirmDelete || renaming || deleting || mobileActionsOpen) return;
    if (e.button !== 0 || isInteractiveSwipeTarget(e.target)) return;

    swipeRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startOffset: swipeOpen ? SESSION_SWIPE_ACTION_WIDTH : 0,
      axis: null,
      moved: false,
    };
    setSwipeDragging(true);
  }, [confirmDelete, deleting, isMobile, mobileActionsOpen, renaming, swipeOpen]);

  const handlePointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = swipeRef.current;
    if (!gesture || gesture.pointerId !== e.pointerId) return;

    const dx = e.clientX - gesture.startX;
    const dy = e.clientY - gesture.startY;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);

    if (!gesture.axis) {
      if (absX < SESSION_SWIPE_AXIS_LOCK_PX && absY < SESSION_SWIPE_AXIS_LOCK_PX) return;
      if (absY > absX * SESSION_SWIPE_AXIS_RATIO) {
        gesture.axis = "y";
        setSwipeDragging(false);
        return;
      }
      if (absX <= absY * SESSION_SWIPE_AXIS_RATIO) return;

      gesture.axis = "x";
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Some browsers throw if capture is unavailable or already lost.
      }
    }

    if (gesture.axis !== "x") return;
    e.preventDefault();

    const nextOffset = clampSessionSwipeOffset(gesture.startOffset - dx);
    if (absX > SESSION_SWIPE_AXIS_LOCK_PX) gesture.moved = true;
    setSwipeOffset(nextOffset);
  }, []);

  const finishSwipe = useCallback((e: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
    const gesture = swipeRef.current;
    if (!gesture || gesture.pointerId !== e.pointerId) return;

    swipeRef.current = null;
    setSwipeDragging(false);
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore capture state races.
    }

    if (gesture.axis !== "x" || cancelled) {
      if (cancelled) closeSwipe();
      return;
    }

    e.preventDefault();
    const finalOffset = clampSessionSwipeOffset(gesture.startOffset - (e.clientX - gesture.startX));
    if (gesture.moved) suppressNextSwipeClick();
    if (finalOffset >= SESSION_SWIPE_OPEN_THRESHOLD) openSwipe();
    else closeSwipe();
  }, [closeSwipe, openSwipe, suppressNextSwipeClick]);

  const handlePointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    finishSwipe(e);
  }, [finishSwipe]);

  const handlePointerCancel = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    finishSwipe(e, true);
  }, [finishSwipe]);

  return (
    <div
      className={styles.sessionItem}
      data-deleting={deleting || undefined}
      style={{ "--swipe-offset": isMobile ? `${swipeOffset}px` : "0px" } as CSSProperties}
    >
      {isMobile && !confirmDelete && !renaming && !mobileActionsOpen && (
        <button
          type="button"
          className={styles.swipeDelete}
          data-visible={swipeOffset > 8 || undefined}
          aria-label={`Delete ${title}`}
          onClick={handleDeleteClick}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6" /><path d="m19 6-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg>
          Delete
        </button>
      )}
      <div
        className={styles.sessionRow}
        data-selected={isSelected || undefined}
        data-confirm={confirmDelete || undefined}
        data-dragging={swipeDragging || undefined}
        role="treeitem"
        aria-selected={isSelected}
        tabIndex={!confirmDelete && !renaming && !deleting && !mobileActionsOpen ? 0 : -1}
        aria-disabled={confirmDelete || renaming || deleting || mobileActionsOpen || undefined}
        aria-label={`Open ${title}`}
        onClick={confirmDelete || renaming || deleting ? undefined : handleRowClick}
        onKeyDown={(event) => {
          if ((event.key === "Enter" || event.key === " ") && !confirmDelete && !renaming && !deleting && !mobileActionsOpen) {
            event.preventDefault();
            onClick();
          }
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      >
        {confirmDelete ? (
          <>
            <div className={styles.confirmCopy}>Delete <strong>&ldquo;{title.slice(0, 22)}{title.length > 22 ? "…" : ""}&rdquo;</strong>?</div>
            <div className={styles.confirmActions}>
              <Button variant="danger" size="compact" onClick={handleDeleteConfirm}>Delete</Button>
              <Button size="compact" onClick={handleDeleteCancel}>Cancel</Button>
            </div>
          </>
        ) : renaming ? (
          <Input
            ref={inputRef}
            className={styles.renameInput}
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            onBlur={() => void commitRename()}
            onKeyDown={(event) => {
              if (event.key === "Enter") void commitRename();
              if (event.key === "Escape") setRenaming(false);
            }}
            aria-label="Session name"
            autoFocus
          />
        ) : mobileActionsOpen ? (
          <div className={styles.mobileActions}>
            <span className={styles.mobileActionsTitle}>{title}</span>
            <Button size="compact" onClick={startRename}>Rename</Button>
            <Button variant="danger" size="compact" onClick={handleDeleteClick}>Delete</Button>
            <IconButton label="Cancel session actions" size="compact" onClick={(event) => { event.stopPropagation(); setMobileActionsOpen(false); }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></svg>
            </IconButton>
          </div>
        ) : (
          <>
            {depth > 0 && (
              <svg className={styles.forkIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" /></svg>
            )}
            <div className={styles.sessionPrimary}>
              <div className={styles.sessionTitle} title={isRunning ? `${title} · Agent running…` : isUnread ? `${title} · New activity` : title}>
                {isRunning ? <RunningSessionIndicator /> : isUnread ? <UnreadSessionIndicator /> : null}
                <span className={styles.sessionTitleText}>{title}</span>
              </div>
              <div className={styles.sessionMeta}>
                <span title={session.modified}>{formatRelativeTime(session.modified)}</span>
                <span>{session.messageCount} msgs</span>
                {session.worktreeBranch && (
                  <span className={styles.sessionBranch} title={`Worktree: ${session.cwd}`}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" /></svg>
                    <span>{session.worktreeBranch}</span>
                  </span>
                )}
              </div>
            </div>
            {hasChildren && (
              <IconButton
                label={collapsed ? "Expand forks" : "Collapse forks"}
                size="compact"
                className={styles.collapseButton}
                data-collapsed={collapsed || undefined}
                onClick={(event) => { event.stopPropagation(); onToggleCollapse?.(); }}
              >
                <svg width="11" height="11" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="2 3.5 5 6.5 8 3.5" /></svg>
              </IconButton>
            )}
            <div className={styles.sessionActions}>
              <IconButton label={`Rename ${title}`} size="compact" className={styles.sessionAction} onClick={startRename}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3Z" /></svg>
              </IconButton>
              <IconButton label={`Delete ${title}`} size="compact" className={styles.sessionAction} data-danger="true" onClick={handleDeleteClick}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6" /><path d="m19 6-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg>
              </IconButton>
            </div>
            {isMobile && (
              <IconButton label={`Actions for ${title}`} size="touch" className={styles.mobileMore} onClick={(event) => { event.stopPropagation(); closeSwipe(); setMobileActionsOpen(true); }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></svg>
              </IconButton>
            )}
          </>
        )}
      </div>
    </div>
  );
}
