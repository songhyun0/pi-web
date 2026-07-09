"use client";

import { useState, useCallback, useRef, useEffect, useReducer } from "react";
import type {
  AgentMessage,
  ExtensionChromeState,
  ExtensionCompatibilityItem,
  ExtensionStatusItem,
  ExtensionUiRequest,
  ExtensionWidgetItem,
  OpenAIFastModeConfigState,
  OpenAIFastModeState,
  SessionInfo,
  SessionTreeNode,
} from "@/lib/types";
import { normalizeToolCalls } from "@/lib/normalize";
import { sendAgentCommand } from "@/lib/agent-client";
import { parseUserBashCommand } from "@/lib/user-bash";
import type { AgentProfileRef, AgentProfilesResponse } from "@/lib/api-types";
import type { SessionStatsInfo } from "@/lib/pi-types";
import {
  getWebBuiltinSlashCommand,
  isWebBuiltinSlashCommand,
  type SlashCommandInfo,
  type SlashUiAction,
} from "@/lib/slash-command-registry";

export interface SessionData {
  sessionId: string;
  filePath: string;
  tree: SessionTreeNode[];
  leafId: string | null;
  context: {
    messages: AgentMessage[];
    entryIds: string[];
    thinkingLevel: string;
    model: { provider: string; modelId: string } | null;
  };
}

interface StreamingState {
  isStreaming: boolean;
  streamingMessage: Partial<AgentMessage> | null;
}

type StreamAction =
  | { type: "start" }
  | { type: "update"; message: Partial<AgentMessage> }
  | { type: "end" }
  | { type: "reset" };

function streamReducer(state: StreamingState, action: StreamAction): StreamingState {
  switch (action.type) {
    case "start":
      return { isStreaming: true, streamingMessage: null };
    case "update":
      return { isStreaming: true, streamingMessage: action.message };
    case "end":
    case "reset":
      return { isStreaming: false, streamingMessage: null };
    default:
      return state;
  }
}

interface AgentEvent {
  type: string;
  [key: string]: unknown;
}

interface CompactCommandResult {
  tokensBefore?: number;
  estimatedTokensAfter?: number;
}

interface LastAssistantTextResponse {
  text?: string;
}

export interface ForkCandidate {
  entryId: string;
  text: string;
}

interface ForkCandidatesResponse {
  messages?: ForkCandidate[];
}

export type ExtensionAutocompleteProviderState = {
  id: string;
  label?: string;
  active: boolean;
};

export type ExtensionAutocompleteSuggestion = {
  id: string;
  label: string;
  value: string;
  description?: string;
  prefix?: string;
};

export type ExtensionAutocompleteResult = {
  providerId: string;
  label?: string;
  items: ExtensionAutocompleteSuggestion[];
} | null;

type OpenAIFastToggleResponse = {
  extensionStatuses?: ExtensionStatusItem[];
  extensionWidgets?: ExtensionWidgetItem[];
  extensionChrome?: ExtensionChromeState;
  extensionCompatibility?: ExtensionCompatibilityItem[];
  openAIFastMode?: OpenAIFastModeState;
  openAIFastConfig?: OpenAIFastModeConfigState;
};

type AgentStateResponse = {
  contextUsage?: { percent: number | null; contextWindow: number; tokens: number | null } | null;
  model?: { id: string; provider: string } | null;
  systemPrompt?: string;
  thinkingLevel?: string;
  isStreaming?: boolean;
  isPromptRunning?: boolean;
  isCompacting?: boolean;
  isBashRunning?: boolean;
  extensionStatuses?: ExtensionStatusItem[];
  extensionWidgets?: ExtensionWidgetItem[];
  extensionChrome?: ExtensionChromeState;
  extensionCompatibility?: ExtensionCompatibilityItem[];
  extensionAutocompleteProviders?: ExtensionAutocompleteProviderState[];
  queuedMessages?: { steering?: string[]; followUp?: string[] } | null;
  profile?: { ref: AgentProfileRef; name: string; error?: string; missing?: boolean } | null;
  openAIFastMode?: OpenAIFastModeState;
  openAIFastConfig?: OpenAIFastModeConfigState;
};

type ContextUsageInfo = NonNullable<AgentStateResponse["contextUsage"]>;

function sameContextUsage(a: ContextUsageInfo | null, b: ContextUsageInfo | null): boolean {
  return a?.percent === b?.percent
    && a?.contextWindow === b?.contextWindow
    && a?.tokens === b?.tokens;
}

export interface QueuedMessages {
  steering: string[];
  followUp: string[];
}

function normalizeQueuedMessages(q?: { steering?: string[]; followUp?: string[] } | null): QueuedMessages {
  return { steering: q?.steering ?? [], followUp: q?.followUp ?? [] };
}

const DEFAULT_OPENAI_FAST_CONFIG: OpenAIFastModeConfigState = {
  enabled: false,
  models: ["openai/gpt-5.4", "openai/gpt-5.5", "openai-codex/gpt-5.4", "openai-codex/gpt-5.5"],
};

function normalizeOpenAIFastModelRef(ref: string): string {
  return ref.trim().toLowerCase();
}

function isOpenAIFastEligible(model: SelectedModel | null, config: OpenAIFastModeConfigState): boolean {
  if (!model) return false;
  if (model.provider !== "openai" && model.provider !== "openai-codex") return false;
  const bare = normalizeOpenAIFastModelRef(model.modelId);
  const full = normalizeOpenAIFastModelRef(`${model.provider}/${model.modelId}`);
  return config.models.some((entry) => {
    const normalized = normalizeOpenAIFastModelRef(entry);
    return normalized === bare || normalized === full;
  });
}

function deriveOpenAIFastModeState(
  model: SelectedModel | null,
  config: OpenAIFastModeConfigState
): OpenAIFastModeState | null {
  if (!model) return null;
  const eligible = isOpenAIFastEligible(model, config);
  const active = config.enabled && eligible;
  const status = !eligible ? "unavailable" : active ? "fast" : "normal";
  return {
    enabled: config.enabled,
    eligible,
    active,
    status,
    statusText: status === "fast" ? "Fast" : status === "normal" ? "Normal" : "Fast N/A",
    model,
  };
}

function sameSelectedModel(
  a: { provider: string; modelId: string } | null | undefined,
  b: { provider: string; modelId: string } | null | undefined
): boolean {
  return !!a && !!b && a.provider === b.provider && a.modelId === b.modelId;
}

type ExtensionUiDialogRequest = Extract<ExtensionUiRequest, { method: "select" | "confirm" | "input" | "editor" }>;
type ExtensionUiCustomRequest = Extract<ExtensionUiRequest, { method: "custom" }>;
export type NoticeType = "info" | "success" | "warning" | "error";

export type NoticeItem = {
  id: string;
  message: string;
  type: NoticeType;
  exiting?: boolean;
};

type NoticeState = {
  visible: NoticeItem[];
  pending: NoticeItem[];
};

type NoticeAction =
  | { type: "add"; notice: NoticeItem }
  | { type: "mark_oldest_exiting" }
  | { type: "remove"; id: string };

export type AgentPhase =
  | { kind: "waiting_model" }
  | { kind: "running_command" }
  | { kind: "running_tools"; tools: { id: string; name: string }[] }
  | null;

export interface CompactResultInfo {
  reason: "manual" | "threshold" | "overflow" | "auto" | string;
  tokensBefore: number;
  estimatedTokensAfter: number;
}

export type { SlashCommandInfo };

export type BuiltinSlashCommandResult =
  | { handled: false }
  | { handled: true; message?: string; error?: string; action?: SlashUiAction["type"] | "download" };

export interface UseAgentSessionOptions {
  session: SessionInfo | null;
  newSessionCwd: string | null;
  onAgentEnd?: () => void;
  onSessionCreated?: (session: SessionInfo) => void;
  onSessionForked?: (newSessionId: string) => void;
  modelsRefreshKey?: number;
  chatInputRef?: React.RefObject<ChatInputHandle | null>;
  onBranchDataChange?: (tree: SessionTreeNode[], activeLeafId: string | null, onLeafChange: (leafId: string | null) => void) => void;
  onSystemPromptChange?: (prompt: string | null) => void;
  onSessionStatsPanelOpen?: () => void;
  onSlashUiAction?: (action: SlashUiAction) => void | Promise<void>;
}

export type ThinkingLevelOption = "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

const PROGRAMMATIC_SCROLL_IGNORE_MS = 700;
const USER_SCROLL_INTENT_MS = 1200;
const PROMPT_SETTLE_INITIAL_DELAY_MS = 800;
const PROMPT_SETTLE_POLL_MS = 600;
const PROMPT_SETTLE_MAX_MS = 20_000;
const AGENT_STATE_RECONCILE_MS = 15_000;
const LIVE_CONTEXT_USAGE_REFRESH_THROTTLE_MS = 2_000;
const EVENT_STREAM_CONNECT_TIMEOUT_MS = 5_000;
const MAX_NOTICES = 5;
const NOTICE_VISIBLE_MS = 5000;
const NOTICE_EXIT_ANIMATION_MS = 180;
const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " ", "Space", "Spacebar"]);
const TOOL_PRESET_STORAGE_KEY = "pi-web-default-tool-preset";
const PROFILE_STORAGE_KEY = "pi-web-default-profile-ref";
const THINKING_LEVEL_STORAGE_KEY = "pi-web-default-thinking-level";
const FALLBACK_THINKING_LEVEL: ThinkingLevelOption = "xhigh";
const THINKING_LEVEL_VALUES = new Set(["auto", "off", "minimal", "low", "medium", "high", "xhigh"]);

function readLocalStorageValue(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalStorageValue(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore storage failures (private windows, denied storage, etc.).
  }
}
function removeLocalStorageValue(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore storage failures (private windows, denied storage, etc.).
  }
}

type StoredProfileSelection = { ref: AgentProfileRef; source: "legacy" };

function legacyPresetProfileRef(value: string | null): AgentProfileRef | undefined {
  if (value === "none") return "builtin:no-tools";
  if (value === "default") return "builtin:default";
  if (value === "full") return "builtin:full";
  return undefined;
}

function readStoredProfileSelection(): StoredProfileSelection | undefined {
  removeLocalStorageValue(PROFILE_STORAGE_KEY);
  const legacyRef = legacyPresetProfileRef(readLocalStorageValue(TOOL_PRESET_STORAGE_KEY));
  if (legacyRef) {
    removeLocalStorageValue(TOOL_PRESET_STORAGE_KEY);
    return { ref: legacyRef, source: "legacy" };
  }
  return undefined;
}
function readStoredThinkingLevel(): ThinkingLevelOption {
  const value = readLocalStorageValue(THINKING_LEVEL_STORAGE_KEY);
  return THINKING_LEVEL_VALUES.has(value ?? "") ? value as ThinkingLevelOption : FALLBACK_THINKING_LEVEL;
}

function hasStoredThinkingLevel(): boolean {
  return THINKING_LEVEL_VALUES.has(readLocalStorageValue(THINKING_LEVEL_STORAGE_KEY) ?? "");
}

type EventStreamConnectionStatus = "connected" | "timeout" | "closed";

type EventStreamConnectionResult = {
  status: EventStreamConnectionStatus;
  source: EventSource;
};

class EventStreamConnectionError extends Error {
  constructor(public readonly status: Exclude<EventStreamConnectionStatus, "connected">) {
    super(status === "timeout"
      ? "Timed out connecting to the agent event stream. Please try again."
      : "Failed to connect to the agent event stream. Please try again.");
    this.name = "EventStreamConnectionError";
  }
}

function createNoticeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function markOldestNoticeExiting(notices: NoticeItem[]): NoticeItem[] {
  const index = notices.findIndex((notice) => !notice.exiting);
  if (index === -1) return notices;
  return notices.map((notice, i) => (
    i === index ? { ...notice, exiting: true } : notice
  ));
}

function fillPendingNotices(visible: NoticeItem[], pending: NoticeItem[]): NoticeState {
  let nextVisible = visible;
  let nextPending = pending;
  while (nextPending.length > 0 && nextVisible.length < MAX_NOTICES) {
    const [next, ...rest] = nextPending;
    nextVisible = [...nextVisible, next];
    nextPending = rest;
  }
  if (nextPending.length > 0 && !nextVisible.some((notice) => notice.exiting)) {
    nextVisible = markOldestNoticeExiting(nextVisible);
  }
  return { visible: nextVisible, pending: nextPending };
}

function noticeReducer(state: NoticeState, action: NoticeAction): NoticeState {
  switch (action.type) {
    case "add": {
      if (state.visible.some((notice) => notice.exiting) || state.visible.length >= MAX_NOTICES) {
        return {
          visible: state.visible.some((notice) => notice.exiting)
            ? state.visible
            : markOldestNoticeExiting(state.visible),
          pending: [...state.pending, action.notice],
        };
      }
      return { ...state, visible: [...state.visible, action.notice] };
    }
    case "mark_oldest_exiting":
      return { ...state, visible: markOldestNoticeExiting(state.visible) };
    case "remove": {
      const visible = state.visible.filter((notice) => notice.id !== action.id);
      return fillPendingNotices(visible, state.pending);
    }
    default:
      return state;
  }
}

function extractMessageText(message: Partial<AgentMessage>): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) =>
      block && typeof block === "object"
        && (block as { type?: string }).type === "text"
        && typeof (block as { text?: unknown }).text === "string"
        ? (block as { text: string }).text
        : "")
    .filter(Boolean)
    .join("\n");
}

function imageSignature(block: unknown): string {
  if (!block || typeof block !== "object" || (block as { type?: unknown }).type !== "image") return "";
  const source = (block as { source?: unknown }).source;
  if (source && typeof source === "object") {
    const src = source as { type?: unknown; media_type?: unknown; data?: unknown; url?: unknown };
    return [
      src.type === "url" ? "url" : "base64",
      typeof src.media_type === "string" ? src.media_type : "",
      typeof src.data === "string" ? src.data : "",
      typeof src.url === "string" ? src.url : "",
    ].join(":");
  }
  const flat = block as { data?: unknown; mimeType?: unknown };
  return [
    "base64",
    typeof flat.mimeType === "string" ? flat.mimeType : "",
    typeof flat.data === "string" ? flat.data : "",
    "",
  ].join(":");
}

function userMessageKey(message: Partial<AgentMessage>): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return JSON.stringify({ text: content, images: [] });
  if (!Array.isArray(content)) return JSON.stringify({ text: "", images: [] });
  return JSON.stringify({
    text: extractMessageText(message),
    images: content.map(imageSignature).filter(Boolean),
  });
}


function readCompactResult(result: unknown, reason: string): CompactResultInfo | null {
  if (!result || typeof result !== "object") return null;
  const r = result as CompactCommandResult;
  if (typeof r.tokensBefore !== "number" || typeof r.estimatedTokensAfter !== "number") return null;
  return { reason, tokensBefore: r.tokensBefore, estimatedTokensAfter: r.estimatedTokensAfter };
}

export interface ChatInputHandle {
  insertText: (text: string) => void;
  setText: (text: string) => void;
  insertIfEmpty: (content: string) => void;
  prependText: (text: string) => void;
  addImages: (files: File[]) => void;
}

export interface AttachedImage {
  data: string;
  mimeType: string;
  previewUrl: string;
}

type SelectedModel = { provider: string; modelId: string };
type ModelEntry = { id: string; name: string; provider: string };
type ModelsResponse = {
  models: Record<string, string>;
  modelList?: ModelEntry[];
  defaultModel?: SelectedModel | null;
  defaultThinkingLevel?: ThinkingLevelOption;
  thinkingLevels?: Record<string, string[]>;
  thinkingLevelMaps?: Record<string, Record<string, string | null>>;
  openAIFastConfig?: OpenAIFastModeConfigState;
};

type SlashCommandsResponse = {
  commands?: SlashCommandInfo[];
};

type ModelMatchResult =
  | { status: "matched"; model: ModelEntry }
  | { status: "ambiguous" }
  | { status: "not-found" };

function findExactModelMatch(searchTerm: string, models: ModelEntry[]): ModelMatchResult {
  const trimmed = searchTerm.trim();
  if (!trimmed) return { status: "not-found" };
  const normalized = trimmed.toLowerCase();

  const canonicalMatches = models.filter((model) => `${model.provider}/${model.id}`.toLowerCase() === normalized);
  if (canonicalMatches.length === 1) return { status: "matched", model: canonicalMatches[0] };
  if (canonicalMatches.length > 1) return { status: "ambiguous" };

  const slashIndex = trimmed.indexOf("/");
  if (slashIndex !== -1) {
    const provider = trimmed.slice(0, slashIndex).trim().toLowerCase();
    const modelId = trimmed.slice(slashIndex + 1).trim().toLowerCase();
    if (provider && modelId) {
      const providerMatches = models.filter((model) =>
        model.provider.toLowerCase() === provider && model.id.toLowerCase() === modelId
      );
      if (providerMatches.length === 1) return { status: "matched", model: providerMatches[0] };
      if (providerMatches.length > 1) return { status: "ambiguous" };
    }
  }

  const idMatches = models.filter((model) => model.id.toLowerCase() === normalized);
  if (idMatches.length === 1) return { status: "matched", model: idMatches[0] };
  if (idMatches.length > 1) return { status: "ambiguous" };

  const nameMatches = models.filter((model) => model.name.toLowerCase() === normalized);
  if (nameMatches.length === 1) return { status: "matched", model: nameMatches[0] };
  if (nameMatches.length > 1) return { status: "ambiguous" };

  return { status: "not-found" };
}

function parsePathCommandArgument(args: string): string | undefined {
  const argsString = args.trimStart();
  if (!argsString) return undefined;
  const firstChar = argsString[0];
  if (firstChar === "\"" || firstChar === "'") {
    const closingQuoteIndex = argsString.indexOf(firstChar, 1);
    return closingQuoteIndex < 0 ? undefined : argsString.slice(1, closingQuoteIndex);
  }
  const firstWhitespaceIndex = argsString.search(/\s/);
  return firstWhitespaceIndex < 0 ? argsString : argsString.slice(0, firstWhitespaceIndex);
}

function getUnsupportedBuiltinMessage(commandName: string): string {
  switch (commandName) {
    case "fork":
      return "Fork selector is not available in this view.";
    case "import":
      return "Session import is not implemented in pi-web yet.";
    case "share":
      return "Sharing sessions as GitHub gists is not implemented in pi-web yet.";
    case "trust":
      return "Project trust changes are not implemented in pi-web slash commands yet.";
    case "hotkeys":
      return "Hotkeys help is not implemented in pi-web yet.";
    case "changelog":
      return "Changelog view is not implemented in pi-web yet.";
    case "quit":
      return "Quit is not applicable in the browser. Close the tab instead.";
    default:
      return `/${commandName} is a pi built-in command, but pi-web does not support it yet.`;
  }
}

export function useAgentSession(opts: UseAgentSessionOptions) {
  const {
    session, newSessionCwd, onAgentEnd, onSessionCreated, onSessionForked,
    modelsRefreshKey, onBranchDataChange, onSystemPromptChange, onSessionStatsPanelOpen, onSlashUiAction,
  } = opts;

  const isNew = session === null && newSessionCwd !== null;

  const [data, setData] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [error, setError] = useState<string | null>(null);
  const [activeLeafId, setActiveLeafId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [entryIds, setEntryIds] = useState<string[]>([]);
  const [streamState, dispatch] = useReducer(streamReducer, { isStreaming: false, streamingMessage: null });
  const [agentRunning, setAgentRunning] = useState(false);
  const [modelNames, setModelNames] = useState<Record<string, string>>({});
  const [modelList, setModelList] = useState<ModelEntry[]>([]);
  const [modelThinkingLevels, setModelThinkingLevels] = useState<Record<string, string[]>>({});
  const [modelThinkingLevelMaps, setModelThinkingLevelMaps] = useState<Record<string, Record<string, string | null>>>({});
  const [newSessionModel, setNewSessionModel] = useState<SelectedModel | null>(null);
  const [newSessionDefaultModel, setNewSessionDefaultModel] = useState<SelectedModel | null>(null);
  const [profilesResponse, setProfilesResponse] = useState<AgentProfilesResponse | null>(null);
  const [profilesRefreshKey, setProfilesRefreshKey] = useState(0);
  const initialProfileSelectionSourceRef = useRef<StoredProfileSelection["source"] | null>(null);
  const profileStorageCheckedRef = useRef(false);
  const newSessionProfileOverrideRef = useRef(false);
  const [activeProfileRef, setActiveProfileRef] = useState<AgentProfileRef | undefined>(() => {
    if (!isNew) return undefined;
    profileStorageCheckedRef.current = true;
    const selection = readStoredProfileSelection();
    initialProfileSelectionSourceRef.current = selection?.source ?? null;
    return selection?.ref;
  });
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevelOption>(() => readStoredThinkingLevel());
  const [newSessionDefaultThinkingLevel, setNewSessionDefaultThinkingLevel] = useState<ThinkingLevelOption>(FALLBACK_THINKING_LEVEL);
  const [profileSwitchSupported, setProfileSwitchSupported] = useState(isNew);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileMissing, setProfileMissing] = useState(false);
  const [retryInfo, setRetryInfo] = useState<{ attempt: number; maxAttempts: number; errorMessage?: string } | null>(null);
  const [contextUsage, setContextUsage] = useState<ContextUsageInfo | null>(null);
  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);
  const [forkingEntryId, setForkingEntryId] = useState<string | null>(null);
  const [currentModelOverride, setCurrentModelOverride] = useState<{ provider: string; modelId: string } | null>(null);
  const [pendingModel, setPendingModel] = useState<{ provider: string; modelId: string } | null>(null);
  const [isCompacting, setIsCompacting] = useState(false);
  const [compactError, setCompactError] = useState<string | null>(null);
  const [compactResult, setCompactResult] = useState<CompactResultInfo | null>(null);
  const [agentPhase, setAgentPhase] = useState<AgentPhase>(null);
  const [userBashRunning, setUserBashRunning] = useState(false);
  const [slashCommands, setSlashCommands] = useState<SlashCommandInfo[]>([]);
  const [slashCommandsLoading, setSlashCommandsLoading] = useState(false);
  const [noticeState, dispatchNotice] = useReducer(noticeReducer, { visible: [], pending: [] });
  const [sessionStatsOverride, setSessionStatsOverride] = useState<SessionStatsInfo | null>(null);
  const [extensionDialog, setExtensionDialog] = useState<ExtensionUiDialogRequest | null>(null);
  const [extensionCustomUi, setExtensionCustomUi] = useState<ExtensionUiCustomRequest | null>(null);
  const [extensionStatuses, setExtensionStatuses] = useState<ExtensionStatusItem[]>([]);
  const [extensionWidgets, setExtensionWidgets] = useState<ExtensionWidgetItem[]>([]);
  const [extensionChrome, setExtensionChrome] = useState<ExtensionChromeState>({ headerLines: [], footerLines: [], working: { visible: false } });
  const [extensionCompatibility, setExtensionCompatibility] = useState<ExtensionCompatibilityItem[]>([]);
  const [extensionAutocompleteProviders, setExtensionAutocompleteProviders] = useState<ExtensionAutocompleteProviderState[]>([]);
  const [queuedMessages, setQueuedMessages] = useState<QueuedMessages>({ steering: [], followUp: [] });
  const [openAIFastConfig, setOpenAIFastConfig] = useState<OpenAIFastModeConfigState>(DEFAULT_OPENAI_FAST_CONFIG);
  const [openAIFastModeState, setOpenAIFastModeState] = useState<OpenAIFastModeState | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const sessionIdRef = useRef<string | null>(session?.id ?? null);
  const agentRunningRef = useRef(false);
  const userBashRunningRef = useRef(false);
  const handleAgentEventRef = useRef<((event: AgentEvent) => void) | null>(null);
  const initialScrollDoneRef = useRef(false);
  const lastUserMsgRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollToUserRef = useRef(false);
  const completionScrollAllowedRef = useRef(true);
  const userScrollIntentUntilRef = useRef(0);
  const ignoreProgrammaticScrollUntilRef = useRef(0);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const ensuringNewSessionRef = useRef<Promise<string | null> | null>(null);
  const newSessionPromotedRef = useRef(false);
  const promptRunIdRef = useRef(0);
  const optimisticUserMessageKeyRef = useRef<string | null>(null);
  const liveContextUsageRefreshInFlightRef = useRef(false);
  const lastLiveContextUsageRefreshAtRef = useRef(0);
  const pendingLiveContextUsageRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const newSessionThinkingOverrideRef = useRef(false);

  const currentModel = currentModelOverride ?? data?.context.model ?? pendingModel ?? null;
  const profileCwd = newSessionCwd ?? session?.cwd ?? null;
  const activeProfile = profilesResponse?.profiles.find((profile) => profile.ref === activeProfileRef) ?? null;
  const activeProfileModel = activeProfile?.model ? { provider: activeProfile.model.provider, modelId: activeProfile.model.modelId } : null;
  const displayModel = isNew ? (newSessionModel ?? activeProfileModel ?? newSessionDefaultModel) : currentModel;
  const profileOptions = profilesResponse?.profiles ?? [];
  const derivedOpenAIFastMode = deriveOpenAIFastModeState(displayModel, openAIFastConfig);
  const openAIFastMode = openAIFastModeState && sameSelectedModel(openAIFastModeState.model, displayModel)
    ? openAIFastModeState
    : derivedOpenAIFastMode;
  useEffect(() => {
    if (!isNew || newSessionThinkingOverrideRef.current) return;
    const profileThinkingLevel = activeProfile?.thinkingLevel as ThinkingLevelOption | undefined;
    if (profileThinkingLevel && profileThinkingLevel !== "auto") {
      setThinkingLevel(profileThinkingLevel);
      return;
    }
    setThinkingLevel(hasStoredThinkingLevel() ? readStoredThinkingLevel() : newSessionDefaultThinkingLevel);
  }, [isNew, activeProfile?.thinkingLevel, newSessionDefaultThinkingLevel]);

  useEffect(() => {
    if (!profileCwd) return;
    const handleProfilesChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ cwd?: string }>).detail;
      if (!detail?.cwd || detail.cwd === profileCwd) setProfilesRefreshKey((key) => key + 1);
    };
    window.addEventListener("pi-web-profiles-changed", handleProfilesChanged);
    return () => window.removeEventListener("pi-web-profiles-changed", handleProfilesChanged);
  }, [profileCwd]);

  useEffect(() => {
    if (!isNew || profileStorageCheckedRef.current) return;
    profileStorageCheckedRef.current = true;
    const selection = readStoredProfileSelection();
    initialProfileSelectionSourceRef.current = selection?.source ?? null;
    if (selection) setActiveProfileRef(selection.ref);
  }, [isNew]);

  useEffect(() => {
    if (!profileCwd) {
      setProfilesResponse(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/profiles?cwd=${encodeURIComponent(profileCwd)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json() as AgentProfilesResponse;
        if (cancelled) return;
        setProfilesResponse(data);
        setActiveProfileRef((current) => {
          const currentExists = current && data.profiles.some((profile) => profile.ref === current);
          if (isNew) {
            if (sessionIdRef.current) return current ?? data.effectiveDefaultProfileRef;
            if (newSessionProfileOverrideRef.current) return currentExists ? current : data.effectiveDefaultProfileRef;
            if (initialProfileSelectionSourceRef.current) {
              initialProfileSelectionSourceRef.current = null;
              if (currentExists) return current;
            }
            return data.effectiveDefaultProfileRef;
          }
          if (currentExists) return current;
          if (session && current) return current;
          return current;
        });
      } catch (error) {
        if (!cancelled) console.error("Failed to load profiles:", error);
      }
    })();
    return () => { cancelled = true; };
  }, [profileCwd, session, isNew, profilesRefreshKey]);

  const applyContextUsage = useCallback((usage: AgentStateResponse["contextUsage"]) => {
    const nextUsage = usage ?? null;
    setContextUsage((prev) => sameContextUsage(prev, nextUsage) ? prev : nextUsage);
  }, []);

  const applyContextUsageFromState = useCallback((state?: AgentStateResponse | null) => {
    if (state?.contextUsage !== undefined) applyContextUsage(state.contextUsage);
  }, [applyContextUsage]);

  const applyOpenAIFastFromState = useCallback((state?: AgentStateResponse | null) => {
    if (state?.openAIFastConfig !== undefined) setOpenAIFastConfig(state.openAIFastConfig ?? DEFAULT_OPENAI_FAST_CONFIG);
    if (state?.openAIFastMode !== undefined) setOpenAIFastModeState(state.openAIFastMode ?? null);
  }, []);
  const applyExtensionUiFromState = useCallback((state?: AgentStateResponse | null) => {
    if (state?.extensionStatuses !== undefined) setExtensionStatuses(state.extensionStatuses ?? []);
    if (state?.extensionWidgets !== undefined) setExtensionWidgets(state.extensionWidgets ?? []);
    if (state?.extensionChrome !== undefined) setExtensionChrome(state.extensionChrome ?? { headerLines: [], footerLines: [], working: { visible: false } });
    if (state?.extensionCompatibility !== undefined) setExtensionCompatibility(state.extensionCompatibility ?? []);
    if (state?.extensionAutocompleteProviders !== undefined) setExtensionAutocompleteProviders(state.extensionAutocompleteProviders ?? []);
  }, []);

  const sessionStats = (() => {
    if (sessionStatsOverride) return sessionStatsOverride;
    const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
    let cost = 0;
    let userMessages = 0;
    let assistantMessages = 0;
    let toolResults = 0;
    let toolCalls = 0;
    for (const msg of messages) {
      if (msg.role === "user") userMessages += 1;
      if (msg.role === "toolResult") toolResults += 1;
      if (msg.role !== "assistant") continue;
      assistantMessages += 1;
      const u = (msg as import("@/lib/types").AssistantMessage).usage;
      toolCalls += (msg as import("@/lib/types").AssistantMessage).content.filter((c) => c.type === "toolCall").length;
      if (!u) continue;
      tokens.input += u.input ?? 0;
      tokens.output += u.output ?? 0;
      tokens.cacheRead += u.cacheRead ?? 0;
      tokens.cacheWrite += u.cacheWrite ?? 0;
      cost += u.cost?.total ?? 0;
    }
    tokens.total = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite;
    if (tokens.total === 0 && messages.length === 0) return null;
    return {
      sessionFile: data?.filePath || undefined,
      sessionId: sessionIdRef.current ?? session?.id ?? "",
      sessionName: session?.name,
      userMessages,
      assistantMessages,
      toolCalls,
      toolResults,
      totalMessages: messages.length,
      tokens,
      cost,
      ...(contextUsage ? { contextUsage } : {}),
    } satisfies SessionStatsInfo;
  })();

  const loadSession = useCallback(async (sid: string, showLoading = false, includeState = false, shouldApply?: () => boolean) => {
    try {
      if (showLoading) setLoading(true);
      const url = includeState
        ? `/api/sessions/${encodeURIComponent(sid)}?includeState`
        : `/api/sessions/${encodeURIComponent(sid)}`;
      const res = await fetch(url);
      if (res.status === 404) {
        if (shouldApply && !shouldApply()) return null;
        if (showLoading) {
          setData(null);
          setActiveLeafId(null);
          setMessages([]);
          setError(null);
        }
        return null;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json() as SessionData & { agentState?: { running: boolean; state?: AgentStateResponse } };
      if (shouldApply && !shouldApply()) return null;
      setData(d);
      setActiveLeafId(d.leafId);
      setMessages(d.context.messages);
      setEntryIds(d.context.entryIds ?? []);
      setCurrentModelOverride(null);
      setError(null);
      const liveState = d.agentState?.state;
      if (liveState) {
        applyContextUsageFromState(liveState);
        if (liveState.model) setCurrentModelOverride({ provider: liveState.model.provider, modelId: liveState.model.id });
        if (liveState.profile !== undefined) {
          setProfileSwitchSupported(true);
          if (liveState.profile === null) {
            setProfileError(null);
            setProfileMissing(false);
            setActiveProfileRef(undefined);
          } else {
            setProfileError(liveState.profile?.error ?? null);
            setProfileMissing(Boolean(liveState.profile?.missing));
            if (liveState.profile?.ref) setActiveProfileRef(liveState.profile.ref);
          }
        }
        if (liveState.systemPrompt !== undefined) setSystemPrompt(liveState.systemPrompt ?? null);
        if (liveState.thinkingLevel !== undefined) setThinkingLevel((liveState.thinkingLevel as ThinkingLevelOption) ?? "auto");
        applyExtensionUiFromState(liveState);
        if (liveState.queuedMessages !== undefined) setQueuedMessages(normalizeQueuedMessages(liveState.queuedMessages));
      }
      else if (d.agentState && !d.agentState.running) setQueuedMessages({ steering: [], followUp: [] });
      // If no live agent state, fall back to thinking level from session file
      if (!liveState?.thinkingLevel && d.context.thinkingLevel && d.context.thinkingLevel !== "off") {
        setThinkingLevel(d.context.thinkingLevel as ThinkingLevelOption);
      }
      return d.agentState ?? null;
    } catch (e) {
      setError(String(e));
      return null;
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [applyContextUsageFromState, applyExtensionUiFromState]);

  const loadContext = useCallback(async (sid: string, leafId: string | null) => {
    try {
      const url = leafId
        ? `/api/sessions/${encodeURIComponent(sid)}/context?leafId=${encodeURIComponent(leafId)}`
        : `/api/sessions/${encodeURIComponent(sid)}/context`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json() as { context: { messages: AgentMessage[]; entryIds: string[] } };
      setMessages(d.context.messages);
      setEntryIds(d.context.entryIds ?? []);
    } catch (e) {
      console.error("Failed to load context:", e);
    }
  }, []);


  const promoteNewSession = useCallback((messageCount = 0, firstMessage = "(no messages)") => {
    const sid = sessionIdRef.current;
    if (!isNew || !newSessionCwd || !sid || newSessionPromotedRef.current) return;
    newSessionPromotedRef.current = true;
    onSessionCreated?.({
      id: sid,
      path: "",
      cwd: newSessionCwd,
      name: undefined,
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      messageCount,
      firstMessage,
    });
  }, [isNew, newSessionCwd, onSessionCreated]);

  const ensureNewSession = useCallback(async () => {
    if (sessionIdRef.current) return sessionIdRef.current;
    if (!isNew || !newSessionCwd) return sessionIdRef.current;
    if (ensuringNewSessionRef.current) return ensuringNewSessionRef.current;

    const promise = (async () => {
      const selectedModel = newSessionModel;
      if (selectedModel) setPendingModel(selectedModel);
      const isKnownBuiltInProfile = activeProfileRef === "builtin:no-tools" || activeProfileRef === "builtin:default" || activeProfileRef === "builtin:full";
      if (activeProfileRef && !isKnownBuiltInProfile && !profilesResponse) throw new Error("Profiles are still loading; try again in a moment.");
      const profileRef = activeProfileRef && (isKnownBuiltInProfile || profilesResponse?.profiles.some((profile) => profile.ref === activeProfileRef))
        ? activeProfileRef
        : profilesResponse?.effectiveDefaultProfileRef;
      const profileThinkingLevel = activeProfile?.thinkingLevel as ThinkingLevelOption | undefined;
      const shouldSendThinkingLevel = newSessionThinkingOverrideRef.current
        || (hasStoredThinkingLevel() && (!profileThinkingLevel || profileThinkingLevel === "auto"));
      const res = await fetch("/api/agent/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cwd: newSessionCwd,
          type: "ensure_session",
          ...(profileRef ? { profileRef } : {}),
          ...(selectedModel ? { provider: selectedModel.provider, modelId: selectedModel.modelId } : {}),
          ...(shouldSendThinkingLevel ? { thinkingLevel } : {}),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = await res.json() as { sessionId: string };
      const realId = result.sessionId;
      sessionIdRef.current = realId;
      try {
        const state = await sendAgentCommand<AgentStateResponse>(realId, { type: "get_state" });
        setProfileSwitchSupported(true);
        if (state.profile === null) {
          setProfileError(null);
          setProfileMissing(false);
          setActiveProfileRef(undefined);
        } else {
          setProfileError(state.profile?.error ?? null);
          setProfileMissing(Boolean(state.profile?.missing));
          if (state.profile?.ref) setActiveProfileRef(state.profile.ref);
        }
        if (state.model) setCurrentModelOverride({ provider: state.model.provider, modelId: state.model.id });
        if (state.thinkingLevel !== undefined) setThinkingLevel((state.thinkingLevel as ThinkingLevelOption) ?? "auto");
        applyContextUsageFromState(state);
        applyOpenAIFastFromState(state);
        applyExtensionUiFromState(state);
      } catch (error) {
        console.warn("Failed to sync new session profile state:", error);
      }
      return realId;
    })();

    ensuringNewSessionRef.current = promise;
    try {
      return await promise;
    } finally {
      ensuringNewSessionRef.current = null;
    }
  }, [isNew, newSessionCwd, newSessionModel, activeProfileRef, activeProfile?.thinkingLevel, profilesResponse, thinkingLevel, applyContextUsageFromState, applyOpenAIFastFromState, applyExtensionUiFromState]);

  const loadSlashCommands = useCallback(async () => {
    const sid = sessionIdRef.current ?? await ensureNewSession();
    if (!sid) {
      setSlashCommands([]);
      return [] as SlashCommandInfo[];
    }
    setSlashCommandsLoading(true);
    try {
      const data = await sendAgentCommand<SlashCommandsResponse>(sid, { type: "get_commands" });
      const commands = data?.commands ?? [];
      setSlashCommands(commands);
      return commands;
    } catch (e) {
      console.error("Failed to load slash commands:", e);
      setSlashCommands([]);
      return [] as SlashCommandInfo[];
    } finally {
      setSlashCommandsLoading(false);
    }
  }, [ensureNewSession]);

  const loadForkCandidates = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return [] as ForkCandidate[];
    const data = await sendAgentCommand<ForkCandidatesResponse>(sid, { type: "get_user_messages_for_forking" });
    return data?.messages ?? [];
  }, []);

  const connectEvents = useCallback((sid: string): Promise<EventStreamConnectionResult> => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    const es = new EventSource(`/api/agent/${encodeURIComponent(sid)}/events`);
    eventSourceRef.current = es;

    return new Promise((resolve) => {
      let settled = false;
      const settle = (status: EventStreamConnectionStatus) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve({ status, source: es });
      };
      const timeout = setTimeout(() => settle("timeout"), EVENT_STREAM_CONNECT_TIMEOUT_MS);

      es.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data) as AgentEvent;
          if (event.type === "connected") settle("connected");
          handleAgentEventRef.current?.(event);
        } catch {
          // ignore
        }
      };
      es.onerror = () => {
        if (es.readyState === EventSource.CLOSED) {
          // Fatal error (404/500/content-type mismatch): browser won't
          // auto-reconnect. Settle the Promise and manually reconnect for
          // already-running sessions.
          settle("closed");
          if (eventSourceRef.current === es && agentRunningRef.current) {
            eventSourceRef.current = null;
            setTimeout(() => {
              if (agentRunningRef.current) void connectEvents(sid);
            }, 1000);
          }
        }
        // Recoverable errors (CONNECTING): let EventSource auto-reconnect.
        // The timeout above resolves only to let callers decide whether this
        // connection must be ready before they continue.
      };
    });
  }, []);

  const ensureEventsConnected = useCallback(async (sid: string) => {
    const result = await connectEvents(sid);
    if (result.status === "connected" || result.source.readyState === EventSource.OPEN) return;
    if (eventSourceRef.current === result.source) eventSourceRef.current = null;
    result.source.close();
    throw new EventStreamConnectionError(result.status);
  }, [connectEvents]);

  const respondToExtensionUi = useCallback(async (
    request: ExtensionUiDialogRequest,
    response: { value: string } | { confirmed: boolean } | { cancelled: true },
  ) => {
    const sid = sessionIdRef.current;
    setExtensionDialog((current) => current?.id === request.id ? null : current);
    if (!sid) return;
    try {
      await sendAgentCommand(sid, {
        type: "extension_ui_response",
        id: request.id,
        ...response,
      });
    } catch (e) {
      console.error("Failed to send extension UI response:", e);
    }
  }, []);

  const sendExtensionCustomInput = useCallback(async (request: ExtensionUiCustomRequest, data: string) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, {
        type: "extension_ui_input",
        id: request.id,
        data,
      });
    } catch (e) {
      console.error("Failed to send extension custom UI input:", e);
    }
  }, []);

  const sendExtensionCustomResize = useCallback(async (request: ExtensionUiCustomRequest, size: { columns: number; rows: number }) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, {
        type: "extension_ui_resize",
        id: request.id,
        columns: size.columns,
        rows: size.rows,
      });
    } catch (e) {
      console.error("Failed to send extension custom UI resize:", e);
    }
  }, []);

  const sendEditorSnapshot = useCallback((text: string) => {
    const sid = sessionIdRef.current;
    if (!sid || extensionAutocompleteProviders.length === 0) return;
    void sendAgentCommand(sid, { type: "extension_editor_snapshot", text }).catch(() => {});
  }, [extensionAutocompleteProviders.length]);

  const requestExtensionAutocomplete = useCallback(async (text: string, cursor: number): Promise<ExtensionAutocompleteResult> => {
    const sid = sessionIdRef.current;
    if (!sid || extensionAutocompleteProviders.length === 0) return null;
    try {
      return await sendAgentCommand<ExtensionAutocompleteResult>(sid, { type: "extension_autocomplete", text, cursor });
    } catch {
      return null;
    }
  }, [extensionAutocompleteProviders.length]);

  const addNotice = useCallback((notice: { id?: string; message: string; type?: NoticeType }) => {
    const message = notice.message.trim();
    if (!message) return;
    dispatchNotice({
      type: "add",
      notice: {
        id: notice.id ?? createNoticeId(),
        message,
        type: notice.type ?? "info",
      },
    });
  }, []);

  const handleExtensionUiRequest = useCallback((request: ExtensionUiRequest) => {
    switch (request.method) {
      case "select":
      case "confirm":
      case "input":
      case "editor":
        setExtensionDialog(request);
        break;
      case "notify": {
        addNotice({
          id: request.id,
          message: request.message,
          type: request.notifyType ?? "info",
        });
        break;
      }
      case "setStatus":
        setExtensionStatuses((prev) => {
          const rest = prev.filter((item) => item.key !== request.statusKey);
          return request.statusText ? [...rest, { key: request.statusKey, text: request.statusText }] : rest;
        });
        break;
      case "setWidget":
        setExtensionWidgets((prev) => {
          const rest = prev.filter((item) => item.key !== request.widgetKey);
          return request.widgetLines
            ? [...rest, {
                key: request.widgetKey,
                lines: request.widgetLines,
                placement: request.widgetPlacement ?? "aboveEditor",
              }]
            : rest;
        });
        break;
      case "setTitle":
        if (request.title) document.title = request.title;
        break;
      case "set_editor_text":
        opts.chatInputRef?.current?.setText(request.text);
        break;
      case "paste_editor_text":
        opts.chatInputRef?.current?.insertText(request.text);
        break;
      case "setChrome":
        setExtensionChrome(request.chrome);
        break;
      case "compatibility_report":
        setExtensionCompatibility(request.reports);
        break;
      case "autocomplete_provider":
        setExtensionAutocompleteProviders((prev) => {
          const rest = prev.filter((provider) => provider.id !== request.providerId);
          return request.active ? [...rest, { id: request.providerId, label: request.label, active: true }] : rest;
        });
        break;
      case "setTheme":
        if (request.success && typeof window !== "undefined") {
          const next = request.themeName === "dark" ? "dark" : request.themeName === "light" ? "light" : undefined;
          if (next === "dark") document.documentElement.classList.add("dark");
          if (next === "light") document.documentElement.classList.remove("dark");
          localStorage.setItem("pi-theme", request.themeName);
          window.dispatchEvent(new CustomEvent("pi-theme-change", { detail: request.themeName }));
        }
        break;
      case "custom":
        setExtensionCustomUi((current) => {
          if (request.closed) return current?.id === request.id ? null : current;
          return request;
        });
        break;
    }
  }, [addNotice, opts.chatInputRef]);

  const finishPromptWithoutStream = useCallback(async (sid: string | null = sessionIdRef.current, runId?: number) => {
    // Bail out before loadSession too: a stale finish for a previous run
    // must not overwrite the messages of the run currently streaming.
    if (runId !== undefined && promptRunIdRef.current !== runId) return;
    try {
      if (sid) await loadSession(sid, false, true, runId === undefined ? undefined : () => promptRunIdRef.current === runId && sessionIdRef.current === sid);
      if (runId !== undefined && promptRunIdRef.current !== runId) return;
    } finally {
      if (runId !== undefined && promptRunIdRef.current !== runId) return;
      optimisticUserMessageKeyRef.current = null;
      if (!agentRunningRef.current) return;
      agentRunningRef.current = false;
      setAgentRunning(false);
      setAgentPhase(null);
      setRetryInfo(null);
      setIsCompacting(false);
      dispatch({ type: "end" });
      onAgentEnd?.();
    }
  }, [dispatch, loadSession, onAgentEnd]);

  const waitForPromptSettlement = useCallback(async (sid: string, runId?: number) => {
    await delay(PROMPT_SETTLE_INITIAL_DELAY_MS);
    const startedAt = Date.now();

    while (agentRunningRef.current && Date.now() - startedAt < PROMPT_SETTLE_MAX_MS) {
      if (runId !== undefined && promptRunIdRef.current !== runId) return;
      try {
        const res = await fetch(`/api/agent/${encodeURIComponent(sid)}`);
        if (res.ok) {
          const data = await res.json() as { running?: boolean; state?: AgentStateResponse };
          const state = data.state;
          applyContextUsageFromState(state);
          applyOpenAIFastFromState(state);
          applyExtensionUiFromState(state);
          if (!data.running || !state || (!state.isStreaming && !state.isPromptRunning)) {
            await finishPromptWithoutStream(sid, runId);
            return;
          }
        }
      } catch {
        // SSE remains the primary completion path.
      }
      await delay(PROMPT_SETTLE_POLL_MS);
    }
  }, [applyContextUsageFromState, applyExtensionUiFromState, applyOpenAIFastFromState, finishPromptWithoutStream]);

  const fetchLiveContextUsage = useCallback(async (runId: number) => {
    const sid = sessionIdRef.current;
    if (!sid || !agentRunningRef.current || promptRunIdRef.current !== runId) return;
    if (liveContextUsageRefreshInFlightRef.current) return;
    liveContextUsageRefreshInFlightRef.current = true;
    lastLiveContextUsageRefreshAtRef.current = Date.now();
    try {
      const res = await fetch(`/api/agent/${encodeURIComponent(sid)}`);
      if (!res.ok) return;
      const data = await res.json() as { state?: AgentStateResponse };
      if (promptRunIdRef.current !== runId || !agentRunningRef.current) return;
      applyContextUsageFromState(data.state);
      applyOpenAIFastFromState(data.state);
      applyExtensionUiFromState(data.state);
    } catch {
      // Best-effort live refresh; final/reconcile paths remain authoritative.
    } finally {
      liveContextUsageRefreshInFlightRef.current = false;
    }
  }, [applyContextUsageFromState, applyExtensionUiFromState, applyOpenAIFastFromState]);

  const requestLiveContextUsageRefresh = useCallback((options: { immediate?: boolean } = {}) => {
    if (!agentRunningRef.current) return;
    const runId = promptRunIdRef.current;

    const schedule = (delay: number) => {
      if (pendingLiveContextUsageRefreshTimerRef.current) return;
      pendingLiveContextUsageRefreshTimerRef.current = setTimeout(() => {
        pendingLiveContextUsageRefreshTimerRef.current = null;
        void fetchLiveContextUsage(runId);
      }, delay);
    };

    if (liveContextUsageRefreshInFlightRef.current) {
      schedule(LIVE_CONTEXT_USAGE_REFRESH_THROTTLE_MS);
      return;
    }

    const elapsed = Date.now() - lastLiveContextUsageRefreshAtRef.current;
    const delay = options.immediate ? 0 : Math.max(0, LIVE_CONTEXT_USAGE_REFRESH_THROTTLE_MS - elapsed);
    if (delay > 0) {
      schedule(delay);
      return;
    }

    if (pendingLiveContextUsageRefreshTimerRef.current) {
      clearTimeout(pendingLiveContextUsageRefreshTimerRef.current);
      pendingLiveContextUsageRefreshTimerRef.current = null;
    }
    void fetchLiveContextUsage(runId);
  }, [fetchLiveContextUsage]);

  // Reconcile client streaming state with the server. When SSE events are
  // missed (network drop, mobile tab backgrounded, half-open connection),
  // agent_end never arrives and the UI stays in streaming state forever.
  // If the server reports idle while we still think it's running, finish
  // through the same path as prompt_done.
  const reconcileAgentState = useCallback(async (sid: string) => {
    if (!agentRunningRef.current) return;
    const runId = promptRunIdRef.current;
    try {
      const res = await fetch(`/api/agent/${encodeURIComponent(sid)}`);
      if (!res.ok) return;
      const data = await res.json() as { running?: boolean; state?: AgentStateResponse };
      // A slow response can straddle a run boundary (previous run finished
      // and the user already started the next one while this request was in
      // flight) — everything in it is stale, drop it.
      if (promptRunIdRef.current !== runId) return;
      // The run may have finished while this request was in flight. Do not let
      // a stale snapshot resurrect the compaction indicator after agent_end.
      if (!agentRunningRef.current) return;
      const state = data.state;
      // Mirror compaction state unconditionally: a missed compaction_end
      // would otherwise leave the "Stop compaction" UI stuck. No state
      // (wrapper destroyed) means nothing is compacting.
      setIsCompacting(state?.isCompacting ?? false);
      setQueuedMessages(normalizeQueuedMessages(state?.queuedMessages));
      if (state) {
        applyContextUsageFromState(state);
        applyOpenAIFastFromState(state);
        applyExtensionUiFromState(state);
      }
      const busy = data.running && state
        && (state.isStreaming || state.isPromptRunning || state.isCompacting);
      if (busy || !agentRunningRef.current) return;
      if (state) {
        if (state.systemPrompt !== undefined) setSystemPrompt(state.systemPrompt ?? null);
        applyExtensionUiFromState(state);
      }
      await finishPromptWithoutStream(sid, runId);
    } catch {
      // Network still down — the next poll / visibility / online tick retries.
    }
  }, [applyContextUsageFromState, applyExtensionUiFromState, applyOpenAIFastFromState, finishPromptWithoutStream]);

  // Recovery net for missed SSE events: while the agent is running, verify
  // against the server periodically and whenever the tab returns to the
  // foreground or the network comes back.
  useEffect(() => {
    if (!agentRunning) return;
    const reconcile = () => {
      // Read the ref on every tick: for brand-new sessions the id is
      // assigned only after ensure_session returns.
      const sid = sessionIdRef.current;
      if (sid) void reconcileAgentState(sid);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") reconcile();
    };
    const interval = setInterval(reconcile, AGENT_STATE_RECONCILE_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", reconcile);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", reconcile);
    };
  }, [agentRunning, reconcileAgentState]);

  useEffect(() => {
    agentRunningRef.current = agentRunning;
  }, [agentRunning]);
  useEffect(() => {
    userBashRunningRef.current = userBashRunning;
  }, [userBashRunning]);
  const handleAgentEvent = useCallback((event: AgentEvent) => {
    switch (event.type) {
      case "agent_start":
        agentRunningRef.current = true;
        setAgentRunning(true);
        setAgentPhase({ kind: "waiting_model" });
        dispatch({ type: "start" });
        requestLiveContextUsageRefresh({ immediate: true });
        break;
      case "agent_end": {
        // A late agent_end can arrive over SSE after reconcileAgentState
        // already finished this run — don't re-trigger completion.
        if (!agentRunningRef.current) break;
        const endedRunId = promptRunIdRef.current;
        agentRunningRef.current = false;
        setAgentRunning(false);
        setAgentPhase(null);
        setRetryInfo(null);
        setIsCompacting(false);
        dispatch({ type: "end" });
        const sid = sessionIdRef.current;
        if (sid) {
          void (async () => {
            const stillSameEndedRun = () => promptRunIdRef.current === endedRunId && sessionIdRef.current === sid && !agentRunningRef.current;
            await loadSession(sid, false, false, stillSameEndedRun);
            try {
              const r = await fetch(`/api/agent/${encodeURIComponent(sid)}`);
              const d = await r.json() as { state?: AgentStateResponse };
              if (!stillSameEndedRun()) return;
              applyContextUsageFromState(d.state);
              applyOpenAIFastFromState(d.state);
              applyExtensionUiFromState(d.state);
              // Aborted turns can leave messages queued in pi (delivered with the
              // next turn); dead wrapper (no state) means the queue is gone.
              setQueuedMessages(normalizeQueuedMessages(d.state?.queuedMessages));
            } catch {
              // Best-effort post-run state refresh.
            }
          })();
        }
        onAgentEnd?.();
        break;
      }
      case "prompt_done":
        if (!agentRunningRef.current) break;
        void finishPromptWithoutStream(sessionIdRef.current);
        break;
      case "prompt_error":
        addNotice({ type: "error", message: (event.errorMessage as string | undefined) ?? "Command failed" });
        break;
      case "extension_error":
        addNotice({
          type: "error",
          message: (event.error as string | undefined) ?? "Extension command failed",
        });
        break;
      case "message_start":
      case "message_update": {
        // Ignore streaming events arriving after this run already finished
        // (e.g. SSE data buffered while the tab was frozen, flushed after
        // reconcile) — they would resurrect a ghost streaming bubble.
        if (!agentRunningRef.current) break;
        const msg = event.message as Partial<AgentMessage> | undefined;
        if (msg?.role === "user") {
          break;
        }
        if (msg) {
          dispatch({ type: "update", message: normalizeToolCalls(msg as AgentMessage) });
        }
        if (event.type === "message_update") {
          requestLiveContextUsageRefresh();
        } else {
          requestLiveContextUsageRefresh({ immediate: true });
        }
        setAgentPhase(null);
        break;
      }
      case "message_end": {
        // Same late-event guard: after reconcile finished this run,
        // loadSession already loaded this message from the session file —
        // appending it again would duplicate it.
        if (!agentRunningRef.current) break;
        const completed = event.message as AgentMessage | undefined;
        if (completed && completed.role === "user") {
          // Delivered steering/follow-up messages surface here as user
          // messages. The run's initial prompt also emits one, but handleSend
          // already appended it optimistically. Consume only the still-adjacent
          // optimistic bubble; later same-text queue deliveries must render.
          const delivered = normalizeToolCalls(completed);
          const deliveredKey = userMessageKey(delivered);
          const optimisticKey = optimisticUserMessageKeyRef.current;
          optimisticUserMessageKeyRef.current = null;
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (optimisticKey && last?.role === "user" && userMessageKey(last) === optimisticKey) {
              return optimisticKey === deliveredKey
                ? prev
                : [...prev.slice(0, -1), delivered];
            }
            return [...prev, delivered];
          });
        } else if (completed) {
          setMessages((prev) => [...prev, normalizeToolCalls(completed)]);
        }
        dispatch({ type: "reset" });
        setAgentPhase({ kind: "waiting_model" });
        requestLiveContextUsageRefresh({ immediate: true });
        break;
      }
      case "tool_execution_start": {
        const id = event.toolCallId as string;
        const name = event.toolName as string;
        setAgentPhase((prev) => {
          const tools = prev?.kind === "running_tools" ? [...prev.tools] : [];
          if (!tools.some((t) => t.id === id)) tools.push({ id, name });
          return { kind: "running_tools", tools };
        });
        requestLiveContextUsageRefresh({ immediate: true });
        break;
      }
      case "tool_execution_end": {
        const id = event.toolCallId as string;
        setAgentPhase((prev) => {
          if (prev?.kind !== "running_tools") return prev;
          const tools = prev.tools.filter((t) => t.id !== id);
          if (tools.length === 0) return { kind: "waiting_model" };
          return { kind: "running_tools", tools };
        });
        requestLiveContextUsageRefresh({ immediate: true });
        break;
      }
      case "queue_update":
        setQueuedMessages({
          steering: [...((event.steering as string[] | undefined) ?? [])],
          followUp: [...((event.followUp as string[] | undefined) ?? [])],
        });
        break;
      case "auto_retry_start":
        setRetryInfo({ attempt: event.attempt as number, maxAttempts: event.maxAttempts as number, errorMessage: event.errorMessage as string | undefined });
        break;
      case "auto_retry_end":
        setRetryInfo(null);
        break;
      case "auto_compaction_start":
      case "compaction_start":
        setIsCompacting(true);
        setCompactError(null);
        setCompactResult(null);
        break;
      case "auto_compaction_end":
      case "compaction_end":
        setIsCompacting(false);
        if (event.errorMessage) {
          setCompactError(event.errorMessage as string);
          setCompactResult(null);
        } else if (!event.aborted) {
          setCompactResult(readCompactResult(event.result, (event.reason as string | undefined) ?? "auto"));
          if (sessionIdRef.current) loadSession(sessionIdRef.current);
        }
        break;
      case "user_bash_start":
        userBashRunningRef.current = true;
        agentRunningRef.current = true;
        setUserBashRunning(true);
        setAgentRunning(true);
        setAgentPhase({ kind: "running_command" });
        dispatch({ type: "start" });
        break;
      case "user_bash_end":
        userBashRunningRef.current = false;
        setUserBashRunning(false);
        break;
      case "extension_ui_request":
        handleExtensionUiRequest(event as ExtensionUiRequest);
        break;
    }
  }, [addNotice, applyContextUsageFromState, applyExtensionUiFromState, applyOpenAIFastFromState, dispatch, finishPromptWithoutStream, handleExtensionUiRequest, loadSession, onAgentEnd, requestLiveContextUsageRefresh]);
  handleAgentEventRef.current = handleAgentEvent;

  const handleSend = useCallback(async (message: string, images?: AttachedImage[]) => {
    const trimmedMessage = message.trim();
    if (!trimmedMessage && !images?.length) return;
    if (agentRunning) return;
    if (images?.length && trimmedMessage.startsWith("!")) {
      addNotice({ type: "error", message: "User bash commands cannot include image attachments." });
      return;
    }
    const parsedUserBash = !images?.length ? parseUserBashCommand(message) : null;
    if (parsedUserBash) {
      if (!parsedUserBash.command) {
        addNotice({ type: "error", message: `Usage: ${parsedUserBash.prefix}<command>` });
        return;
      }
      const runId = promptRunIdRef.current + 1;
      promptRunIdRef.current = runId;
      agentRunningRef.current = true;
      userBashRunningRef.current = true;
      setAgentRunning(true);
      setUserBashRunning(true);
      setAgentPhase({ kind: "running_command" });
      dispatch({ type: "start" });
      pendingScrollToUserRef.current = true;
      completionScrollAllowedRef.current = true;
      try {
        let sid: string | null = null;
        if (isNew && newSessionCwd) {
          sid = sessionIdRef.current ?? await ensuringNewSessionRef.current ?? await ensureNewSession();
          if (sid) {
            await ensureEventsConnected(sid);
            promoteNewSession(1, `${parsedUserBash.prefix}${parsedUserBash.command}`);
          }
        } else if (session) {
          sid = session.id;
          await ensureEventsConnected(sid);
        }
        if (!sid) throw new Error("No active session for bash command");
        const result = await sendAgentCommand<{ output: string; exitCode?: number; cancelled: boolean; truncated: boolean; fullOutputPath?: string; command?: string; cwd?: string; durationMs?: number; excludeFromContext?: boolean }>(sid, {
          type: "user_bash",
          command: parsedUserBash.command,
          excludeFromContext: parsedUserBash.excludeFromContext,
        });
        await loadSession(sid, false, true);
        setMessages((prev) => {
          const next = [...prev];
          for (let i = next.length - 1; i >= 0; i -= 1) {
            if (next[i].role === "bashExecution" && (next[i] as { command?: string }).command === parsedUserBash.command) {
              next[i] = { ...next[i], cwd: result?.cwd, durationMs: result?.durationMs } as AgentMessage;
              break;
            }
          }
          return next;
        });
      } catch (e) {
        console.error("Failed to execute user bash:", e);
        addNotice({ type: "error", message: e instanceof Error ? e.message : String(e) });
      } finally {
        userBashRunningRef.current = false;
        agentRunningRef.current = false;
        setUserBashRunning(false);
        setAgentRunning(false);
        setAgentPhase(null);
        dispatch({ type: "end" });
        onAgentEnd?.();
      }
      return;
    }
    const isSlashCommandPrompt = !images?.length && trimmedMessage.startsWith("/");
    const promptRunId = promptRunIdRef.current + 1;

    const imageBlocks = images?.map((img) => ({ type: "image" as const, source: { type: "base64" as const, media_type: img.mimeType, data: img.data } }));
    const userMsg: AgentMessage = {
      role: "user",
      content: imageBlocks?.length
        ? [...(message.trim() ? [{ type: "text" as const, text: message }] : []), ...imageBlocks]
        : message,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    optimisticUserMessageKeyRef.current = userMessageKey(userMsg);
    promptRunIdRef.current = promptRunId;
    agentRunningRef.current = true;
    setAgentRunning(true);
    setAgentPhase(isSlashCommandPrompt ? { kind: "running_command" } : { kind: "waiting_model" });
    dispatch({ type: "start" });
    pendingScrollToUserRef.current = true;
    completionScrollAllowedRef.current = true;

    const piImages = images?.map((img) => ({ type: "image" as const, data: img.data, mimeType: img.mimeType }));

    try {
      let sentSessionId: string | null = null;
      if (isNew && newSessionCwd) {
        const existingSid = sessionIdRef.current ?? await ensuringNewSessionRef.current;
        const sid = existingSid ?? await ensureNewSession();

        if (sid) {
          sentSessionId = sid;
          // A draft session may already have applied a later model/profile change.
          // Do not replay stale newSessionModel on the first prompt.
          await ensureEventsConnected(sid);
          await sendAgentCommand(sid, {
            type: "prompt",
            message,
            ...(piImages?.length ? { images: piImages } : {}),
          });
          promoteNewSession(1, message);
        }
      } else if (session) {
        sentSessionId = session.id;
        await ensureEventsConnected(session.id);
        await sendAgentCommand(session.id, {
          type: "prompt",
          message,
          ...(piImages?.length ? { images: piImages } : {}),
        });
      }
      if (isSlashCommandPrompt && sentSessionId) {
        void waitForPromptSettlement(sentSessionId, promptRunId);
      }
    } catch (e) {
      console.error("Failed to send message:", e);
      if (e instanceof EventStreamConnectionError) {
        const optimisticKey = optimisticUserMessageKeyRef.current;
        if (optimisticKey) {
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            return last?.role === "user" && userMessageKey(last) === optimisticKey
              ? prev.slice(0, -1)
              : prev;
          });
        }
        addNotice({ type: "error", message: e.message });
      }
      optimisticUserMessageKeyRef.current = null;
      agentRunningRef.current = false;
      setAgentRunning(false);
      setAgentPhase(null);
      dispatch({ type: "end" });
    }
  }, [isNew, newSessionCwd, session, agentRunning, ensureNewSession, ensureEventsConnected, promoteNewSession, waitForPromptSettlement, addNotice, dispatch, loadSession, onAgentEnd]);

  const handleAbort = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, { type: userBashRunningRef.current ? "abort_bash" : "abort" });
    } catch (e) {
      console.error("Failed to abort:", e);
    }
  }, []);

  const handleFork = useCallback(async (entryId: string) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    setForkingEntryId(entryId);
    try {
      const result = await sendAgentCommand<{ cancelled?: boolean; newSessionId?: string; selectedText?: string }>(sid, {
        type: "fork",
        entryId,
      });
      const { cancelled, newSessionId, selectedText } = result ?? {};
      if (!cancelled && newSessionId) {
        onSessionForked?.(newSessionId);
        if (selectedText) {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => opts.chatInputRef?.current?.insertIfEmpty(selectedText));
          });
        }
      }
    } catch (e) {
      console.error("Fork failed:", e);
      addNotice({ type: "error", message: e instanceof Error ? e.message : String(e) });
    } finally {
      setForkingEntryId(null);
    }
  }, [addNotice, onSessionForked, opts.chatInputRef]);

  const handleNavigate = useCallback(async (entryId: string, options?: { summarize?: boolean }) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, { type: "navigate_tree", targetId: entryId, ...(options?.summarize ? { summarize: true } : {}) });
    } catch (e) {
      console.error("Failed to navigate session tree:", e);
    }
    setActiveLeafId(entryId);
    await loadContext(sid, entryId);
  }, [loadContext]);

  const handleLeafChange = useCallback(async (leafId: string | null) => {
    setActiveLeafId(leafId);
    const sid = sessionIdRef.current;
    if (!sid) return;
    await loadContext(sid, leafId);
    if (leafId) {
      sendAgentCommand(sid, { type: "navigate_tree", targetId: leafId }).catch(() => {});
    }
  }, [loadContext]);

  const handleModelChange = useCallback(async (provider: string, modelId: string) => {
    if (isNew) {
      setNewSessionModel({ provider, modelId });
      setPendingModel({ provider, modelId });
      const sid = sessionIdRef.current ?? await ensuringNewSessionRef.current;
      if (!sid) return;
      try {
        await sendAgentCommand(sid, { type: "set_model", provider, modelId });
      } catch (e) {
        console.error("Failed to set model:", e);
      }
      return;
    }
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, { type: "set_model", provider, modelId });
      setCurrentModelOverride({ provider, modelId });
    } catch (e) {
      console.error("Failed to set model:", e);
    }
  }, [isNew, setNewSessionModel]);

  const handleOpenAIFastToggle = useCallback(async () => {
    if (agentRunningRef.current) {
      addNotice({ type: "warning", message: "Wait for the current response to finish before changing Fast mode." });
      return;
    }

    const sid = sessionIdRef.current ?? await ensureNewSession();
    if (!sid) {
      addNotice({ type: "error", message: "No active session for OpenAI Fast mode." });
      return;
    }

    try {
      const result = await sendAgentCommand<OpenAIFastToggleResponse>(sid, { type: "toggle_openai_fast" });
      applyExtensionUiFromState(result as AgentStateResponse);
      if (result?.openAIFastConfig) setOpenAIFastConfig(result.openAIFastConfig);
      if (result?.openAIFastMode) setOpenAIFastModeState(result.openAIFastMode);
    } catch (e) {
      addNotice({ type: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, [addNotice, applyExtensionUiFromState, ensureNewSession]);

  const handleCompact = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid || isCompacting) return;
    setIsCompacting(true);
    setCompactError(null);
    setCompactResult(null);
    try {
      const result = await sendAgentCommand<CompactCommandResult>(sid, { type: "compact" });
      setCompactResult(readCompactResult(result, "manual"));
      await loadSession(sid, true);
    } catch (e) {
      setCompactError(e instanceof Error ? e.message : String(e));
      setCompactResult(null);
    } finally {
      setIsCompacting(false);
    }
  }, [isCompacting, loadSession]);

  const loadModels = useCallback(async (signal?: AbortSignal) => {
    const modelCwd = newSessionCwd ?? session?.cwd ?? "";
    const modelsUrl = modelCwd ? `/api/models?cwd=${encodeURIComponent(modelCwd)}` : "/api/models";
    const res = await fetch(modelsUrl, signal ? { signal } : undefined);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json() as ModelsResponse;
    setModelNames(d.models);
    setModelThinkingLevels(d.thinkingLevels ?? {});
    setModelThinkingLevelMaps(d.thinkingLevelMaps ?? {});
    setOpenAIFastConfig(d.openAIFastConfig ?? DEFAULT_OPENAI_FAST_CONFIG);
    setOpenAIFastModeState(null);
    const nextModelList = d.modelList ?? [];
    setModelList(nextModelList);
    if (isNew) {
      const match = d.defaultModel
        ? nextModelList.find((m) => m.id === d.defaultModel?.modelId && m.provider === d.defaultModel?.provider)
        : undefined;
      const displayModel = match ?? nextModelList[0];
      setNewSessionDefaultModel(displayModel ? { provider: displayModel.provider, modelId: displayModel.id } : null);
      const defaultThinkingLevel = d.defaultThinkingLevel && THINKING_LEVEL_VALUES.has(d.defaultThinkingLevel)
        ? d.defaultThinkingLevel as ThinkingLevelOption
        : FALLBACK_THINKING_LEVEL;
      setNewSessionDefaultThinkingLevel(defaultThinkingLevel);
      if (!hasStoredThinkingLevel()) {
        setThinkingLevel(defaultThinkingLevel);
      }
    }
  }, [isNew, newSessionCwd, session?.cwd]);

  const handleBuiltinSlashCommand = useCallback(async (text: string): Promise<BuiltinSlashCommandResult> => {
    if (!text.startsWith("/")) return { handled: false };
    const match = text.match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/);
    if (!match) return { handled: false };

    const [, rawCommandName, rawArgs = ""] = match;
    const commandName = rawCommandName.toLowerCase();
    const args = rawArgs.trim();
    const knownBuiltin = isWebBuiltinSlashCommand(commandName)
      || slashCommands.some((command) => command.source === "builtin" && command.name.toLowerCase() === commandName);
    if (!knownBuiltin) return { handled: false };

    let didStartCompact = false;
    let sidPromise: Promise<string | null> | null = null;
    const getSid = () => {
      sidPromise ??= Promise.resolve(sessionIdRef.current ?? ensureNewSession());
      return sidPromise;
    };
    const emitUiAction = async (action: SlashUiAction) => {
      if (onSlashUiAction) await onSlashUiAction(action);
      else if (action.type === "openSessionStats") onSessionStatsPanelOpen?.();
    };
    const complete = (result: BuiltinSlashCommandResult): BuiltinSlashCommandResult => {
      if (!result.handled) return result;
      if (result.error) {
        addNotice({ type: "error", message: result.error });
      } else if (result.message) {
        addNotice({ type: "success", message: result.message });
      }
      return result;
    };

    try {
      switch (commandName) {
        case "compact": {
          const sid = await getSid();
          if (!sid || isCompacting) return complete({ handled: true, error: "No active session to compact" });
          didStartCompact = true;
          setIsCompacting(true);
          setCompactError(null);
          setCompactResult(null);
          const result = await sendAgentCommand<CompactCommandResult>(sid, {
            type: "compact",
            ...(args ? { customInstructions: args } : {}),
          });
          setCompactResult(readCompactResult(result, "manual"));
          if (await loadSession(sid, true)) promoteNewSession();
          return complete({ handled: true, message: "Compacted context" });
        }


        case "name": {
          const sid = await getSid();
          if (!sid) return complete({ handled: true, error: "No active session to name" });
          if (!args) return complete({ handled: true, error: "Usage: /name <name>" });
          await sendAgentCommand(sid, { type: "set_session_name", name: args });
          if (await loadSession(sid)) promoteNewSession();
          return complete({ handled: true, message: `Session renamed to ${args}` });
        }

        case "session": {
          const sid = await getSid();
          if (!sid) return complete({ handled: true, error: "No active session" });
          const stats = await sendAgentCommand<SessionStatsInfo>(sid, { type: "get_session_stats" });
          if (stats) setSessionStatsOverride(stats);
          await emitUiAction({ type: "openSessionStats" });
          return complete({ handled: true, action: "openSessionStats" });
        }

        case "copy": {
          const sid = await getSid();
          if (!sid) return complete({ handled: true, error: "No active session" });
          const data = await sendAgentCommand<LastAssistantTextResponse>(sid, { type: "get_last_assistant_text" });
          const textToCopy = data?.text ?? "";
          if (!textToCopy) return complete({ handled: true, error: "No assistant message to copy" });
          await navigator.clipboard.writeText(textToCopy);
          return complete({ handled: true, message: "Copied last assistant message" });
        }

        case "reload": {
          const sid = await getSid();
          if (!sid) return complete({ handled: true, error: "No active session to reload" });
          if (agentRunningRef.current) return complete({ handled: true, error: "Wait for the current response to finish before reloading." });
          if (isCompacting) return complete({ handled: true, error: "Wait for compaction to finish before reloading." });
          await sendAgentCommand(sid, { type: "reload" });
          await Promise.all([
            loadSession(sid, false, true),
            loadSlashCommands(),
            loadModels(),
          ]);
          return complete({ handled: true, message: "Reloaded session resources" });
        }

        case "export": {
          const sid = sessionIdRef.current;
          if (!sid) return complete({ handled: true, error: "No active session to export" });
          if (!args) {
            window.location.href = `/api/sessions/${encodeURIComponent(sid)}/export`;
            return complete({ handled: true, action: "download" });
          }
          const outputPath = parsePathCommandArgument(args);
          if (!outputPath) return complete({ handled: true, error: "Usage: /export [path.html|path.jsonl]" });
          const result = await sendAgentCommand<{ filePath?: string }>(sid, { type: "export_session", outputPath });
          return complete({ handled: true, message: result?.filePath ? `Session exported to ${result.filePath}` : "Session exported" });
        }

        case "clone": {
          const sid = sessionIdRef.current;
          if (!sid) return complete({ handled: true, error: "No active session to clone" });
          const result = await sendAgentCommand<{ cancelled?: boolean; newSessionId?: string }>(sid, { type: "clone" });
          if (result?.cancelled) return complete({ handled: true, error: "Clone cancelled" });
          if (!result?.newSessionId) return complete({ handled: true, error: "Clone did not return a new session id" });
          onSessionForked?.(result.newSessionId);
          return complete({ handled: true, message: "Cloned to new session" });
        }

        case "model": {
          if (!args) {
            await emitUiAction({ type: "openModelsConfig", section: "models" });
            return complete({ handled: true, message: "Opened model settings" });
          }
          const match = findExactModelMatch(args, modelList);
          if (match.status === "ambiguous") {
            return complete({ handled: true, error: `Ambiguous model reference: ${args}. Use provider/model.` });
          }
          if (match.status === "not-found") {
            return complete({ handled: true, error: `Model not found: ${args}` });
          }
          await handleModelChange(match.model.provider, match.model.id);
          return complete({ handled: true, message: `Model: ${match.model.name || match.model.id}` });
        }

        case "tree":
          await emitUiAction({ type: "openBranchNavigator" });
          return complete({ handled: true });

        case "fork":
          await emitUiAction({ type: "openForkSelector" });
          return complete({ handled: true });
        case "new":
          await emitUiAction({ type: "newSession" });
          return complete({ handled: true });

        case "trust":
          await emitUiAction({ type: "openProjectTrust" });
          return complete({ handled: true });
        case "resume":
          await emitUiAction({ type: "openSessionSidebar" });
          return complete({ handled: true, message: "Opened session list" });

        case "settings":
          await emitUiAction({ type: "openSettings" });
          return complete({ handled: true, message: "Opened settings" });

        case "scoped-models":
          await emitUiAction({ type: "openModelsConfig", section: "scoped" });
          return complete({ handled: true, message: "Opened model settings" });

        case "login":
          await emitUiAction({ type: "openModelsConfig", section: "auth" });
          return complete({ handled: true, message: args ? `Opened auth settings for ${args}` : "Opened auth settings" });

        case "logout":
          await emitUiAction({ type: "openModelsConfig", section: "auth" });
          return complete({ handled: true, message: args ? `Opened auth settings for ${args}` : "Opened auth settings" });

        case "hotkeys":
          await emitUiAction({ type: "openHotkeys" });
          return complete({ handled: true });
        default: {
          const command = getWebBuiltinSlashCommand(commandName);
          return complete({
            handled: true,
            error: command?.mode === "unsupported"
              ? getUnsupportedBuiltinMessage(commandName)
              : `/${commandName} is not supported in pi-web yet.`,
          });
        }
      }
    } catch (e) {
      return complete({ handled: true, error: e instanceof Error ? e.message : String(e) });
    } finally {
      if (didStartCompact) setIsCompacting(false);
    }
  }, [addNotice, ensureNewSession, handleModelChange, isCompacting, loadModels, loadSession, loadSlashCommands, modelList, onSessionForked, onSessionStatsPanelOpen, onSlashUiAction, promoteNewSession, slashCommands]);

  // Queued (undelivered) messages live in the queue panel only; the chat gets
  // the real user message when pi delivers it (user message_end event). An
  // optimistic chat bubble here would duplicate the queue panel and turn into
  // a ghost message if the queue is recalled.
  const handleSteer = useCallback(async (message: string, images?: AttachedImage[]) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    const piImages = images?.map((img) => ({ type: "image" as const, data: img.data, mimeType: img.mimeType }));
    try {
      await sendAgentCommand(sid, {
        type: "steer",
        message,
        ...(piImages?.length ? { images: piImages } : {}),
      });
    } catch (e) {
      console.error("Failed to steer:", e);
    }
  }, []);

  const handlePromptWithStreamingBehavior = useCallback(async (
    message: string,
    behavior: "steer" | "followUp",
    images?: AttachedImage[],
  ) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    const piImages = images?.map((img) => ({ type: "image" as const, data: img.data, mimeType: img.mimeType }));
    try {
      await sendAgentCommand(sid, {
        type: "prompt",
        message,
        streamingBehavior: behavior,
        ...(piImages?.length ? { images: piImages } : {}),
      });
    } catch (e) {
      console.error("Failed to queue prompt:", e);
    }
  }, []);

  const handleFollowUp = useCallback(async (message: string, images?: AttachedImage[]) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    const piImages = images?.map((img) => ({ type: "image" as const, data: img.data, mimeType: img.mimeType }));
    try {
      await sendAgentCommand(sid, {
        type: "follow_up",
        message,
        ...(piImages?.length ? { images: piImages } : {}),
      });
    } catch (e) {
      console.error("Failed to follow up:", e);
    }
  }, []);

  const handleAbortCompaction = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, { type: "abort_compaction" });
    } catch (e) {
      console.error("Failed to abort compaction:", e);
    }
  }, []);

  const handleRecallQueue = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      const result = await sendAgentCommand<{ steering?: string[]; followUp?: string[] }>(sid, { type: "clear_queue" });
      // clearQueue also emits an empty queue_update, but that only reaches us
      // while SSE is connected — clear locally so idle recalls update the UI.
      setQueuedMessages({ steering: [], followUp: [] });
      const texts = [...(result?.steering ?? []), ...(result?.followUp ?? [])];
      if (texts.length > 0) {
        opts.chatInputRef?.current?.prependText(texts.join("\n\n"));
      }
    } catch (e) {
      console.error("Failed to recall queued messages:", e);
      addNotice({ type: "error", message: "Failed to recall queued messages" });
    }
  }, [opts.chatInputRef, addNotice]);

  const handleThinkingLevelChange = useCallback(async (level: ThinkingLevelOption) => {
    if (isNew && !sessionIdRef.current) newSessionThinkingOverrideRef.current = true;
    setThinkingLevel(level);
    writeLocalStorageValue(THINKING_LEVEL_STORAGE_KEY, level);
    const sid = sessionIdRef.current ?? await ensuringNewSessionRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, { type: "set_thinking_level", level });
    } catch (e) {
      console.error("Failed to set thinking level:", e);
    }
  }, [isNew]);
  const handleProfileChange = useCallback(async (profileRef: AgentProfileRef) => {
    const previous = activeProfileRef;
    const previousNewSessionModel = newSessionModel;
    setNewSessionModel(null);
    let sid = sessionIdRef.current;
    if (!sid && ensuringNewSessionRef.current) {
      try {
        sid = await ensuringNewSessionRef.current;
      } catch {
        sid = null;
      }
    }
    if (!sid) {
      setProfileError(null);
      setProfileMissing(false);
      if (isNew) newSessionProfileOverrideRef.current = true;
      setActiveProfileRef(profileRef);
      return;
    }
    try {
      const result = await sendAgentCommand<{ profileRef?: AgentProfileRef; profileName?: string }>(sid, { type: "set_profile", profileRef });
      const appliedRef = result?.profileRef ?? profileRef;
      setProfileError(null);
      setProfileMissing(false);
      if (isNew) newSessionProfileOverrideRef.current = true;
      setActiveProfileRef(appliedRef);
      await loadSession(sid, false, true);
    } catch (e) {
      setNewSessionModel(previousNewSessionModel);
      setActiveProfileRef(previous);
      console.error("Failed to switch profile:", e);
      addNotice({ type: "error", message: e instanceof Error ? e.message : "Failed to switch profile" });
    }
  }, [activeProfileRef, addNotice, isNew, loadSession, newSessionModel]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    ignoreProgrammaticScrollUntilRef.current = Date.now() + PROGRAMMATIC_SCROLL_IGNORE_MS;
    messagesEndRef.current?.scrollIntoView({ behavior });
  }, []);

  const scrollUserMsgToTop = useCallback(() => {
    const container = scrollContainerRef.current;
    const el = lastUserMsgRef.current;
    if (!container || !el) return;
    const elAbsTop = el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
    ignoreProgrammaticScrollUntilRef.current = Date.now() + PROGRAMMATIC_SCROLL_IGNORE_MS;
    container.scrollTo({ top: elAbsTop - 16, behavior: "smooth" });
  }, []);

  const markUserScrollIntent = useCallback((event: Event) => {
    if (event instanceof KeyboardEvent) {
      if (!SCROLL_KEYS.has(event.key)) return;
      if (event.target instanceof Element && event.target.closest("input, textarea, [contenteditable='true']")) return;
    }
    userScrollIntentUntilRef.current = Date.now() + USER_SCROLL_INTENT_MS;
  }, []);

  const handleScrollPositionChange = useCallback(() => {
    if (!agentRunningRef.current) return;
    if (Date.now() < ignoreProgrammaticScrollUntilRef.current) return;
    if (Date.now() > userScrollIntentUntilRef.current) return;
    completionScrollAllowedRef.current = false;
  }, []);

  // Load session on mount
  useEffect(() => {
    if (session) {
      sessionIdRef.current = session.id;
      loadSession(session.id, true, true).then((agentState) => {
        if (agentState?.running) {
          if (agentState.state?.isStreaming || agentState.state?.isPromptRunning) {
            agentRunningRef.current = true;
            setAgentRunning(true);
            setAgentPhase(agentState.state.isStreaming ? { kind: "waiting_model" } : { kind: "running_command" });
            dispatch({ type: "start" });
            void connectEvents(session.id);
            if (!agentState.state.isStreaming && agentState.state.isPromptRunning) {
              void waitForPromptSettlement(session.id);
            }
          }
        }
        if (agentState?.state) {
          if (agentState.state.isCompacting !== undefined) setIsCompacting(agentState.state.isCompacting);
          applyContextUsageFromState(agentState.state);
          applyOpenAIFastFromState(agentState.state);
          applyExtensionUiFromState(agentState.state);
          if (agentState.state.systemPrompt !== undefined) setSystemPrompt(agentState.state.systemPrompt ?? null);
          if (agentState.state.thinkingLevel !== undefined) setThinkingLevel((agentState.state.thinkingLevel as ThinkingLevelOption) ?? "auto");
          if (agentState.state.queuedMessages !== undefined) setQueuedMessages(normalizeQueuedMessages(agentState.state.queuedMessages));
        }
      });
    }
    return () => {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      if (pendingLiveContextUsageRefreshTimerRef.current) {
        clearTimeout(pendingLiveContextUsageRefreshTimerRef.current);
        pendingLiveContextUsageRefreshTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    onSystemPromptChange?.(systemPrompt);
  }, [systemPrompt, onSystemPromptChange]);

  useEffect(() => {
    if (!onBranchDataChange) return;
    onBranchDataChange(data?.tree ?? [], activeLeafId, handleLeafChange);
  }, [data?.tree, activeLeafId, handleLeafChange, onBranchDataChange]);

  useEffect(() => {
    window.addEventListener("keydown", markUserScrollIntent);
    window.addEventListener("pointerdown", markUserScrollIntent, { passive: true });
    return () => {
      window.removeEventListener("keydown", markUserScrollIntent);
      window.removeEventListener("pointerdown", markUserScrollIntent);
    };
  }, [markUserScrollIntent]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    container.addEventListener("wheel", markUserScrollIntent, { passive: true });
    container.addEventListener("touchstart", markUserScrollIntent, { passive: true });
    container.addEventListener("scroll", handleScrollPositionChange, { passive: true });
    return () => {
      container.removeEventListener("wheel", markUserScrollIntent);
      container.removeEventListener("touchstart", markUserScrollIntent);
      container.removeEventListener("scroll", handleScrollPositionChange);
    };
  }, [messages.length, loading, handleScrollPositionChange, markUserScrollIntent]);

  useEffect(() => {
    if (messages.length > 0) {
      if (pendingScrollToUserRef.current) {
        pendingScrollToUserRef.current = false;
        initialScrollDoneRef.current = true;
        scrollUserMsgToTop();
      } else if (!initialScrollDoneRef.current) {
        initialScrollDoneRef.current = true;
        scrollToBottom("instant");
      } else if (!agentRunningRef.current && completionScrollAllowedRef.current) {
        scrollToBottom("smooth");
      }
    }
  }, [messages.length, agentRunning, scrollToBottom, scrollUserMsgToTop]);

  // Load model list
  useEffect(() => {
    const controller = new AbortController();
    loadModels(controller.signal).catch((e) => {
      if (e instanceof DOMException && e.name === "AbortError") return;
    });
    return () => controller.abort();
  }, [loadModels, modelsRefreshKey]);

  // Compact error auto-dismiss
  useEffect(() => {
    if (!compactError) return;
    const t = setTimeout(() => setCompactError(null), 3000);
    return () => clearTimeout(t);
  }, [compactError]);

  useEffect(() => {
    if (!compactResult) return;
    const t = setTimeout(() => setCompactResult(null), 6000);
    return () => clearTimeout(t);
  }, [compactResult]);

  useEffect(() => {
    if (noticeState.visible.length === 0) return;
    const exiting = noticeState.visible.find((notice) => notice.exiting);
    if (exiting) {
      const t = setTimeout(() => {
        dispatchNotice({ type: "remove", id: exiting.id });
      }, NOTICE_EXIT_ANIMATION_MS);
      return () => clearTimeout(t);
    }
    const oldest = noticeState.visible[0];
    if (!oldest) return;
    const t = setTimeout(() => {
      dispatchNotice({ type: "mark_oldest_exiting" });
    }, NOTICE_VISIBLE_MS);
    return () => clearTimeout(t);
  }, [noticeState.visible]);

  useEffect(() => {
    setSessionStatsOverride(null);
  }, [messages.length, contextUsage?.tokens, contextUsage?.percent, contextUsage?.contextWindow]);

  return {
    // State
    data, loading, error, activeLeafId, messages, entryIds, streamState,
    agentRunning, modelNames, modelList, modelThinkingLevels, modelThinkingLevelMaps, newSessionModel, thinkingLevel, profilesResponse, profileOptions, activeProfileRef, activeProfile, profileSwitchSupported, profileError, profileMissing,
    retryInfo, contextUsage, systemPrompt, forkingEntryId,
    isCompacting, compactError, compactResult, currentModel, displayModel, openAIFastMode, sessionStats,
    slashCommands, slashCommandsLoading, queuedMessages,
    notices: noticeState.visible, extensionDialog, extensionCustomUi, extensionStatuses, extensionWidgets, extensionChrome, extensionCompatibility, extensionAutocompleteProviders, respondToExtensionUi, sendExtensionCustomInput, sendExtensionCustomResize, sendEditorSnapshot, requestExtensionAutocomplete,
    isAutoModelSelection: isNew && newSessionModel === null,
    agentPhase,
    isNew,
    // Refs
    sessionIdRef, eventSourceRef, messagesEndRef, scrollContainerRef,
    lastUserMsgRef, pendingScrollToUserRef, initialScrollDoneRef,
    // Actions
    handleSend, handleAbort, handleFork, handleNavigate, handleModelChange,
    handleCompact, handleSteer, handleFollowUp, handlePromptWithStreamingBehavior, handleAbortCompaction,
    handleRecallQueue,
    handleBuiltinSlashCommand, handleOpenAIFastToggle,
    handleProfileChange, handleThinkingLevelChange, loadSlashCommands, loadForkCandidates, setActiveLeafId, setData, setMessages,
    dispatch, setAgentRunning, setForkingEntryId,
    // Subscriptions
    handleAgentEventRef,
  };
}
