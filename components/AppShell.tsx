"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { type CSSProperties, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from "react";
import { useForkComposerFocus } from "@/hooks/useForkComposerFocus";
import { useTheme } from "@/hooks/useTheme";
import { useViewportTier } from "@/hooks/useViewportTier";
import { type AppSettings, DEFAULT_APP_SETTINGS } from "@/lib/app-settings";
import { copyText } from "@/lib/clipboard";
import { buildAtMentionText } from "@/lib/file-fuzzy";
import { getFileName } from "@/lib/file-paths";
import {
  type MobileWorkspaceLayer,
  readMobileInspectorFiles,
  readMobileWorkspaceLayer,
  withMobileInspectorFiles,
  withMobileWorkspaceLayer,
  withoutMobileInspectorFiles,
  withoutMobileWorkspaceLayer,
} from "@/lib/mobile-workspace";
import type { SessionStatsInfo } from "@/lib/pi-types";
import type { SlashUiAction } from "@/lib/slash-command-registry";
import type { SessionInfo, SessionTreeNode } from "@/lib/types";
import styles from "./AppShell.module.css";
import { InspectorFileSheet } from "./app-shell/InspectorFileSheet";
import { type MobileMoreActions, MobileMoreSheet } from "./app-shell/MobileMoreSheet";
import { type SessionCopyField, SessionInfoPanel } from "./app-shell/SessionInfoPanel";
import { BranchNavigator } from "./BranchNavigator";
import type { ChatInputHandle } from "./ChatInput";
import { ChatWindow } from "./ChatWindow";
import { FileViewer } from "./FileViewer";
import { GitChangesPanel } from "./GitChangesPanel";
import { HotkeysModal } from "./HotkeysModal";
import { ModelsConfig } from "./ModelsConfig";
import { PluginsConfig } from "./PluginsConfig";
import { ProjectTrustModal } from "./ProjectTrustModal";
import { SessionSidebar } from "./SessionSidebar";
import { SettingsModal } from "./SettingsModal";
import { SkillsConfig } from "./SkillsConfig";
import { type Tab, TabBar } from "./TabBar";
import { TerminalPanel } from "./TerminalPanel";
import { Button, IconButton } from "./ui";

type ResizingPanel = "sidebar" | "right";

const SIDEBAR_WIDTH_STORAGE_KEY = "pi-sidebar-width";
const RIGHT_PANEL_WIDTH_STORAGE_KEY = "pi-right-panel-width";
const SIDEBAR_DEFAULT_WIDTH = 288;
const SIDEBAR_MIN_WIDTH = 240;
const SIDEBAR_MAX_WIDTH = 520;
const RIGHT_PANEL_DEFAULT_WIDTH = 560;
const RIGHT_PANEL_MIN_WIDTH = 300;
const RIGHT_PANEL_MAX_WIDTH = 960;
const OVERLAY_BREAKPOINT = 1024;

function clampWidth(value: number, min: number, max: number): number {
  const safeMax = Math.max(min, max);
  return Math.min(Math.max(Math.round(value), min), safeMax);
}

function getSidebarMaxWidth(): number {
  if (typeof window === "undefined" || window.innerWidth <= OVERLAY_BREAKPOINT) return SIDEBAR_MAX_WIDTH;
  return Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, Math.floor(window.innerWidth * 0.5)));
}

function getRightPanelMaxWidth(): number {
  if (typeof window === "undefined" || window.innerWidth <= OVERLAY_BREAKPOINT) return RIGHT_PANEL_MAX_WIDTH;
  return Math.max(RIGHT_PANEL_MIN_WIDTH, Math.min(RIGHT_PANEL_MAX_WIDTH, Math.floor(window.innerWidth * 0.75)));
}

function getRightPanelDefaultWidth(): number {
  if (typeof window === "undefined" || window.innerWidth <= OVERLAY_BREAKPOINT) return RIGHT_PANEL_DEFAULT_WIDTH;
  return clampWidth(Math.round(window.innerWidth * 0.42), RIGHT_PANEL_MIN_WIDTH, getRightPanelMaxWidth());
}

function readStoredWidth(key: string, fallback: number, min: number, max: number): number {
  if (typeof window === "undefined") return clampWidth(fallback, min, max);
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) ? clampWidth(parsed, min, max) : clampWidth(fallback, min, max);
  } catch {
    return clampWidth(fallback, min, max);
  }
}
export function AppShell() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isDark, toggleTheme } = useTheme();
  const viewportTier = useViewportTier();
  const usesOverlayLayout = viewportTier !== "desktop";
  const [selectedSession, setSelectedSession] = useState<SessionInfo | null>(null);
  // When user clicks +, we only store the cwd — no fake session id
  const [newSessionCwd, setNewSessionCwd] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [sessionKey, setSessionKey] = useState(0);
  const [explorerRefreshKey, setExplorerRefreshKey] = useState(0);
  const [modelsConfigOpen, setModelsConfigOpen] = useState(false);
  const [modelsRefreshKey, setModelsRefreshKey] = useState(0);
  const [skillsConfigOpen, setSkillsConfigOpen] = useState(false);
  const [pluginsConfigOpen, setPluginsConfigOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [projectTrustOpen, setProjectTrustOpen] = useState(false);
  const [hotkeysOpen, setHotkeysOpen] = useState(false);
  const [appSettings, setAppSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [inspectorFileSheetOpen, setInspectorFileSheetOpen] = useState(false);
  const [mobileSidebarReady, setMobileSidebarReady] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH);
  const [rightPanelWidth, setRightPanelWidth] = useState(RIGHT_PANEL_DEFAULT_WIDTH);
  const [layoutPrefsLoaded, setLayoutPrefsLoaded] = useState(false);
  const [resizingPanel, setResizingPanel] = useState<ResizingPanel | null>(null);
  const sidebarPanelRef = useRef<HTMLElement>(null);
  const inspectorPanelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    setMobileSidebarReady(true);
  }, []);

  const applyWorkspaceLayer = useCallback((layer: MobileWorkspaceLayer | null) => {
    setSidebarOpen(layer === "sessions");
    setRightPanelOpen(layer === "inspector");
    setMobileMoreOpen(layer === "more");
  }, []);

  const openWorkspaceLayer = useCallback((layer: MobileWorkspaceLayer) => {
    if (!usesOverlayLayout) return;
    const currentLayer = readMobileWorkspaceLayer(window.history.state);
    const nextState = withMobileWorkspaceLayer(withoutMobileInspectorFiles(window.history.state), layer);
    if (currentLayer) window.history.replaceState(nextState, "", window.location.href);
    else window.history.pushState(nextState, "", window.location.href);
    applyWorkspaceLayer(layer);
  }, [applyWorkspaceLayer, usesOverlayLayout]);

  const dismissWorkspaceLayer = useCallback(() => {
    if (!usesOverlayLayout) return;
    window.history.replaceState(withoutMobileInspectorFiles(withoutMobileWorkspaceLayer(window.history.state)), "", window.location.href);
    applyWorkspaceLayer(null);
  }, [applyWorkspaceLayer, usesOverlayLayout]);

  const closeWorkspaceLayer = useCallback(() => {
    if (!usesOverlayLayout) return;
    if (readMobileWorkspaceLayer(window.history.state)) window.history.back();
    else applyWorkspaceLayer(null);
  }, [applyWorkspaceLayer, usesOverlayLayout]);

  const openInspectorFileSheet = useCallback(() => {
    if (!usesOverlayLayout) return;
    if (!readMobileInspectorFiles(window.history.state)) {
      window.history.pushState(withMobileInspectorFiles(window.history.state), "", window.location.href);
    }
    setInspectorFileSheetOpen(true);
  }, [usesOverlayLayout]);

  const closeInspectorFileSheet = useCallback(() => {
    if (!usesOverlayLayout) {
      setInspectorFileSheetOpen(false);
      return;
    }
    if (readMobileInspectorFiles(window.history.state)) window.history.back();
    else setInspectorFileSheetOpen(false);
  }, [usesOverlayLayout]);

  useEffect(() => {
    if (!usesOverlayLayout) {
      if (readMobileWorkspaceLayer(window.history.state)) {
        window.history.replaceState(withoutMobileInspectorFiles(withoutMobileWorkspaceLayer(window.history.state)), "", window.location.href);
      }
      setInspectorFileSheetOpen(false);
      setMobileMoreOpen(false);
      setSidebarOpen(true);
      return;
    }

    const syncHistoryLayers = () => {
      applyWorkspaceLayer(readMobileWorkspaceLayer(window.history.state));
      setInspectorFileSheetOpen(readMobileInspectorFiles(window.history.state));
    };
    syncHistoryLayers();
    window.addEventListener("popstate", syncHistoryLayers);
    return () => window.removeEventListener("popstate", syncHistoryLayers);
  }, [applyWorkspaceLayer, usesOverlayLayout]);

  useEffect(() => {
    if (!usesOverlayLayout || (!sidebarOpen && !rightPanelOpen)) return;
    const panel = sidebarOpen ? sidebarPanelRef.current : inspectorPanelRef.current;
    const focusFrame = window.requestAnimationFrame(() => {
      const preferred = sidebarOpen
        ? panel?.querySelector<HTMLElement>("[aria-label='Close workspace navigator']")
        : panel?.querySelector<HTMLElement>("[aria-label='Back to conversation']");
      (preferred ?? panel)?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || document.querySelector(".pi-dialog")) return;
      event.preventDefault();
      closeWorkspaceLayer();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeWorkspaceLayer, rightPanelOpen, sidebarOpen, usesOverlayLayout]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/app-settings", { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json() as AppSettings;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return data;
      })
      .then((data) => {
        if (!cancelled) setAppSettings(data);
      })
      .catch(() => {
        // Keep the built-in default if settings cannot be loaded.
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const applyTitle = () => {
      if (document.title !== appSettings.displayName) document.title = appSettings.displayName;
    };
    applyTitle();
    const observer = new MutationObserver(applyTitle);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [appSettings.displayName]);

  useEffect(() => {
    setSidebarWidth(readStoredWidth(SIDEBAR_WIDTH_STORAGE_KEY, SIDEBAR_DEFAULT_WIDTH, SIDEBAR_MIN_WIDTH, getSidebarMaxWidth()));
    setRightPanelWidth(readStoredWidth(RIGHT_PANEL_WIDTH_STORAGE_KEY, getRightPanelDefaultWidth(), RIGHT_PANEL_MIN_WIDTH, getRightPanelMaxWidth()));
    setLayoutPrefsLoaded(true);
  }, []);

  useEffect(() => {
    if (!layoutPrefsLoaded || resizingPanel) return;
    try {
      window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidth));
      window.localStorage.setItem(RIGHT_PANEL_WIDTH_STORAGE_KEY, String(rightPanelWidth));
    } catch {
      // Ignore storage failures (private windows, denied storage, etc.).
    }
  }, [layoutPrefsLoaded, resizingPanel, sidebarWidth, rightPanelWidth]);

  useEffect(() => {
    const handleResize = () => {
      setSidebarWidth((width) => clampWidth(width, SIDEBAR_MIN_WIDTH, getSidebarMaxWidth()));
      setRightPanelWidth((width) => clampWidth(width, RIGHT_PANEL_MIN_WIDTH, getRightPanelMaxWidth()));
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const chatInputRef = useRef<ChatInputHandle | null>(null);
  const queueForkComposerFocus = useForkComposerFocus(chatInputRef, selectedSession?.id ?? null);
  const topBarRef = useRef<HTMLDivElement>(null);

  // Branch navigator state — populated by ChatWindow via onBranchDataChange
  const [branchTree, setBranchTree] = useState<SessionTreeNode[]>([]);
  const [branchActiveLeafId, setBranchActiveLeafId] = useState<string | null>(null);
  const branchLeafChangeFnRef = useRef<((leafId: string | null) => void) | null>(null);

  const handleBranchDataChange = useCallback((tree: SessionTreeNode[], activeLeafId: string | null, onLeafChange: (leafId: string | null) => void) => {
    setBranchTree(tree);
    setBranchActiveLeafId(activeLeafId);
    branchLeafChangeFnRef.current = onLeafChange;
  }, []);

  const handleBranchLeafChange = useCallback((leafId: string | null) => {
    branchLeafChangeFnRef.current?.(leafId);
  }, []);

  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);

  const handleSystemPromptChange = useCallback((prompt: string | null) => {
    setSystemPrompt(prompt);
  }, []);

  // Session stats (tokens + cost) — populated by ChatWindow, displayed in top bar
  const [sessionStats, setSessionStats] = useState<SessionStatsInfo | null>(null);
  const handleSessionStatsChange = useCallback((stats: SessionStatsInfo | null) => {
    setSessionStats(stats);
  }, []);
  const [copiedSessionField, setCopiedSessionField] = useState<SessionCopyField | null>(null);
  const sessionCopyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleCopySessionField = useCallback((field: SessionCopyField, value: string) => {
    void copyText(value).then(() => {
      if (sessionCopyTimerRef.current) clearTimeout(sessionCopyTimerRef.current);
      setCopiedSessionField(field);
      sessionCopyTimerRef.current = setTimeout(() => setCopiedSessionField(null), 1400);
    });
  }, []);

  useEffect(() => {
    return () => {
      if (sessionCopyTimerRef.current) clearTimeout(sessionCopyTimerRef.current);
    };
  }, []);

  // Context usage — populated by ChatWindow, displayed in top bar
  const [contextUsage, setContextUsage] = useState<{ percent: number | null; contextWindow: number; tokens: number | null } | null>(null);
  const handleContextUsageChange = useCallback((usage: { percent: number | null; contextWindow: number; tokens: number | null } | null) => {
    setContextUsage(usage);
  }, []);

  // Single active panel — only one dropdown open at a time
  const [activeTopPanel, setActiveTopPanel] = useState<"branches" | "system" | "session" | null>(null);
  const [topPanelPos, setTopPanelPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const toggleTopPanel = useCallback((panel: "branches" | "system" | "session") => {
    if (usesOverlayLayout) dismissWorkspaceLayer();
    setActiveTopPanel((current) => current === panel ? null : panel);
  }, [dismissWorkspaceLayer, usesOverlayLayout]);

  const openSessionStatsPanel = useCallback(() => {
    if (usesOverlayLayout) dismissWorkspaceLayer();
    setActiveTopPanel("session");
  }, [dismissWorkspaceLayer, usesOverlayLayout]);

  const handleSidebarToggle = useCallback(() => {
    setActiveTopPanel(null);
    if (usesOverlayLayout) {
      if (sidebarOpen) closeWorkspaceLayer();
      else openWorkspaceLayer("sessions");
      return;
    }
    setSidebarOpen((open) => !open);
  }, [closeWorkspaceLayer, openWorkspaceLayer, sidebarOpen, usesOverlayLayout]);

  const handleSidebarClose = useCallback(() => {
    setActiveTopPanel(null);
    if (usesOverlayLayout) closeWorkspaceLayer();
    else setSidebarOpen(false);
  }, [closeWorkspaceLayer, usesOverlayLayout]);

  const startSidebarResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (usesOverlayLayout || !sidebarOpen) return;
    event.preventDefault();
    setActiveTopPanel(null);
    setResizingPanel("sidebar");

    const startX = event.clientX;
    const startWidth = sidebarWidth;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const stopResize = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      setResizingPanel(null);
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
    };
    const handleMove = (moveEvent: PointerEvent) => {
      moveEvent.preventDefault();
      setSidebarWidth(clampWidth(startWidth + moveEvent.clientX - startX, SIDEBAR_MIN_WIDTH, getSidebarMaxWidth()));
    };

    window.addEventListener("pointermove", handleMove, { passive: false });
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
  }, [sidebarOpen, sidebarWidth, usesOverlayLayout]);

  const startRightPanelResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (usesOverlayLayout) return;
    event.preventDefault();
    setActiveTopPanel(null);
    setResizingPanel("right");

    const startX = event.clientX;
    const startWidth = rightPanelWidth;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const stopResize = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      setResizingPanel(null);
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
    };
    const handleMove = (moveEvent: PointerEvent) => {
      moveEvent.preventDefault();
      setRightPanelWidth(clampWidth(startWidth - (moveEvent.clientX - startX), RIGHT_PANEL_MIN_WIDTH, getRightPanelMaxWidth()));
    };

    window.addEventListener("pointermove", handleMove, { passive: false });
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
  }, [rightPanelWidth, usesOverlayLayout]);

  useEffect(() => {
    const topBar = topBarRef.current;
    if (!activeTopPanel || !topBar) return;
    const update = () => {
      const rect = topBar.getBoundingClientRect();
      setTopPanelPos({ top: rect.bottom, left: rect.left, width: rect.width });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(topBar);
    return () => observer.disconnect();
  }, [activeTopPanel]);

  // Right panel — changes review plus file tabs
  const [fileTabs, setFileTabs] = useState<Tab[]>([]);
  const [activeFileTabId, setActiveFileTabId] = useState<string | null>(null);
  const [rightPanelView, setRightPanelView] = useState<"changes" | "terminal" | "file">("changes");
  const [gitChangesCount, setGitChangesCount] = useState<number | null>(null);

  // Same @mention format as the chat input's @ autocomplete, so the agent's
  // read tool resolves it the same way (it strips the @ prefix).
  const handleAtMention = useCallback((relativePath: string, isDir: boolean) => {
    chatInputRef.current?.insertText(buildAtMentionText(relativePath, isDir));
  }, []);

  const [initialSessionId] = useState<string | null>(() => searchParams.get("session"));
  const [activeCwd, setActiveCwd] = useState<string | null>(null);
  // True once the initial ?session= URL param has been resolved (or confirmed absent)
  const [initialSessionRestored, setInitialSessionRestored] = useState<boolean>(() => !searchParams.get("session"));
  // Suppresses sessionKey bump in handleCwdChange during the initial URL restore
  const suppressCwdBumpRef = useRef(false);

  const handleCwdChange = useCallback((cwd: string | null, projectRoot?: string | null) => {
    setActiveCwd(cwd);
    // Skip if cwd is null (initial mount) or during the initial URL restore.
    if (!cwd) return;
    if (suppressCwdBumpRef.current) {
      suppressCwdBumpRef.current = false;
      return;
    }
    // Worktrees of one repo share a project root. Moving the effective cwd
    // within the same project (e.g. switching worktree, or clicking a session
    // that lives in another worktree) must not close the open session.
    const newProject = projectRoot ?? cwd;
    if (selectedSession && (selectedSession.projectRoot ?? selectedSession.cwd) === newProject) {
      return;
    }
    // Close any session that belongs to a different project — it no longer
    // matches the selected project directory.
    setSelectedSession(null);
    setNewSessionCwd((prev) => {
      if (prev && prev !== cwd) return null;
      return prev;
    });
    setSessionKey((k) => k + 1);
    setBranchTree([]);
    setBranchActiveLeafId(null);
    setSystemPrompt(null);
    setActiveTopPanel(null);
    router.replace("/", { scroll: false });
  }, [router, selectedSession]);

  const handleSelectSession = useCallback((session: SessionInfo, isRestore = false) => {
    setNewSessionCwd(null);
    setSelectedSession(session);
    setSessionKey((k) => k + 1);
    setSystemPrompt(null);
    setInitialSessionRestored(true);
    // Overlay navigation is browser-history-aware; selecting content dismisses
    // the layer in place so the new session URL becomes the current entry.
    if (usesOverlayLayout && !isRestore) dismissWorkspaceLayer();
    if (isRestore) {
      // Suppress the redundant sessionKey bump that would come from the
      // onCwdChange effect firing after setSelectedCwd in the sidebar
      suppressCwdBumpRef.current = true;
    }
    // Skip router.replace when restoring from URL — the param is already correct
    // and calling replace in production Next.js triggers a Suspense remount loop
    if (!isRestore) {
      router.replace(`?session=${encodeURIComponent(session.id)}`, { scroll: false });
    }
  }, [dismissWorkspaceLayer, router, usesOverlayLayout]);

  const handleNewSession = useCallback((_sessionId: string, cwd: string) => {
    setSelectedSession(null);
    setNewSessionCwd(cwd);
    setSessionKey((k) => k + 1);
    setBranchTree([]);
    setBranchActiveLeafId(null);
    setSystemPrompt(null);
    setActiveTopPanel(null);
    if (usesOverlayLayout) dismissWorkspaceLayer();
    router.replace("/", { scroll: false });
  }, [dismissWorkspaceLayer, router, usesOverlayLayout]);

  // Client-built transient SessionInfo (new session / fork) lacks the
  // server-computed projectRoot, which the same-project check in
  // handleCwdChange relies on. Hydrate it from the session list so switching
  // worktrees right after creating a session doesn't close the chat.
  const hydrateSelectedSession = useCallback((sessionId: string) => {
    void fetch("/api/sessions")
      .then((r) => (r.ok ? (r.json() as Promise<{ sessions: SessionInfo[] }>) : null))
      .then((d) => {
        const full = d?.sessions.find((s) => s.id === sessionId);
        if (!full) return;
        setSelectedSession((prev) => (prev && prev.id === sessionId && !prev.projectRoot ? full : prev));
      })
      .catch(() => {});
  }, []);

  // Called by ChatWindow when a new session gets its real id from pi
  const handleSessionCreated = useCallback((session: SessionInfo) => {
    setNewSessionCwd(null);
    setSelectedSession(session);
    setRefreshKey((k) => k + 1);
    hydrateSelectedSession(session.id);
    router.replace(`?session=${encodeURIComponent(session.id)}`, { scroll: false });
  }, [router, hydrateSelectedSession]);

  const handleAgentEnd = useCallback(() => {
    setRefreshKey((k) => k + 1);
    setExplorerRefreshKey((k) => k + 1);
  }, []);

  const handleSessionForked = useCallback((newSessionId: string, selectedText?: string) => {
    queueForkComposerFocus(newSessionId, selectedText);
    setRefreshKey((k) => k + 1);
    setSessionKey((k) => k + 1);
    setNewSessionCwd(null);
    setSelectedSession((prev) => ({
      ...(prev ?? { path: "", cwd: "", created: "", modified: "", messageCount: 0, firstMessage: "" }),
      id: newSessionId,
    }));
    hydrateSelectedSession(newSessionId);
    router.replace(`?session=${encodeURIComponent(newSessionId)}`, { scroll: false });
  }, [router, hydrateSelectedSession, queueForkComposerFocus]);

  const handleInitialRestoreDone = useCallback(() => {
    setInitialSessionRestored(true);
  }, []);

  const handleSessionDeleted = useCallback((sessionId: string) => {
    setRefreshKey((k) => k + 1);
    if (selectedSession?.id === sessionId) {
      const cwd = selectedSession.cwd;
      setSelectedSession(null);
      setNewSessionCwd(cwd ?? null);
      setSessionKey((k) => k + 1);
      setBranchTree([]);
      setBranchActiveLeafId(null);
      setSystemPrompt(null);
      setActiveTopPanel(null);
      router.replace("/", { scroll: false });
    }
  }, [selectedSession, router]);

  const revealInspector = useCallback(() => {
    setActiveTopPanel(null);
    if (usesOverlayLayout) openWorkspaceLayer("inspector");
    else setRightPanelOpen(true);
  }, [openWorkspaceLayer, usesOverlayLayout]);

  const hideInspector = useCallback(() => {
    if (usesOverlayLayout) closeWorkspaceLayer();
    else setRightPanelOpen(false);
  }, [closeWorkspaceLayer, usesOverlayLayout]);

  const toggleInspector = useCallback(() => {
    setActiveTopPanel(null);
    if (rightPanelOpen) hideInspector();
    else {
      if (!activeFileTabId) setRightPanelView("changes");
      revealInspector();
    }
  }, [activeFileTabId, hideInspector, revealInspector, rightPanelOpen]);

  const handleOpenFile = useCallback((filePath: string, fileName: string, sourceSessionId?: string | null) => {
    const tabId = `file:${filePath}`;
    setFileTabs((prev) => {
      const existing = prev.find((t) => t.id === tabId);
      if (!existing) return [...prev, { id: tabId, label: fileName, filePath, sourceSessionId }];
      if (!sourceSessionId || existing.sourceSessionId === sourceSessionId) return prev;
      return prev.map((t) => t.id === tabId ? { ...t, sourceSessionId } : t);
    });
    setActiveFileTabId(tabId);
    setRightPanelView("file");
    revealInspector();
  }, [revealInspector]);

  const handleSelectFileTab = useCallback((tabId: string) => {
    setActiveFileTabId(tabId);
    setRightPanelView("file");
    revealInspector();
  }, [revealInspector]);

  const handleSelectInspectorFile = useCallback((tabId: string) => {
    setActiveFileTabId(tabId);
    setRightPanelView("file");
  }, []);

  const handleOpenLinkedFile = useCallback((filePath: string) => {
    handleOpenFile(filePath, getFileName(filePath), selectedSession?.id ?? null);
  }, [handleOpenFile, selectedSession?.id]);

  const handleCloseFileTab = useCallback((tabId: string) => {
    setFileTabs((prev) => {
      const next = prev.filter((t) => t.id !== tabId);
      if (next.length === 0) setRightPanelView("changes");
      return next;
    });
    setActiveFileTabId((cur) => {
      if (cur !== tabId) return cur;
      const remaining = fileTabs.filter((t) => t.id !== tabId);
      return remaining.length > 0 ? remaining[remaining.length - 1].id : null;
    });
  }, [fileTabs]);

  const handleOpenChanges = useCallback(() => {
    setRightPanelView("changes");
    revealInspector();
  }, [revealInspector]);

  const handleOpenTerminal = useCallback(() => {
    setRightPanelView("terminal");
    revealInspector();
  }, [revealInspector]);

  const handleOpenPreview = useCallback(() => {
    const tabId = activeFileTabId ?? fileTabs[0]?.id ?? null;
    if (tabId) handleSelectFileTab(tabId);
    else {
      setRightPanelView("file");
      revealInspector();
    }
  }, [activeFileTabId, fileTabs, handleSelectFileTab, revealInspector]);

  const handleExportSession = useCallback(() => {
    if (!selectedSession) return;
    window.location.href = `/api/sessions/${encodeURIComponent(selectedSession.id)}/export`;
  }, [selectedSession]);

  const handleSlashUiAction = useCallback((action: SlashUiAction) => {
    switch (action.type) {
      case "openSessionStats":
        openSessionStatsPanel();
        break;
      case "openBranchNavigator":
        if (usesOverlayLayout) dismissWorkspaceLayer();
        setActiveTopPanel("branches");
        break;
      case "openForkSelector":
        break;
      case "openModelsConfig":
        setModelsConfigOpen(true);
        break;
      case "openSettings":
        setSettingsOpen(true);
        break;
      case "openProjectTrust":
        setProjectTrustOpen(true);
        break;
      case "openHotkeys":
        setHotkeysOpen(true);
        break;
      case "newSession": {
        const cwd = selectedSession?.cwd ?? newSessionCwd ?? activeCwd;
        if (cwd) handleNewSession("", cwd);
        break;
      }
      case "openSessionSidebar":
        setActiveTopPanel(null);
        if (usesOverlayLayout) openWorkspaceLayer("sessions");
        else setSidebarOpen(true);
        break;
    }
  }, [activeCwd, dismissWorkspaceLayer, handleNewSession, newSessionCwd, openSessionStatsPanel, openWorkspaceLayer, selectedSession?.cwd, usesOverlayLayout]);

  // Show chat area if a session is selected, or if we have a cwd to start a new session in
  const effectiveNewSessionCwd = newSessionCwd ?? (selectedSession === null && activeCwd ? activeCwd : null);
  const showChat = selectedSession !== null || effectiveNewSessionCwd !== null;
  // While restoring initial session from URL, don't show the placeholder
  const showPlaceholder = initialSessionRestored && !showChat;

  const activeFileTab = fileTabs.find((t) => t.id === activeFileTabId) ?? null;
  const gitChangesCwd = activeCwd ?? selectedSession?.cwd ?? newSessionCwd ?? null;
  const terminalScopeId = selectedSession?.id
    ? `session:${selectedSession.id}`
    : gitChangesCwd
      ? `cwd:${gitChangesCwd}`
      : null;

  // biome-ignore lint/correctness/useExhaustiveDependencies: explorerRefreshKey intentionally refreshes the Git summary.
  useEffect(() => {
    let cancelled = false;
    if (!gitChangesCwd) {
      setGitChangesCount(null);
      return;
    }
    fetch(`/api/git/changes?cwd=${encodeURIComponent(gitChangesCwd)}`, { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json() as { isGit?: boolean; totals?: { files: number }; error?: string };
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        return data;
      })
      .then((data) => {
        if (!cancelled) setGitChangesCount(data.isGit ? data.totals?.files ?? 0 : null);
      })
      .catch(() => {
        if (!cancelled) setGitChangesCount(null);
      });
    return () => { cancelled = true; };
  }, [gitChangesCwd, explorerRefreshKey]);

  const hasWorkspace = Boolean(gitChangesCwd);
  const compactNumber = (value: number) => value >= 1_000_000
    ? `${(value / 1_000_000).toFixed(1)}M`
    : value >= 1_000
      ? `${(value / 1_000).toFixed(0)}k`
      : String(value);
  const statsTokens = sessionStats?.tokens;
  const statsCost = sessionStats?.cost ?? 0;
  const statsCostLabel = statsCost > 0 ? (statsCost >= 0.01 ? `$${statsCost.toFixed(2)}` : "<$0.01") : null;
  const contextPercent = contextUsage?.percent ?? null;
  const contextLabel = contextUsage?.contextWindow
    ? `${contextPercent !== null ? contextPercent.toFixed(0) : "?"}% / ${compactNumber(contextUsage.contextWindow)}`
    : null;
  const contextLevel = contextPercent !== null && contextPercent > 90
    ? "danger"
    : contextPercent !== null && contextPercent > 70
      ? "warning"
      : "normal";
  const statsTooltip = [
    ...(statsTokens ? [
      `in: ${statsTokens.input.toLocaleString()}`,
      `out: ${statsTokens.output.toLocaleString()}`,
      `cache read: ${statsTokens.cacheRead.toLocaleString()}`,
      `cache write: ${statsTokens.cacheWrite.toLocaleString()}`,
    ] : []),
    ...(statsCost > 0 ? [`cost: $${statsCost.toFixed(4)}`] : []),
    ...(contextUsage?.contextWindow ? [`context: ${contextPercent !== null ? `${contextPercent.toFixed(1)}%` : "unknown"} of ${contextUsage.contextWindow.toLocaleString()} tokens`] : []),
  ].join("  |  ");
  const currentSessionTitle = selectedSession
    ? selectedSession.name || selectedSession.firstMessage?.slice(0, 64) || `Session ${selectedSession.id.slice(0, 8)}`
    : effectiveNewSessionCwd
      ? "New session"
      : activeCwd
        ? "Project selected"
        : appSettings.displayName;
  const currentSessionMeta = selectedSession
    ? `${selectedSession.messageCount} messages · ${selectedSession.id.slice(0, 8)}`
    : effectiveNewSessionCwd
      ? "Ready for the first message"
      : activeCwd
        ? "Choose a session"
        : "Choose a project";

  const runMoreAction = (action: () => void) => {
    dismissWorkspaceLayer();
    action();
  };
  const mobileMoreActions: MobileMoreActions = {
    newSession: () => {
      const cwd = selectedSession?.cwd ?? newSessionCwd ?? activeCwd;
      if (cwd) runMoreAction(() => handleNewSession("", cwd));
    },
    exportSession: () => runMoreAction(handleExportSession),
    branches: () => runMoreAction(() => setActiveTopPanel("branches")),
    systemPrompt: () => runMoreAction(() => setActiveTopPanel("system")),
    models: () => runMoreAction(() => setModelsConfigOpen(true)),
    skills: () => runMoreAction(() => setSkillsConfigOpen(true)),
    plugins: () => runMoreAction(() => setPluginsConfigOpen(true)),
    settings: () => runMoreAction(() => setSettingsOpen(true)),
    projectTrust: () => runMoreAction(() => setProjectTrustOpen(true)),
    hotkeys: () => runMoreAction(() => setHotkeysOpen(true)),
    theme: () => runMoreAction(() => toggleTheme()),
  };

  const sidebarContent = (
    <div className={styles.sidebarInner}>
      <SessionSidebar
        appName={appSettings.displayName}
        selectedSessionId={selectedSession?.id ?? null}
        onSelectSession={handleSelectSession}
        onNewSession={handleNewSession}
        initialSessionId={initialSessionId}
        onInitialRestoreDone={handleInitialRestoreDone}
        refreshKey={refreshKey}
        onSessionDeleted={handleSessionDeleted}
        selectedCwd={selectedSession?.cwd ?? newSessionCwd ?? null}
        onCwdChange={handleCwdChange}
        onOpenFile={handleOpenFile}
        explorerRefreshKey={explorerRefreshKey}
        onAtMention={handleAtMention}
        onRequestClose={usesOverlayLayout ? handleSidebarClose : undefined}
      />
      <nav className={styles.sidebarActions} aria-label="Configuration">
        <button type="button" className={styles.sidebarAction} onClick={() => setModelsConfigOpen(true)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" /></svg>
          <span>Models</span>
        </button>
        <button type="button" className={styles.sidebarAction} onClick={() => setSkillsConfigOpen(true)} disabled={!hasWorkspace}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 2 2 7l10 5 10-5-10-5Z" /><path d="m2 17 10 5 10-5" /><path d="m2 12 10 5 10-5" /></svg>
          <span>Skills</span>
        </button>
        <button type="button" className={styles.sidebarAction} onClick={() => setPluginsConfigOpen(true)} disabled={!hasWorkspace}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 7V2" /><path d="M15 7V2" /><path d="M6 13V8a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v5a6 6 0 0 1-12 0Z" /><path d="M12 19v3" /></svg>
          <span>Plugins</span>
        </button>
        <button type="button" className={styles.sidebarAction} onClick={() => setSettingsOpen(true)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.1A1.7 1.7 0 0 0 8.6 19a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.1A1.7 1.7 0 0 0 5 8.6a1.7 1.7 0 0 0-.34-1.88L4.6 6.66l2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.1A1.7 1.7 0 0 0 15.4 5a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.12.37.34.7.6 1 .3.3.7.44 1.1.4h.1v4h-.1a1.7 1.7 0 0 0-1.7.6Z" /></svg>
          <span>Settings</span>
        </button>
      </nav>
    </div>
  );

  return (
    <>
      <div className={styles.shell}>
        <div className={styles.safeAreaFill} aria-hidden="true" />
        <button
          type="button"
          className={styles.layerBackdrop}
          data-open={usesOverlayLayout && (sidebarOpen || rightPanelOpen) || undefined}
          aria-label="Close workspace layer"
          tabIndex={usesOverlayLayout && (sidebarOpen || rightPanelOpen) ? 0 : -1}
          onClick={closeWorkspaceLayer}
        />

        <aside
          ref={sidebarPanelRef}
          className={styles.sidebar}
          data-open={sidebarOpen}
          data-pending={!mobileSidebarReady || undefined}
          data-resizing={resizingPanel === "sidebar" || undefined}
          style={{ "--shell-sidebar-width": `${sidebarWidth}px` } as CSSProperties}
          aria-label="Sessions and files"
          aria-hidden={!sidebarOpen}
          inert={!sidebarOpen}
        >
          {sidebarContent}
          {sidebarOpen && !usesOverlayLayout && (
            <hr
              className={`${styles.resizeHandle} ${styles.sidebarResizeHandle}`}
              data-active={resizingPanel === "sidebar" || undefined}
              onPointerDown={startSidebarResize}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                  event.preventDefault();
                  const delta = event.key === "ArrowRight" ? 16 : -16;
                  setSidebarWidth((width) => clampWidth(width + delta, SIDEBAR_MIN_WIDTH, getSidebarMaxWidth()));
                }
              }}
              tabIndex={0}
              aria-orientation="vertical"
              aria-valuemin={SIDEBAR_MIN_WIDTH}
              aria-valuemax={getSidebarMaxWidth()}
              aria-valuenow={sidebarWidth}
              aria-label="Resize sidebar"
              title="Resize sidebar"
            />
          )}
        </aside>

        <main
          className={styles.center}
          aria-hidden={usesOverlayLayout && (sidebarOpen || rightPanelOpen) || undefined}
          inert={usesOverlayLayout && (sidebarOpen || rightPanelOpen)}
        >
          <header ref={topBarRef} className={styles.topBar}>
            <div className={styles.desktopChrome}>
              <IconButton label={sidebarOpen ? "Hide sidebar" : "Show sidebar"} selected={sidebarOpen} className={styles.topIcon} onClick={handleSidebarToggle}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="9" y1="3" x2="9" y2="21" /></svg>
              </IconButton>
              <IconButton
                label={isDark ? "Switch to light mode" : "Switch to dark mode"}
                className={styles.topIcon}
                aria-pressed={isDark}
                onClick={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  toggleTheme({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
                }}
              >
                {isDark ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="5" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" /></svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" /></svg>
                )}
              </IconButton>
              {showChat && (
                <>
                  <button type="button" className={styles.topTool} onClick={handleExportSession} disabled={!selectedSession} title={selectedSession ? "Export HTML" : "Export is available after the session is saved"}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                    Export
                  </button>
                  <BranchNavigator
                    tree={branchTree}
                    activeLeafId={branchActiveLeafId}
                    onLeafChange={handleBranchLeafChange}
                    inline
                    containerRef={topBarRef}
                    open={activeTopPanel === "branches"}
                    onToggle={() => toggleTopPanel("branches")}
                    hasSession
                  />
                  <button type="button" className={styles.topTool} onClick={() => toggleTopPanel("system")} aria-pressed={activeTopPanel === "system"} title="System prompt">
                    <svg className={styles.systemIcon} data-loaded={systemPrompt !== null || undefined} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="13" y2="17" /></svg>
                    System
                  </button>
                </>
              )}
              {showChat && (sessionStats || contextUsage) && (
                <button type="button" className={styles.statsButton} onClick={() => toggleTopPanel("session")} title={statsTooltip || "Session info"} aria-label="Session info" aria-pressed={activeTopPanel === "session"}>
                  {statsTokens && statsTokens.input > 0 && <span className={styles.statsMetric}>↑ {compactNumber(statsTokens.input)}</span>}
                  {statsTokens && statsTokens.output > 0 && <span className={styles.statsMetric}>↓ {compactNumber(statsTokens.output)}</span>}
                  {statsTokens && statsTokens.cacheRead > 0 && <span className={styles.statsMetric}>↻ {compactNumber(statsTokens.cacheRead)}</span>}
                  {statsCostLabel && <span className={styles.statsCost}>{statsCostLabel}</span>}
                  {contextLabel && <span className={`${styles.statsMetric} ${styles.statsContext}`} data-level={contextLevel}>◴ {contextLabel}</span>}
                </button>
              )}
              <IconButton label={rightPanelOpen ? "Hide inspector" : "Show inspector"} selected={rightPanelOpen} className={`${styles.topIcon} ${styles.inspectorToggle}`} onClick={toggleInspector}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="15" y1="3" x2="15" y2="21" /></svg>
              </IconButton>
            </div>

            <div className={styles.compactChrome}>
              <button type="button" className={styles.compactNavButton} aria-pressed={sidebarOpen} onClick={handleSidebarToggle}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="9" y1="3" x2="9" y2="21" /></svg>
                <span>Sessions</span>
              </button>
              <button type="button" className={styles.currentSession} onClick={showChat ? openSessionStatsPanel : handleSidebarToggle}>
                <span className={styles.currentSessionTitle}>{currentSessionTitle}</span>
                <span className={styles.currentSessionMeta}>{currentSessionMeta}</span>
              </button>
              <button type="button" className={styles.compactNavButton} aria-pressed={rightPanelOpen} onClick={toggleInspector}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="15" y1="3" x2="15" y2="21" /></svg>
                <span>Inspector</span>
              </button>
              <button type="button" className={styles.compactNavButton} aria-pressed={mobileMoreOpen} onClick={() => { setActiveTopPanel(null); openWorkspaceLayer("more"); }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></svg>
                <span>More</span>
              </button>
              <div className={styles.branchHost} aria-hidden="true">
                <BranchNavigator
                  tree={branchTree}
                  activeLeafId={branchActiveLeafId}
                  onLeafChange={handleBranchLeafChange}
                  inline
                  compact
                  containerRef={topBarRef}
                  open={activeTopPanel === "branches"}
                  onToggle={() => toggleTopPanel("branches")}
                  hasSession
                />
              </div>
            </div>
          </header>

          {activeTopPanel && activeTopPanel !== "branches" && topPanelPos && (
            <div
              className={styles.topPanelHost}
              style={{
                "--panel-top": `${topPanelPos.top}px`,
                top: topPanelPos.top,
                ...(usesOverlayLayout ? {} : { left: topPanelPos.left, width: topPanelPos.width }),
              } as CSSProperties}
            >
              {activeTopPanel === "system" && (
                <section className={styles.topPanel} aria-label="System prompt">
                  {systemPrompt ? (
                    <div className={styles.systemPrompt}>{systemPrompt}</div>
                  ) : systemPrompt === "" ? (
                    <div className={styles.panelEmpty}>System prompt is empty because tools are disabled.</div>
                  ) : (
                    <div className={styles.panelEmpty}>Send a message to load the system prompt.</div>
                  )}
                </section>
              )}
              {activeTopPanel === "session" && (
                <section className={styles.topPanel} aria-label="Session info">
                  <SessionInfoPanel sessionStats={sessionStats} contextUsage={contextUsage} copiedField={copiedSessionField} onCopy={handleCopySessionField} />
                </section>
              )}
            </div>
          )}

          <div className={styles.chatContent}>
            {showChat ? (
              <ChatWindow
                key={sessionKey}
                appName={appSettings.displayName}
                session={selectedSession}
                newSessionCwd={effectiveNewSessionCwd}
                onAgentEnd={handleAgentEnd}
                onSessionCreated={handleSessionCreated}
                onSessionForked={handleSessionForked}
                modelsRefreshKey={modelsRefreshKey}
                chatInputRef={chatInputRef}
                onBranchDataChange={handleBranchDataChange}
                onSystemPromptChange={handleSystemPromptChange}
                onSessionStatsChange={handleSessionStatsChange}
                onSessionStatsPanelOpen={openSessionStatsPanel}
                onSlashUiAction={handleSlashUiAction}
                onContextUsageChange={handleContextUsageChange}
                onOpenFile={handleOpenLinkedFile}
                onRetry={() => setSessionKey((key) => key + 1)}
              />
            ) : showPlaceholder ? (
              <div className={styles.placeholder}>
                <section className={styles.placeholderCard}>
                  <span className={styles.placeholderEyebrow}>{activeCwd ? "Workspace ready" : "Start here"}</span>
                  <h1 className={styles.placeholderTitle}>{activeCwd ? "Choose a session" : "Open a project"}</h1>
                  <p className={styles.placeholderCopy}>
                    {activeCwd
                      ? "Continue an existing session or start a clean one in the selected project."
                      : "Sessions, project files, and worktrees are available from the workspace navigator."}
                  </p>
                  {!activeCwd && (
                    <ol className={styles.placeholderSteps}><li>Open Sessions and choose a project directory.</li><li>Configure a model, then start the first message.</li></ol>
                  )}
                  <div className={styles.placeholderActions}>
                    <Button variant="primary" size={usesOverlayLayout ? "touch" : "default"} onClick={() => usesOverlayLayout ? openWorkspaceLayer("sessions") : setSidebarOpen(true)}>Open Sessions</Button>
                    {activeCwd && <Button size={usesOverlayLayout ? "touch" : "default"} onClick={() => handleNewSession("", activeCwd)}>New session</Button>}
                  </div>
                </section>
              </div>
            ) : null}
          </div>
        </main>

        <aside
          ref={inspectorPanelRef}
          className={styles.inspector}
          data-open={rightPanelOpen}
          data-resizing={resizingPanel === "right" || undefined}
          style={{ "--shell-inspector-width": `${rightPanelWidth}px` } as CSSProperties}
          aria-label="Inspector"
          aria-hidden={!rightPanelOpen}
          inert={!rightPanelOpen}
        >
          <div className={styles.inspectorInner}>
            {rightPanelOpen && !usesOverlayLayout && (
              <hr
                className={`${styles.resizeHandle} ${styles.inspectorResizeHandle}`}
                data-active={resizingPanel === "right" || undefined}
                onPointerDown={startRightPanelResize}
                onKeyDown={(event) => {
                  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                    event.preventDefault();
                    const delta = event.key === "ArrowLeft" ? 16 : -16;
                    setRightPanelWidth((width) => clampWidth(width + delta, RIGHT_PANEL_MIN_WIDTH, getRightPanelMaxWidth()));
                  }
                }}
                tabIndex={0}
                aria-orientation="vertical"
                aria-valuemin={RIGHT_PANEL_MIN_WIDTH}
                aria-valuemax={getRightPanelMaxWidth()}
                aria-valuenow={rightPanelWidth}
                aria-label="Resize inspector"
                title="Resize inspector"
              />
            )}
            <header className={styles.inspectorHeader}>
              <div className={styles.inspectorIdentity}>
                <IconButton label="Back to conversation" size="touch" className={styles.inspectorBack} onClick={hideInspector}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg>
                </IconButton>
                <h2>Inspector</h2>
              </div>
              <div className={styles.inspectorTabs}>
                <button type="button" className={styles.inspectorTab} aria-pressed={rightPanelView === "changes"} onClick={handleOpenChanges}>Changes{gitChangesCount !== null && gitChangesCount > 0 && <span className={styles.inspectorCount}>{gitChangesCount}</span>}</button>
                <button type="button" className={styles.inspectorTab} aria-pressed={rightPanelView === "terminal"} onClick={handleOpenTerminal}>Terminal</button>
                <div className={styles.desktopFileTabs}>
                  <TabBar
                    tabs={fileTabs}
                    activeTabId={rightPanelView === "file" ? activeFileTabId ?? "" : ""}
                    onSelectTab={handleSelectFileTab}
                    onCloseTab={handleCloseFileTab}
                  />
                </div>
              </div>
              <nav className={styles.mobileInspectorTabs} aria-label="Inspector views">
                <button type="button" className={styles.inspectorTab} aria-pressed={rightPanelView === "changes"} onClick={handleOpenChanges}>Changes{gitChangesCount !== null && gitChangesCount > 0 && <span className={styles.inspectorCount}>{gitChangesCount}</span>}</button>
                <button type="button" className={styles.inspectorTab} aria-pressed={rightPanelView === "file"} onClick={handleOpenPreview}>Preview{fileTabs.length > 0 && <span className={styles.inspectorCount}>{fileTabs.length}</span>}</button>
                <button type="button" className={styles.inspectorTab} aria-pressed={rightPanelView === "terminal"} onClick={handleOpenTerminal}>Terminal</button>
              </nav>
            </header>
            <div className={styles.inspectorBody}>
              {rightPanelView === "changes" ? (
                <GitChangesPanel cwd={gitChangesCwd} refreshKey={explorerRefreshKey} onCountChange={setGitChangesCount} />
              ) : rightPanelView === "terminal" ? (
                <TerminalPanel cwd={gitChangesCwd} scopeId={terminalScopeId} />
              ) : activeFileTab?.filePath ? (
                <div className={styles.inspectorFileView}>
                  <button type="button" className={styles.inspectorFileSwitcher} onClick={openInspectorFileSheet} aria-haspopup="dialog" aria-expanded={inspectorFileSheetOpen}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><polyline points="14 2 14 8 20 8" /></svg>
                    <span><strong>{activeFileTab.label}</strong><small>{activeFileTab.filePath}</small></span>
                    <span className={styles.inspectorFileCount}>{fileTabs.length} open</span>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9" /></svg>
                  </button>
                  <div className={styles.inspectorFileBody}>
                    <FileViewer filePath={activeFileTab.filePath} cwd={activeCwd ?? undefined} sourceSessionId={activeFileTab.sourceSessionId} />
                  </div>
                </div>
              ) : (
                <div className={styles.noFile}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><polyline points="14 2 14 8 20 8" /></svg>
                  <h3>No file preview</h3>
                  <p>Open a file from Explorer or a message link to inspect it here.</p>
                  {usesOverlayLayout && fileTabs.length > 0 && <Button onClick={openInspectorFileSheet}>Choose open file</Button>}
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>

      <MobileMoreSheet
        open={mobileMoreOpen}
        onOpenChange={(open) => { if (!open) closeWorkspaceLayer(); }}
        actions={mobileMoreActions}
        hasWorkspace={hasWorkspace}
        hasSession={Boolean(selectedSession)}
        isDark={isDark}
      />

      <InspectorFileSheet
        open={usesOverlayLayout && inspectorFileSheetOpen}
        tabs={fileTabs}
        activeTabId={activeFileTabId}
        onOpenChange={(open) => { if (open) openInspectorFileSheet(); else closeInspectorFileSheet(); }}
        onSelect={handleSelectInspectorFile}
        onClose={handleCloseFileTab}
      />

      {modelsConfigOpen && <ModelsConfig onClose={() => { setModelsConfigOpen(false); setModelsRefreshKey((key) => key + 1); }} />}
      {settingsOpen && (
        <SettingsModal
          settings={appSettings}
          cwd={gitChangesCwd}
          onClose={() => setSettingsOpen(false)}
          onSaved={(next) => setAppSettings(next)}
          onOpenModels={() => { setSettingsOpen(false); setModelsConfigOpen(true); }}
          onOpenScopedModels={() => { setSettingsOpen(false); setModelsConfigOpen(true); }}
          onOpenAuth={() => { setSettingsOpen(false); setModelsConfigOpen(true); }}
          onOpenProjectTrust={() => { setSettingsOpen(false); setProjectTrustOpen(true); }}
        />
      )}
      {projectTrustOpen && gitChangesCwd && (
        <ProjectTrustModal
          cwd={gitChangesCwd}
          onClose={() => setProjectTrustOpen(false)}
          onChanged={() => { setRefreshKey((key) => key + 1); setModelsRefreshKey((key) => key + 1); }}
        />
      )}
      {hotkeysOpen && <HotkeysModal onClose={() => setHotkeysOpen(false)} />}
      {skillsConfigOpen && gitChangesCwd && <SkillsConfig cwd={gitChangesCwd} onClose={() => setSkillsConfigOpen(false)} />}
      {pluginsConfigOpen && gitChangesCwd && (
        <PluginsConfig
          cwd={gitChangesCwd}
          sessionId={selectedSession?.id ?? null}
          onClose={() => setPluginsConfigOpen(false)}
          onReloaded={() => setSessionKey((key) => key + 1)}
        />
      )}
    </>
  );
}
