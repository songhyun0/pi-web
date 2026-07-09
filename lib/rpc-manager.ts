import { createAgentSessionFromServices, createAgentSessionServices, estimateTokens, getAgentDir, SessionManager, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { clampThinkingLevel } from "@earendil-works/pi-ai";
import { randomUUID } from "crypto";
import { cpSync, existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { cacheSessionPath } from "./session-reader";
import { loadPiBuiltinSlashCommands } from "./pi-builtin-slash-commands";
import { ExtensionUiBridge } from "./extension-ui-bridge";
import type { SlashCommandInfo } from "./slash-command-registry";
import type { AgentSessionLike, BashCommandResult, ModelLike, ToolInfo } from "./pi-types";
import type { ExtensionUiRequest, ExtensionUiResponse } from "./types";
import { getPiCodexFastModeState, loadPiCodexFastModeConfig, PI_CODEX_FAST_COMMAND_NAME, PI_CODEX_FAST_PACKAGE_NAME } from "./pi-codex-fast";
import { expandAgentProfileForNewSession, normalizeAgentProfileRef, resolveAgentProfile, type AgentProfileSessionOptions } from "./agent-profiles";
import { isProfileStateEntry, PROFILE_STATE_CUSTOM_TYPE } from "./profile-session-state";
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

type ProfileResourceLoaderOptions = NonNullable<Parameters<typeof createAgentSessionServices>[0]["resourceLoaderOptions"]>;
type ExtensionToolMode = AgentProfileSessionOptions["extensionToolMode"];

const MAX_PROFILE_RESOURCE_SCAN_ENTRIES = 5000;

function isPathInside(target: string, root: string): boolean {
  const resolvedTarget = path.resolve(target);
  const resolvedRoot = path.resolve(root);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertProfileDirectoryTreeSafe(baseDir: string, root: string, label: string): void {
  const stack = [baseDir];
  let scanned = 0;
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      scanned += 1;
      if (scanned > MAX_PROFILE_RESOURCE_SCAN_ENTRIES) {
        throw new Error(`${label} contains too many files to validate safely: ${baseDir}`);
      }
      const fullPath = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`${label} must not contain symbolic links: ${fullPath}`);
      }
      const realPath = realpathSync.native(fullPath);
      if (!isPathInside(realPath, root) || !isPathInside(realPath, baseDir)) {
        throw new Error(`${label} contains a path outside its trusted root: ${fullPath}`);
      }
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (!entry.isFile()) {
        throw new Error(`${label} contains an unsupported filesystem entry: ${fullPath}`);
      }
    }
  }
}

function checkedProfilePath(entry: { scope: string; path: string; resolvedPath: string }, cwd: string, expected: "file" | "resource" = "resource"): string {
  const root = entry.scope === "project" ? cwd : getAgentDir();
  const realRoot = realpathSync.native(root);
  const linkStats = lstatSync(entry.resolvedPath);
  if (linkStats.isSymbolicLink()) {
    throw new Error(`Profile resource path must not be a symbolic link: ${entry.resolvedPath}`);
  }
  const realPath = realpathSync.native(entry.resolvedPath);
  if (realPath !== entry.resolvedPath) {
    throw new Error(`Profile resource path changed after validation: ${entry.resolvedPath}`);
  }
  if (!isPathInside(realPath, realRoot)) {
    throw new Error(`Profile resource path left its trusted root: ${entry.path}`);
  }
  const stats = statSync(realPath);
  if (expected === "file" && !stats.isFile()) {
    throw new Error(`Profile instruction path is not a file: ${entry.path}`);
  }
  if (!stats.isFile() && !stats.isDirectory()) {
    throw new Error(`Profile resource path is not a file or directory: ${entry.resolvedPath}`);
  }
  if (stats.isDirectory()) {
    assertProfileDirectoryTreeSafe(realPath, realRoot, "Profile resource directory");
  }
  return realPath;
}
function cleanupProfileSnapshots(profileState: ProfileRuntimeState | undefined): void {
  if (!profileState) return;
  for (const snapshot of profileState.snapshots) {
    try { rmSync(snapshot, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
  }
  profileState.snapshots.clear();
}

function snapshotCheckedProfilePath(checkedPath: string, snapshots: Set<string>): string {
  const parent = mkdtempSync(path.join(tmpdir(), "pi-web-profile-resource-"));
  const destination = path.join(parent, path.basename(checkedPath) || "resource");
  cpSync(checkedPath, destination, { recursive: true, dereference: false, errorOnExist: true });
  const realParent = realpathSync.native(parent);
  if (lstatSync(destination).isSymbolicLink()) {
    throw new Error(`Profile resource snapshot root must not be a symbolic link: ${destination}`);
  }
  const realDestination = realpathSync.native(destination);
  if (!isPathInside(realDestination, realParent)) {
    throw new Error(`Profile resource snapshot escaped its temporary directory: ${destination}`);
  }
  const stats = statSync(realDestination);
  if (stats.isDirectory()) {
    assertProfileDirectoryTreeSafe(realDestination, realDestination, "Profile resource snapshot");
  } else if (!stats.isFile()) {
    throw new Error(`Profile resource snapshot is not a file or directory: ${realDestination}`);
  }
  snapshots.add(parent);
  return realDestination;
}

function checkedProfileResourcePath(entry: { scope: string; path: string; resolvedPath: string }, cwd: string, snapshots: Set<string>): string {
  return snapshotCheckedProfilePath(checkedProfilePath(entry, cwd), snapshots);
}

function readProfileInstructionFiles(profile: AgentProfileSessionOptions, cwd: string, snapshots?: Set<string>): string[] {
  return profile.instructions.files.map((entry) => {
    const checkedPath = checkedProfilePath(entry, cwd, "file");
    const stablePath = snapshots ? snapshotCheckedProfilePath(checkedPath, snapshots) : checkedPath;
    const content = readFileSync(stablePath, "utf8").trim();
    return content ? `# ${entry.path}\n\n${content}` : "";
  }).filter(Boolean);
}

function buildProfileInstructionText(profile: AgentProfileSessionOptions, cwd: string, snapshots?: Set<string>): string | undefined {
  if (profile.instructions.mode === "default") return undefined;
  const parts = [profile.instructions.text?.trim(), ...readProfileInstructionFiles(profile, cwd, snapshots)].filter((part): part is string => Boolean(part));
  if (parts.length === 0) return undefined;
  return [`Active profile: ${profile.profileName} (${profile.profileRef})`, ...parts].join("\n\n");
}

function profileRuntimeSignature(profile: AgentProfileSessionOptions): string {
  const pathKey = (entry: { scope: string; path: string; resolvedPath: string }) => `${entry.scope}:${entry.path}:${entry.resolvedPath}`;
  return JSON.stringify({
    profileRef: profile.profileRef,
    toolNames: profile.toolNames,
    includeExtensionTools: profile.includeExtensionTools,
    model: { provider: profile.provider ?? "", modelId: profile.modelId ?? "" },
    thinkingLevel: profile.thinkingLevel ?? "",
    extensionToolMode: profile.extensionToolMode,
    instructions: {
      mode: profile.instructions.mode,
      text: profile.instructions.text ?? "",
      files: profile.instructions.files.map(pathKey),
    },
    resources: {
      skillPaths: profile.resources.skillPaths.map(pathKey),
      promptPaths: profile.resources.promptPaths.map(pathKey),
      themePaths: profile.resources.themePaths.map(pathKey),
    },
  });
}

function profileHasPromptContributions(profile: AgentProfileSessionOptions): boolean {
  return profile.instructions.mode !== "default"
    || profile.instructions.files.length > 0
    || Boolean(profile.instructions.text?.trim())
    || profile.resources.skillPaths.length > 0
    || profile.resources.promptPaths.length > 0
    || profile.resources.themePaths.length > 0;
}

function shouldForceEmptySystemPromptForProfile(profile: AgentProfileSessionOptions): boolean {
  return profile.toolNames.length === 0 && !profile.includeExtensionTools && !profileHasPromptContributions(profile);
}

type PersistedProfileState = {
  profileRef: AgentProfileSessionOptions["profileRef"];
  profileName?: string;
  toolPolicySnapshot?: boolean;
  toolNames?: string[];
  includeExtensionTools?: boolean;
  extensionToolMode?: ExtensionToolMode;
  modelOverride?: boolean;
  thinkingOverride?: boolean;
};

type ProfileRuntimeState = {
  cwd: string;
  persisted: PersistedProfileState;
  profile: AgentProfileSessionOptions;
  signature: string;
  snapshots: Set<string>;
  restoreError?: string;
  refresh: () => AgentProfileSessionOptions;
};
type ProfileRuntimeStateRef = { current?: ProfileRuntimeState };

function buildProfileResourceLoaderOptions(profileStateRef: ProfileRuntimeStateRef): ProfileResourceLoaderOptions {
  const emptyResources = { skillPaths: [] as string[], promptPaths: [] as string[], themePaths: [] as string[] };

  return {
    extensionFactories: [(pi: ExtensionAPI) => {
      pi.on("resources_discover", () => {
        const profileState = profileStateRef.current;
        if (!profileState) return emptyResources;
        cleanupProfileSnapshots(profileState);
        const profile = profileState.refresh();
        return {
          skillPaths: profile.resources.skillPaths.map((entry) => checkedProfileResourcePath(entry, profileState.cwd, profileState.snapshots)),
          promptPaths: profile.resources.promptPaths.map((entry) => checkedProfileResourcePath(entry, profileState.cwd, profileState.snapshots)),
          themePaths: profile.resources.themePaths.map((entry) => checkedProfileResourcePath(entry, profileState.cwd, profileState.snapshots)),
        };
      });
      pi.on("before_agent_start", (event) => {
        const profileState = profileStateRef.current;
        if (!profileState) return {};
        const profile = profileState.refresh();
        const instructionText = buildProfileInstructionText(profile, profileState.cwd, profileState.snapshots);
        if (!instructionText) return {};
        return {
          systemPrompt: profile.instructions.mode === "replace"
            ? instructionText
            : `${event.systemPrompt}\n\n${instructionText}`,
        };
      });
    }],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type ProfileStateSessionManager = {
  getEntries: () => Array<{ type: string; customType?: string; data?: unknown }>;
  appendCustomEntry?: (customType: string, data?: unknown) => string;
  getLeafId?: () => string | null;
  branch?: (branchFromId: string) => void;
  resetLeaf?: () => void;
};


function normalizeProfileStateLeaf(sessionManager: ProfileStateSessionManager & { getEntry?: (id: string) => { type?: unknown; customType?: unknown; parentId?: string | null } | undefined }): void {
  let leafId = sessionManager.getLeafId?.() ?? null;
  const seen = new Set<string>();
  while (leafId && !seen.has(leafId)) {
    seen.add(leafId);
    const entry = sessionManager.getEntry?.(leafId);
    if (!isProfileStateEntry(entry)) return;
    leafId = entry?.parentId ?? null;
  }
  if (leafId) sessionManager.branch?.(leafId);
  else sessionManager.resetLeaf?.();
}

function makeUnavailableProfileOptions(profileRef: AgentProfileSessionOptions["profileRef"] = "builtin:no-tools"): AgentProfileSessionOptions {
  return {
    profileRef,
    profileName: "Unavailable profile (tools disabled)",
    toolNames: [],
    includeExtensionTools: false,
    extensionToolMode: "none",
    instructions: { mode: "default", files: [] },
    resources: { skillPaths: [], promptPaths: [], themePaths: [] },
  };
}

function persistedStateFromProfile(
  profile: AgentProfileSessionOptions,
  toolPolicySnapshot = false,
  overrides: { modelOverride?: boolean; thinkingOverride?: boolean } = {},
): PersistedProfileState {
  return {
    profileRef: profile.profileRef,
    profileName: profile.profileName,
    ...(overrides.modelOverride ? { modelOverride: true } : {}),
    ...(overrides.thinkingOverride ? { thinkingOverride: true } : {}),
    ...(toolPolicySnapshot ? {
      toolPolicySnapshot: true,
      toolNames: profile.toolNames,
      includeExtensionTools: profile.includeExtensionTools,
      extensionToolMode: profile.extensionToolMode,
    } : {}),
  };
}

function persistedStateFromEntryData(data: unknown): PersistedProfileState | undefined {
  if (!isRecord(data)) return undefined;
  const profileRef = normalizeAgentProfileRef(data.profileRef);
  if (!profileRef) return undefined;
  const toolNames = Array.isArray(data.toolNames)
    ? data.toolNames.filter((name): name is string => typeof name === "string")
    : undefined;
  const includeExtensionTools = typeof data.includeExtensionTools === "boolean" ? data.includeExtensionTools : undefined;
  const extensionToolMode = data.extensionToolMode === "none" || data.extensionToolMode === "all" || data.extensionToolMode === "selected"
    ? data.extensionToolMode
    : undefined;
  return {
    profileRef,
    ...(typeof data.profileName === "string" ? { profileName: data.profileName } : {}),
    ...(data.toolPolicySnapshot === true ? { toolPolicySnapshot: true } : {}),
    ...(toolNames ? { toolNames } : {}),
    ...(includeExtensionTools !== undefined ? { includeExtensionTools } : {}),
    ...(extensionToolMode ? { extensionToolMode } : {}),
    ...(data.modelOverride === true ? { modelOverride: true } : {}),
    ...(data.thinkingOverride === true ? { thinkingOverride: true } : {}),
  };
}

function profileRestoreErrorMessage(profileRef: AgentProfileSessionOptions["profileRef"], error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `Failed to restore profile ${profileRef}: ${detail}`;
}

function resolveProfileFromPersistedState(cwd: string, persisted: PersistedProfileState): AgentProfileSessionOptions {
  const restored = expandAgentProfileForNewSession(cwd, resolveAgentProfile(cwd, persisted.profileRef));
  const useSnapshot = persisted.toolPolicySnapshot === true;
  const allowedToolNames = new Set([...restored.toolNames, ...CODING_TOOL_NAMES]);
  const snapshotToolNames = persisted.toolNames?.filter((name) => allowedToolNames.has(name));
  const toolNames = useSnapshot && snapshotToolNames
    ? snapshotToolNames
    : restored.toolNames;
  const includeExtensionTools = useSnapshot && persisted.includeExtensionTools !== undefined
    ? persisted.includeExtensionTools
    : restored.includeExtensionTools;
  const extensionToolMode: ExtensionToolMode = useSnapshot
    ? (!includeExtensionTools ? "none" : persisted.extensionToolMode ?? restored.extensionToolMode)
    : restored.extensionToolMode;
  return {
    ...restored,
    ...(persisted.modelOverride ? { provider: undefined, modelId: undefined } : {}),
    ...(persisted.thinkingOverride ? { thinkingLevel: undefined } : {}),
    toolNames,
    includeExtensionTools,
    extensionToolMode,
  };
}

function loadProfileFromPersistedState(cwd: string, persisted: PersistedProfileState): { profile: AgentProfileSessionOptions; restoreError?: string } {
  try {
    return { profile: resolveProfileFromPersistedState(cwd, persisted) };
  } catch (error) {
    const restoreError = profileRestoreErrorMessage(persisted.profileRef, error);
    console.warn("[pi-web] failed to restore persisted profile", persisted.profileRef, error instanceof Error ? error.message : error);
    return { profile: makeUnavailableProfileOptions(persisted.profileRef), restoreError };
  }
}

function createProfileRuntimeState(
  cwd: string,
  profile: AgentProfileSessionOptions | undefined,
  toolPolicySnapshot = false,
  overrides: { modelOverride?: boolean; thinkingOverride?: boolean } = {},
  persistedOverride?: PersistedProfileState,
  restoreError?: string,
 ): ProfileRuntimeState | undefined {
  if (!profile) return undefined;
  const persisted = persistedOverride ?? persistedStateFromProfile(profile, toolPolicySnapshot, overrides);
  const state: ProfileRuntimeState = {
    cwd,
    persisted,
    profile,
    signature: profileRuntimeSignature(profile),
    snapshots: new Set<string>(),
    ...(restoreError ? { restoreError } : {}),
    refresh: () => {
      const restored = loadProfileFromPersistedState(state.cwd, state.persisted);
      state.profile = restored.profile;
      state.restoreError = restored.restoreError;
      state.signature = profileRuntimeSignature(state.profile);
      return state.profile;
    },
  };
  return state;
}

function appendProfileStateEntry(
  sessionManager: ProfileStateSessionManager,
  profile: AgentProfileSessionOptions | undefined,
  toolPolicySnapshot = false,
  overrides: { modelOverride?: boolean; thinkingOverride?: boolean } = {},
): void {
  if (!profile || typeof sessionManager.appendCustomEntry !== "function") return;
  const previousLeafId = sessionManager.getLeafId?.() ?? null;
  sessionManager.appendCustomEntry(PROFILE_STATE_CUSTOM_TYPE, {
    profileRef: profile.profileRef,
    profileName: profile.profileName,
    ...(overrides.modelOverride ? { modelOverride: true } : {}),
    ...(overrides.thinkingOverride ? { thinkingOverride: true } : {}),
    ...(toolPolicySnapshot ? {
      toolPolicySnapshot: true,
      toolNames: profile.toolNames,
      includeExtensionTools: profile.includeExtensionTools,
      extensionToolMode: profile.extensionToolMode,
    } : {}),
    instructionsMode: profile.instructions.mode,
  });
  if (previousLeafId) {
    sessionManager.branch?.(previousLeafId);
  } else {
    sessionManager.resetLeaf?.();
  }
}

function persistProfileStateOnce(
  sessionManager: ProfileStateSessionManager,
  profile: AgentProfileSessionOptions | undefined,
  toolPolicySnapshot = false,
  overrides: { modelOverride?: boolean; thinkingOverride?: boolean } = {},
): void {
  if (!profile) return;
  const alreadyPersisted = sessionManager.getEntries().some(isProfileStateEntry);
  if (alreadyPersisted) return;
  appendProfileStateEntry(sessionManager, profile, toolPolicySnapshot, overrides);
}

function loadPersistedProfileState(sessionManager: ProfileStateSessionManager, cwd: string): { profile: AgentProfileSessionOptions; persisted: PersistedProfileState; restoreError?: string } | undefined {
  const entry = [...sessionManager.getEntries()]
    .reverse()
    .find(isProfileStateEntry);
  if (!entry) return undefined;
  const persisted = persistedStateFromEntryData(entry.data) ?? persistedStateFromProfile(makeUnavailableProfileOptions());
  const restored = loadProfileFromPersistedState(cwd, persisted);
  return { persisted, profile: restored.profile, ...(restored.restoreError ? { restoreError: restored.restoreError } : {}) };
}

const CODING_TOOL_NAMES = ["read", "bash", "edit", "write", "grep", "find", "ls"];

function getExtensionShadowedCodingToolNames(session: AgentSessionLike, toolNames: string[]): string[] {
  const requestedCodingToolNames = new Set(toolNames.filter((name) => CODING_TOOL_NAMES.includes(name)));
  if (requestedCodingToolNames.size === 0) return [];
  return session
    .getAllTools()
    .filter((tool) => requestedCodingToolNames.has(tool.name) && tool.sourceInfo?.source !== "builtin")
    .map((tool) => tool.name);
}

function assertNoExtensionToolShadows(session: AgentSessionLike, toolNames: string[], includeExtensionTools: boolean, extensionToolMode: ExtensionToolMode): void {
  if (includeExtensionTools && extensionToolMode !== "none") return;
  const shadowed = [...new Set(getExtensionShadowedCodingToolNames(session, toolNames))];
  if (shadowed.length > 0) {
    throw new Error(`Profile disables extension tools, but extension tool(s) shadow allowed built-in tool names: ${shadowed.join(", ")}. Rename the extension tool or enable extension tools explicitly.`);
  }
}

function withExtensionTools(session: AgentSessionLike, toolNames: string[], includeExtensionTools: boolean, extensionToolMode: ExtensionToolMode): string[] {
  if (!includeExtensionTools || extensionToolMode === "none") {
    assertNoExtensionToolShadows(session, toolNames, includeExtensionTools, extensionToolMode);
    return [...new Set(toolNames.filter((name) => CODING_TOOL_NAMES.includes(name)))];
  }
  if (extensionToolMode === "selected") return [...new Set(toolNames)];

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
  private listeners: EventListener[] = [];
  private readonly extensionUi: ExtensionUiBridge;
  private promptRunning = false;
  private extensionsBound = false;
  private extensionBindingPromise: Promise<void> | null = null;
  private extensionBindingError: unknown = null;
  private forceEmptySystemPrompt = false;
  private profileSensitiveOperation = false;
  private activeToolNames: string[] | undefined;
  private activeIncludeExtensionTools = true;
  private activeExtensionToolMode: ExtensionToolMode = "all";
  private profilePolicyError: Error | null = null;
  private applyingActiveToolPolicy = false;
  private readonly setActiveToolsByNameUnwrapped: (names: string[]) => void;
  private unsubscribe: (() => void) | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private onDestroyCallback: (() => void) | null = null;
  private _alive = true;

  constructor(public readonly inner: AgentSessionLike, private readonly profileStateRef: ProfileRuntimeStateRef, private readonly cwd: string) {
    this.extensionUi = new ExtensionUiBridge({ emit: (event) => this.emit(event as AgentEvent) });
    this.setActiveToolsByNameUnwrapped = this.inner.setActiveToolsByName.bind(this.inner);
    this.inner.setActiveToolsByName = (names: string[]) => {
      if (this.applyingActiveToolPolicy || this.activeToolNames === undefined) {
        this.setActiveToolsByNameUnwrapped(names);
        return;
      }
      this.applyActiveToolPolicy();
    };
  }

  private get profileState(): ProfileRuntimeState | undefined {
    return this.profileStateRef.current;
  }

  private set profileState(profileState: ProfileRuntimeState | undefined) {
    const previous = this.profileStateRef.current;
    if (previous && previous !== profileState) cleanupProfileSnapshots(previous);
    this.profileStateRef.current = profileState;
  }

  get sessionId(): string {
    return this.inner.sessionId;
  }

  get sessionFile(): string {
    return this.inner.sessionFile ?? "";
  }

  isAlive(): boolean {
    return this._alive;
  }

  isRunning(): boolean {
    return this._alive && (this.profileSensitiveOperation || this.promptRunning || this.inner.isStreaming || this.inner.isCompacting || Boolean(this.inner.isBashRunning));
  }

  private hasActiveAgentRun(): boolean {
    return this.promptRunning || this.inner.isStreaming || this.inner.isCompacting || Boolean(this.inner.isBashRunning);
  }
  private beginProfileSensitiveOperation(): () => void {
    if (this.profileSensitiveOperation) throw new Error("Another profile-sensitive operation is already in progress");
    this.profileSensitiveOperation = true;
    notifyRunningChange();
    return () => {
      this.profileSensitiveOperation = false;
      notifyRunningChange();
    };
  }
  start(): void {
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


  setActiveToolPolicy(toolNames: string[] | undefined, includeExtensionTools: boolean, extensionToolMode: ExtensionToolMode = includeExtensionTools ? "all" : "none", forceEmptySystemPrompt?: boolean): void {
    const noTools = Boolean(toolNames && toolNames.length === 0 && !includeExtensionTools);
    this.activeToolNames = toolNames ? [...toolNames] : undefined;
    this.activeIncludeExtensionTools = includeExtensionTools;
    this.activeExtensionToolMode = extensionToolMode;
    this.forceEmptySystemPrompt = noTools && (forceEmptySystemPrompt ?? true);
    this.applyActiveToolPolicy();
  }

  beginExtensionBinding(options: ExtensionBindingOptions = {}): void {
    void this.ensureExtensionsBound(options).catch((err) => {
      console.error("[pi-web] failed to dispatch session_start to extensions:", err instanceof Error ? err.message : err);
    });
  }

  private ensureExtensionsBound(options: ExtensionBindingOptions = {}): Promise<void> {
    if (options.forceEmptySystemPrompt) this.forceEmptySystemPrompt = true;
    if (this.extensionsBound) {
      this.applyActiveToolPolicy();
      return Promise.resolve();
    }
    if (this.extensionBindingPromise) return this.extensionBindingPromise;

    this.extensionBindingError = null;
    this.extensionBindingPromise = (async () => {
      if (!this._alive) return;
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
      this.extensionsBound = true;
      try {
        this.applyActiveToolPolicy();
      } catch (err) {
        console.warn("[pi-web] profile tool policy rejected extension tools:", err instanceof Error ? err.message : err);
      }
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

  private async withFinalRunningNotification<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } finally {
      notifyRunningChange();
    }
  }
  private applyProfileToolPolicy(profile: AgentProfileSessionOptions): void {
    this.activeToolNames = [...profile.toolNames];
    this.activeIncludeExtensionTools = profile.includeExtensionTools;
    this.activeExtensionToolMode = profile.extensionToolMode;
    this.forceEmptySystemPrompt = shouldForceEmptySystemPromptForProfile(profile);
  }

  private refreshActiveProfilePolicy(): boolean {
    const profileState = this.profileState;
    if (!profileState) return false;
    const previousSignature = profileState.signature;
    const profile = profileState.refresh();
    this.applyProfileToolPolicy(profile);
    return previousSignature !== profileState.signature;
  }

  private assertActiveProfileReady(): void {
    const profileState = this.profileState;
    if (profileState?.restoreError) {
      const error = new Error(profileState.restoreError);
      this.profilePolicyError = error;
      try {
        this.applyActiveToolPolicy();
      } catch {
        // Keep the profile-restore failure as the user-visible blocker.
      }
      this.profilePolicyError = error;
      throw error;
    }
    if (this.profilePolicyError) throw this.profilePolicyError;
    if (!profileState) return;
    const profile = profileState.profile;
    try {
      for (const entry of profile.instructions.files) checkedProfilePath(entry, profileState.cwd, "file");
      for (const entry of profile.resources.skillPaths) checkedProfilePath(entry, profileState.cwd);
      for (const entry of profile.resources.promptPaths) checkedProfilePath(entry, profileState.cwd);
      for (const entry of profile.resources.themePaths) checkedProfilePath(entry, profileState.cwd);
      buildProfileInstructionText(profile, profileState.cwd);
    } catch (error) {
      this.activeToolNames = [];
      this.activeIncludeExtensionTools = false;
      this.activeExtensionToolMode = "none";
      this.forceEmptySystemPrompt = true;
      this.applyActiveToolPolicy();
      throw error;
    }
  }

  private async prepareProfileRuntimeForUserTurn(): Promise<void> {
    const profileState = this.profileState;
    let changed = false;
    if (profileState) {
      const previousSignature = profileState.signature;
      const restored = loadProfileFromPersistedState(profileState.cwd, profileState.persisted);
      const nextSignature = profileRuntimeSignature(restored.profile);
      changed = previousSignature !== nextSignature;
      if (changed && this.hasActiveAgentRun()) {
        throw new Error("Active profile changed while the session is running; wait for the current operation to finish before queueing another message.");
      }
      profileState.profile = restored.profile;
      profileState.restoreError = restored.restoreError;
      profileState.signature = nextSignature;
      this.applyProfileToolPolicy(restored.profile);
      if (restored.restoreError) {
        this.applyActiveToolPolicy();
        throw new Error(restored.restoreError);
      }
    }
    if (changed) {
      await this.inner.reload({
        beforeSessionStart: () => {
          this.inner.extensionRunner.setUIContext?.(this.extensionUi.createContext(), "rpc");
        },
      });
    }
    this.applyActiveToolPolicy();
    if (profileState) await this.applyProfileModelAndThinking(profileState.profile);
    this.assertActiveProfileReady();
  }

  private applyActiveToolPolicy(): void {
    if (this.activeToolNames !== undefined) {
      try {
        const nextToolNames = withExtensionTools(this.inner, this.activeToolNames, this.activeIncludeExtensionTools, this.activeExtensionToolMode);
        this.applyingActiveToolPolicy = true;
        try {
          this.setActiveToolsByNameUnwrapped(nextToolNames);
        } finally {
          this.applyingActiveToolPolicy = false;
        }
        this.profilePolicyError = null;
      } catch (error) {
        const policyError = error instanceof Error ? error : new Error(String(error));
        this.profilePolicyError = policyError;
        this.forceEmptySystemPrompt = true;
        this.applyingActiveToolPolicy = true;
        try {
          this.setActiveToolsByNameUnwrapped([]);
        } finally {
          this.applyingActiveToolPolicy = false;
        }
        this.applyForcedEmptySystemPrompt();
        throw policyError;
      }
    }
    this.applyForcedEmptySystemPrompt();
  }
  private persistProfileStateToSessionFile(sessionFile: string, sessionDir?: string): void {
    const profileState = this.profileState;
    if (!profileState) return;
    const manager = SessionManager.open(sessionFile, sessionDir);
    appendProfileStateEntry(manager, profileState.profile, profileState.persisted.toolPolicySnapshot === true, {
      modelOverride: profileState.persisted.modelOverride === true,
      thinkingOverride: profileState.persisted.thinkingOverride === true,
    });
    const verified = manager.getEntries().some(isProfileStateEntry);
    if (!verified) throw new Error("Profile state was not written to the branched session");
  }

  private persistProfileOverrideFlags(overrides: { modelOverride?: boolean; thinkingOverride?: boolean }): void {
    const profileState = this.profileState;
    if (!profileState) return;
    profileState.persisted = {
      ...profileState.persisted,
      ...(overrides.modelOverride ? { modelOverride: true } : {}),
      ...(overrides.thinkingOverride ? { thinkingOverride: true } : {}),
    };
    const restored = loadProfileFromPersistedState(profileState.cwd, profileState.persisted);
    profileState.profile = restored.profile;
    profileState.restoreError = restored.restoreError;
    profileState.signature = profileRuntimeSignature(profileState.profile);
    appendProfileStateEntry(this.inner.sessionManager, profileState.profile, profileState.persisted.toolPolicySnapshot === true, {
      modelOverride: profileState.persisted.modelOverride === true,
      thinkingOverride: profileState.persisted.thinkingOverride === true,
    });
  }
  private applyForcedEmptySystemPrompt(): void {
    if (this.forceEmptySystemPrompt && this.inner.agent.state) {
      (this.inner as unknown as { _baseSystemPrompt?: string })._baseSystemPrompt = "";
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

  private setThinkingLevel(level: string): void {
    this.inner.setThinkingLevel(level);
    if (level === "xhigh" && (this.inner.model as { compat?: { thinkingFormat?: string } } | null)?.compat?.thinkingFormat === "deepseek" && this.inner.agent?.state) {
      this.inner.agent.state.thinkingLevel = "xhigh";
    }
  }

  private restoreSessionModelForProfile(model: ModelLike | undefined): void {
    const state = this.inner.agent.state as (typeof this.inner.agent.state & { model?: ModelLike }) | undefined;
    if (!state) return;
    if (model) state.model = model;
    else delete state.model;
  }
  private setSessionModelForProfile(model: ModelLike): void {
    const state = this.inner.agent.state as (typeof this.inner.agent.state & { model?: ModelLike }) | undefined;
    if (!state) throw new Error("Agent state is not available for profile model application");
    if (this.inner.model?.provider === model.provider && this.inner.model.id === model.id) return;
    state.model = model;
  }

  private setSessionThinkingLevelForProfile(level: AgentProfileSessionOptions["thinkingLevel"]): void {
    const state = this.inner.agent.state;
    if (!state) return;
    const model = this.inner.model;
    const deepSeekXHigh = level === "xhigh" && (model as { compat?: { thinkingFormat?: string } } | undefined)?.compat?.thinkingFormat === "deepseek";
    const effectiveLevel = deepSeekXHigh
      ? "xhigh"
      : model
        ? String(clampThinkingLevel(model as never, level as never))
        : "off";
    state.thinkingLevel = effectiveLevel;
  }

  applyProfileModelAndThinking(profile: AgentProfileSessionOptions): void {
    if (profile.provider && profile.modelId) {
      const model = this.inner.modelRegistry.find(profile.provider, profile.modelId);
      if (!model) throw new Error(`Model not found: ${profile.provider}/${profile.modelId}`);
      const registry = this.inner.modelRegistry as typeof this.inner.modelRegistry & { hasConfiguredAuth?: (model: ModelLike) => boolean };
      if (registry.hasConfiguredAuth && !registry.hasConfiguredAuth(model)) {
        throw new Error(`No API key for ${model.provider}/${model.id}`);
      }
      this.setSessionModelForProfile(model);
    }
    if (profile.thinkingLevel) this.setSessionThinkingLevelForProfile(profile.thinkingLevel);
  }

  async send(command: Record<string, unknown>): Promise<unknown> {
    this.resetIdleTimer();
    const type = command.type as string;
    if (this.shouldWaitForExtensions(type)) await this.waitForExtensionsBound();

    switch (type) {
      case "prompt": {
        // Fire and forget — events come via subscribe
        const message = command.message as string;
        const promptImages = command.images as Array<{ type: "image"; data: string; mimeType: string }> | undefined;
        const streamingBehavior = command.streamingBehavior as "steer" | "followUp" | undefined;
        const releaseOperation = this.beginProfileSensitiveOperation();
        try {
          await this.prepareProfileRuntimeForUserTurn();
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
        } finally {
          releaseOperation();
        }
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
          profile: this.profileState ? {
            ref: this.profileState.profile.profileRef,
            name: this.profileState.profile.profileName,
            ...((this.profileState.restoreError ?? this.profilePolicyError?.message) ? {
              error: this.profileState.restoreError ?? this.profilePolicyError?.message,
              missing: Boolean(this.profileState.restoreError),
            } : {}),
          } : null,
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
        if (this.isRunning()) throw new Error("Cannot change model while the session is running");
        const releaseOperation = this.beginProfileSensitiveOperation();
        try {
          const { provider, modelId } = command as { provider: string; modelId: string };
          const registry = this.inner.modelRegistry;
          const model = registry.find(provider, modelId);
          if (!model) throw new Error(`Model not found: ${provider}/${modelId}`);
          await this.inner.setModel(model);
          this.persistProfileOverrideFlags({ modelOverride: true });
          return { id: model.id, provider: model.provider };
        } finally {
          releaseOperation();
        }
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

        this.persistProfileStateToSessionFile(newSessionFile, sessionDir);
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
        this.persistProfileStateToSessionFile(newSessionFile, sessionManager.getSessionDir());
        cacheSessionPath(newSessionId, newSessionFile);
        return { cancelled: false, newSessionId };
      }

      case "navigate_tree": {
        const result = await this.inner.navigateTree(command.targetId as string, { summarize: command.summarize === true });
        return { cancelled: result.cancelled };
      }

      case "set_thinking_level": {
        if (this.isRunning()) throw new Error("Cannot change thinking level while the session is running");
        const releaseOperation = this.beginProfileSensitiveOperation();
        try {
          const level = command.level as string;
          if (level !== "auto") this.setThinkingLevel(level);
          this.persistProfileOverrideFlags({ thinkingOverride: true });
          return null;
        } finally {
          releaseOperation();
        }
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
        const releaseOperation = this.beginProfileSensitiveOperation();
        try {
          await this.prepareProfileRuntimeForUserTurn();
          await this.inner.steer(command.message as string, steerImages?.length ? steerImages : undefined);
          return null;
        } finally {
          releaseOperation();
        }
      }

      case "follow_up": {
        const followImages = command.images as Array<{ type: "image"; data: string; mimeType: string }> | undefined;
        const releaseOperation = this.beginProfileSensitiveOperation();
        try {
          await this.prepareProfileRuntimeForUserTurn();
          await this.inner.followUp(command.message as string, followImages?.length ? followImages : undefined);
          return null;
        } finally {
          releaseOperation();
        }
      }

      case "get_tools": {
        const all: ToolInfo[] = this.inner.getAllTools();
        const active = new Set<string>(this.inner.getActiveToolNames());
        return all.map((t) => ({
          name: t.name,
          description: t.description,
          active: active.has(t.name),
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
        const releaseOperation = this.beginProfileSensitiveOperation();
        try {
          await this.prepareProfileRuntimeForUserTurn();
          if (!this.hasOpenAIFastCommand()) {
            throw new Error(`OpenAI Fast mode is not available in this session. Install or reload the ${PI_CODEX_FAST_PACKAGE_NAME} plugin.`);
          }

          const currentFastMode = getPiCodexFastModeState(this.inner.model);
          if (!currentFastMode.eligible) {
            throw new Error("OpenAI Fast mode is unavailable for the current model.");
          }

          await this.inner.prompt(`/fast ${currentFastMode.active ? "off" : "on"}`, { source: "rpc" });
        } finally {
          releaseOperation();
        }
        return {
          extensionStatuses: this.extensionUi.getStatuses(),
          extensionWidgets: this.extensionUi.getWidgets(),
          openAIFastMode: getPiCodexFastModeState(this.inner.model),
          openAIFastConfig: loadPiCodexFastModeConfig(),
        };
      }

      case "set_profile": {
        const profileRef = normalizeAgentProfileRef(command.profileRef);
        if (!profileRef) throw new Error("profileRef must be a valid profile reference");
        if (this.isRunning()) throw new Error("Cannot switch profiles while the session is running");
        const releaseOperation = this.beginProfileSensitiveOperation();
        try {
          await this.waitForExtensionsBound();
          const currentProfileState = this.profileState;
          const profileCwd = currentProfileState?.cwd ?? this.cwd;
          const profile = expandAgentProfileForNewSession(profileCwd, resolveAgentProfile(profileCwd, profileRef));
          const model = profile.provider && profile.modelId ? this.inner.modelRegistry.find(profile.provider, profile.modelId) : undefined;
          if (profile.provider && profile.modelId && !model) throw new Error(`Model not found: ${profile.provider}/${profile.modelId}`);
          const previousState = currentProfileState ? {
            cwd: currentProfileState.cwd,
            persisted: currentProfileState.persisted,
            profile: currentProfileState.profile,
            signature: currentProfileState.signature,
          } : undefined;
          const previousActiveToolNames = this.activeToolNames ? [...this.activeToolNames] : undefined;
          const previousIncludeExtensionTools = this.activeIncludeExtensionTools;
          const previousExtensionToolMode = this.activeExtensionToolMode;
          const previousForceEmptySystemPrompt = this.forceEmptySystemPrompt;
          const previousModel = this.inner.model;
          const previousThinkingLevel = this.inner.agent.state?.thinkingLevel;
          const reloadWithCurrentProfile = async () => {
            await this.inner.reload({
              beforeSessionStart: () => {
                this.inner.extensionRunner.setUIContext?.(this.extensionUi.createContext(), "rpc");
              },
            });
          };
          try {
            const nextState = createProfileRuntimeState(profileCwd, profile);
            if (!nextState) throw new Error("Unable to create profile runtime state");
            this.profileState = nextState;
            this.setActiveToolPolicy(profile.toolNames, profile.includeExtensionTools, profile.extensionToolMode, shouldForceEmptySystemPromptForProfile(profile));
            await reloadWithCurrentProfile();
            await this.applyProfileModelAndThinking(profile);
            appendProfileStateEntry(this.inner.sessionManager, profile);
            return { profileRef: profile.profileRef, profileName: profile.profileName };
          } catch (error) {
            const rollbackErrors: unknown[] = [];
            if (previousState) {
              const restoredState: ProfileRuntimeState = {
                ...previousState,
                snapshots: new Set<string>(),
                refresh: () => {
                  const restored = loadProfileFromPersistedState(restoredState.cwd, restoredState.persisted);
                  restoredState.profile = restored.profile;
                  restoredState.restoreError = restored.restoreError;
                  restoredState.signature = profileRuntimeSignature(restoredState.profile);
                  return restoredState.profile;
                },
              };
              this.profileState = restoredState;
            } else {
              this.profileState = undefined;
            }
            try {
              await reloadWithCurrentProfile();
            } catch (rollbackError) {
              rollbackErrors.push(rollbackError);
            }
            try {
              this.activeToolNames = previousActiveToolNames ? [...previousActiveToolNames] : undefined;
              this.activeIncludeExtensionTools = previousIncludeExtensionTools;
              this.activeExtensionToolMode = previousExtensionToolMode;
              this.forceEmptySystemPrompt = previousForceEmptySystemPrompt;
              this.applyActiveToolPolicy();
            } catch (rollbackError) {
              rollbackErrors.push(rollbackError);
            }
            try {
              this.restoreSessionModelForProfile(previousModel);
            } catch (rollbackError) {
              rollbackErrors.push(rollbackError);
            }
            try {
              if (typeof previousThinkingLevel === "string") this.setSessionThinkingLevelForProfile(previousThinkingLevel as AgentProfileSessionOptions["thinkingLevel"]);
            } catch (rollbackError) {
              rollbackErrors.push(rollbackError);
            }
            try {
              if (previousState) appendProfileStateEntry(this.inner.sessionManager, previousState.profile, previousState.persisted.toolPolicySnapshot === true, {
                modelOverride: previousState.persisted.modelOverride === true,
                thinkingOverride: previousState.persisted.thinkingOverride === true,
              });
              normalizeProfileStateLeaf(this.inner.sessionManager);
            } catch (rollbackError) {
              rollbackErrors.push(rollbackError);
            }
            if (rollbackErrors.length > 0) {
              console.error("[pi-web] failed to fully rollback profile switch:", rollbackErrors.map((rollbackError) => rollbackError instanceof Error ? rollbackError.message : String(rollbackError)).join("; "));
            }
            throw error;
          }
        } finally {
          releaseOperation();
        }
      }

      case "set_tools": {
        if (this.isRunning()) throw new Error("Cannot change tools while the session is running");
        const releaseOperation = this.beginProfileSensitiveOperation();
        try {
          const toolNames = command.toolNames as string[];
          const includeExtensionTools = typeof command.includeExtensionTools === "boolean"
            ? command.includeExtensionTools as boolean
            : toolNames.length > 0;
          const profileState = this.profileState;
          const nextProfile = profileState ? {
            ...profileState.profile,
            toolNames: [...toolNames],
            includeExtensionTools,
            extensionToolMode: includeExtensionTools ? "all" as const : "none" as const,
          } : undefined;
          this.setActiveToolPolicy(toolNames, includeExtensionTools, includeExtensionTools ? "all" : "none", nextProfile ? shouldForceEmptySystemPromptForProfile(nextProfile) : undefined);
          if (profileState) {
            profileState.profile = nextProfile!;
            profileState.persisted = persistedStateFromProfile(profileState.profile, true, {
              modelOverride: profileState.persisted.modelOverride === true,
              thinkingOverride: profileState.persisted.thinkingOverride === true,
            });
            profileState.signature = profileRuntimeSignature(profileState.profile);
            appendProfileStateEntry(this.inner.sessionManager, profileState.profile, true, {
              modelOverride: profileState.persisted.modelOverride === true,
              thinkingOverride: profileState.persisted.thinkingOverride === true,
            });
          }
          return null;
        } finally {
          releaseOperation();
        }
      }

      case "reload": {
        if (this.isRunning()) throw new Error("Cannot reload while the session is running");
        const releaseOperation = this.beginProfileSensitiveOperation();
        try {
          await this.waitForExtensionsBound();
          this.extensionUi.clearPersistentUi();
          this.refreshActiveProfilePolicy();
          await this.inner.reload();
          if (typeof this.inner.bindExtensions !== "function") {
            this.inner.extensionRunner.setUIContext?.(this.extensionUi.createContext(), "rpc");
          }
          this.applyActiveToolPolicy();
          if (this.profileState) await this.applyProfileModelAndThinking(this.profileState.profile);
          return { success: true };
        } finally {
          releaseOperation();
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

  destroy(): void {
    if (!this._alive) return;
    this._alive = false;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.unsubscribe?.();
    cleanupProfileSnapshots(this.profileState);
    this.extensionUi.destroy();
    this.onDestroyCallback?.();
    notifyRunningChange();
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
        if (this.isRunning()) throw new Error("Cannot reload while the session is running");
        const releaseOperation = this.beginProfileSensitiveOperation();
        try {
          this.extensionUi.clearPersistentUi();
          this.refreshActiveProfilePolicy();
          await this.inner.reload({
            beforeSessionStart: () => {
              this.inner.extensionRunner.setUIContext?.(this.extensionUi.createContext(), "rpc");
            },
          });
          this.applyActiveToolPolicy();
          if (this.profileState) await this.applyProfileModelAndThinking(this.profileState.profile);
        } finally {
          releaseOperation();
        }
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
    const cleanup = () => globalThis.__piSessions?.forEach((s) => s.destroy());
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
export interface StartRpcSessionOptions {
  includeExtensionTools?: boolean;
  profile?: AgentProfileSessionOptions;
  profileToolPolicySnapshot?: boolean;
  profileModelOverride?: boolean;
  profileThinkingOverride?: boolean;
}

/**
 * Get or create an AgentSession for the given session.
 * For new sessions (sessionFile === ""), pi generates its own id.
 * Pass toolNames to pre-configure active tools (empty array = all tools disabled
 * unless includeExtensionTools is true).
 */
export async function startRpcSession(
  sessionId: string,
  sessionFile: string,
  cwd: string,
  toolNames?: string[],
  options: StartRpcSessionOptions = {},
): Promise<{ session: AgentSessionWrapper; realSessionId: string }> {
  const registry = getRegistry();
  const locks = getLocks();

  const existing = registry.get(sessionId);
  if (existing?.isAlive()) return { session: existing, realSessionId: sessionId };

  const inflight = locks.get(sessionId);
  if (inflight) return inflight;

  const starting = (async () => {
    const agentDir = getAgentDir();

    const sessionManager = sessionFile
      ? SessionManager.open(sessionFile, undefined)
      : SessionManager.create(cwd, undefined);
    normalizeProfileStateLeaf(sessionManager);
    const persistedProfileState = !options.profile && sessionFile ? loadPersistedProfileState(sessionManager, cwd) : undefined;
    const profileOptions = options.profile ?? persistedProfileState?.profile;
    const profileToolPolicySnapshot = options.profileToolPolicySnapshot === true || persistedProfileState?.persisted.toolPolicySnapshot === true;
    const effectiveToolNames = toolNames ?? profileOptions?.toolNames;
    const includeExtensionTools = options.includeExtensionTools ?? profileOptions?.includeExtensionTools ?? Boolean(effectiveToolNames && effectiveToolNames.length > 0);

    // Keep the complete tool registry loaded even for no-tools profiles; the
    // wrapper applies the active allow-list before any prompt runs, which lets
    // an idle no-tools session switch back to a tool-enabled profile later.

    const profileStateRef: ProfileRuntimeStateRef = { current: createProfileRuntimeState(cwd, profileOptions, profileToolPolicySnapshot, {
      modelOverride: options.profileModelOverride === true || persistedProfileState?.persisted.modelOverride === true,
      thinkingOverride: options.profileThinkingOverride === true || persistedProfileState?.persisted.thinkingOverride === true,
    }, persistedProfileState?.persisted, persistedProfileState?.restoreError) };
    const resourceLoaderOptions = buildProfileResourceLoaderOptions(profileStateRef);

    // Build services first so extension-registered providers are available
    // before the SDK restores the saved model from the session file.
    const services = await createAgentSessionServices({
      cwd,
      agentDir,
      resourceLoaderOptions,
    });
    if (profileOptions?.provider && profileOptions.modelId) {
      const profileModel = services.modelRegistry.find(profileOptions.provider, profileOptions.modelId);
      if (!profileModel) throw new Error(`Model not found: ${profileOptions.provider}/${profileOptions.modelId}`);
      const registry = services.modelRegistry as typeof services.modelRegistry & { hasConfiguredAuth?: (model: ModelLike) => boolean };
      if (registry.hasConfiguredAuth && !registry.hasConfiguredAuth(profileModel)) {
        throw new Error(`No API key for ${profileModel.provider}/${profileModel.id}`);
      }
    }
    const { session: inner } = await createAgentSessionFromServices({
      services,
      sessionManager,
    });

    if (!sessionFile) persistProfileStateOnce(sessionManager, profileOptions, profileToolPolicySnapshot, {
      modelOverride: options.profileModelOverride === true,
      thinkingOverride: options.profileThinkingOverride === true,
    });

    const extensionToolMode = profileOptions?.extensionToolMode ?? (includeExtensionTools ? "all" : "none");
    const wrapper = new AgentSessionWrapper(inner, profileStateRef, cwd);
    const forceEmptySystemPrompt = profileOptions
      ? shouldForceEmptySystemPromptForProfile(profileOptions)
      : Boolean(effectiveToolNames && effectiveToolNames.length === 0 && !includeExtensionTools);
    wrapper.setActiveToolPolicy(effectiveToolNames, includeExtensionTools, extensionToolMode, forceEmptySystemPrompt);
    if (profileOptions) await wrapper.applyProfileModelAndThinking(profileOptions);
    wrapper.start();

    const realSessionId = inner.sessionId as string;
    const realSessionFile = inner.sessionFile as string | undefined;
    if (realSessionFile) cacheSessionPath(realSessionId, realSessionFile);

    wrapper.onDestroy(() => registry.delete(realSessionId));
    registry.set(realSessionId, wrapper);
    wrapper.beginExtensionBinding({ forceEmptySystemPrompt });

    return { session: wrapper, realSessionId };
  })().finally(() => locks.delete(sessionId));

  locks.set(sessionId, starting);
  return starting;
}
