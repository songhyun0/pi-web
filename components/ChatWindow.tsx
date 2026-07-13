"use client";

import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { type AgentPhase, type NoticeItem, useAgentSession } from "@/hooks/useAgentSession";
import { useAudio } from "@/hooks/useAudio";
import { useDragDrop } from "@/hooks/useDragDrop";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useProfiles } from "@/hooks/useProfiles";
import { useSessionProfile } from "@/hooks/useSessionProfile";
import { DEFAULT_APP_DISPLAY_NAME } from "@/lib/app-settings";
import { countToolCallBlocks, getDisplayableAssistantBlocks, splitFinalAssistantBlocks } from "@/lib/message-display";
import type { SessionStatsInfo } from "@/lib/pi-types";
import type { ProfileRef } from "@/lib/profiles";
import type { SlashUiAction } from "@/lib/slash-command-registry";
import type { AgentMessage, AssistantContentBlock, AssistantMessage, SessionInfo, SessionTreeNode, ToolResultMessage } from "@/lib/types";
import { ChatInput, type ChatInputHandle } from "./ChatInput";
import { ChatMinimap, useMessageRefs } from "./ChatMinimap";
import styles from "./ChatWindow.module.css";
import { ExtensionUiHost, ExtensionUiInline } from "./ExtensionUiHost";
import { MessageView } from "./MessageView";
import { ProfileManagerModal } from "./ProfileManagerModal";
import { ProfileSelector } from "./ProfileSelector";
import { ForkSelectorModal, SessionTreeSelectorModal } from "./SessionCommandModals";

interface Props {
  appName?: string;
  session: SessionInfo | null;
  newSessionCwd: string | null;
  onAgentEnd?: () => void;
  onSessionCreated?: (session: SessionInfo) => void;
  onSessionForked?: (newSessionId: string, selectedText?: string) => void;
  modelsRefreshKey?: number;
  chatInputRef?: React.RefObject<ChatInputHandle | null>;
  onBranchDataChange?: (tree: SessionTreeNode[], activeLeafId: string | null, onLeafChange: (leafId: string | null) => void) => void;
  onSystemPromptChange?: (prompt: string | null) => void;
  onSessionStatsChange?: (stats: SessionStatsInfo | null) => void;
  onSessionStatsPanelOpen?: () => void;
  onSlashUiAction?: (action: SlashUiAction) => void | Promise<void>;
  onContextUsageChange?: (usage: { percent: number | null; contextWindow: number; tokens: number | null } | null) => void;
  onOpenFile?: (filePath: string) => void;
  onRetry?: () => void;
}

function phaseLabel(phase: AgentPhase): string {
  if (phase?.kind === "running_tools") {
    const names = phase.tools.map((t) => t.name);
    if (names.length === 0) return "Running tool...";
    if (names.length === 1) return `Running ${names[0]}...`;
    if (names.length <= 3) return `Running ${names.join(", ")}...`;
    return `Running ${names.slice(0, 2).join(", ")} (+${names.length - 2})...`;
  }
  if (phase?.kind === "waiting_model") return "Waiting for model...";
  if (phase?.kind === "running_command") return "Running command...";
  return "Thinking...";
}


function hasFinalAssistantAnswer(message: AgentMessage): boolean {
  if (message.role !== "assistant") return false;
  return splitFinalAssistantBlocks(message as AssistantMessage).answerBlocks.some((block) => (
    block.type === "image" || (block.type === "text" && block.text.trim().length > 0)
  ));
}

function findFinalAssistantIndex(messages: AgentMessage[], userIdx: number, endIdx: number): number {
  for (let candidateIdx = endIdx - 1; candidateIdx > userIdx; candidateIdx--) {
    if (hasFinalAssistantAnswer(messages[candidateIdx])) return candidateIdx;
  }
  for (let candidateIdx = endIdx - 1; candidateIdx > userIdx; candidateIdx--) {
    if (messages[candidateIdx]?.role === "assistant") return candidateIdx;
  }
  return -1;
}

function countToolCalls(messages: AgentMessage[], indices: number[]): number {
  let count = 0;
  for (const idx of indices) {
    const msg = messages[idx];
    if (msg?.role !== "assistant") continue;
    count += countToolCallBlocks(getDisplayableAssistantBlocks(msg as AssistantMessage));
  }
  return count;
}

function hasDisplayableProcessMessage(message: AgentMessage): boolean {
  if (message.role === "assistant") {
    return getDisplayableAssistantBlocks(message as AssistantMessage).length > 0;
  }
  return message.role === "custom";
}

function withAssistantBlocks(
  message: AssistantMessage,
  content: AssistantContentBlock[],
  options: { omitUsage?: boolean } = {},
): AssistantMessage {
  const next = { ...message, content };
  if (options.omitUsage) next.usage = undefined;
  return next;
}

function ProcessDetailsGroup({ messageCount, toolCallCount, children }: { messageCount: number; toolCallCount: number; children: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const parts = ["Process details", `${messageCount} ${messageCount === 1 ? "message" : "messages"}`];
  if (toolCallCount > 0) parts.push(`${toolCallCount} ${toolCallCount === 1 ? "tool call" : "tool calls"}`);

  return (
    <div className={styles.processGroup}>
      <button
        type="button"
        aria-expanded={expanded}
        className={styles.processToggle}
        data-expanded={expanded || undefined}
        onClick={() => setExpanded((value) => !value)}
        title={expanded ? "Collapse process details" : "Expand process details"}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="4 2.5 7.5 6 4 9.5" />
        </svg>
        <span>{parts.join(" · ")}</span>
      </button>
      {expanded && <div className={styles.processBody}>{children}</div>}
    </div>
  );
}

export function ChatWindow({ appName = DEFAULT_APP_DISPLAY_NAME, session, newSessionCwd, onAgentEnd, onSessionCreated, onSessionForked, modelsRefreshKey, chatInputRef, onBranchDataChange, onSystemPromptChange, onSessionStatsChange, onSessionStatsPanelOpen, onSlashUiAction, onContextUsageChange, onOpenFile, onRetry }: Props) {
  const { soundEnabled, onSoundToggle, playDoneSound, unlockAudio } = useAudio();
  const isMobile = useIsMobile();

  // Wrap onAgentEnd to play the completion sound. This is more reliable than
  // wrapping handleAgentEventRef because useAgentSession overwrites that ref
  // on every render (it syncs the latest callback), which would blow away an
  // externally-installed wrapper after the first re-render.
  const playDoneSoundRef = useRef(playDoneSound);
  playDoneSoundRef.current = playDoneSound;
  const soundEnabledRef = useRef(soundEnabled);
  soundEnabledRef.current = soundEnabled;
  const wrappedOnAgentEnd = useCallback(() => {
    if (soundEnabledRef.current) {
      playDoneSoundRef.current();
    }
    onAgentEnd?.();
  }, [onAgentEnd]);

  const [treeSelectorOpen, setTreeSelectorOpen] = useState(false);
  const [forkSelectorOpen, setForkSelectorOpen] = useState(false);
  const [profileManagerOpen, setProfileManagerOpen] = useState(false);
  const profilesState = useProfiles();
  const reconcileProfileRuntimeRef = useRef<((sessionId: string) => Promise<void>) | null>(null);
  const reconcileAfterProfileSwitch = useCallback(async (sessionId: string) => {
    const reconcile = reconcileProfileRuntimeRef.current;
    if (!reconcile) throw new Error("Profile runtime reconciliation is not ready.");
    await reconcile(sessionId);
  }, []);
  const isNewSession = !session;
  const sessionProfile = useSessionProfile({
    sessionId: session?.id ?? null,
    isNew: isNewSession,
    profiles: profilesState.allProfiles,
    globalDefaultProfileRef: profilesState.globalDefaultProfileRef,
    onAfterSwitch: reconcileAfterProfileSwitch,
  });
  const [fullTreeState, setFullTreeState] = useState<{
    sessionId: string | null;
    tree: SessionTreeNode[];
    leafId: string | null;
    loading: boolean;
    error: string | null;
  }>({ sessionId: null, tree: [], leafId: null, loading: false, error: null });
  const handleSlashUiAction = useCallback(async (action: SlashUiAction) => {
    if (action.type === "openBranchNavigator") {
      setTreeSelectorOpen(true);
      return;
    }
    if (action.type === "openForkSelector") {
      setForkSelectorOpen(true);
      return;
    }
    await onSlashUiAction?.(action);
  }, [onSlashUiAction]);

  const {
    data, activeLeafId,
    loading, error, messages, entryIds, streamState,
    agentRunning, modelNames, modelList, modelThinkingLevels, modelThinkingLevelMaps, runtimeTools, thinkingLevel,
    retryInfo, contextUsage, forkingEntryId,
    isCompacting, compactError, compactResult, displayModel: displayModelValue, openAIFastMode, sessionStats,
    slashCommands, slashCommandsLoading, queuedMessages,
    notices, extensionDialog, extensionCustomUi, extensionStatuses, extensionWidgets, extensionChrome, extensionCompatibility, extensionAutocompleteProviders, respondToExtensionUi, sendExtensionCustomInput, sendExtensionCustomResize, sendEditorSnapshot, requestExtensionAutocomplete,
    isAutoModelSelection,
    agentPhase,
    isNew,
    sessionIdRef, messagesEndRef, scrollContainerRef,
    lastUserMsgRef,
    handleSend, handleAbort, handleFork, handleNavigate, handleModelChange,
    handleCompact, handleSteer, handleFollowUp, handlePromptWithStreamingBehavior, handleAbortCompaction,
    handleRecallQueue,
    handleBuiltinSlashCommand, handleOpenAIFastToggle,
    handleThinkingLevelChange, reconcileProfileRuntime, loadSlashCommands, loadForkCandidates,
  } = useAgentSession({
    session, newSessionCwd, onAgentEnd: wrappedOnAgentEnd, onSessionCreated, onSessionForked,
    modelsRefreshKey, chatInputRef, onBranchDataChange, onSystemPromptChange, onSessionStatsPanelOpen, onSlashUiAction: handleSlashUiAction,
    newSessionProfileRef: sessionProfile.explicitNewSessionProfileRef,
    onNewSessionProfileSnapshot: sessionProfile.acceptCreatedSnapshot,
  });
  reconcileProfileRuntimeRef.current = reconcileProfileRuntime;

  // Push session stats up to AppShell for the top bar.
  // Compare scalar fields to avoid loops from new object identity each render.
  const statsKey = sessionStats
    ? [
      sessionStats.sessionId,
      sessionStats.sessionFile ?? "",
      sessionStats.sessionName ?? "",
      sessionStats.userMessages,
      sessionStats.assistantMessages,
      sessionStats.toolCalls,
      sessionStats.toolResults,
      sessionStats.totalMessages,
      sessionStats.tokens.input,
      sessionStats.tokens.output,
      sessionStats.tokens.cacheRead,
      sessionStats.tokens.cacheWrite,
      sessionStats.tokens.total,
      sessionStats.cost ?? 0,
    ].join("|")
    : null;
  const sessionStatsRef = useRef(sessionStats);
  sessionStatsRef.current = sessionStats;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the scalar key intentionally gates structurally equivalent stats updates.
  useEffect(() => {
    onSessionStatsChange?.(sessionStatsRef.current);
  }, [statsKey, onSessionStatsChange]);
  useEffect(() => () => { onSessionStatsChange?.(null); }, [onSessionStatsChange]);

  // Push context usage up to AppShell as well.
  const ctxKey = contextUsage
    ? `${contextUsage.percent ?? "null"}|${contextUsage.contextWindow}|${contextUsage.tokens ?? "null"}`
    : null;
  const contextUsageRef = useRef(contextUsage);
  contextUsageRef.current = contextUsage;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the scalar key intentionally gates structurally equivalent context updates.
  useEffect(() => {
    onContextUsageChange?.(contextUsageRef.current);
  }, [ctxKey, onContextUsageChange]);
  useEffect(() => () => { onContextUsageChange?.(null); }, [onContextUsageChange]);

  const onDrop = useCallback((files: File[]) => {
    if (agentRunning) return;
    chatInputRef?.current?.addImages(files);
  }, [agentRunning, chatInputRef]);

  const { isDragOver, handleDragEnter, handleDragOver, handleDragLeave, handleDrop } = useDragDrop(onDrop);

  const visibleMessages = messages.filter((m) => m.role === "user" || m.role === "assistant");
  const messageRefs = useMessageRefs(visibleMessages.length);

  const isEmptyNew = isNew && messages.length === 0 && !streamState.isStreaming && !agentRunning;
  const messageCwd = session?.cwd ?? newSessionCwd ?? undefined;

  const availableThinkingLevels = displayModelValue
    ? (modelThinkingLevels[`${displayModelValue.provider}:${displayModelValue.modelId}`] ?? null)
    : null;

  const currentThinkingLevelMap = displayModelValue
    ? (modelThinkingLevelMaps[`${displayModelValue.provider}:${displayModelValue.modelId}`] ?? null)
    : null;

  const openAIFastEligible = openAIFastMode?.eligible;
  const openAIFastModeActive = openAIFastMode?.active;
  const showOpenAIFastToggle = !!openAIFastMode
    && (openAIFastMode.eligible || displayModelValue?.provider === "openai" || displayModelValue?.provider === "openai-codex");
  const handleProfileSelect = useCallback(async (profileRef: string | null) => {
    if (!profileRef) {
      if (sessionProfile.materializedSessionId && profilesState.globalDefaultProfileRef) {
        profileRef = profilesState.globalDefaultProfileRef;
      } else {
        sessionProfile.clearExplicitNewSessionProfile();
        return;
      }
    }
    if (agentRunning || isCompacting || sessionProfile.applying) return;
    try {
      await sessionProfile.applyProfile(profileRef as ProfileRef);
    } catch {
      // useSessionProfile keeps the previous confirmed state and exposes the error.
    }
  }, [agentRunning, isCompacting, profilesState.globalDefaultProfileRef, sessionProfile]);

  const profileSelectorElement = (
    <ProfileSelector
      profiles={profilesState.allProfiles}
      globalDefaultProfileRef={profilesState.globalDefaultProfileRef}
      mode={isNew ? "new" : "existing"}
      selectedProfileRef={sessionProfile.selectedProfileRef}
      displayName={sessionProfile.displayName}
      effectiveSnapshot={sessionProfile.effectiveSnapshot}
      diagnostics={sessionProfile.diagnostics}
      conflicts={sessionProfile.conflicts}
      setupWarnings={profilesState.warnings}
      runtimeTools={runtimeTools}
      disabled={agentRunning || isCompacting || profilesState.loading || sessionProfile.loading}
      applying={sessionProfile.applying}
      error={sessionProfile.error ?? profilesState.error}
      onSelectProfile={handleProfileSelect}
      onOpenManager={() => setProfileManagerOpen(true)}
    />
  );

  useEffect(() => {
    if (!treeSelectorOpen) return;
    const sid = data?.sessionId ?? session?.id ?? null;
    if (!sid) {
      setFullTreeState({ sessionId: null, tree: [], leafId: null, loading: false, error: "No active session" });
      return;
    }

    const fallbackTree = data?.tree ?? [];
    const fallbackLeafId = activeLeafId;
    const controller = new AbortController();
    setFullTreeState({ sessionId: sid, tree: fallbackTree, leafId: fallbackLeafId, loading: true, error: null });
    fetch(`/api/sessions/${encodeURIComponent(sid)}/tree`, { signal: controller.signal })
      .then(async (res) => {
        const body = await res.json().catch(() => ({})) as { tree?: SessionTreeNode[]; leafId?: string | null; error?: string };
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        return body;
      })
      .then((body) => {
        setFullTreeState({
          sessionId: sid,
          tree: body.tree ?? [],
          leafId: body.leafId ?? null,
          loading: false,
          error: null,
        });
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setFullTreeState({
          sessionId: sid,
          tree: fallbackTree,
          leafId: fallbackLeafId,
          loading: false,
          error: err instanceof Error ? err.message : String(err),
        });
      });
  }, [activeLeafId, data?.sessionId, data?.tree, session?.id, treeSelectorOpen]);
  const handleTreeLabelChange = useCallback(async (entryId: string, label: string | undefined) => {
    const sid = fullTreeState.sessionId ?? data?.sessionId ?? session?.id ?? null;
    if (!sid) throw new Error("No active session");
    const res = await fetch(`/api/sessions/${encodeURIComponent(sid)}/tree`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetId: entryId, label }),
    });
    const body = await res.json().catch(() => ({})) as { tree?: SessionTreeNode[]; leafId?: string | null; error?: string };
    if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
    setFullTreeState((current) => ({
      sessionId: sid,
      tree: body.tree ?? current.tree,
      leafId: body.leafId ?? current.leafId,
      loading: false,
      error: null,
    }));
  }, [data?.sessionId, fullTreeState.sessionId, session?.id]);

  const chatInputElement = (
    <ChatInput
      ref={chatInputRef}
      onSend={handleSend}
      onAbort={handleAbort}
      onSteer={agentRunning ? handleSteer : undefined}
      onFollowUp={agentRunning ? handleFollowUp : undefined}
      onPromptWithStreamingBehavior={agentRunning ? handlePromptWithStreamingBehavior : undefined}
      isStreaming={agentRunning}
      model={displayModelValue}
      isAutoModelSelection={isAutoModelSelection}
      modelNames={modelNames}
      modelList={modelList}
      showOpenAIFastToggle={showOpenAIFastToggle}
      openAIFastEligible={openAIFastEligible}
      openAIFastModeActive={openAIFastModeActive}
      onOpenAIFastToggle={showOpenAIFastToggle ? handleOpenAIFastToggle : undefined}
      onModelChange={handleModelChange}
      onCompact={session || isNew ? handleCompact : undefined}
      onAbortCompaction={handleAbortCompaction}
      isCompacting={isCompacting}
      compactError={compactError}
      compactResult={compactResult}
      profileSelector={profileSelectorElement}
      thinkingLevel={thinkingLevel}
      onThinkingLevelChange={session || isNew ? handleThinkingLevelChange : undefined}
      availableThinkingLevels={availableThinkingLevels}
      thinkingLevelMap={currentThinkingLevelMap}
      retryInfo={retryInfo}
      queuedMessages={queuedMessages}
      onRecallQueue={handleRecallQueue}
      slashCommands={slashCommands}
      slashCommandsLoading={slashCommandsLoading}
      onLoadSlashCommands={loadSlashCommands}
      onBuiltinCommand={handleBuiltinSlashCommand}
      soundEnabled={soundEnabled}
      onSoundToggle={onSoundToggle}
      onAudioUnlock={unlockAudio}
      draftKey={session?.id ?? (newSessionCwd ? `new:${newSessionCwd}` : undefined)}
      cwd={session?.cwd ?? newSessionCwd}
      extensionAutocompleteProviderCount={extensionAutocompleteProviders.length}
      onEditorSnapshot={sendEditorSnapshot}
      onExtensionAutocomplete={requestExtensionAutocomplete}
    />
  );

  const aboveEditorWidgets = extensionWidgets.filter((widget) => widget.placement !== "belowEditor");
  const belowEditorWidgets = extensionWidgets.filter((widget) => widget.placement === "belowEditor");

  if (loading) {
    return (
      <div className={styles.state} aria-live="polite" aria-busy="true">
        <div className={styles.stateCard}>
          <span className={styles.stateSpinner} aria-hidden="true" />
          <span className={styles.stateEyebrow}>Restoring workspace</span>
          <h2 className={styles.stateTitle}>Loading conversation</h2>
          <p className={styles.stateDescription}>Messages, branches, and runtime state are being restored.</p>
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className={styles.state} data-tone="danger" role="alert">
        <div className={styles.stateCard}>
          <svg className={styles.stateIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><line x1="12" y1="7" x2="12" y2="13" /><circle cx="12" cy="17" r="1" fill="currentColor" stroke="none" /></svg>
          <span className={styles.stateEyebrow}>Session diagnostic</span>
          <h2 className={styles.stateTitle}>Conversation unavailable</h2>
          <p className={styles.stateDescription}>The session could not be restored. Its file and runtime state were left unchanged.</p>
          <code className={styles.stateDetail}>{error}</code>
          {session && onRetry && (
            <button type="button" className={styles.stateAction} onClick={onRetry}>
              Try again
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the full conversation surface is the image drop target.
    <div
      className={styles.root}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {profileManagerOpen && (
        <ProfileManagerModal
          cwd={session?.cwd ?? newSessionCwd}
          profilesState={profilesState}
          onClose={() => setProfileManagerOpen(false)}
        />
      )}
      {isDragOver && !agentRunning && (
        <div className={styles.dropOverlay} aria-hidden="true">
          <div className={styles.dropRings}>
            {[0, 0.8, 1.6].map((delay) => (
              <div key={delay} className={styles.dropRing} style={{ animationDelay: `${delay}s` }} />
            ))}
          </div>
          <svg className={styles.dropIcon} viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="12" y="17" width="40" height="31" rx="4" />
            <circle cx="43" cy="26" r="3" />
            <path d="m16 44 11-13 8 8 5-6 8 11" />
          </svg>
        </div>
      )}

      <ExtensionUiHost
        dialog={extensionDialog}
        customUi={extensionCustomUi}
        onRespond={respondToExtensionUi}
        onCustomInput={sendExtensionCustomInput}
        onCustomResize={sendExtensionCustomResize}
      />

      {treeSelectorOpen && (
        <SessionTreeSelectorModal
          tree={fullTreeState.tree}
          activeLeafId={fullTreeState.leafId ?? activeLeafId}
          loading={fullTreeState.loading}
          error={fullTreeState.error}
          onClose={() => setTreeSelectorOpen(false)}
          onSelect={handleNavigate}
          onLabelChange={handleTreeLabelChange}
        />
      )}

      {forkSelectorOpen && (
        <ForkSelectorModal
          onClose={() => setForkSelectorOpen(false)}
          onLoadCandidates={loadForkCandidates}
          onFork={handleFork}
          busyEntryId={forkingEntryId}
          disabled={agentRunning || isNew}
          disabledReason={isNew ? "Fork is available after the session has messages." : "Fork is available after the current run finishes."}
        />
      )}

      {isEmptyNew ? (
        <div className={styles.empty}>
          <div className={styles.emptyInner}>
            <div className={styles.brandRow}>
              <div className={styles.brandIdentity}>
                <span className={styles.brandMark}>π</span>
                <span className={styles.brandName} title={appName}>{appName}</span>
              </div>
              <div className={styles.versions}>
                <span>web <strong>v{process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0"}</strong></span>
                <span>pi <strong>v{process.env.NEXT_PUBLIC_PI_VERSION ?? "0.0.0"}</strong></span>
              </div>
            </div>
            <NoticeShelf notices={notices} align="right" />
            {chatInputElement}
          </div>
        </div>
      ) : (
      <>
      <div className={styles.conversation}>
        <div className={styles.floatingNotices}>
          <div className={styles.column}>
            <NoticeShelf notices={notices} floating align="right" />
          </div>
        </div>
        <div ref={scrollContainerRef} className={styles.timeline}>
          <div className={styles.timelinePadding}>
            <div className={styles.column}>
              <ExtensionUiInline statuses={extensionStatuses} widgets={aboveEditorWidgets} chrome={extensionChrome} compatibility={extensionCompatibility} />

            {(() => {
              const toolResultsMap = new Map<string, ToolResultMessage>();
              for (const msg of messages) {
                if (msg.role === "toolResult") {
                  toolResultsMap.set((msg as ToolResultMessage).toolCallId, msg as ToolResultMessage);
                }
              }

              let lastUserIdx = -1;
              for (let i = messages.length - 1; i >= 0; i--) {
                if (messages[i].role === "user") { lastUserIdx = i; break; }
              }

              const visibleRefIndexByMessage = new Map<number, number>();
              let refIdx = 0;
              messages.forEach((msg, idx) => {
                if (msg.role === "user" || msg.role === "assistant") {
                  visibleRefIndexByMessage.set(idx, refIdx++);
                }
              });

              const attachVisibleRef = (idx: number, refIndex: number) => (el: HTMLDivElement | null) => {
                messageRefs.current[refIndex] = el;
                if (idx === lastUserIdx) { (lastUserMsgRef as { current: HTMLDivElement | null }).current = el; }
              };

              const renderMessage = (idx: number, options: { attachRef?: boolean; keyPrefix?: string; messageOverride?: AgentMessage; showTimestamp?: boolean } = {}): ReactNode => {
                const msg = options.messageOverride ?? messages[idx];
                const prevAssistantEntryId =
                  msg.role === "user" && idx > 0 && messages[idx - 1].role === "assistant"
                    ? entryIds[idx - 1]
                    : undefined;
                const isVisible = msg.role === "user" || msg.role === "assistant";
                const currentRefIdx = visibleRefIndexByMessage.get(idx);
                const keyPrefix = options.keyPrefix ?? "message";
                let showTimestamp = false;
                if (msg.role === "assistant") {
                  showTimestamp = true;
                  for (let j = idx + 1; j < messages.length; j++) {
                    const r = messages[j].role;
                    if (r === "user") break;
                    if (r === "assistant") { showTimestamp = false; break; }
                  }
                  // Hide on the currently-streaming tail (the streaming bubble owns the live timestamp)
                  if (showTimestamp && streamState.isStreaming && idx === messages.length - 1) {
                    showTimestamp = false;
                  }
                }
                if (options.showTimestamp !== undefined) showTimestamp = options.showTimestamp;
                const view = (
                  <MessageView
                    key={`${keyPrefix}-view-${idx}`}
                    message={msg}
                    toolResults={toolResultsMap}
                    modelNames={modelNames}
                    cwd={messageCwd}
                    onOpenFile={onOpenFile}
                    entryId={entryIds[idx]}
                    onFork={agentRunning || isNew || (idx === 0 && msg.role === "user") ? undefined : handleFork}
                    forking={forkingEntryId === entryIds[idx]}
                    onNavigate={agentRunning ? undefined : handleNavigate}
                    prevAssistantEntryId={agentRunning ? undefined : prevAssistantEntryId}
                    onEditContent={(content) => chatInputRef?.current?.insertIfEmpty(content)}
                    showTimestamp={showTimestamp}
                    prevTimestamp={idx > 0 ? (messages[idx - 1] as AgentMessage & { timestamp?: number }).timestamp : undefined}
                    sessionId={session?.id ?? sessionIdRef.current ?? undefined}
                  />
                );
                if (!isVisible || options.attachRef === false || currentRefIdx === undefined) return view;
                return (
                  <div className={styles.messageAnchor} key={`${keyPrefix}-${idx}`} ref={attachVisibleRef(idx, currentRefIdx)}>
                    {view}
                  </div>
                );
              };

              const rendered: ReactNode[] = [];
              for (let idx = 0; idx < messages.length;) {
                const msg = messages[idx];
                if (msg.role !== "user") {
                  rendered.push(renderMessage(idx));
                  idx += 1;
                  continue;
                }

                const userIdx = idx;
                let endIdx = userIdx + 1;
                while (endIdx < messages.length && messages[endIdx].role !== "user") endIdx += 1;

                const finalAssistantIdx = findFinalAssistantIndex(messages, userIdx, endIdx);

                if (finalAssistantIdx === -1) {
                  for (let renderIdx = userIdx; renderIdx < endIdx; renderIdx++) {
                    rendered.push(renderMessage(renderIdx));
                  }
                  idx = endIdx;
                  continue;
                }

                const isLiveTail = (agentRunning || streamState.isStreaming) && endIdx === messages.length && userIdx === lastUserIdx;
                if (isLiveTail) {
                  for (let renderIdx = userIdx; renderIdx < endIdx; renderIdx++) {
                    rendered.push(renderMessage(renderIdx));
                  }
                  idx = endIdx;
                  continue;
                }

                rendered.push(renderMessage(userIdx));

                const processIndices: number[] = [];
                for (let processIdx = userIdx + 1; processIdx < finalAssistantIdx; processIdx++) {
                  processIndices.push(processIdx);
                }
                const visibleProcessIndices = processIndices.filter((processIdx) => hasDisplayableProcessMessage(messages[processIdx]));
                const finalAssistant = messages[finalAssistantIdx] as AssistantMessage;
                const finalSplit = splitFinalAssistantBlocks(finalAssistant);
                const finalProcessMessage = finalSplit.processBlocks.length > 0
                  ? withAssistantBlocks(finalAssistant, finalSplit.processBlocks, { omitUsage: true })
                  : null;
                const finalAnswerMessage = finalSplit.answerBlocks.length > 0
                  ? withAssistantBlocks(finalAssistant, finalSplit.answerBlocks)
                  : null;

                const processCount = visibleProcessIndices.length + (finalProcessMessage ? 1 : 0);
                if (processCount > 0) {
                  const processRefIdx = visibleProcessIndices
                    .map((processIdx) => visibleRefIndexByMessage.get(processIdx))
                    .find((value): value is number => typeof value === "number")
                    ?? (finalAnswerMessage ? undefined : visibleRefIndexByMessage.get(finalAssistantIdx));
                  const processGroup = (
                    <ProcessDetailsGroup
                      messageCount={processCount}
                      toolCallCount={countToolCalls(messages, visibleProcessIndices) + countToolCallBlocks(finalSplit.processBlocks)}
                    >
                      {visibleProcessIndices.map((processIdx) => renderMessage(processIdx, { attachRef: false, keyPrefix: "process" }))}
                      {finalProcessMessage && renderMessage(finalAssistantIdx, { attachRef: false, keyPrefix: "process-final", messageOverride: finalProcessMessage, showTimestamp: false })}
                    </ProcessDetailsGroup>
                  );
                  rendered.push(
                    <div
                      key={`process-group-${userIdx}-${finalAssistantIdx}`}
                      ref={processRefIdx === undefined ? undefined : (el) => { messageRefs.current[processRefIdx] = el; }}
                    >
                      {processGroup}
                    </div>,
                  );
                }

                if (finalAnswerMessage) {
                  rendered.push(renderMessage(finalAssistantIdx, { messageOverride: finalAnswerMessage }));
                }
                for (let renderIdx = finalAssistantIdx + 1; renderIdx < endIdx; renderIdx++) {
                  rendered.push(renderMessage(renderIdx));
                }
                idx = endIdx;
              }
              return rendered;
            })()}

            {streamState.isStreaming && streamState.streamingMessage && (
              <MessageView message={streamState.streamingMessage as AgentMessage} isStreaming modelNames={modelNames} cwd={messageCwd} onOpenFile={onOpenFile} />
            )}

            {agentRunning && !streamState.streamingMessage && (
              <output className={styles.phase}>
                <span>{phaseLabel(agentPhase)}</span>
              </output>
            )}

            {agentRunning && (
              <div className={styles.scrollSpacer} style={{ height: scrollContainerRef.current ? scrollContainerRef.current.clientHeight : "80vh" }} />
            )}

            <div ref={messagesEndRef} />
            </div>
          </div>
        </div>
        {isMobile ? null : (
          <ChatMinimap
            messages={messages}
            streamingMessage={streamState.streamingMessage}
            scrollContainer={scrollContainerRef}
            messageRefs={messageRefs}
          />
        )}
      </div>

      <div className={styles.composerRegion}>
        <div className={`${styles.extensionFooter} ${!isMobile ? styles.desktopComposerOffset : ""}`}>
          <div className={styles.column}>
            <ExtensionUiInline widgets={belowEditorWidgets} chrome={{ headerLines: [], footerLines: extensionChrome.footerLines, working: { visible: false } }} />
          </div>
        </div>
        {chatInputElement}
      </div>
      </>
      )}
    </div>
  );
}


function NoticeShelf({ notices, floating = false, align = "left" }: { notices: NoticeItem[]; floating?: boolean; align?: "left" | "right" }) {
  if (notices.length === 0) return null;
  return (
    <div className={styles.noticeShelf} data-floating={floating || undefined} data-align={align}>
      {notices.map((notice) => (
        <div
          key={notice.id}
          className={styles.noticeItem}
          data-tone={notice.type}
          data-exiting={notice.exiting || undefined}
          role={notice.type === "error" ? "alert" : "status"}
        >
          <span className={styles.noticeDot} aria-hidden="true" />
          <span className={styles.noticeMessage}>{notice.message}</span>
        </div>
      ))}
    </div>
  );
}

