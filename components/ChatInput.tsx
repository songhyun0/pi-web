// biome-ignore-all lint/performance/noImgElement: composer previews use runtime blob/data URLs.
"use client";

import React, { forwardRef, type KeyboardEvent, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { BuiltinSlashCommandResult, CompactResultInfo, ExtensionAutocompleteResult, QueuedMessages, SlashCommandInfo } from "@/hooks/useAgentSession";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useViewportTier } from "@/hooks/useViewportTier";
import { type ChatDraftImage, clearDraft, getDraft, setDraft } from "@/lib/draft-store";
import {
  type AtQueryMatch,
  buildAtInsertText,
  buildEntriesFromFiles,
  extractAtQuery,
  type FileIndexEntry,
  filterFileEntries,
} from "@/lib/file-fuzzy";
import { readSafeAreaInsetPx } from "@/lib/safe-area";
import { IMPLEMENTED_WEB_BUILTIN_SLASH_COMMANDS } from "@/lib/slash-command-registry";
import { buildWebKeybindings, eventMatchesWebAction, type WebKeybinding } from "@/lib/web-keybindings";
import styles from "./ChatInput.module.css";
import { FolderIcon, getFileIcon } from "./FileIcons";
import { deriveOpenAIFastControlState, OpenAIFastCompactControl } from "./OpenAIFastCompactControl";
import { Button, Dialog, Select } from "./ui";

export interface AttachedImage {
  data: string;   // base64, no prefix
  mimeType: string;
  previewUrl: string; // object URL for display
}

interface ModelOption {
  provider: string;
  modelId: string;
  name: string;
}

interface Props {
  onSend: (message: string, images?: AttachedImage[]) => void;
  onAbort: () => void;
  onSteer?: (message: string, images?: AttachedImage[]) => void;
  onFollowUp?: (message: string, images?: AttachedImage[]) => void;
  onPromptWithStreamingBehavior?: (message: string, behavior: "steer" | "followUp", images?: AttachedImage[]) => void;
  isStreaming: boolean;
  model?: { provider: string; modelId: string } | null;
  isAutoModelSelection?: boolean;
  modelNames?: Record<string, string>;
  modelList?: { id: string; name: string; provider: string }[];
  onModelChange?: (provider: string, modelId: string) => void;
  showOpenAIFastToggle?: boolean;
  openAIFastEligible?: boolean;
  openAIFastModeActive?: boolean;
  onOpenAIFastToggle?: () => void | Promise<void>;
  onCompact?: () => void;
  onAbortCompaction?: () => void;
  isCompacting?: boolean;
  compactError?: string | null;
  compactResult?: CompactResultInfo | null;
  profileSelector?: React.ReactNode;
  thinkingLevel?: "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  onThinkingLevelChange?: (level: "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max") => void;
  availableThinkingLevels?: string[] | null;
  thinkingLevelMap?: Record<string, string | null> | null;
  retryInfo?: { attempt: number; maxAttempts: number; errorMessage?: string } | null;
  queuedMessages?: QueuedMessages | null;
  onRecallQueue?: () => void;
  slashCommands?: SlashCommandInfo[];
  slashCommandsLoading?: boolean;
  onLoadSlashCommands?: () => Promise<SlashCommandInfo[]> | SlashCommandInfo[];
  onBuiltinCommand?: (message: string) => Promise<BuiltinSlashCommandResult>;
  soundEnabled?: boolean;
  onSoundToggle?: () => void;
  onAudioUnlock?: () => void;
  draftKey?: string;
  /** Session working directory — enables the @ file autocomplete menu */
  cwd?: string | null;
  extensionAutocompleteProviderCount?: number;
  onEditorSnapshot?: (text: string) => void;
  onExtensionAutocomplete?: (text: string, cursor: number) => Promise<ExtensionAutocompleteResult>;
}
export interface ChatInputHandle {
  focus: () => void;
  insertText: (text: string) => void;
  setText: (text: string) => void;
  insertIfEmpty: (text: string) => void;
  prependText: (text: string) => void;
  addImages: (files: File[]) => void;
}

const COMPOSITION_END_ENTER_GRACE_MS = 100;
const AUTOCOMPLETE_MENU_GAP_PX = 8;
const AUTOCOMPLETE_MENU_MAX_HEIGHT_PX = 460;
const AUTOCOMPLETE_MENU_MIN_HEIGHT_PX = 96;
const MOBILE_AUTOCOMPLETE_TOP_GUARD_PX = 60; // 52px compact top bar + breathing room
const DESKTOP_AUTOCOMPLETE_TOP_GUARD_PX = 8;
const MODEL_OPTION_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function compareModelOptions(a: ModelOption, b: ModelOption): number {
  return MODEL_OPTION_COLLATOR.compare(a.name || a.modelId, b.name || b.modelId)
    || MODEL_OPTION_COLLATOR.compare(a.provider, b.provider)
    || MODEL_OPTION_COLLATOR.compare(a.modelId, b.modelId);
}

const THINKING_LEVELS = ["auto", "off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
const THINKING_LEVEL_DESC: Record<typeof THINKING_LEVELS[number], string> = {
  auto: "Use pi default",
  off: "Reasoning off",
  minimal: "Minimal reasoning",
  low: "Low reasoning",
  medium: "Medium reasoning",
  high: "High reasoning",
  xhigh: "Extra-high reasoning",
  max: "Max reasoning",
};

function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return tokens.toLocaleString();
}

type SlashCommandPaletteItem = SlashCommandInfo;

type SlashCommandSource = SlashCommandPaletteItem["source"];

const SLASH_SOURCES: SlashCommandSource[] = ["builtin", "extension", "prompt", "skill"];

const SLASH_SOURCE_GROUP_LABEL: Record<SlashCommandSource, string> = {
  builtin: "Built-in",
  extension: "Extensions",
  prompt: "Prompts",
  skill: "Skills",
};

const SLASH_SOURCE_ORDER: Record<SlashCommandSource, number> = {
  builtin: 0,
  extension: 1,
  prompt: 2,
  skill: 3,
};

function slashMatchRank(command: SlashCommandPaletteItem, query: string): number {
  const name = command.name.toLowerCase();
  const description = command.description?.toLowerCase() ?? "";
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  if (name.includes(query)) return 2;
  if (description.includes(query)) return 3;
  return 4;
}
function computeAutocompleteMenuMaxHeight(anchor: HTMLElement | null, isMobile: boolean): number {
  if (typeof window === "undefined" || !anchor) return AUTOCOMPLETE_MENU_MAX_HEIGHT_PX;

  const rect = anchor.getBoundingClientRect();
  const visualViewport = window.visualViewport;
  const viewportTop = visualViewport?.offsetTop ?? 0;
  const viewportHeight = visualViewport?.height ?? window.innerHeight;
  const safeTop = readSafeAreaInsetPx("top");
  const topGuard = viewportTop + (isMobile ? safeTop + MOBILE_AUTOCOMPLETE_TOP_GUARD_PX : DESKTOP_AUTOCOMPLETE_TOP_GUARD_PX);
  const availableAbove = rect.top - topGuard - AUTOCOMPLETE_MENU_GAP_PX;
  const viewportCap = viewportHeight * (isMobile ? 0.62 : 0.56);
  const measuredMax = Math.min(AUTOCOMPLETE_MENU_MAX_HEIGHT_PX, viewportCap, availableAbove);

  return Math.max(AUTOCOMPLETE_MENU_MIN_HEIGHT_PX, Math.floor(Number.isFinite(measuredMax) ? measuredMax : AUTOCOMPLETE_MENU_MAX_HEIGHT_PX));
}

function imageToDraftImage(image: AttachedImage): ChatDraftImage {
  return { data: image.data, mimeType: image.mimeType };
}

function draftImageToAttachedImage(image: ChatDraftImage): AttachedImage {
  return {
    ...image,
    previewUrl: `data:${image.mimeType};base64,${image.data}`,
  };
}

function revokeImagePreview(image: AttachedImage): void {
  if (image.previewUrl.startsWith("blob:")) {
    URL.revokeObjectURL(image.previewUrl);
  }
}

function QueuedMessageRow({ kind, text }: { kind: "steer" | "follow-up"; text: string }) {
  return (
    <div className={styles.queueRow} title={text}>
      <span className={styles.queueKind} data-kind={kind}>{kind}</span>
      <span className={styles.queueText}>{text}</span>
    </div>
  );
}

export const ChatInput = forwardRef<ChatInputHandle, Props>(function ChatInput({
  onSend, onAbort, onSteer, onFollowUp, isStreaming, model, isAutoModelSelection, modelNames, modelList, onModelChange,
  showOpenAIFastToggle, openAIFastEligible, openAIFastModeActive, onOpenAIFastToggle,
  onCompact, onAbortCompaction, isCompacting, compactError, compactResult, profileSelector,
  thinkingLevel, onThinkingLevelChange, availableThinkingLevels, thinkingLevelMap,
  retryInfo, queuedMessages, onRecallQueue,
  slashCommands, slashCommandsLoading, onLoadSlashCommands,
  onBuiltinCommand,
  soundEnabled, onSoundToggle, onAudioUnlock,
  onPromptWithStreamingBehavior,
  draftKey,
  cwd,
  extensionAutocompleteProviderCount = 0,
  onEditorSnapshot,
  onExtensionAutocomplete,
}: Props, ref) {
  const isMobile = useIsMobile();
  const usesCompactControls = useViewportTier() !== "desktop";
  const [value, setValue] = useState(() => (draftKey ? getDraft(draftKey)?.value ?? "" : ""));
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [modelDropdownRect, setModelDropdownRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const [fastToggleBusy, setFastToggleBusy] = useState(false);
  const [thinkingDropdownOpen, setThinkingDropdownOpen] = useState(false);
  const [controlsMenuOpen, setControlsMenuOpen] = useState(false);
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>(() => (
    draftKey ? getDraft(draftKey)?.images.map(draftImageToAttachedImage) ?? [] : []
  ));
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  const [atQuery, setAtQuery] = useState<AtQueryMatch | null>(null);
  const [atMenuOpen, setAtMenuOpen] = useState(false);
  const [atActiveIndex, setAtActiveIndex] = useState(0);
  const [fileIndex, setFileIndex] = useState<{ cwd: string; entries: FileIndexEntry[]; truncated: boolean } | null>(null);
  const [fileIndexLoading, setFileIndexLoading] = useState(false);
  const [atServerResult, setAtServerResult] = useState<{ cwd: string; query: string; matches: FileIndexEntry[] } | null>(null);
  const [autocompleteMenuMaxHeight, setAutocompleteMenuMaxHeight] = useState(AUTOCOMPLETE_MENU_MAX_HEIGHT_PX);
  const [webKeybindings, setWebKeybindings] = useState<WebKeybinding[]>(() => buildWebKeybindings());
  const [promptEditorOpen, setPromptEditorOpen] = useState(false);
  const [promptEditorValue, setPromptEditorValue] = useState("");
  const [extensionAutocomplete, setExtensionAutocomplete] = useState<ExtensionAutocompleteResult>(null);
  const [extensionAutocompleteOpen, setExtensionAutocompleteOpen] = useState(false);
  const [extensionAutocompleteActiveIndex, setExtensionAutocompleteActiveIndex] = useState(0);
  const [cursorPosition, setCursorPosition] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const promptEditorRef = useRef<HTMLTextAreaElement>(null);
  const autocompleteAnchorRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const modelDropdownPanelRef = useRef<HTMLDivElement>(null);
  const thinkingDropdownRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isComposingRef = useRef(false);
  const lastCompositionEndAtRef = useRef(0);
  const slashCommandsRequestedRef = useRef(false);
  const slashItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const atItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const extensionAutocompleteItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const fileIndexMetaRef = useRef<{ cwd: string; fetchedAt: number } | null>(null);
  const fileIndexFetchingRef = useRef<string | null>(null);
  const draftKeyRef = useRef(draftKey);
  const valueRef = useRef(value);
  const attachedImagesRef = useRef(attachedImages);
  valueRef.current = value;
  attachedImagesRef.current = attachedImages;

  useEffect(() => {
    let cancelled = false;
    fetch("/api/keybindings", { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json() as { keybindings?: WebKeybinding[] };
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return body.keybindings ?? buildWebKeybindings();
      })
      .then((bindings) => { if (!cancelled) setWebKeybindings(bindings); })
      .catch(() => { if (!cancelled) setWebKeybindings(buildWebKeybindings()); });
    return () => { cancelled = true; };
  }, []);

  useImperativeHandle(ref, () => ({
    focus() {
      textareaRef.current?.focus({ preventScroll: true });
    },
    insertIfEmpty(text: string) {
      const ta = textareaRef.current;
      const current = ta ? ta.value : value;
      if (current.trim()) return;
      setValue(text);
      setAtQuery(null);
      requestAnimationFrame(() => {
        if (!ta) return;
        ta.focus();
        ta.style.height = "auto";
        ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
      });
    },
    prependText(text: string) {
      if (!text.trim()) return;
      const ta = textareaRef.current;
      const current = ta ? ta.value : value;
      // Mirrors the TUI's queue restore: queued text first, then whatever
      // the user already typed, separated by a blank line.
      const combined = [text, current].filter((t) => t.trim()).join("\n\n");
      setValue(combined);
      setAtQuery(null);
      requestAnimationFrame(() => {
        if (!ta) return;
        ta.focus();
        ta.setSelectionRange(combined.length, combined.length);
        ta.style.height = "auto";
        ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
      });
    },
    insertText(text: string) {
      const ta = textareaRef.current;
      if (!ta) {
        setValue((v) => v + (v ? " " : "") + text);
        return;
      }
      const start = ta.selectionStart ?? ta.value.length;
      const end = ta.selectionEnd ?? ta.value.length;
      const before = ta.value.slice(0, start);
      const after = ta.value.slice(end);
      const sep = before.length > 0 && !before.endsWith(" ") ? " " : "";
      const newVal = before + sep + text + after;
      setValue(newVal);
      setAtQuery(null);
      requestAnimationFrame(() => {
        if (!ta) return;
        const pos = start + sep.length + text.length;
        ta.setSelectionRange(pos, pos);
        ta.focus();
        ta.style.height = "auto";
        ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
      });
    },
    setText(text: string) {
      const ta = textareaRef.current;
      setValue(text);
      setAtQuery(null);
      setExtensionAutocomplete(null);
      setExtensionAutocompleteOpen(false);
      requestAnimationFrame(() => {
        if (!ta) return;
        ta.focus();
        ta.setSelectionRange(text.length, text.length);
        ta.style.height = "auto";
        ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
      });
    },
    addImages(files: File[]) {
      processImageFiles(files);
    },
  }));

  const processImageFiles = useCallback(async (files: File[]) => {
    if (isStreaming) return;
    const imageFiles = files.filter((f) => f.type.startsWith("image/"));
    if (!imageFiles.length) return;
    const newImages = await Promise.all(
      imageFiles.map(
        (file) =>
          new Promise<AttachedImage>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              const result = reader.result as string;
              // result is "data:<mime>;base64,<data>"
              const base64 = result.split(",")[1];
              resolve({ data: base64, mimeType: file.type, previewUrl: URL.createObjectURL(file) });
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
          })
      )
    );
    setAttachedImages((prev) => [...prev, ...newImages]);
  }, [isStreaming]);

  const removeImage = useCallback((index: number) => {
    setAttachedImages((prev) => {
      const next = [...prev];
      const [removed] = next.splice(index, 1);
      if (removed) revokeImagePreview(removed);
      return next;
    });
  }, []);

  const clearImages = useCallback(() => {
    setAttachedImages((prev) => {
      prev.forEach(revokeImagePreview);
      return [];
    });
  }, []);

  const clearInput = useCallback(() => {
    setValue("");
    setAtQuery(null);
    if (draftKey) clearDraft(draftKey);
    if (draftKeyRef.current && draftKeyRef.current !== draftKey) clearDraft(draftKeyRef.current);
    clearImages();
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [clearImages, draftKey]);

  const openPromptEditor = useCallback(() => {
    setPromptEditorValue(valueRef.current);
    setPromptEditorOpen(true);
  }, []);

  const savePromptEditor = useCallback(() => {
    setValue(promptEditorValue);
    setAtQuery(null);
    setPromptEditorOpen(false);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      ta.style.height = "auto";
      ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
    });
  }, [promptEditorValue]);

  useEffect(() => {
    if (!draftKey || draftKeyRef.current !== draftKey) return;
    setDraft(draftKey, {
      value,
      images: attachedImages.map(imageToDraftImage),
    });
  }, [attachedImages, draftKey, value]);

  useEffect(() => {
    const previousDraftKey = draftKeyRef.current;
    if (previousDraftKey === draftKey) return;

    if (previousDraftKey) {
      setDraft(previousDraftKey, {
        value: valueRef.current,
        images: attachedImagesRef.current.map(imageToDraftImage),
      });
    }

    const draft = draftKey ? getDraft(draftKey) : null;
    draftKeyRef.current = draftKey;
    setValue(draft?.value ?? "");
    setAtQuery(null);
    setAttachedImages((prev) => {
      prev.forEach(revokeImagePreview);
      return draft?.images.map(draftImageToAttachedImage) ?? [];
    });
  }, [draftKey]);

  useEffect(() => {
    onEditorSnapshot?.(value);
  }, [onEditorSnapshot, value]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    if (value) ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, [value]);

  useEffect(() => {
    return () => {
      attachedImagesRef.current.forEach(revokeImagePreview);
    };
  }, []);

  const handleSend = useCallback(async () => {
    const msg = value.trim();
    if (!msg && !attachedImages.length) return;
    if (isStreaming) return;
    onAudioUnlock?.();
    if (!attachedImages.length && msg.startsWith("/") && onBuiltinCommand) {
      const result = await onBuiltinCommand(msg);
      if (result.handled) {
        if (!result.error) clearInput();
        return;
      }
    }
    onSend(msg, attachedImages.length ? attachedImages : undefined);
    clearInput();
  }, [value, attachedImages, isStreaming, onBuiltinCommand, onSend, clearInput, onAudioUnlock]);
  const handleOpenAIFastClick = useCallback(async () => {
    if (isStreaming || fastToggleBusy || !onOpenAIFastToggle || openAIFastEligible === false) return;
    onAudioUnlock?.();
    setFastToggleBusy(true);
    try {
      await onOpenAIFastToggle();
    } finally {
      setFastToggleBusy(false);
    }
  }, [fastToggleBusy, isStreaming, onAudioUnlock, onOpenAIFastToggle, openAIFastEligible]);

  const slashQuery = value.startsWith("/") && !/\s/.test(value.slice(1))
    ? value.slice(1).toLowerCase()
    : null;

  const filteredSlashCommands = (() => {
    if (slashQuery === null) return [];
    const seen = new Set<string>();
    const commands = [...(isStreaming ? [] : IMPLEMENTED_WEB_BUILTIN_SLASH_COMMANDS), ...(slashCommands ?? [])]
      .filter((command) => {
        const key = `${command.source}:${command.name}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    return [...commands]
      .filter((command) => {
        const name = command.name.toLowerCase();
        const description = command.description?.toLowerCase() ?? "";
        return name.includes(slashQuery) || description.includes(slashQuery);
      })
      .sort((a, b) => {
        const rankDelta = slashMatchRank(a, slashQuery) - slashMatchRank(b, slashQuery);
        if (rankDelta !== 0) return rankDelta;
        return SLASH_SOURCE_ORDER[a.source] - SLASH_SOURCE_ORDER[b.source]
          || MODEL_OPTION_COLLATOR.compare(a.name, b.name);
      });
  })();

  const groupedSlashCommands = (() => {
    const groups = new Map<SlashCommandSource, { source: SlashCommandSource; items: { command: SlashCommandPaletteItem; index: number }[] }>();
    for (const source of SLASH_SOURCES) {
      groups.set(source, { source, items: [] });
    }
    filteredSlashCommands.forEach((command, index) => {
      groups.get(command.source)?.items.push({ command, index });
    });
    return SLASH_SOURCES
      .map((source) => groups.get(source))
      .filter((group): group is { source: SlashCommandSource; items: { command: SlashCommandPaletteItem; index: number }[] } => Boolean(group && group.items.length > 0));
  })();

  const slashCommandCountLabel = filteredSlashCommands.length === 1
    ? (slashQuery ? "1 match" : "1 command")
    : `${filteredSlashCommands.length} ${slashQuery ? "matches" : "commands"}`;
  const hasInputText = Boolean(value.trim());
  const canQueueStreamingMessage = hasInputText && attachedImages.length === 0;

  // ── @ file autocomplete ──────────────────────────────────────────────────
  // Recomputed from the text before the caret on every change/caret move.
  // Disabled entirely when there is no cwd (new session without a directory).
  const updateAtQuery = useCallback((text: string, cursor: number | null) => {
    if (!cwd) {
      setAtQuery(null);
      return;
    }
    const pos = cursor ?? text.length;
    setAtQuery(extractAtQuery(text.slice(0, pos)));
  }, [cwd]);

  const atQueryText = atQuery?.query ?? null;
  const atLocalMatches: FileIndexEntry[] = React.useMemo(() => (
    atQueryText !== null && fileIndex && fileIndex.cwd === cwd
      ? filterFileEntries(fileIndex.entries, atQueryText)
      : []
  ), [atQueryText, fileIndex, cwd]);

  // When the client index is truncated (repo larger than the index cap),
  // local filtering cannot see deep files, so queries are also ranked
  // server-side against the full listing. Local matches render immediately
  // and are replaced when the (debounced) server result for the current
  // query arrives; stale responses are ignored via the query/cwd tag.
  const needsServerSearch = Boolean(atQueryText && fileIndex?.truncated && fileIndex.cwd === cwd);
  useEffect(() => {
    if (!needsServerSearch || !cwd || !atQueryText) return;
    const fetchCwd = cwd;
    const query = atQueryText;
    const timer = setTimeout(() => {
      fetch(`/api/file-index?cwd=${encodeURIComponent(fetchCwd)}&q=${encodeURIComponent(query)}`)
        .then((res) => {
          if (!res.ok) throw new Error(`file search failed: ${res.status}`);
          return res.json() as Promise<{ matches?: FileIndexEntry[] }>;
        })
        .then((data) => setAtServerResult({ cwd: fetchCwd, query, matches: data.matches ?? [] }))
        .catch(() => {
          // Keep showing local matches; the next keystroke retries.
        });
    }, 150);
    return () => clearTimeout(timer);
  }, [needsServerSearch, atQueryText, cwd]);

  const serverResultInUse = needsServerSearch
    && atServerResult !== null
    && atServerResult.cwd === cwd
    && atServerResult.query === atQueryText;
  const atMatches: FileIndexEntry[] = serverResultInUse ? atServerResult.matches : atLocalMatches;

  // Open/reset the menu whenever the @token appears or changes (mirrors the
  // slash menu: Escape closes it, the next keystroke re-opens it).
  const atTokenKey = atQuery === null ? null : `${atQuery.start}:${atQuery.quoted ? 1 : 0}:${atQuery.query}`;
  useEffect(() => {
    if (atTokenKey === null) {
      setAtMenuOpen(false);
      setAtActiveIndex(0);
      return;
    }
    setAtMenuOpen(true);
    setAtActiveIndex(0);
  }, [atTokenKey]);

  // Fetch the file index when the menu opens. The server caches per cwd for
  // ~10s, so re-opening refreshes cheaply; while typing nothing refetches.
  const atTokenActive = atQuery !== null;
  useEffect(() => {
    if (!atTokenActive || !cwd) return;
    const meta = fileIndexMetaRef.current;
    if (meta && meta.cwd === cwd && Date.now() - meta.fetchedAt < 10_000) return;
    if (fileIndexFetchingRef.current === cwd) return;
    fileIndexFetchingRef.current = cwd;
    const fetchCwd = cwd;
    setFileIndexLoading(true);
    fetch(`/api/file-index?cwd=${encodeURIComponent(fetchCwd)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`file index failed: ${res.status}`);
        return res.json() as Promise<{ files?: string[]; truncated?: boolean }>;
      })
      .then((data) => {
        setFileIndex({ cwd: fetchCwd, entries: buildEntriesFromFiles(data.files ?? []), truncated: !!data.truncated });
        fileIndexMetaRef.current = { cwd: fetchCwd, fetchedAt: Date.now() };
      })
      .catch(() => {
        // Leave any previous index in place; next open retries.
        fileIndexMetaRef.current = null;
      })
      .finally(() => {
        fileIndexFetchingRef.current = null;
        setFileIndexLoading(false);
      });
  }, [atTokenActive, cwd]);

  const applyAtCompletion = useCallback((entry: FileIndexEntry) => {
    if (!atQuery) return;
    const ta = textareaRef.current;
    const cursor = ta?.selectionStart ?? value.length;
    const before = value.slice(0, atQuery.start);
    let after = value.slice(cursor);
    // Completing inside a quoted token (@"my dir/… with the caret before the
    // closing quote): the replacement carries its own closing quote, so drop
    // the old one right after the caret (mirrors the TUI's applyCompletion).
    if (atQuery.quoted && after.startsWith('"')) {
      after = after.slice(1);
    }
    const insert = buildAtInsertText(entry.path, entry.isDir, atQuery.quoted);
    const newValue = before + insert.text + after;
    const newPos = before.length + insert.cursorOffset;
    setValue(newValue);
    // setValue alone does not fire onChange — re-derive the token here. Files
    // end with a space (token closes, menu hides); directories end with "/"
    // before the caret (token stays open for drill-down into the directory).
    setAtQuery(extractAtQuery(newValue.slice(0, newPos)));
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(newPos, newPos);
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    });
  }, [atQuery, value]);

  useEffect(() => {
    if (atActiveIndex >= atMatches.length) {
      setAtActiveIndex(Math.max(0, atMatches.length - 1));
    }
  }, [atMatches.length, atActiveIndex]);

  useEffect(() => {
    atItemRefs.current.length = atMatches.length;
  }, [atMatches.length]);

  useEffect(() => {
    if (!atMenuOpen) return;
    atItemRefs.current[atActiveIndex]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [atActiveIndex, atMenuOpen]);

  useEffect(() => {
    if (extensionAutocompleteProviderCount === 0 || !onExtensionAutocomplete || slashMenuOpen || atMenuOpen) {
      setExtensionAutocompleteOpen(false);
      setExtensionAutocomplete(null);
      return;
    }
    const cursor = cursorPosition;
    const timer = setTimeout(() => {
      onExtensionAutocomplete(value, cursor).then((result) => {
        setExtensionAutocomplete(result);
        setExtensionAutocompleteActiveIndex(0);
        setExtensionAutocompleteOpen(Boolean(result?.items.length));
      }).catch(() => {
        setExtensionAutocomplete(null);
        setExtensionAutocompleteOpen(false);
      });
    }, 120);
    return () => clearTimeout(timer);
  }, [atMenuOpen, cursorPosition, extensionAutocompleteProviderCount, onExtensionAutocomplete, slashMenuOpen, value]);

  useEffect(() => {
    if ((extensionAutocompleteActiveIndex >= (extensionAutocomplete?.items.length ?? 0))) {
      setExtensionAutocompleteActiveIndex(Math.max(0, (extensionAutocomplete?.items.length ?? 1) - 1));
    }
  }, [extensionAutocomplete?.items.length, extensionAutocompleteActiveIndex]);

  useEffect(() => {
    extensionAutocompleteItemRefs.current.length = extensionAutocomplete?.items.length ?? 0;
  }, [extensionAutocomplete?.items.length]);

  useEffect(() => {
    if (!extensionAutocompleteOpen) return;
    extensionAutocompleteItemRefs.current[extensionAutocompleteActiveIndex]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [extensionAutocompleteActiveIndex, extensionAutocompleteOpen]);

  const applyExtensionAutocomplete = useCallback((index: number) => {
    const item = extensionAutocomplete?.items[index];
    if (!item) return;
    const ta = textareaRef.current;
    const cursor = ta?.selectionStart ?? value.length;
    const prefix = item.prefix ?? "";
    const replaceStart = prefix && value.slice(0, cursor).endsWith(prefix) ? cursor - prefix.length : cursor;
    const nextValue = value.slice(0, replaceStart) + item.value + value.slice(cursor);
    const nextPos = replaceStart + item.value.length;
    setValue(nextValue);
    setExtensionAutocomplete(null);
    setExtensionAutocompleteOpen(false);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(nextPos, nextPos);
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    });
  }, [extensionAutocomplete, value]);
  const applySlashCommand = useCallback((command: SlashCommandPaletteItem) => {
    const nextValue = `/${command.name} `;
    setValue(nextValue);
    setSlashMenuOpen(false);
    setSlashActiveIndex(0);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(nextValue.length, nextValue.length);
      ta.style.height = "auto";
      ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
    });
  }, []);

  const sendQueued = useCallback((mode: "steer" | "followup") => {
    const msg = value.trim();
    if (!msg && !attachedImages.length) return;
    if (attachedImages.length) return;
    onAudioUnlock?.();
    const streamingBehavior = mode === "steer" ? "steer" : "followUp";
    if (msg.startsWith("/") && onPromptWithStreamingBehavior) {
      onPromptWithStreamingBehavior(msg, streamingBehavior, attachedImages.length ? attachedImages : undefined);
      clearInput();
      return;
    }
    if (mode === "steer" && onSteer) {
      onSteer(msg, attachedImages.length ? attachedImages : undefined);
    } else if (mode === "followup" && onFollowUp) {
      onFollowUp(msg, attachedImages.length ? attachedImages : undefined);
    }
    clearInput();
  }, [value, attachedImages, onPromptWithStreamingBehavior, onSteer, onFollowUp, clearInput, onAudioUnlock]);

  const getNextSlashIndex = useCallback((direction: "up" | "down" | "left" | "right") => {
    const lastIndex = filteredSlashCommands.length - 1;
    if (lastIndex < 0) return 0;

    if (direction === "left") return Math.max(0, slashActiveIndex - 1);
    if (direction === "right") return Math.min(lastIndex, slashActiveIndex + 1);

    const currentNode = slashItemRefs.current[slashActiveIndex];
    if (!currentNode) {
      return direction === "down"
        ? Math.min(lastIndex, slashActiveIndex + 1)
        : Math.max(0, slashActiveIndex - 1);
    }

    const currentRect = currentNode.getBoundingClientRect();
    const currentX = currentRect.left + currentRect.width / 2;
    const currentY = currentRect.top + currentRect.height / 2;
    let bestIndex = -1;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let index = 0; index <= lastIndex; index += 1) {
      if (index === slashActiveIndex) continue;
      const node = slashItemRefs.current[index];
      if (!node) continue;
      const rect = node.getBoundingClientRect();
      const candidateY = rect.top + rect.height / 2;
      const verticalDelta = candidateY - currentY;
      if (direction === "down" ? verticalDelta <= 4 : verticalDelta >= -4) continue;

      const candidateX = rect.left + rect.width / 2;
      const score = Math.abs(verticalDelta) * 1000 + Math.abs(candidateX - currentX);
      if (score < bestScore) {
        bestIndex = index;
        bestScore = score;
      }
    }

    if (bestIndex >= 0) return bestIndex;
    return direction === "down"
      ? Math.min(lastIndex, slashActiveIndex + 1)
      : Math.max(0, slashActiveIndex - 1);
  }, [filteredSlashCommands.length, slashActiveIndex]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      const nativeEvent = e.nativeEvent;
      const recentlyComposed = Date.now() - lastCompositionEndAtRef.current < COMPOSITION_END_ENTER_GRACE_MS;
      const isComposing =
        isComposingRef.current ||
        nativeEvent.isComposing ||
        nativeEvent.keyCode === 229;

      if (e.key === "Enter" && !e.shiftKey && (isComposing || recentlyComposed)) {
        if (recentlyComposed) e.preventDefault();
        return;
      }

      if (!isComposing && eventMatchesWebAction(e.nativeEvent, webKeybindings, "chat.editor.external")) {
        e.preventDefault();
        openPromptEditor();
        return;
      }

      if (!isComposing && eventMatchesWebAction(e.nativeEvent, webKeybindings, "chat.queue.followUp")) {
        e.preventDefault();
        if (isStreaming && onFollowUp) sendQueued("followup");
        return;
      }

      if (slashMenuOpen && slashQuery !== null) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSlashActiveIndex(getNextSlashIndex("down"));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSlashActiveIndex(getNextSlashIndex("up"));
          return;
        }
        if (e.key === "ArrowRight") {
          e.preventDefault();
          setSlashActiveIndex(getNextSlashIndex("right"));
          return;
        }
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          setSlashActiveIndex(getNextSlashIndex("left"));
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setSlashMenuOpen(false);
          return;
        }
        if ((e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) && filteredSlashCommands[slashActiveIndex]) {
          e.preventDefault();
          applySlashCommand(filteredSlashCommands[slashActiveIndex]);
          return;
        }
      }

      // @ file menu — skip while composing so IME candidate navigation
      // (arrows/Enter/Tab) is never intercepted.
      if (atMenuOpen && atQuery !== null && !isComposing) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setAtActiveIndex((i) => Math.min(Math.max(0, atMatches.length - 1), i + 1));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setAtActiveIndex((i) => Math.max(0, i - 1));
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setAtMenuOpen(false);
          return;
        }
        if ((e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) && atMatches[atActiveIndex]) {
          e.preventDefault();
          applyAtCompletion(atMatches[atActiveIndex]);
          return;
        }
      }

      if (extensionAutocompleteOpen && extensionAutocomplete?.items.length && !isComposing) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setExtensionAutocompleteActiveIndex((i) => Math.min(extensionAutocomplete.items.length - 1, i + 1));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setExtensionAutocompleteActiveIndex((i) => Math.max(0, i - 1));
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setExtensionAutocompleteOpen(false);
          return;
        }
        if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
          e.preventDefault();
          applyExtensionAutocomplete(extensionAutocompleteActiveIndex);
          return;
        }
      }
      if (eventMatchesWebAction(e.nativeEvent, webKeybindings, "chat.submit")) {
        e.preventDefault();
        if (isStreaming && (onSteer || onFollowUp)) {
          // Default Enter sends as steer if available, else followup
          sendQueued(onSteer ? "steer" : "followup");
        } else {
          handleSend();
        }
      }
    },
    [isStreaming, onSteer, onFollowUp, slashMenuOpen, slashQuery, filteredSlashCommands, slashActiveIndex, applySlashCommand, sendQueued, handleSend, getNextSlashIndex, atMenuOpen, atQuery, atMatches, atActiveIndex, applyAtCompletion, extensionAutocompleteOpen, extensionAutocomplete, extensionAutocompleteActiveIndex, applyExtensionAutocomplete, webKeybindings, openPromptEditor]
  );

  const handleInput = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, []);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData?.items ?? []);
    const imageItems = items.filter((item) => item.type.startsWith("image/"));
    if (!imageItems.length) return;
    e.preventDefault();
    const files = imageItems.map((item) => item.getAsFile()).filter((f): f is File => f !== null);
    processImageFiles(files);
  }, [processImageFiles]);

  useEffect(() => {
    if (slashQuery === null) {
      setSlashMenuOpen(false);
      setSlashActiveIndex(0);
      slashCommandsRequestedRef.current = false;
      return;
    }
    setSlashMenuOpen(true);
    setSlashActiveIndex(0);
    if (!slashCommandsRequestedRef.current && onLoadSlashCommands) {
      slashCommandsRequestedRef.current = true;
      Promise.resolve(onLoadSlashCommands()).catch(() => {
        slashCommandsRequestedRef.current = false;
      });
    }
  }, [slashQuery, onLoadSlashCommands]);

  useEffect(() => {
    if (slashActiveIndex >= filteredSlashCommands.length) {
      setSlashActiveIndex(Math.max(0, filteredSlashCommands.length - 1));
    }
  }, [filteredSlashCommands.length, slashActiveIndex]);

  useEffect(() => {
    slashItemRefs.current.length = filteredSlashCommands.length;
  }, [filteredSlashCommands.length]);

  useEffect(() => {
    if (!slashMenuOpen) return;
    slashItemRefs.current[slashActiveIndex]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [slashActiveIndex, slashMenuOpen]);

  // Build model options: prefer modelList (has provider info), fallback to modelNames
  const modelOptions: ModelOption[] = (() => {
    if (modelList && modelList.length > 0) {
      return modelList.map((m) => ({ provider: m.provider, modelId: m.id, name: m.name })).sort(compareModelOptions);
    }
    return Object.entries(modelNames ?? {}).map(([modelId, name]) => ({
      provider: model?.provider ?? "unknown",
      modelId,
      name,
    })).sort(compareModelOptions);
  })();

  // Group options by provider, preserving insertion order
  const modelsByProvider: { provider: string; options: ModelOption[] }[] = [];
  for (const opt of modelOptions) {
    const group = modelsByProvider.find((g) => g.provider === opt.provider);
    if (group) group.options.push(opt);
    else modelsByProvider.push({ provider: opt.provider, options: [opt] });
  }

  const displayModelName = model
    ? (modelOptions.find((o) => o.modelId === model.modelId && o.provider === model.provider)?.name ?? model.modelId)
    : null;
  const currentName = displayModelName;

  const compactSavedTokens = compactResult
    ? Math.max(0, compactResult.tokensBefore - compactResult.estimatedTokensAfter)
    : 0;
  const compactVerb = compactResult?.reason && compactResult.reason !== "manual"
    ? `${compactResult.reason[0].toUpperCase()}${compactResult.reason.slice(1)} compacted`
    : "Compacted";
  const compactResultText = compactResult
    ? `${compactVerb} ${formatTokenCount(compactResult.tokensBefore)} -> ${formatTokenCount(compactResult.estimatedTokensAfter)} tokens (${formatTokenCount(compactSavedTokens)} saved)`
    : null;
  const thinkingDisplayLabel = (() => {
    const lvl = thinkingLevel ?? "auto";
    if (lvl === "auto" || !thinkingLevelMap) return lvl;
    return thinkingLevelMap[lvl] ?? lvl;
  })();
  const openAIFastControlState = deriveOpenAIFastControlState(openAIFastEligible, openAIFastModeActive);
  const { active: openAIFastActive, unavailable: openAIFastUnavailable } = openAIFastControlState;
  const openAIFastButtonDisabled = isStreaming || fastToggleBusy || !onOpenAIFastToggle || openAIFastUnavailable;
  const openAIFastLabel = openAIFastUnavailable ? "Fast N/A" : openAIFastActive ? "Fast" : "Normal";
  const openAIFastTitle = openAIFastUnavailable
    ? "OpenAI Fast mode is unavailable for the current model"
    : openAIFastActive
      ? "OpenAI Fast mode is active. Click to switch to normal mode."
      : "OpenAI Fast mode is normal. Click to enable Fast mode.";

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        modelDropdownPanelRef.current && !modelDropdownPanelRef.current.contains(e.target as Node)
      ) {
        setModelDropdownOpen(false);
      }
      if (thinkingDropdownRef.current && !thinkingDropdownRef.current.contains(e.target as Node)) {
        setThinkingDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: content changes intentionally remeasure anchored autocomplete height.
  useEffect(() => {
    if (!slashMenuOpen && !atMenuOpen) return;

    let frame = 0;
    const updateAutocompleteHeight = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setAutocompleteMenuMaxHeight(computeAutocompleteMenuMaxHeight(autocompleteAnchorRef.current, usesCompactControls));
      });
    };

    updateAutocompleteHeight();
    window.addEventListener("resize", updateAutocompleteHeight);
    window.visualViewport?.addEventListener("resize", updateAutocompleteHeight);
    window.visualViewport?.addEventListener("scroll", updateAutocompleteHeight);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", updateAutocompleteHeight);
      window.visualViewport?.removeEventListener("resize", updateAutocompleteHeight);
      window.visualViewport?.removeEventListener("scroll", updateAutocompleteHeight);
    };
  }, [slashMenuOpen, atMenuOpen, usesCompactControls, value, attachedImages.length, filteredSlashCommands.length, atMatches.length, slashCommandsLoading, fileIndexLoading]);

  useEffect(() => {
    if (!usesCompactControls) setControlsMenuOpen(false);
  }, [usesCompactControls]);

  const slashMenuMaxHeight = Math.min(AUTOCOMPLETE_MENU_MAX_HEIGHT_PX, autocompleteMenuMaxHeight);
  const atMenuMaxHeight = Math.min(400, autocompleteMenuMaxHeight);
  const quickProfileSelector = React.isValidElement<{
    quickControls?: boolean;
    onBeforeOpenManager?: () => void;
  }>(profileSelector)
    ? React.cloneElement(profileSelector, {
        quickControls: true,
        onBeforeOpenManager: () => setControlsMenuOpen(false),
      })
    : profileSelector;

  return (
    <div className={styles.root} data-minimap={!isMobile || undefined}>
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        disabled={isStreaming}
        className={styles.hiddenInput}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          processImageFiles(files);
          e.target.value = "";
        }}
      />
      <Dialog
        open={promptEditorOpen}
        onOpenChange={setPromptEditorOpen}
        title="Prompt editor"
        description="Browser-safe replacement for the CLI external editor shortcut."
        variant="adaptive"
        size="xl"
        initialFocusRef={promptEditorRef}
        footer={
          <>
            <Button size={usesCompactControls ? "touch" : "compact"} onClick={() => setPromptEditorOpen(false)}>Cancel</Button>
            <Button variant="primary" size={usesCompactControls ? "touch" : "compact"} onClick={savePromptEditor}>Use text</Button>
          </>
        }
      >
        <textarea
          ref={promptEditorRef}
          id="pi-web-prompt-editor"
          aria-label="Prompt text"
          className={styles.promptEditor}
          value={promptEditorValue}
          onChange={(event) => setPromptEditorValue(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              savePromptEditor();
            }
          }}
        />
      </Dialog>
      <div className={styles.inner}>
        {/* Queued steering / follow-up messages (delivered by pi on upcoming turns) */}
        {((queuedMessages?.steering.length ?? 0) + (queuedMessages?.followUp.length ?? 0)) > 0 && (
          <div className={styles.queuePanel}>
            <div className={styles.queueHeader}>
              <span className={styles.queueTitle}>Queued · {(queuedMessages?.steering.length ?? 0) + (queuedMessages?.followUp.length ?? 0)}</span>
              {onRecallQueue && (
                <Button
                  size={usesCompactControls ? "touch" : "compact"}
                  onClick={onRecallQueue}
                  title="Remove all queued messages and put them back into the input box for editing"
                >
                  Recall to input
                </Button>
              )}
            </div>
            {queuedMessages?.steering.map((text) => (
              <QueuedMessageRow key={`steer:${text}`} kind="steer" text={text} />
            ))}
            {queuedMessages?.followUp.map((text) => (
              <QueuedMessageRow key={`followup:${text}`} kind="follow-up" text={text} />
            ))}
          </div>
        )}
        {/* Retry banner */}
        {retryInfo && (
          <output className={styles.feedback} data-tone="warning">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></svg>
            <span>Retrying ({retryInfo.attempt}/{retryInfo.maxAttempts})…</span>
            {retryInfo.errorMessage && <span className={styles.feedbackDetail}>— {retryInfo.errorMessage}</span>}
          </output>
        )}
        {compactResultText && (
          <output className={styles.feedback} data-tone="success">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>
            <span>{compactResultText}</span>
          </output>
        )}
        {/* Image previews */}
        {attachedImages.length > 0 && (
          <div className={styles.attachments}>
            {attachedImages.map((image, index) => (
              <div key={image.previewUrl} className={styles.attachment}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image.previewUrl} alt="Attached preview" className={styles.attachmentImage} />
                <button type="button" className={styles.attachmentRemove} onClick={() => removeImage(index)} aria-label={`Remove attachment ${index + 1}`}>
                  <svg viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><line x1="1" y1="1" x2="7" y2="7" /><line x1="7" y1="1" x2="1" y2="7" /></svg>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Main input and run controls share one floating surface. */}
        <div className={styles.composerSurface}>
          <div ref={autocompleteAnchorRef} className={styles.anchor}>
          {slashMenuOpen && slashQuery !== null && (
            <div
              id="composer-slash-menu"
              className={styles.menu}
              style={{ "--composer-menu-height": `${slashMenuMaxHeight}px` } as React.CSSProperties}
              role="listbox"
              aria-label="Slash commands"
            >
              <div className={styles.menuHeader}>
                <span>{slashCommandsLoading ? "Loading commands…" : `Slash commands · ${slashCommandCountLabel}`}</span>
                <span className={styles.menuHint}>Tab / Enter</span>
              </div>
              <div className={styles.menuBody}>
                {!slashCommandsLoading && filteredSlashCommands.length === 0 ? (
                  <div className={styles.menuEmpty}>No slash commands found</div>
                ) : (
                  groupedSlashCommands.map((group) => (
                    <section key={group.source} className={styles.menuGroup}>
                      <div className={styles.menuGroupHeader}>
                        <span>{SLASH_SOURCE_GROUP_LABEL[group.source]}</span>
                        <span className={styles.menuHint}>{group.items.length}</span>
                      </div>
                      <div className={styles.commandGrid}>
                        {group.items.map(({ command, index }) => {
                          const active = index === slashActiveIndex;
                          return (
                            <button
                              id={`slash-option-${index}`}
                              key={`${command.source}:${command.name}`}
                              ref={(node) => { slashItemRefs.current[index] = node; }}
                              type="button"
                              role="option"
                              aria-selected={active}
                              className={styles.commandItem}
                              data-active={active || undefined}
                              onMouseDown={(event) => {
                                event.preventDefault();
                                applySlashCommand(command);
                              }}
                              onMouseEnter={() => setSlashActiveIndex(index)}
                            >
                              <span className={styles.commandName}>/{command.name}</span>
                              {command.description && <span className={styles.commandDescription}>{command.description}</span>}
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  ))
                )}
              </div>
            </div>
          )}
          {atMenuOpen && atQuery !== null && (() => {
            const indexLoading = fileIndexLoading && (!fileIndex || fileIndex.cwd !== cwd);
            const matchCountLabel = atMatches.length === 1 ? "1 match" : `${atMatches.length} matches`;
            // With a truncated index, local results are provisional — the
            // debounced server search over the full listing replaces them.
            const truncatedHint = fileIndex?.truncated && !serverResultInUse
              ? (atQuery.query ? " · searching all files…" : " · index truncated")
              : "";
            return (
              <div
                id="composer-file-menu"
                className={styles.menu}
                style={{ "--composer-menu-height": `${atMenuMaxHeight}px` } as React.CSSProperties}
                role="listbox"
                aria-label="Project files"
              >
                <div className={styles.menuHeader}>
                  <span>{indexLoading ? "Loading files…" : `Files · ${matchCountLabel}${truncatedHint}`}</span>
                  <span className={styles.menuHint}>Tab / Enter</span>
                </div>
                <div className={styles.menuBody}>
                  {!indexLoading && atMatches.length === 0 ? (
                    <div className={styles.menuEmpty}>{needsServerSearch && !serverResultInUse ? "Searching…" : "No matching files"}</div>
                  ) : (
                    atMatches.map((entry, index) => {
                      const active = index === atActiveIndex;
                      const name = entry.path.split("/").pop() ?? entry.path;
                      const dirPrefix = entry.path.slice(0, entry.path.length - name.length);
                      return (
                        <button
                          id={`file-option-${index}`}
                          key={`${entry.isDir ? "d" : "f"}:${entry.path}`}
                          ref={(node) => { atItemRefs.current[index] = node; }}
                          type="button"
                          role="option"
                          aria-selected={active}
                          className={styles.menuItem}
                          data-active={active || undefined}
                          onMouseDown={(event) => {
                            event.preventDefault();
                            applyAtCompletion(entry);
                          }}
                          onMouseEnter={() => setAtActiveIndex(index)}
                        >
                          <span className={styles.menuItemIcon}>{entry.isDir ? <FolderIcon size={14} /> : getFileIcon(name, 14)}</span>
                          <span className={styles.menuItemPath}>
                            {dirPrefix && <em>{dirPrefix}</em>}
                            {name}
                            {entry.isDir && <em>/</em>}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })()}
          {extensionAutocompleteOpen && extensionAutocomplete?.items.length ? (
            <div
              id="composer-extension-menu"
              className={styles.menu}
              style={{ "--composer-menu-height": `${atMenuMaxHeight}px` } as React.CSSProperties}
              role="listbox"
              aria-label={extensionAutocomplete.label ? `Extension autocomplete: ${extensionAutocomplete.label}` : "Extension autocomplete"}
            >
              <div className={styles.menuHeader}>
                <span>{extensionAutocomplete.label ? `Extension autocomplete · ${extensionAutocomplete.label}` : "Extension autocomplete"}</span>
                <span className={styles.menuHint}>Tab / Enter</span>
              </div>
              <div className={styles.menuBody}>
                {extensionAutocomplete.items.map((item, index) => {
                  const active = index === extensionAutocompleteActiveIndex;
                  return (
                    <button
                      id={`extension-option-${index}`}
                      key={item.id}
                      ref={(node) => { extensionAutocompleteItemRefs.current[index] = node; }}
                      type="button"
                      role="option"
                      aria-selected={active}
                      className={styles.menuItem}
                      data-active={active || undefined}
                      data-stacked={Boolean(item.description) || undefined}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        applyExtensionAutocomplete(index);
                      }}
                      onMouseEnter={() => setExtensionAutocompleteActiveIndex(index)}
                    >
                      <span className={styles.menuItemPath}>{item.label || item.value}</span>
                      {item.description && <span className={styles.menuItemDescription}>{item.description}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
          <div className={styles.composer} data-streaming={isStreaming || undefined}>
            <textarea
              ref={textareaRef}
              className={styles.editor}
              aria-label="Message"
              aria-autocomplete="list"
              aria-controls={slashMenuOpen ? "composer-slash-menu" : atMenuOpen ? "composer-file-menu" : extensionAutocompleteOpen ? "composer-extension-menu" : undefined}
              aria-activedescendant={
                slashMenuOpen ? `slash-option-${slashActiveIndex}`
                  : atMenuOpen ? `file-option-${atActiveIndex}`
                    : extensionAutocompleteOpen ? `extension-option-${extensionAutocompleteActiveIndex}`
                      : undefined
              }
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                setCursorPosition(event.target.selectionStart);
                updateAtQuery(event.target.value, event.target.selectionStart);
              }}
              onSelect={(event) => {
                const element = event.currentTarget;
                setCursorPosition(element.selectionStart);
                updateAtQuery(element.value, element.selectionStart);
              }}
              onKeyDown={handleKeyDown}
              onCompositionStart={() => { isComposingRef.current = true; }}
              onCompositionEnd={(event) => {
                isComposingRef.current = false;
                lastCompositionEndAtRef.current = Date.now();
                const element = event.currentTarget;
                setCursorPosition(element.selectionStart);
                updateAtQuery(element.value, element.selectionStart);
              }}
              onInput={handleInput}
              onPaste={handlePaste}
              placeholder={
                isStreaming && (onSteer || onFollowUp)
                  ? "Steer now or queue a follow-up…"
                  : isStreaming ? "Agent is running…"
                    : "Message… Type / for commands, @ for files"
              }
              rows={1}
            />
            <div className={styles.inputActions}>
              {isStreaming ? (
                <>
                  {onSteer && (
                    <button
                      type="button"
                      className={styles.steerButton}
                      aria-label="Steer current run"
                      onClick={() => sendQueued("steer")}
                      disabled={!canQueueStreamingMessage}
                      title={attachedImages.length ? "Image attachments cannot be queued while the agent is running" : "Interrupt the current run and inject this message now"}
                    >
                      <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 1 9 5 5 9" /><line x1="1" y1="5" x2="9" y2="5" /></svg>
                      <span>Steer</span>
                    </button>
                  )}
                  {onFollowUp && (
                    <button
                      type="button"
                      className={styles.followButton}
                      aria-label="Queue follow-up"
                      onClick={() => sendQueued("followup")}
                      disabled={!canQueueStreamingMessage}
                      title={attachedImages.length ? "Image attachments cannot be queued while the agent is running" : "Queue this message after the agent finishes"}
                    >
                      <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="5" y1="1" x2="5" y2="6" /><polyline points="2.5 3.5 5 1 7.5 3.5" /><line x1="2" y1="9" x2="8" y2="9" /></svg>
                      <span>Follow-up</span>
                    </button>
                  )}
                </>
              ) : (
                <button type="button" className={styles.sendButton} onClick={handleSend} disabled={!value.trim() && !attachedImages.length} aria-label="Send message">
                  <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="2" y1="7" x2="11" y2="7" /><polyline points="7.5 3 12 7 7.5 11" /></svg>
                  <span>Send</span>
                </button>
              )}
            </div>
          </div>
        </div>

        <div className={styles.toolbar}>
          <div className={styles.toolbarLeft}>
            <button
              type="button"
              className={styles.control}
              data-icon-only="true"
              data-active={attachedImages.length > 0 || undefined}
              onClick={() => fileInputRef.current?.click()}
              disabled={isStreaming}
              aria-label="Attach image"
              title="Attach image"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
            </button>

            {modelOptions.length > 0 && currentName && onModelChange && (
              <div ref={dropdownRef} className={styles.modelWrap}>
                <button
                  type="button"
                  className={styles.modelTrigger}
                  data-open={modelDropdownOpen || undefined}
                  onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    setModelDropdownRect({ top: rect.top, left: rect.left, width: rect.width });
                    setModelDropdownOpen((open) => !open);
                  }}
                  disabled={isStreaming}
                  aria-haspopup="listbox"
                  aria-expanded={modelDropdownOpen}
                  title={`Current model: ${currentName}`}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" /><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3" /></svg>
                  <span className={styles.modelName}>{currentName}</span>
                </button>
                {modelDropdownOpen && modelDropdownRect && (() => {
                  const visualViewport = window.visualViewport;
                  const viewportTop = visualViewport?.offsetTop ?? 0;
                  const viewportHeight = visualViewport?.height ?? window.innerHeight;
                  const topGuard = viewportTop + (usesCompactControls ? readSafeAreaInsetPx("top") + MOBILE_AUTOCOMPLETE_TOP_GUARD_PX : DESKTOP_AUTOCOMPLETE_TOP_GUARD_PX);
                  const bottom = viewportHeight - modelDropdownRect.top + 6;
                  const maxHeight = Math.max(120, Math.min(modelDropdownRect.top - topGuard - 6, viewportHeight * 0.6));
                  const position = usesCompactControls
                    ? { left: 8, right: 8 }
                    : { left: modelDropdownRect.left, width: "max-content", minWidth: modelDropdownRect.width };
                  return (
                    <div
                      ref={modelDropdownPanelRef}
                      className={styles.modelPanel}
                      style={{ bottom, maxHeight, ...position }}
                      role="listbox"
                      aria-label="Models"
                    >
                      {modelsByProvider.map((group) => (
                        <div key={group.provider} className={styles.modelGroup}>
                          {modelsByProvider.length > 1 && <div className={styles.modelGroupLabel}>{group.provider}</div>}
                          {group.options.map((option) => {
                            const active = option.modelId === model?.modelId && option.provider === model?.provider;
                            return (
                              <button
                                key={`${option.provider}:${option.modelId}`}
                                type="button"
                                role="option"
                                aria-selected={active}
                                className={styles.modelOption}
                                data-active={active || undefined}
                                onClick={() => {
                                  setModelDropdownOpen(false);
                                  if (!active || isAutoModelSelection) onModelChange(option.provider, option.modelId);
                                }}
                              >
                                <span className={styles.modelCheck}>{active ? "✓" : ""}</span>
                                {option.name}
                              </button>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>

          <div className={styles.toolbarRight}>
            {!usesCompactControls && (
              <div className={styles.desktopControls}>
                {showOpenAIFastToggle && (
                  <button
                    type="button"
                    className={styles.control}
                    data-active={openAIFastActive || undefined}
                    onClick={handleOpenAIFastClick}
                    disabled={openAIFastButtonDisabled}
                    title={openAIFastTitle}
                    aria-label="Toggle OpenAI Fast mode"
                    aria-pressed={openAIFastActive}
                  >
                    {openAIFastActive && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>}
                    <span>{openAIFastLabel}</span>
                  </button>
                )}
                {!isStreaming && onThinkingLevelChange && (
                  <div ref={thinkingDropdownRef} className={styles.reasoningWrap}>
                    <button
                      type="button"
                      className={styles.control}
                      data-open={thinkingDropdownOpen || undefined}
                      onClick={() => setThinkingDropdownOpen((open) => !open)}
                      title={`Change reasoning level: ${thinkingDisplayLabel}`}
                      aria-haspopup="listbox"
                      aria-expanded={thinkingDropdownOpen}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9.5 2A5.5 5.5 0 0 0 4 7.5c0 1.7.78 3.21 2 4.21V14a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1v-2.29c1.22-1 2-2.51 2-4.21A5.5 5.5 0 0 0 9.5 2z" /><line x1="7" y1="18" x2="12" y2="18" /><line x1="8" y1="21" x2="11" y2="21" /></svg>
                      <span>{thinkingDisplayLabel}</span>
                    </button>
                    {thinkingDropdownOpen && (
                      <div className={styles.reasoningMenu} role="listbox" aria-label="Reasoning levels">
                        {THINKING_LEVELS.filter((level) => level === "auto" || !availableThinkingLevels || availableThinkingLevels.includes(level)).map((level) => {
                          const active = (thinkingLevel ?? "auto") === level;
                          const mappedValue = level !== "auto" && thinkingLevelMap ? thinkingLevelMap[level] : undefined;
                          const label = mappedValue != null && mappedValue !== level ? mappedValue : level;
                          return (
                            <button
                              key={level}
                              type="button"
                              role="option"
                              aria-selected={active}
                              className={styles.reasoningOption}
                              data-active={active || undefined}
                              onClick={() => { setThinkingDropdownOpen(false); if (!active) onThinkingLevelChange(level); }}
                            >
                              <span className={styles.modelCheck}>{active ? "✓" : ""}</span>
                              <span>{label}{mappedValue != null && mappedValue !== level && <span className={styles.reasoningOriginal}>({level})</span>}</span>
                              <span className={styles.reasoningDescription}>{THINKING_LEVEL_DESC[level]}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
                {!isStreaming && profileSelector && <div className={styles.profileControl}>{profileSelector}</div>}
                <button type="button" className={styles.control} onClick={openPromptEditor} title="Open prompt editor">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 3h7v7" /><path d="M10 21H3v-7" /><path d="M21 3l-8 8" /><path d="M3 21l8-8" /></svg>
                  <span>Editor</span>
                </button>
                {!isStreaming && onCompact && (
                  <div className={styles.compactWrap}>
                    {compactError && <div className={styles.compactError} role="alert">{compactError}</div>}
                    <button
                      type="button"
                      className={styles.control}
                      data-danger={isCompacting || undefined}
                      onClick={isCompacting ? onAbortCompaction : onCompact}
                      title={isCompacting ? "Stop compaction" : "Compact context"}
                    >
                      {isCompacting ? <svg viewBox="0 0 10 10" fill="none" aria-hidden="true"><rect x="2" y="2" width="6" height="6" rx="1" fill="currentColor" /></svg> : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" /><line x1="10" y1="14" x2="3" y2="21" /><line x1="21" y1="3" x2="14" y2="10" /></svg>}
                      <span>{isCompacting ? "Compacting…" : "Compact"}</span>
                    </button>
                  </div>
                )}
                {onSoundToggle !== undefined && (
                  <button type="button" className={styles.control} data-icon-only="true" data-active={soundEnabled || undefined} onClick={onSoundToggle} title={soundEnabled ? "Disable completion sound" : "Enable completion sound"} aria-label={soundEnabled ? "Disable completion sound" : "Enable completion sound"}>
                    {soundEnabled ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" /></svg> : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" /></svg>}
                  </button>
                )}
              </div>
            )}

            {isStreaming && (
              <button type="button" className={styles.control} data-danger="true" onClick={onAbort} title="Stop agent">
                <svg viewBox="0 0 10 10" fill="none" aria-hidden="true"><rect x="1.5" y="1.5" width="7" height="7" rx="1.5" fill="currentColor" /></svg>
                <span>Stop</span>
              </button>
            )}

            {usesCompactControls && (
              <button
                type="button"
                className={styles.control}
                onClick={() => { setModelDropdownOpen(false); setControlsMenuOpen(true); }}
                aria-haspopup="dialog"
                aria-expanded={controlsMenuOpen}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="5" cy="12" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /><circle cx="19" cy="12" r="1" fill="currentColor" /></svg>
                <span>Options</span>
              </button>
            )}
          </div>
          </div>
        </div>

        <Dialog
          open={usesCompactControls && controlsMenuOpen}
          onOpenChange={setControlsMenuOpen}
          title="Run controls"
          description="Reasoning, profile, compaction, and completion settings."
          variant="sheet"
          size="md"
          className={styles.controlsDialog}
          bodyClassName={styles.controlsDialogBody}
        >
          <div className={styles.controlsSheet}>
            {onThinkingLevelChange && (
              <section className={`${styles.controlsSection} ${styles.reasoningSection}`}>
                <div className={styles.controlsRow}>
                  <span className={styles.controlsLabel}>Reasoning effort</span>
                  <Select
                    className={styles.reasoningSelect}
                    value={thinkingLevel ?? "auto"}
                    disabled={isStreaming}
                    aria-label="Reasoning effort"
                    onChange={(event) => onThinkingLevelChange(event.target.value as NonNullable<Props["thinkingLevel"]>)}
                  >
                    {THINKING_LEVELS
                      .filter((level) => level === "auto" || !availableThinkingLevels || availableThinkingLevels.includes(level))
                      .map((level) => {
                        const mappedValue = level !== "auto" && thinkingLevelMap ? thinkingLevelMap[level] : undefined;
                        const label = mappedValue != null && mappedValue !== level ? mappedValue : THINKING_LEVEL_DESC[level];
                        return <option key={level} value={level}>{label}</option>;
                      })}
                  </Select>
                </div>
              </section>
            )}
            {profileSelector && (
              <section className={`${styles.controlsSection} ${styles.profileSection}`}>
                <div className={styles.controlsRow}>
                  <span className={styles.controlsLabel}>Capability profile</span>
                  <div className={styles.profileControl}>{quickProfileSelector}</div>
                </div>
              </section>
            )}
            <section className={`${styles.controlsSection} ${styles.executionSection}`}>
              <h3 className={styles.controlsTitle}>Execution</h3>
              {compactError && <div className={styles.feedback} data-tone="danger" role="alert">{compactError}</div>}
              <div className={styles.controlsActions}>
                <button
                  type="button"
                  className={styles.control}
                  data-kind="action"
                  onClick={() => { setControlsMenuOpen(false); openPromptEditor(); }}
                >
                  <span className={styles.executionLabel}>Prompt editor</span>
                  <svg className={styles.actionIcon} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 3 5 5-5 5" /></svg>
                </button>
                {showOpenAIFastToggle && (
                  <OpenAIFastCompactControl
                    state={openAIFastControlState}
                    disabled={openAIFastButtonDisabled}
                    onToggle={handleOpenAIFastClick}
                    classNames={{
                      control: styles.control,
                      executionLabel: styles.executionLabel,
                      toggleState: styles.toggleState,
                    }}
                  />
                )}
                {onCompact && !isStreaming && (
                  <button
                    type="button"
                    className={styles.control}
                    data-kind="action"
                    data-danger={isCompacting || undefined}
                    onClick={isCompacting ? onAbortCompaction : onCompact}
                  >
                    <span className={styles.executionLabel}>{isCompacting ? "Stop compaction" : "Compact context"}</span>
                    <span className={styles.actionState}>{isCompacting ? "Stop" : "Run"}</span>
                  </button>
                )}
                {onSoundToggle !== undefined && (
                  <button
                    type="button"
                    className={styles.control}
                    data-kind="toggle"
                    data-active={soundEnabled || undefined}
                    onClick={onSoundToggle}
                    aria-label={`Completion sound — ${soundEnabled ? "On" : "Off"}`}
                    aria-pressed={soundEnabled}
                  >
                    <span className={styles.executionLabel}>Completion sound</span>
                    <span className={styles.toggleState} data-checked={soundEnabled || undefined} aria-hidden="true" />
                  </button>
                )}
              </div>
            </section>
          </div>
        </Dialog>
      </div>
    </div>
  );
});
