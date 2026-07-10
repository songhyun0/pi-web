import { createAgentSessionFromServices, createAgentSessionServices, estimateTokens, getAgentDir, SessionManager, type CreateAgentSessionServicesOptions } from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, realpathSync, renameSync, unlinkSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { cloneJson } from "./profiles";
import { cacheSessionPath } from "./session-reader";
import { loadPiBuiltinSlashCommands } from "./pi-builtin-slash-commands";
import { ExtensionUiBridge } from "./extension-ui-bridge";
import type { SlashCommandInfo } from "./slash-command-registry";
import type { AgentSessionLike, BashCommandResult, ToolInfo } from "./pi-types";
import type { ExtensionUiRequest, ExtensionUiResponse } from "./types";
import { getPiCodexFastModeState, loadPiCodexFastModeConfig, PI_CODEX_FAST_COMMAND_NAME, PI_CODEX_FAST_PACKAGE_NAME } from "./pi-codex-fast";
import { getProjectTrustStatus } from "./project-trust-core";
import { applyProfileToolPolicy, createProfileScopedRuntimeOptions, getProfileRuntimeToolMetadata, resolveProfileSnapshotToolsFromRuntime, validateProfileRuntimeAgainstSnapshot, type RuntimeToolMetadata } from "./profile-runtime";
import {
  getSessionProfileSnapshot,
  restoreSessionProfileSnapshot,
  setSessionProfileSnapshot,
  type CapabilitySnapshotV1,
} from "./session-profile-store";

// ============================================================================
// Types
// ============================================================================

export interface AgentEvent {
  type: string;
  [key: string]: unknown;
}

type EventListener = (event: AgentEvent) => void;


type ExtensionCommandContextActionsLike = {
  waitForIdle: () => Promise<void>;
  newSession: () => Promise<{ cancelled: boolean }>;
  fork: () => Promise<{ cancelled: boolean }>;
  navigateTree: (targetId: string, options?: { summarize?: boolean }) => Promise<{ cancelled: boolean }>;
  switchSession: () => Promise<{ cancelled: boolean }>;
  reload: () => Promise<void>;
};

type ExtensionBindingOptions = {
  forceEmptySystemPrompt?: boolean;
};

export interface StartRpcSessionRuntimeOptions {
  profileSnapshot?: CapabilitySnapshotV1;
  agentDir?: string;
  settingsManager?: CreateAgentSessionServicesOptions["settingsManager"];
  resourceLoaderOptions?: CreateAgentSessionServicesOptions["resourceLoaderOptions"];
  resourceLoaderReloadOptions?: CreateAgentSessionServicesOptions["resourceLoaderReloadOptions"];
  autoStart?: boolean;
  isolateSessionFile?: boolean;
  resolveProfileTools?: boolean;
}

const CODING_TOOL_NAMES = ["read", "bash", "edit", "write", "grep", "find", "ls"];

function withExtensionTools(session: AgentSessionLike, toolNames: string[]): string[] {
  if (toolNames.length === 0) return [];

  const codingToolNames = new Set(CODING_TOOL_NAMES);
  const extensionToolNames = session
    .getAllTools()
    .map((t) => t.name)
    .filter((name) => !codingToolNames.has(name));

  return [...new Set([...toolNames, ...extensionToolNames])];
}

function extractUserMessageText(content: unknown): string {
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

// ============================================================================
// AgentSessionWrapper
// Wraps AgentSession with the same interface the rest of the app expects
// ============================================================================

export class AgentSessionWrapper {
  public readonly inner: AgentSessionLike;
  private profileSnapshot?: CapabilitySnapshotV1;
  private readonly agentDir: string;
  private listeners: EventListener[] = [];
  private readonly extensionUi: ExtensionUiBridge;
  private promptRunning = false;
  private extensionsBound = false;
  private extensionBindingPromise: Promise<void> | null = null;
  private extensionBindingError: unknown = null;
  private forceEmptySystemPrompt = false;
  private unsubscribe: (() => void) | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private onDestroyCallback: (() => void) | null = null;
  private _alive = true;
  private isolatedSessionFile: { originalPath: string; temporaryPath: string; initialBytes: Buffer; mode: "copy" | "move" } | null = null;
  private shutdownPromise: Promise<void> | null = null;
  private profileToolGuardSuspended = false;
  private fatalProfilePolicyError: Error | null = null;
  private profileToolPolicyDeferred: boolean;

  constructor(
    inner: AgentSessionLike,
    profileSnapshot?: CapabilitySnapshotV1,
    agentDir = getAgentDir(),
    isolatedSessionFile?: { originalPath: string; temporaryPath: string; initialBytes: Buffer; mode: "copy" | "move" },
    deferProfileToolPolicy = false,
  ) {
    this.inner = inner;
    this.profileSnapshot = profileSnapshot;
    this.agentDir = agentDir;
    this.isolatedSessionFile = isolatedSessionFile ?? null;
    this.profileToolPolicyDeferred = Boolean(profileSnapshot && deferProfileToolPolicy);
    this.extensionUi = new ExtensionUiBridge({ emit: (event) => this.emit(event as AgentEvent) });
    if (this.profileSnapshot && !this.profileToolPolicyDeferred) this.installProfileToolMutationGuards();
  }

  get sessionId(): string {
    return this.inner.sessionId;
  }

  stageSessionFileForPublication(): string {
    if (this.isolatedSessionFile) {
      if (this.isolatedSessionFile.mode === "move") return this.isolatedSessionFile.originalPath;
      throw new Error("Session file is already isolated.");
    }
    const originalPath = this.sessionFile;
    if (!originalPath) throw new Error("Profile-backed sessions require a durable session file before publication.");
    const temporaryPath = `${originalPath}.profile-pending-${process.pid}-${randomUUID()}`;
    const initialBytes = existsSync(originalPath) ? readFileSync(originalPath) : Buffer.alloc(0);
    if (existsSync(originalPath)) renameSync(originalPath, temporaryPath);
    (this.inner.sessionManager as unknown as { sessionFile?: string }).sessionFile = temporaryPath;
    this.isolatedSessionFile = { originalPath, temporaryPath, initialBytes, mode: "move" };
    return originalPath;
  }

  promoteIsolatedSessionFile(): void {
    const isolation = this.isolatedSessionFile;
    if (!isolation) return;
    if (isolation.mode === "copy") {
      const currentBytes = readFileSync(isolation.temporaryPath);
      if (!currentBytes.equals(isolation.initialBytes)) {
        throw new Error("Candidate extensions mutated isolated session state before profile commit.");
      }
    }
    if (isolation.mode === "move") renameSync(isolation.temporaryPath, isolation.originalPath);
    else unlinkSync(isolation.temporaryPath);
    (this.inner.sessionManager as unknown as { sessionFile?: string }).sessionFile = isolation.originalPath;
    this.isolatedSessionFile = null;
  }

  get capabilitySnapshot(): CapabilitySnapshotV1 | undefined {
    return this.profileSnapshot ? cloneJson(this.profileSnapshot) : undefined;
  }

  finalizeProfileToolPolicy(): CapabilitySnapshotV1 | undefined {
    if (!this.profileSnapshot) return undefined;
    if (this.profileToolPolicyDeferred) {
      if (!this.extensionsBound) throw new Error("Profile tool policy cannot be finalized before extension binding.");
      this.profileSnapshot = resolveProfileSnapshotToolsFromRuntime(this.inner, this.profileSnapshot);
      this.profileToolPolicyDeferred = false;
      this.installProfileToolMutationGuards();
    }
    this.applyProfileToolPolicy("after-extension-binding");
    return cloneJson(this.profileSnapshot);
  }

  get sessionFile(): string {
    return this.inner.sessionFile ?? "";
  }

  isAlive(): boolean {
    return this._alive;
  }

  isRunning(): boolean {
    return this._alive && (this.promptRunning || this.inner.isStreaming || this.inner.isCompacting || Boolean(this.inner.isBashRunning));
  }
  private terminateProfileRuntime(error: Error): void {
    this.fatalProfilePolicyError ??= error;
    try {
      (this.inner.extensionRunner as { invalidate?: (message?: string) => void } | undefined)?.invalidate?.("Profile capability policy was violated.");
      void this.inner.abort();
    } catch {
      // The normal shutdown path still disposes the runtime.
    }
    this.destroy();
  }

  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.inner.subscribe((event: AgentEvent) => {
      this.resetIdleTimer();
      this.emit(event);
      // Streaming / compaction / tool events flow through here; re-broadcast
      // the running-status snapshot so the sidebar can update live.
      notifyRunningChange();
    });
    this.resetIdleTimer();
    notifyRunningChange();
  }

  setForceEmptySystemPrompt(force: boolean): void {
    this.forceEmptySystemPrompt = force;
    this.applyForcedEmptySystemPrompt();
  }
  private profileRuntimeMismatch(phase: string, diagnostics: unknown): Error {
    const error = new Error(`Profile runtime capabilities do not match the immutable capability snapshot ${phase}.`);
    (error as Error & { diagnostics?: unknown }).diagnostics = diagnostics;
    return error;
  }

  private assertProfileRuntimeCurrent(phase: string): RuntimeToolMetadata[] | undefined {
    if (!this.profileSnapshot || this.profileToolGuardSuspended) return undefined;
    const metadata = getProfileRuntimeToolMetadata(this.inner, this.profileSnapshot);
    const validation = validateProfileRuntimeAgainstSnapshot(this.inner, this.profileSnapshot, metadata);
    if (validation.diagnostics.length > 0) {
      const error = this.profileRuntimeMismatch(phase, validation.diagnostics);
      this.terminateProfileRuntime(error);
      throw error;
    }
    return metadata;
  }

  private installProfileToolMutationGuards(): void {
    const expected = [...new Set(this.profileSnapshot?.tools.activeToolNames ?? [])].sort();
    const sameExpected = (names: string[]) => {
      const actual = [...new Set(names)].sort();
      return actual.length === expected.length && actual.every((name, index) => name === expected[index]);
    };
    const originalSetActiveTools = this.inner.setActiveToolsByName.bind(this.inner);
    this.inner.setActiveToolsByName = (names: string[]) => {
      if (this.profileToolGuardSuspended || sameExpected(names)) {
        originalSetActiveTools(names);
        return;
      }
      originalSetActiveTools(expected);
      const diagnostic = [{
        type: "error",
        message: "An extension attempted to change tools outside the immutable capability snapshot.",
        source: this.profileSnapshot?.profileRef,
      }];
      const error = this.profileRuntimeMismatch("after an extension tool mutation", diagnostic);
      this.terminateProfileRuntime(error);
      throw error;
    };

    const runtime = this.inner as AgentSessionLike & { _refreshToolRegistry?: (...args: unknown[]) => unknown };
    if (typeof runtime._refreshToolRegistry === "function") {
      const originalRefresh = runtime._refreshToolRegistry.bind(runtime);
      runtime._refreshToolRegistry = (...args: unknown[]) => {
        const result = originalRefresh(...args);
        if (!this.profileToolGuardSuspended) {
          applyProfileToolPolicy(this.inner, this.profileSnapshot as CapabilitySnapshotV1);
          this.assertProfileRuntimeCurrent("after extension tool registration");
        }
        return result;
      };
    }
  }

  applyProfileToolPolicy(phase: "after-session-creation" | "after-extension-binding" | "after-reload" = "after-session-creation"): RuntimeToolMetadata[] | undefined {
    if (!this.profileSnapshot || this.profileToolPolicyDeferred) return undefined;
    const metadata = applyProfileToolPolicy(this.inner, this.profileSnapshot);
    if (phase !== "after-session-creation") {
      const validation = validateProfileRuntimeAgainstSnapshot(this.inner, this.profileSnapshot, metadata);
      if (validation.diagnostics.length > 0) {
        const error = this.profileRuntimeMismatch(`after ${phase}`, validation.diagnostics);
        this.terminateProfileRuntime(error);
        throw error;
      }
    }
    this.forceEmptySystemPrompt = this.inner.getActiveToolNames().length === 0;
    this.applyForcedEmptySystemPrompt();
    if (phase === "after-reload") notifyRunningChange();
    return metadata;
  }

  bindExtensions(options: ExtensionBindingOptions = {}): Promise<void> {
    return this.ensureExtensionsBound(options);
  }

  beginExtensionBinding(options: ExtensionBindingOptions = {}): void {
    void this.bindExtensions(options).catch((err) => {
      console.error("[pi-web] failed to dispatch session_start to extensions:", err instanceof Error ? err.message : err);
    });
  }

  private async withProfileToolGuardSuspended<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.profileToolGuardSuspended;
    this.profileToolGuardSuspended = previous || Boolean(this.profileSnapshot);
    try {
      return await operation();
    } finally {
      this.profileToolGuardSuspended = previous;
    }
  }

  private ensureExtensionsBound(options: ExtensionBindingOptions = {}): Promise<void> {
    if (options.forceEmptySystemPrompt) this.forceEmptySystemPrompt = true;
    if (this.extensionsBound) {
      this.applyForcedEmptySystemPrompt();
      return Promise.resolve();
    }
    if (this.extensionBindingPromise) return this.extensionBindingPromise;

    this.extensionBindingError = null;
    this.extensionBindingPromise = (async () => {
      if (!this._alive) throw this.fatalProfilePolicyError ?? new Error("Profile runtime closed during extension binding.");
      await this.withProfileToolGuardSuspended(async () => {
        const uiContext = this.extensionUi.createContext();
        if (typeof this.inner.bindExtensions === "function") {
          const bindExtensions = this.inner.bindExtensions as (bindings: {
            uiContext?: unknown;
            mode?: "rpc";
            commandContextActions?: ExtensionCommandContextActionsLike;
            shutdownHandler?: () => void;
            onError?: (error: { extensionPath: string; event: string; error: string }) => void;
          }) => Promise<void>;
          await bindExtensions.call(this.inner, {
            uiContext,
            mode: "rpc",
            commandContextActions: this.createExtensionCommandContextActions(),
            shutdownHandler: () => this.emit({
              type: "extension_ui_request",
              id: randomUUID(),
              method: "notify",
              notifyType: "warning",
              message: "Extension requested shutdown, but shutdown is not supported in pi-web.",
            } as ExtensionUiRequest as AgentEvent),
            onError: (error) => this.emit({
              type: "extension_error",
              extensionPath: error.extensionPath,
              event: error.event,
              error: error.error,
            }),
          });
        } else {
          this.inner.extensionRunner.setUIContext?.(uiContext, "rpc");
        }
      });
      if (this.fatalProfilePolicyError || !this._alive) {
        throw this.fatalProfilePolicyError ?? new Error("Profile runtime closed during extension binding.");
      }
      this.extensionsBound = true;
      if (!this.profileToolPolicyDeferred) this.applyProfileToolPolicy("after-extension-binding");
      this.applyForcedEmptySystemPrompt();
      console.log(`[pi-web] session_start dispatched to extensions for session ${this.inner.sessionId}`);
    })().catch((err) => {
      this.extensionBindingError = err;
      throw err;
    });

    return this.extensionBindingPromise;
  }

  private async waitForExtensionsBound(): Promise<void> {
    try {
      if (this.extensionBindingPromise) await this.extensionBindingPromise;
    } catch (err) {
      throw err instanceof Error ? err : new Error(String(err));
    }
    if (this.extensionBindingError) {
      throw this.extensionBindingError instanceof Error
        ? this.extensionBindingError
        : new Error(String(this.extensionBindingError));
    }
  }

  private shouldWaitForExtensions(type: string): boolean {
    return type === "prompt" || type === "steer" || type === "follow_up" || type === "get_commands";
  }

  private async persistDerivedProfileSnapshot(sessionId: string, sessionFilePath: string, cwd: string): Promise<void> {
    if (!this.profileSnapshot) return;
    const options = { agentDir: this.agentDir };
    const pendingPath = `${sessionFilePath}.profile-pending`;
    renameSync(sessionFilePath, pendingPath);
    let writeResult: Awaited<ReturnType<typeof setSessionProfileSnapshot>> | undefined;
    try {
      const current = await getSessionProfileSnapshot(sessionId, options);
      if (current.state !== "legacy") throw new Error(`Derived session ${sessionId} already has a capability snapshot.`);
      const createdAt = new Date().toISOString();
      const snapshot: CapabilitySnapshotV1 = {
        ...cloneJson(this.profileSnapshot),
        snapshotId: randomUUID(),
        createdAt,
        cwd,
      };
      writeResult = await setSessionProfileSnapshot(
        sessionId,
        snapshot,
        { sessionFilePath, cwd, updatedAt: createdAt },
        current.writeToken,
        options,
      );
      renameSync(pendingPath, sessionFilePath);
    } catch (error) {
      if (writeResult) {
        await restoreSessionProfileSnapshot(sessionId, writeResult.previousRecord, writeResult.writeToken, options).catch(() => undefined);
      }
      try { unlinkSync(pendingPath); } catch { /* best-effort orphan cleanup */ }
      try { unlinkSync(sessionFilePath); } catch { /* best-effort orphan cleanup */ }
      throw error;
    }
  }

  private async withFinalRunningNotification<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } finally {
      notifyRunningChange();
    }
  }

  private applyForcedEmptySystemPrompt(): void {
    if (this.forceEmptySystemPrompt && this.inner.agent.state) {
      this.inner.agent.state.systemPrompt = "";
    }
  }

  private emit(event: AgentEvent): void {
    for (const l of this.listeners) l(event);
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.destroy(), 10 * 60 * 1000);
  }

  onEvent(listener: EventListener): () => void {
    this.listeners.push(listener);
    for (const event of this.extensionUi.getPendingRequests()) listener(event as AgentEvent);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i !== -1) this.listeners.splice(i, 1);
    };
  }

  onDestroy(cb: () => void): void {
    this.onDestroyCallback = cb;
  }

  private getLiveContextUsage() {
    const contextUsage = this.inner.getContextUsage();
    if (!contextUsage || contextUsage.tokens === null || contextUsage.contextWindow <= 0) return contextUsage;
    if (!this.inner.isStreaming) return contextUsage;

    const streamingMessage = (this.inner.agent.state as { streamingMessage?: unknown } | undefined)?.streamingMessage;
    if (!streamingMessage || typeof streamingMessage !== "object") return contextUsage;

    try {
      const streamingTokens = estimateTokens(streamingMessage as Parameters<typeof estimateTokens>[0]);
      if (!Number.isFinite(streamingTokens) || streamingTokens <= 0) return contextUsage;
      const tokens = contextUsage.tokens + streamingTokens;
      return {
        ...contextUsage,
        tokens,
        percent: (tokens / contextUsage.contextWindow) * 100,
      };
    } catch {
      return contextUsage;
    }
  }

  private hasOpenAIFastCommand(): boolean {
    return this.inner.extensionRunner
      .getRegisteredCommands()
      .some((registered) => registered.invocationName === PI_CODEX_FAST_COMMAND_NAME);
  }

  async send(command: Record<string, unknown>): Promise<unknown> {
    this.resetIdleTimer();
    const type = command.type as string;
    if (!this._alive) throw new Error("Session runtime is no longer available.");
    if (this.shouldWaitForExtensions(type)) await this.waitForExtensionsBound();
    if (["prompt", "get_state", "get_tools", "get_commands"].includes(type)) {
      this.assertProfileRuntimeCurrent(`before ${type}`);
    }

    switch (type) {
      case "prompt": {
        // Fire and forget — events come via subscribe
        const message = command.message as string;
        const promptImages = command.images as Array<{ type: "image"; data: string; mimeType: string }> | undefined;
        const streamingBehavior = command.streamingBehavior as "steer" | "followUp" | undefined;
        this.promptRunning = true;
        notifyRunningChange();
        this.inner.prompt(message, {
          ...(promptImages?.length ? { images: promptImages } : {}),
          ...(streamingBehavior ? { streamingBehavior } : {}),
          source: "rpc",
        })
          .then(() => {
            this.promptRunning = false;
            if (!streamingBehavior) this.emit({ type: "prompt_done" });
            notifyRunningChange();
          })
          .catch((error) => {
            this.promptRunning = false;
            this.emit({
              type: "prompt_error",
              errorMessage: error instanceof Error ? error.message : String(error),
            });
            if (!streamingBehavior) this.emit({ type: "prompt_done" });
            notifyRunningChange();
          });
        return null;
      }

      case "abort":
        await this.withFinalRunningNotification(() => this.inner.abort());
        return null;

      case "get_state": {
        const model = this.inner.model;
        const contextUsage = this.getLiveContextUsage();
        return {
          sessionId: this.inner.sessionId,
          sessionFile: this.inner.sessionFile ?? "",
          profileSnapshot: this.profileSnapshot ?? null,
          isStreaming: this.inner.isStreaming,
          isPromptRunning: this.promptRunning,
          isCompacting: this.inner.isCompacting,
          isBashRunning: Boolean(this.inner.isBashRunning),
          autoCompactionEnabled: this.inner.autoCompactionEnabled,
          autoRetryEnabled: this.inner.autoRetryEnabled,
          model: model ? { id: model.id, provider: model.provider } : undefined,
          messageCount: 0,
          pendingMessageCount: this.inner.pendingMessageCount,
          queuedMessages: {
            steering: [...this.inner.getSteeringMessages()],
            followUp: [...this.inner.getFollowUpMessages()],
          },
          contextUsage: contextUsage
            ? { percent: contextUsage.percent, contextWindow: contextUsage.contextWindow, tokens: contextUsage.tokens }
            : null,
          systemPrompt: this.inner.agent.state?.systemPrompt ?? "",
          thinkingLevel: this.inner.agent.state?.thinkingLevel ?? "off",
          extensionStatuses: this.extensionUi.getStatuses(),
          extensionWidgets: this.extensionUi.getWidgets(),
          extensionChrome: this.extensionUi.getChrome(),
          extensionCompatibility: this.extensionUi.getCompatibilityReports(),
          extensionAutocompleteProviders: this.extensionUi.getAutocompleteProviders(),
          openAIFastMode: getPiCodexFastModeState(this.inner.model),
          openAIFastConfig: loadPiCodexFastModeConfig(),
        };
      }

      case "set_model": {
        const { provider, modelId } = command as { provider: string; modelId: string };
        const registry = this.inner.modelRegistry;
        const model = registry.find(provider, modelId);
        if (!model) throw new Error(`Model not found: ${provider}/${modelId}`);
        await this.inner.setModel(model);
        return { id: model.id, provider: model.provider };
      }

      case "fork": {
        const entryId = command.entryId as string;
        const sessionManager = this.inner.sessionManager;
        const currentSessionFile = this.inner.sessionFile;

        if (!sessionManager.isPersisted()) return { cancelled: true };
        if (!currentSessionFile) throw new Error("Persisted session is missing a session file");

        const entry = sessionManager.getEntry(entryId);
        if (!entry) throw new Error("Invalid entry ID for forking");
        const selectedText = entry.type === "message"
          && "message" in entry
          && (entry.message as { role?: unknown }).role === "user"
          ? extractUserMessageText((entry.message as { content?: unknown }).content)
          : undefined;

        const sessionDir = sessionManager.getSessionDir();
        let newSessionFile: string;
        let newSessionId: string;

        if (!entry.parentId) {
          // Fork before the first message: create an empty session linked to this one.
          // SessionManager defers writing until an assistant message, but pi-web must
          // make the new session selectable immediately.
          const newManager = SessionManager.create(sessionManager.getCwd(), sessionDir);
          newManager.newSession({ parentSession: currentSessionFile });
          newSessionFile = newManager.getSessionFile() as string;
          if (!existsSync(newSessionFile)) {
            (newManager as unknown as { _rewriteFile?: () => void })._rewriteFile?.();
          }
          if (!existsSync(newSessionFile)) throw new Error("Failed to write forked session");
          newSessionId = newManager.getSessionId();
        } else {
          // Fork after some history: copy path up to (but not including) the fork point
          const sourceManager = SessionManager.open(currentSessionFile, sessionDir);
          const forkedPath = sourceManager.createBranchedSession(entry.parentId);
          if (!forkedPath) throw new Error("Failed to create forked session");
          newSessionFile = forkedPath;
          if (!existsSync(newSessionFile)) {
            (sourceManager as unknown as { _rewriteFile?: () => void })._rewriteFile?.();
          }
          if (!existsSync(newSessionFile)) throw new Error("Failed to write forked session");
          newSessionId = sourceManager.getSessionId();
        }

        await this.persistDerivedProfileSnapshot(newSessionId, newSessionFile, sessionManager.getCwd());
        cacheSessionPath(newSessionId, newSessionFile);
        this.destroy();
        return { cancelled: false, newSessionId, selectedText };
      }

      case "clone": {
        const sessionManager = this.inner.sessionManager;
        const currentSessionFile = this.inner.sessionFile;
        const leafId = sessionManager.getLeafId?.();

        if (!leafId) return { cancelled: true };
        if (!sessionManager.isPersisted()) return { cancelled: true };
        if (!currentSessionFile) throw new Error("Persisted session is missing a session file");

        const sourceManager = SessionManager.open(currentSessionFile, sessionManager.getSessionDir());
        const newSessionFile = sourceManager.createBranchedSession(leafId);
        if (!newSessionFile) throw new Error("Failed to clone session");

        // createBranchedSession intentionally defers writing paths with no assistant
        // message. A web clone must be immediately openable from the sidebar, so force
        // a rewrite for that edge case.
        if (!existsSync(newSessionFile)) {
          (sourceManager as unknown as { _rewriteFile?: () => void })._rewriteFile?.();
        }
        if (!existsSync(newSessionFile)) throw new Error("Failed to write cloned session");

        const newSessionId = sourceManager.getSessionId();
        await this.persistDerivedProfileSnapshot(newSessionId, newSessionFile, sessionManager.getCwd());
        cacheSessionPath(newSessionId, newSessionFile);
        return { cancelled: false, newSessionId };
      }

      case "navigate_tree": {
        const result = await this.inner.navigateTree(command.targetId as string, { summarize: command.summarize === true });
        return { cancelled: result.cancelled };
      }

      case "set_thinking_level": {
        const level = command.level as string;
        this.inner.setThinkingLevel(level);
        // setThinkingLevel clamps xhigh→high for models where supportsXhigh()===false.
        // If the model has DeepSeek thinking compat (reasoningEffortMap maps xhigh→max),
        // force the state back so the compat layer can use it correctly.
        if (level === "xhigh" && (this.inner.model as { compat?: { thinkingFormat?: string } } | null)?.compat?.thinkingFormat === "deepseek" && this.inner.agent?.state) {
          this.inner.agent.state.thinkingLevel = "xhigh";
        }
        return null;
      }

      case "compact": {
        const result = await this.withFinalRunningNotification(() =>
          this.inner.compact(command.customInstructions as string | undefined)
        );
        return result;
      }

      case "set_session_name": {
        const name = (command.name as string | undefined)?.trim();
        if (!name) throw new Error("Session name cannot be empty");
        this.inner.setSessionName(name);
        return null;
      }

      case "get_session_stats": {
        return {
          ...this.inner.getSessionStats(),
          sessionName: this.inner.sessionManager.getSessionName(),
        };
      }

      case "get_last_assistant_text": {
        return { text: this.inner.getLastAssistantText() ?? "" };
      }

      case "get_user_messages_for_forking": {
        return { messages: this.inner.getUserMessagesForForking() };
      }

      case "export_session": {
        const outputPath = (command.outputPath as string | undefined)?.trim() || undefined;
        if (outputPath?.endsWith(".jsonl")) {
          return { filePath: this.inner.exportToJsonl(outputPath), format: "jsonl" };
        }
        return { filePath: await this.inner.exportToHtml(outputPath), format: "html" };
      }

      case "set_auto_compaction": {
        this.inner.setAutoCompactionEnabled(command.enabled as boolean);
        return null;
      }

      case "user_bash": {
        const bashCommand = (command.command as string | undefined)?.trim();
        if (!bashCommand) throw new Error("Command cannot be empty");
        const excludeFromContext = command.excludeFromContext === true;
        const cwd = this.inner.sessionManager.getCwd();
        const startedAt = Date.now();
        notifyRunningChange();
        this.emit({ type: "user_bash_start", command: bashCommand, cwd, excludeFromContext });
        try {
          const result = await this.inner.executeBash(
            bashCommand,
            (chunk) => this.emit({ type: "user_bash_chunk", command: bashCommand, chunk }),
            { excludeFromContext },
          );
          const response: BashCommandResult = {
            ...result,
            command: bashCommand,
            cwd,
            durationMs: Date.now() - startedAt,
            excludeFromContext,
          };
          this.emit({ type: "user_bash_end", ...response });
          return response;
        } finally {
          notifyRunningChange();
        }
      }

      case "abort_bash":
        this.inner.abortBash();
        return null;

      case "clear_queue": {
        // Full clear only: pi has no single-item dequeue, and clear+requeue
        // races against the agent loop pulling messages mid-flight.
        return this.inner.clearQueue();
      }

      case "steer": {
        const steerImages = command.images as Array<{ type: "image"; data: string; mimeType: string }> | undefined;
        await this.inner.steer(command.message as string, steerImages?.length ? steerImages : undefined);
        return null;
      }

      case "follow_up": {
        const followImages = command.images as Array<{ type: "image"; data: string; mimeType: string }> | undefined;
        await this.inner.followUp(command.message as string, followImages?.length ? followImages : undefined);
        return null;
      }

      case "get_tools": {
        if (this.profileSnapshot) return getProfileRuntimeToolMetadata(this.inner, this.profileSnapshot);
        const all: ToolInfo[] = this.inner.getAllTools();
        const active = new Set<string>(this.inner.getActiveToolNames());
        return all.map((t) => ({
          name: t.name,
          description: t.description,
          active: active.has(t.name),
          provenance: t.sourceInfo?.source === "builtin" ? "builtin" : (t.sourceInfo ? "plugin" : "unknown"),
        }));
      }

      case "get_commands": {
        const commands: SlashCommandInfo[] = [];
        const builtinCommands = await loadPiBuiltinSlashCommands();
        const builtinNames = new Set(builtinCommands.map((command) => command.name));
        commands.push(...builtinCommands);

        for (const registered of this.inner.extensionRunner.getRegisteredCommands()) {
          if (builtinNames.has(registered.invocationName)) continue;
          commands.push({
            name: registered.invocationName,
            description: registered.description,
            source: "extension",
            sourceInfo: registered.sourceInfo,
          });
        }
        for (const template of this.inner.promptTemplates) {
          commands.push({
            name: template.name,
            description: template.description,
            source: "prompt",
            sourceInfo: template.sourceInfo,
          });
        }
        for (const skill of this.inner.resourceLoader.getSkills().skills) {
          commands.push({
            name: `skill:${skill.name}`,
            description: skill.description,
            source: "skill",
            sourceInfo: skill.sourceInfo,
          });
        }
        return { commands };
      }

      case "toggle_openai_fast": {
        await this.waitForExtensionsBound();
        if (!this.hasOpenAIFastCommand()) {
          throw new Error(`OpenAI Fast mode is not available in this session. Install or reload the ${PI_CODEX_FAST_PACKAGE_NAME} plugin.`);
        }

        const currentFastMode = getPiCodexFastModeState(this.inner.model);
        if (!currentFastMode.eligible) {
          throw new Error("OpenAI Fast mode is unavailable for the current model.");
        }

        await this.inner.prompt(`/fast ${currentFastMode.active ? "off" : "on"}`, { source: "rpc" });
        return {
          extensionStatuses: this.extensionUi.getStatuses(),
          extensionWidgets: this.extensionUi.getWidgets(),
          openAIFastMode: getPiCodexFastModeState(this.inner.model),
          openAIFastConfig: loadPiCodexFastModeConfig(),
        };
      }

      case "set_tools": {
        if (this.profileSnapshot) {
          this.applyProfileToolPolicy("after-reload");
          throw new Error("Profile-scoped sessions cannot change tools outside their capability snapshot.");
        }
        const toolNames = command.toolNames as string[];
        this.setForceEmptySystemPrompt(toolNames.length === 0);
        this.inner.setActiveToolsByName(withExtensionTools(this.inner, toolNames));
        this.applyForcedEmptySystemPrompt();
        return null;
      }

      case "reload": {
        this.profileToolGuardSuspended = true;
        try {
          await this.waitForExtensionsBound();
          this.extensionUi.clearPersistentUi();
          await this.inner.reload();
          if (typeof this.inner.bindExtensions !== "function") {
            this.inner.extensionRunner.setUIContext?.(this.extensionUi.createContext(), "rpc");
          }
          this.profileToolGuardSuspended = false;
          this.applyProfileToolPolicy("after-reload");
          this.applyForcedEmptySystemPrompt();
          return { success: true };
        } catch (error) {
          this.profileToolGuardSuspended = false;
          if (this.profileSnapshot) this.destroy();
          throw error;
        }
      }

      case "abort_compaction": {
        this.inner.abortCompaction();
        return null;
      }

      case "extension_ui_response": {
        this.extensionUi.resolveExtensionUiResponse(command as ExtensionUiResponse);
        return null;
      }

      case "extension_editor_snapshot": {
        this.extensionUi.setEditorTextSnapshot(command.text as string);
        return null;
      }

      case "extension_autocomplete": {
        return await this.extensionUi.queryAutocomplete(
          typeof command.text === "string" ? command.text : "",
          typeof command.cursor === "number" ? command.cursor : 0,
        );
      }

      case "extension_ui_input": {
        this.extensionUi.handleExtensionUiInput(command.id as string, command.data as string);
        return null;
      }

      case "extension_ui_resize": {
        this.extensionUi.handleExtensionUiResize(command.id as string, {
          columns: command.columns,
          rows: command.rows,
        });
        return null;
      }

      case "set_auto_retry": {
        this.inner.setAutoRetryEnabled(command.enabled as boolean);
        return null;
      }

      default:
        throw new Error(`Unsupported command: ${type}`);
    }
  }

  shutdown(reason: "quit" | "reload" | "new" | "resume" | "fork" = "quit", targetSessionFile?: string): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this._alive = false;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.emit({ type: "runtime_closed", reason });
    this.onDestroyCallback?.();
    notifyRunningChange();

    this.shutdownPromise = (async () => {
      try {
        const runner = this.inner.extensionRunner as {
          emit?: (event: { type: "session_shutdown"; reason: "quit" | "reload" | "new" | "resume" | "fork"; targetSessionFile?: string }) => Promise<unknown>;
          invalidate?: (message?: string) => void;
        } | undefined;
        await runner?.emit?.({ type: "session_shutdown", reason, ...(targetSessionFile ? { targetSessionFile } : {}) });
        runner?.invalidate?.("Profile runtime was shut down.");
      } catch (error) {
        console.error("[pi-web] extension session_shutdown failed:", error instanceof Error ? error.message : error);
      } finally {
        try {
          if (this.inner.isStreaming || this.inner.isCompacting || this.inner.isBashRunning) await this.inner.abort();
        } catch {
          // Continue with disposal even if an in-flight operation cannot be cleanly aborted.
        }
        if (this.isolatedSessionFile) {
          try { unlinkSync(this.isolatedSessionFile.temporaryPath); } catch { /* already removed */ }
          this.isolatedSessionFile = null;
        }
        (this.inner as { dispose?: () => void }).dispose?.();
        this.extensionUi.destroy();
        this.listeners = [];
      }
    })();
    return this.shutdownPromise;
  }

  destroy(): void {
    void this.shutdown();
  }


  private createExtensionCommandContextActions(): ExtensionCommandContextActionsLike {
    return {
      waitForIdle: async () => {
        const agent = this.inner.agent as { waitForIdle?: () => Promise<void> };
        await agent.waitForIdle?.();
      },
      newSession: async () => ({ cancelled: true }),
      fork: async () => ({ cancelled: true }),
      navigateTree: async (targetId, options) => {
        const result = await this.inner.navigateTree(targetId, { summarize: options?.summarize });
        return { cancelled: result.cancelled };
      },
      switchSession: async () => ({ cancelled: true }),
      reload: async () => {
        this.extensionUi.clearPersistentUi();
        await this.inner.reload({
          beforeSessionStart: () => {
            this.inner.extensionRunner.setUIContext?.(this.extensionUi.createContext(), "rpc");
          },
        });
        this.applyProfileToolPolicy("after-reload");
        this.applyForcedEmptySystemPrompt();
      },
    };
  }
}

// ============================================================================
// Session registry
// ============================================================================

declare global {
  var __piSessions: Map<string, AgentSessionWrapper> | undefined;
  var __piStartLocks: Map<string, Promise<{ session: AgentSessionWrapper; realSessionId: string }>> | undefined;
  var __piRunningListeners: Set<(ids: string[]) => void> | undefined;
}

function getRegistry(): Map<string, AgentSessionWrapper> {
  if (!globalThis.__piSessions) {
    globalThis.__piSessions = new Map();
    const cleanup = () => globalThis.__piSessions?.forEach((session) => { session.destroy(); });
    process.once("exit", cleanup);
    process.once("SIGINT", cleanup);
    process.once("SIGTERM", cleanup);
  }
  return globalThis.__piSessions;
}

function getLocks(): Map<string, Promise<{ session: AgentSessionWrapper; realSessionId: string }>> {
  if (!globalThis.__piStartLocks) globalThis.__piStartLocks = new Map();
  return globalThis.__piStartLocks;
}

export function getRpcSession(sessionId: string): AgentSessionWrapper | undefined {
  return getRegistry().get(sessionId);
}

export function getRunningRpcSessionIds(): string[] {
  const ids = new Set<string>();
  for (const [sessionId, session] of getRegistry()) {
    if (session.isRunning()) ids.add(session.sessionId || sessionId);
  }
  return [...ids];
}

// ----------------------------------------------------------------------------
// Running-status broadcaster
//
// Pushes the current set of running session ids to subscribers whenever any
// session's running state may have changed. This lets the sidebar receive live
// updates over SSE instead of polling. Listeners live on globalThis so they
// survive Next.js hot-reload.
// ----------------------------------------------------------------------------

function getRunningListeners(): Set<(ids: string[]) => void> {
  if (!globalThis.__piRunningListeners) globalThis.__piRunningListeners = new Set();
  return globalThis.__piRunningListeners;
}

/** Subscribe to running-session-id changes. Returns an unsubscribe function. */
export function subscribeRunningSessions(listener: (ids: string[]) => void): () => void {
  const listeners = getRunningListeners();
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

let lastRunningSnapshot = "";

/**
 * Recompute the running-session-id set and, if it changed since the last
 * notification, broadcast it to subscribers. Cheap to call often.
 */
export function notifyRunningChange(): void {
  const ids = getRunningRpcSessionIds();
  const snapshot = JSON.stringify([...ids].sort());
  if (snapshot === lastRunningSnapshot) return;
  lastRunningSnapshot = snapshot;
  for (const listener of getRunningListeners()) {
    try { listener(ids); } catch { /* ignore listener errors */ }
  }
}

async function createRpcSessionWrapper(
  sessionFile: string,
  cwd: string,
  toolNames?: string[],
  runtimeOptions: StartRpcSessionRuntimeOptions = {},
): Promise<{ session: AgentSessionWrapper; realSessionId: string }> {
  const agentDir = runtimeOptions.agentDir ?? getAgentDir();
  const canonicalCwd = realpathSync(resolvePath(cwd));
  const profileSnapshot = runtimeOptions.profileSnapshot;
  const profileRuntime = profileSnapshot
    ? createProfileScopedRuntimeOptions({
        cwd: canonicalCwd,
        agentDir,
        snapshot: profileSnapshot,
        projectTrusted: getProjectTrustStatus(canonicalCwd, agentDir).effective.trusted,
      })
    : undefined;

  let isolatedSessionFile: { originalPath: string; temporaryPath: string; initialBytes: Buffer; mode: "copy" | "move" } | undefined;
  let sessionFileForOpen = sessionFile;
  if (sessionFile && runtimeOptions.isolateSessionFile) {
    const originalPath = realpathSync(sessionFile);
    const temporaryPath = `${originalPath}.profile-candidate-${process.pid}-${randomUUID()}`;
    copyFileSync(originalPath, temporaryPath);
    isolatedSessionFile = { originalPath, temporaryPath, initialBytes: readFileSync(temporaryPath), mode: "copy" };
    sessionFileForOpen = temporaryPath;
  }
  try {
  const sessionManager = sessionFileForOpen
    ? SessionManager.open(sessionFileForOpen, undefined)
    : SessionManager.create(canonicalCwd, undefined);
  if (!sessionFileForOpen && profileSnapshot) {
    const generatedSessionFile = sessionManager.getSessionFile();
    if (!generatedSessionFile) throw new Error("Profile-backed sessions require a generated session file path.");
    const originalPath = resolvePath(generatedSessionFile);
    const temporaryPath = `${originalPath}.profile-pending-${process.pid}-${randomUUID()}`;
    (sessionManager as unknown as { sessionFile?: string }).sessionFile = temporaryPath;
    isolatedSessionFile = { originalPath, temporaryPath, initialBytes: Buffer.alloc(0), mode: "move" };
  }
  if (profileSnapshot && profileSnapshot.cwd !== canonicalCwd) {
    throw new Error(`Profile snapshot cwd '${profileSnapshot.cwd}' does not match runtime cwd '${canonicalCwd}'.`);
  }
  const sessionManagerCwd = realpathSync(resolvePath(sessionManager.getCwd()));
  if (sessionManagerCwd !== canonicalCwd) {
    throw new Error(`Session file cwd '${sessionManagerCwd}' does not match runtime cwd '${canonicalCwd}'.`);
  }

  // Determine which tools to pass based on requested toolNames.
  // Since v0.68.0, session creation expects string[] tool names instead of Tool[] instances.
  let toolsOption: string[] | undefined;
  if (!profileSnapshot && toolNames !== undefined) {
    // toolNames === [] -> "all off" (an empty allow-list disables every tool).
    // Otherwise DO NOT pass a builtin-only allow-list: passing CODING_TOOL_NAMES
    // set allowedToolNames to coding builtins only, which filtered every
    // extension/package-provided tool (e.g. subagents, web access) out of the
    // tool registry — so they were unavailable in pi-web sessions even though the
    // `pi` CLI keeps them. Leaving the allow-list unset lets the SDK register all
    // tools (and activate extension tools); we narrow the ACTIVE set below.
    toolsOption = toolNames.length === 0 ? [] : undefined;
  }

  // Build services first so extension-registered providers are available
  // before the SDK restores the saved model from the session file. For
  // profile-backed sessions the profile-scoped settings manager is supplied
  // here, before resourceLoader.reload() can load packages/resources.
  const services = await createAgentSessionServices({
    cwd: canonicalCwd,
    agentDir,
    ...(runtimeOptions.settingsManager || profileRuntime?.settingsManager
      ? { settingsManager: runtimeOptions.settingsManager ?? profileRuntime?.settingsManager }
      : {}),
    resourceLoaderOptions: {
      ...(profileRuntime?.resourceLoaderOptions ?? {}),
      ...(runtimeOptions.resourceLoaderOptions ?? {}),
    },
    ...(runtimeOptions.resourceLoaderReloadOptions
      ? { resourceLoaderReloadOptions: runtimeOptions.resourceLoaderReloadOptions }
      : {}),
  });
  const created = await createAgentSessionFromServices({
    services,
    sessionManager,
    ...(toolsOption !== undefined ? { tools: toolsOption } : {}),
  });
  const inner = created.session;
  if (profileSnapshot) {
    const diagnostics = [
      ...services.diagnostics.filter((item) => item.type === "error").map((item) => ({ type: "error" as const, message: item.message, source: profileSnapshot.profileRef })),
      ...created.extensionsResult.errors.map((item) => ({ type: "error" as const, message: item.error, source: item.path, path: item.path })),
    ];
    if (diagnostics.length > 0) {
      inner.dispose();
      if (isolatedSessionFile) {
        try { unlinkSync(isolatedSessionFile.temporaryPath); } catch { /* already removed */ }
      }
      const error = new Error("Profile runtime failed to load selected extension capabilities.");
      (error as Error & { diagnostics?: unknown }).diagnostics = diagnostics;
      throw error;
    }
  }
  if (isolatedSessionFile?.mode === "copy") isolatedSessionFile.initialBytes = readFileSync(isolatedSessionFile.temporaryPath);

  // If specific tool names were requested (non-empty), set the active tools to the
  // requested builtin coding tools PLUS all extension/package tools, so installed
  // extensions stay usable in pi-web just like in the `pi` CLI.
  if (!profileSnapshot && toolNames && toolNames.length > 0) {
    inner.setActiveToolsByName(withExtensionTools(inner, toolNames));
  }

  const wrapper = new AgentSessionWrapper(inner, profileSnapshot, agentDir, isolatedSessionFile, runtimeOptions.resolveProfileTools ?? false);
  // When all tools are disabled, clear the system prompt entirely.
  // pi's buildSystemPrompt always produces a non-empty prompt even with no tools;
  // keep this forced after extension resource discovery and reloads as well.
  if (profileSnapshot && !runtimeOptions.resolveProfileTools) {
    wrapper.applyProfileToolPolicy("after-session-creation");
  } else if (toolNames?.length === 0) {
    wrapper.setForceEmptySystemPrompt(true);
  }
  if (runtimeOptions.autoStart !== false) wrapper.start();

  const realSessionId = inner.sessionId as string;
  return { session: wrapper, realSessionId };
  } catch (error) {
    if (isolatedSessionFile) {
      try { unlinkSync(isolatedSessionFile.temporaryPath); } catch { /* already removed */ }
    }
    throw error;
  }
}

export async function createUnregisteredRpcSession(
  cwd: string,
  toolNames?: string[],
  runtimeOptions: StartRpcSessionRuntimeOptions = {},
): Promise<{ session: AgentSessionWrapper; realSessionId: string }> {
  return createRpcSessionWrapper("", cwd, toolNames, { ...runtimeOptions, autoStart: runtimeOptions.autoStart ?? false });
}

export async function createUnregisteredRpcSessionFromFile(
  sessionFile: string,
  cwd: string,
  toolNames?: string[],
  runtimeOptions: StartRpcSessionRuntimeOptions = {},
): Promise<{ session: AgentSessionWrapper; realSessionId: string }> {
  return createRpcSessionWrapper(sessionFile, cwd, toolNames, { ...runtimeOptions, autoStart: runtimeOptions.autoStart ?? false });
}

export function registerRpcSession(realSessionId: string, session: AgentSessionWrapper): void {
  if (!session.isAlive()) throw new Error(`Cannot register closed session ${realSessionId}`);
  const registry = getRegistry();
  const existing = registry.get(realSessionId);
  if (existing?.isAlive() && existing !== session) {
    throw new Error(`Session ${realSessionId} is already registered`);
  }
  session.onDestroy(() => {
    if (registry.get(realSessionId) === session) registry.delete(realSessionId);
  });
  session.start();
  if (session.sessionFile) cacheSessionPath(realSessionId, session.sessionFile);
  registry.set(realSessionId, session);
  notifyRunningChange();
}

export function replaceRpcSession(realSessionId: string, session: AgentSessionWrapper): AgentSessionWrapper | undefined {
  if (!session.isAlive()) throw new Error(`Cannot replace session ${realSessionId} with a closed runtime`);
  const registry = getRegistry();
  const previous = registry.get(realSessionId);
  if (previous === session) return previous;
  session.onDestroy(() => {
    if (registry.get(realSessionId) === session) registry.delete(realSessionId);
  });
  session.start();
  if (session.sessionFile) cacheSessionPath(realSessionId, session.sessionFile);
  registry.set(realSessionId, session);
  notifyRunningChange();
  return previous;
}

export function unregisterRpcSession(realSessionId: string, session?: AgentSessionWrapper): void {
  const registry = getRegistry();
  const existing = registry.get(realSessionId);
  if (!session || existing === session) registry.delete(realSessionId);
  session?.destroy();
  notifyRunningChange();
}

/**
 * Get or create an AgentSession for the given session.
 * For new sessions (sessionFile === ""), pi generates its own id.
 * Pass toolNames to pre-configure active tools (empty array = all tools disabled).
 */
export async function startRpcSession(
  sessionId: string,
  sessionFile: string,
  cwd: string,
  toolNames?: string[],
  runtimeOptions: StartRpcSessionRuntimeOptions = {},
): Promise<{ session: AgentSessionWrapper; realSessionId: string }> {
  const registry = getRegistry();
  const locks = getLocks();

  const existing = registry.get(sessionId);
  if (existing?.isAlive()) {
    const expectedSnapshotId = runtimeOptions.profileSnapshot?.snapshotId;
    const liveSnapshotId = existing.capabilitySnapshot?.snapshotId;
    if (expectedSnapshotId !== liveSnapshotId) {
      await existing.shutdown();
      throw new Error(`Live session ${sessionId} does not match its persisted capability snapshot.`);
    }
    return { session: existing, realSessionId: sessionId };
  }

  const inflight = locks.get(sessionId);
  if (inflight) return inflight;

  const starting = (async () => {
    const profileSnapshot = runtimeOptions.profileSnapshot;
    let result: { session: AgentSessionWrapper; realSessionId: string } | undefined;
    try {
      result = await createRpcSessionWrapper(sessionFile, cwd, toolNames, {
        ...runtimeOptions,
        autoStart: profileSnapshot ? false : runtimeOptions.autoStart,
      });
      if (sessionFile && result.realSessionId !== sessionId) {
        await result.session.shutdown();
        throw new Error(`Session file identity '${result.realSessionId}' does not match requested session '${sessionId}'.`);
      }
      if (profileSnapshot) {
        await result.session.bindExtensions({
          forceEmptySystemPrompt: result.session.inner.getActiveToolNames().length === 0,
        });
      }
      registerRpcSession(result.realSessionId, result.session);
      if (!profileSnapshot) {
        result.session.beginExtensionBinding({ forceEmptySystemPrompt: toolNames?.length === 0 });
      }
      return result;
    } catch (error) {
      await result?.session.shutdown();
      throw error;
    }
  })().finally(() => locks.delete(sessionId));

  locks.set(sessionId, starting);
  return starting;
}
