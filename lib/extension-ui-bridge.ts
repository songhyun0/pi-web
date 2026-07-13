import { Theme } from "@earendil-works/pi-coding-agent";
import { randomUUID } from "crypto";
import type { ExtensionUiContextLike } from "./pi-types";
import type { ExtensionChromeState, ExtensionCompatibilityItem, ExtensionStatusItem, ExtensionUiRequest, ExtensionUiResponse, ExtensionWidgetItem } from "./types";

export interface ExtensionUiAgentEvent {
  type: string;
  [key: string]: unknown;
}

type PendingUiResponse = {
  resolve: (response: ExtensionUiResponse) => void;
  cancel: () => void;
};

type ExtensionUiRequestBody = Record<string, unknown> & {
  method: ExtensionUiRequest["method"];
  timeout?: number;
  expiresAt?: number;
};

type TerminalSize = {
  columns: number;
  rows: number;
};

type CompatTui = {
  terminal: TerminalSize;
  requestRender: () => void;
};

type CompatKeybindings = {
  matches: (data: string, keybinding: string) => boolean;
};
type RenderableComponent = {
  render: (width: number) => string[];
  handleInput?: (data: string) => void;
  dispose?: () => void;
  invalidate?: () => void;
};

type ActiveCustomUi = {
  id: string;
  component: RenderableComponent;
  size: TerminalSize;
  resolve: (value: unknown) => void;
  settled: boolean;
};

type AutocompleteItemLike = {
  label?: unknown;
  value?: unknown;
  text?: unknown;
  description?: unknown;
  detail?: unknown;
  replaceRange?: unknown;
};

type AutocompleteSuggestionsLike = {
  items?: unknown;
  prefix?: unknown;
};

type AutocompleteProviderLike = {
  getSuggestions?: (
    lines: string[],
    cursorLine: number,
    cursorColumn: number,
    options?: { signal?: AbortSignal },
  ) => unknown | Promise<unknown>;
  applyCompletion?: (
    item: AutocompleteItemLike,
    lines: string[],
    cursorLine: number,
    cursorColumn: number,
  ) => unknown;
};

type ExtensionAutocompleteProviderState = {
  id: string;
  label?: string;
  active: boolean;
};

type RegisteredAutocompleteProvider = {
  id: string;
  label?: string;
  provider: unknown;
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

type ActiveWidget = {
  key: string;
  placement: "aboveEditor" | "belowEditor";
  size: TerminalSize;
  lines: string[];
  component?: RenderableComponent;
};

type ExtensionUiBridgeOptions = {
  emit: (event: ExtensionUiAgentEvent) => void;
};


const DEFAULT_CUSTOM_COLUMNS = 92;
const DEFAULT_CUSTOM_ROWS = 32;
const DEFAULT_WIDGET_COLUMNS = 92;
const DEFAULT_WIDGET_ROWS = 12;

const ANSI_FG: Record<string, number> = {
  accent: 34,
  border: 90,
  dim: 90,
  error: 31,
  muted: 90,
  success: 32,
  text: 39,
  toolOutput: 39,
  toolTitle: 36,
  warning: 33,
};

const ANSI_BG: Record<string, number> = {
  selectedBg: 44,
  toolErrorBg: 41,
};

function sgr(codes: number[], text: string): string {
  if (!text) return text;
  return `\x1b[${codes.join(";")}m${text}\x1b[0m`;
}

class CompatTheme extends Theme {
  constructor() {
    super(
      { thinkingXhigh: "" } as ConstructorParameters<typeof Theme>[0],
      {} as ConstructorParameters<typeof Theme>[1],
      "truecolor",
    );
  }

  override fg(...[token, text]: Parameters<Theme["fg"]>): string { return sgr([ANSI_FG[token] ?? 39], text); }
  override bg(...[token, text]: Parameters<Theme["bg"]>): string { return sgr([ANSI_BG[token] ?? 49], text); }
  override bold(text: string): string { return sgr([1], text); }
  dim(text: string): string { return sgr([2], text); }
  override italic(text: string): string { return sgr([3], text); }
  override underline(text: string): string { return sgr([4], text); }
  override inverse(text: string): string { return sgr([7], text); }
  override strikethrough(text: string): string { return sgr([9], text); }
  override getFgAnsi(...[token]: Parameters<Theme["getFgAnsi"]>): string { return `\x1b[${ANSI_FG[token] ?? 39}m`; }
  override getBgAnsi(...[token]: Parameters<Theme["getBgAnsi"]>): string { return `\x1b[${ANSI_BG[token] ?? 49}m`; }
  override getThinkingBorderColor(): (text: string) => string { return (text) => text; }
  override getBashModeBorderColor(): (text: string) => string { return (text) => text; }
}

function createCompatTheme(): CompatTheme {
  return new CompatTheme();
}

function normalizeLines(value: unknown): string[] | null {
  if (Array.isArray(value)) return value.map((line) => String(line));
  if (typeof value === "string") return value.split("\n");
  return null;
}

function isRenderableComponent(value: unknown): value is RenderableComponent {
  return !!value
    && typeof value === "object"
    && typeof (value as { render?: unknown }).render === "function";
}

function stringifyAutocompleteValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return String(value);
}

function resolveAutocompleteProviderLabel(provider: unknown): string | undefined {
  if (!provider || typeof provider !== "object") return undefined;
  const record = provider as Record<string, unknown>;
  return stringifyAutocompleteValue(record.label ?? record.name ?? record.id);
}

function normalizeAutocompleteProvider(provider: unknown, current?: AutocompleteProviderLike): AutocompleteProviderLike | null {
  if (!provider) return null;
  if (typeof provider === "function") {
    try {
      const resolved = provider(current);
      return normalizeAutocompleteProvider(resolved, current);
    } catch {
      return null;
    }
  }
  if (typeof provider !== "object") return null;
  const record = provider as AutocompleteProviderLike;
  return typeof record.getSuggestions === "function" ? record : null;
}

const EMPTY_AUTOCOMPLETE_PROVIDER: AutocompleteProviderLike = {
  getSuggestions: () => null,
};

function normalizeAutocompleteSuggestions(value: unknown): { items: AutocompleteItemLike[]; prefix?: string } | null {
  if (Array.isArray(value)) return { items: value.filter((item): item is AutocompleteItemLike => !!item && typeof item === "object") };
  if (!value || typeof value !== "object") return null;
  const record = value as AutocompleteSuggestionsLike;
  const items = Array.isArray(record.items)
    ? record.items.filter((item): item is AutocompleteItemLike => !!item && typeof item === "object")
    : [];
  return {
    items,
    prefix: typeof record.prefix === "string" ? record.prefix : undefined,
  };
}
function safeRender(component: RenderableComponent, width: number): string[] {
  try {
    return normalizeLines(component.render(width)) ?? [];
  } catch (error) {
    return [`Extension UI render failed: ${error instanceof Error ? error.message : String(error)}`];
  }
}

function safeDispose(component: RenderableComponent | undefined): void {
  if (!component) return;
  try {
    component.dispose?.();
  } catch {
    // Ignore dispose errors from extension UI components.
  }
}

function safeInvalidate(component: RenderableComponent | undefined): void {
  if (!component) return;
  try {
    component.invalidate?.();
  } catch {
    // Ignore invalidate errors from extension UI components.
  }
}

function resolveOverlayOptions(options: unknown): Record<string, unknown> | undefined {
  if (!options || typeof options !== "object") return undefined;
  const overlayOptions = (options as { overlayOptions?: unknown }).overlayOptions;
  const resolved = typeof overlayOptions === "function" ? overlayOptions() : overlayOptions;
  return resolved && typeof resolved === "object" ? resolved as Record<string, unknown> : undefined;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(min, Math.min(max, Math.round(value)))
    : fallback;
}

function getInitialCustomSize(options: unknown): TerminalSize {
  const overlayOptions = resolveOverlayOptions(options);
  const width = overlayOptions?.width;
  const columns = typeof width === "number"
    ? clampInt(width, DEFAULT_CUSTOM_COLUMNS, 40, 180)
    : width === "100%"
      ? 120
      : DEFAULT_CUSTOM_COLUMNS;
  const rows = clampInt(overlayOptions?.height ?? overlayOptions?.maxHeight, DEFAULT_CUSTOM_ROWS, 10, 80);
  return { columns, rows };
}

function matchesAny(data: string, values: string[]): boolean {
  return values.includes(data);
}

function createCompatKeybindings(): CompatKeybindings {
  return {
    matches: (data, keybinding) => {
      switch (keybinding) {
        case "tui.select.up":
        case "tui.editor.up":
        case "up":
          return matchesAny(data, ["\x1b[A", "\x10"]);
        case "tui.select.down":
        case "tui.editor.down":
        case "down":
          return matchesAny(data, ["\x1b[B", "\x0e"]);
        case "tui.select.left":
        case "tui.editor.left":
        case "left":
          return data === "\x1b[D";
        case "tui.select.right":
        case "tui.editor.right":
        case "right":
          return data === "\x1b[C";
        case "tui.select.confirm":
        case "tui.editor.submit":
        case "return":
        case "enter":
          return data === "\r" || data === "\n";
        case "tui.select.cancel":
        case "tui.editor.cancel":
        case "escape":
        case "esc":
          return data === "\x1b" || data === "\x03";
        case "tab":
          return data === "\t";
        case "backspace":
          return data === "\x7f" || data === "\b";
        default:
          return false;
      }
    },
  };
}

export class ExtensionUiBridge {
  private readonly emit: (event: ExtensionUiAgentEvent) => void;
  private readonly pendingUiResponses = new Map<string, PendingUiResponse>();
  private readonly pendingUiRequests = new Map<string, ExtensionUiAgentEvent>();
  private readonly activeCustomUis = new Map<string, ActiveCustomUi>();
  private readonly extensionStatuses = new Map<string, string>();
  private readonly extensionWidgets = new Map<string, ActiveWidget>();
  private readonly autocompleteProviders = new Map<string, RegisteredAutocompleteProvider>();
  private readonly compatibilityReports = new Map<string, ExtensionCompatibilityItem>();
  private readonly theme = createCompatTheme();
  private readonly keybindings = createCompatKeybindings();
  private headerLines: string[] = [];
  private footerLines: string[] = [];
  private working: ExtensionChromeState["working"] = { visible: false };
  private editorTextSnapshot = "";
  private toolsExpanded = false;

  constructor(options: ExtensionUiBridgeOptions) {
    this.emit = options.emit;
  }

  createContext(): ExtensionUiContextLike {
    return {
      select: (title, options, opts) => this.requestExtensionUi(
        { method: "select", title, options, ...(opts?.timeout ? { timeout: opts.timeout } : {}) },
        undefined,
        (response) => "value" in response ? response.value : undefined,
        opts?.timeout,
        opts?.signal,
      ),
      confirm: (title, message, opts) => this.requestExtensionUi(
        { method: "confirm", title, message, ...(opts?.timeout ? { timeout: opts.timeout } : {}) },
        false,
        (response) => "confirmed" in response ? response.confirmed : false,
        opts?.timeout,
        opts?.signal,
      ),
      input: (title, placeholder, opts) => this.requestExtensionUi(
        { method: "input", title, ...(placeholder !== undefined ? { placeholder } : {}), ...(opts?.timeout ? { timeout: opts.timeout } : {}) },
        undefined,
        (response) => "value" in response ? response.value : undefined,
        opts?.timeout,
        opts?.signal,
      ),
      editor: (title, prefill, opts) => this.requestExtensionUi(
        { method: "editor", title, ...(prefill !== undefined ? { prefill } : {}), ...(opts?.timeout ? { timeout: opts.timeout } : {}) },
        undefined,
        (response) => "value" in response ? response.value : undefined,
        opts?.timeout,
        opts?.signal,
      ),
      notify: (message, type) => {
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "notify",
          message,
          notifyType: type,
        } as ExtensionUiRequest as ExtensionUiAgentEvent);
      },
      onTerminalInput: () => () => {},
      requestRender: () => this.renderAllActiveUi(),
      setStatus: (key, text) => this.setStatus(key, text),
      setWorkingMessage: (message) => this.setWorkingMessage(message),
      setWorkingVisible: (visible) => this.setWorkingVisible(visible),
      setWorkingIndicator: (indicator) => this.setWorkingIndicator(indicator),
      setHiddenThinkingLabel: (label) => this.recordCompatibility(
        "ctx.ui.setHiddenThinkingLabel",
        "degraded",
        `Hidden thinking label${label ? ` '${label}'` : ""} is not separately rendered in web; use status/header/footer instead.`,
      ),
      setWidget: (key, content, options) => this.setWidget(key, content, options),
      setFooter: (content) => this.setChromeSlot("footer", content),
      setHeader: (content) => this.setChromeSlot("header", content),
      setTitle: (title) => {
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "setTitle",
          title,
        } as ExtensionUiRequest as ExtensionUiAgentEvent);
      },
      custom: <T = unknown>(factory: unknown, options?: unknown) => this.requestExtensionCustomUi<T>(factory, options),
      pasteToEditor: (text) => this.pasteEditorText(text),
      setEditorText: (text) => this.setEditorText(text),
      getEditorText: () => this.editorTextSnapshot,
      addAutocompleteProvider: (provider) => this.addAutocompleteProvider(provider),
      setEditorComponent: (component) => this.setEditorComponent(component),
      getEditorComponent: () => undefined,
      theme: this.theme,
      getAllThemes: () => this.getAllThemes(),
      getTheme: (name) => this.getTheme(name),
      setTheme: (theme) => this.setTheme(theme),
      getToolsExpanded: () => this.toolsExpanded,
      setToolsExpanded: (expanded) => { this.toolsExpanded = expanded; },
    };
  }

  getStatuses(): ExtensionStatusItem[] {
    return Array.from(this.extensionStatuses, ([key, text]) => ({ key, text }));
  }

  getWidgets(): ExtensionWidgetItem[] {
    return Array.from(this.extensionWidgets.values())
      .map((widget) => this.renderWidget(widget))
      .filter((widget) => widget.lines.length > 0);
  }

  getChrome(): ExtensionChromeState {
    return {
      headerLines: [...this.headerLines],
      footerLines: [...this.footerLines],
      working: { ...this.working, frames: this.working.frames ? [...this.working.frames] : undefined },
    };
  }

  getCompatibilityReports(): ExtensionCompatibilityItem[] {
    return Array.from(this.compatibilityReports.values());
  }

  getAutocompleteProviders(): ExtensionAutocompleteProviderState[] {
    return Array.from(this.autocompleteProviders.values()).map((provider) => ({
      id: provider.id,
      label: provider.label,
      active: true,
    }));
  }
  getPendingRequests(): ExtensionUiAgentEvent[] {
    return Array.from(this.pendingUiRequests.values());
  }

  clearPersistentUi(): void {
    this.extensionStatuses.clear();
    for (const widget of this.extensionWidgets.values()) {
      safeDispose(widget.component);
      safeInvalidate(widget.component);
    }
    this.extensionWidgets.clear();
    this.autocompleteProviders.clear();
    this.headerLines = [];
    this.footerLines = [];
    this.working = { visible: false };
    this.emitChrome();
  }
  destroy(): void {
    for (const pending of this.pendingUiResponses.values()) pending.cancel();
    for (const id of Array.from(this.activeCustomUis.keys())) this.closeCustomUi(id, undefined);
    this.pendingUiResponses.clear();
    this.pendingUiRequests.clear();
    this.clearPersistentUi();
  }

  setEditorTextSnapshot(text: string): void {
    this.editorTextSnapshot = text;
  }

  async queryAutocomplete(text: string, cursor: number, signal?: AbortSignal): Promise<ExtensionAutocompleteResult> {
    this.editorTextSnapshot = text;
    let provider: AutocompleteProviderLike = EMPTY_AUTOCOMPLETE_PROVIDER;
    let providerRecord: RegisteredAutocompleteProvider | undefined;
    for (const record of this.autocompleteProviders.values()) {
      const nextProvider = normalizeAutocompleteProvider(record.provider, provider);
      if (!nextProvider) continue;
      provider = nextProvider;
      providerRecord = record;
    }
    if (!providerRecord || !provider.getSuggestions) return null;
    if (!provider?.getSuggestions) return null;

    const beforeCursor = text.slice(0, Math.max(0, cursor));
    const lines = text.split(/\n/);
    const beforeLines = beforeCursor.split(/\n/);
    const cursorLine = Math.max(0, beforeLines.length - 1);
    const cursorColumn = beforeLines.at(-1)?.length ?? 0;

    let suggestions: unknown;
    try {
      suggestions = await provider.getSuggestions(lines, cursorLine, cursorColumn, { signal });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return null;
      this.emitError(`autocomplete:${providerRecord.id}`, "autocomplete", error);
      return null;
    }

    const normalized = normalizeAutocompleteSuggestions(suggestions);
    if (!normalized || normalized.items.length === 0) return null;
    const providerLabel = providerRecord.label ?? resolveAutocompleteProviderLabel(provider);
    const items = normalized.items.slice(0, 20).map((item, index) => ({
      id: `${providerRecord.id}:${index}`,
      label: stringifyAutocompleteValue(item.label ?? item.value ?? item.text ?? item.detail ?? "") ?? "",
      value: stringifyAutocompleteValue(item.value ?? item.text ?? item.label ?? "") ?? "",
      description: stringifyAutocompleteValue(item.description ?? item.detail ?? undefined),
      prefix: normalized.prefix,
    })).filter((item) => item.label || item.value);
    return items.length ? { providerId: providerRecord.id, label: providerLabel, items } : null;
  }

  resolveExtensionUiResponse(response: ExtensionUiResponse): void {
    const pending = this.pendingUiResponses.get(response.id);
    if (!pending) return;
    pending.resolve(response);
  }

  handleExtensionUiInput(id: string, data: string): void {
    const custom = this.activeCustomUis.get(id);
    if (!custom || typeof data !== "string") return;
    try {
      custom.component.handleInput?.(data);
      if (this.activeCustomUis.has(id)) this.emitCustomUiRender(custom);
    } catch (error) {
      this.closeCustomUi(id, undefined);
      this.emitError(`custom-ui:${id}`, "custom_ui_input", error);
    }
  }

  handleExtensionUiResize(id: string, size: { columns?: unknown; rows?: unknown }): void {
    const custom = this.activeCustomUis.get(id);
    if (!custom) return;
    const columns = clampInt(size.columns, custom.size.columns, 40, 220);
    const rows = clampInt(size.rows, custom.size.rows, 8, 100);
    if (columns === custom.size.columns && rows === custom.size.rows) return;
    custom.size.columns = columns;
    custom.size.rows = rows;
    this.emitCustomUiRender(custom);
  }

  private requestExtensionUi<T>(
    request: ExtensionUiRequestBody,
    defaultValue: T,
    parseResponse: (response: ExtensionUiResponse) => T,
    timeout?: number,
    signal?: AbortSignal,
  ): Promise<T> {
    if (signal?.aborted) return Promise.resolve(defaultValue);

    const id = randomUUID();
    const fullRequest = {
      type: "extension_ui_request",
      id,
      ...request,
      ...(timeout ? { timeout, expiresAt: Date.now() + timeout } : {}),
    };

    return new Promise((resolve) => {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
        signal?.removeEventListener("abort", onAbort);
        this.pendingUiRequests.delete(id);
        this.pendingUiResponses.delete(id);
      };
      const settle = (value: T) => {
        cleanup();
        resolve(value);
      };
      const onAbort = () => settle(defaultValue);

      if (timeout) timeoutId = setTimeout(() => settle(defaultValue), timeout);
      signal?.addEventListener("abort", onAbort, { once: true });

      this.pendingUiRequests.set(id, fullRequest as ExtensionUiAgentEvent);
      this.pendingUiResponses.set(id, {
        resolve: (response) => settle(parseResponse(response)),
        cancel: () => settle(defaultValue),
      });
      this.emit(fullRequest as ExtensionUiAgentEvent);
    });
  }

  private requestExtensionCustomUi<T>(factory: unknown, options?: unknown): Promise<T> {
    if (typeof factory !== "function") return Promise.resolve(undefined as T);

    const id = randomUUID();
    const size = getInitialCustomSize(options);

    return new Promise<T>((resolve) => {
      const tui = this.createTui(size, () => {
        const custom = this.activeCustomUis.get(id);
        if (custom) this.emitCustomUiRender(custom);
      });
      const done = (value: T) => this.closeCustomUi(id, value);

      Promise.resolve()
        .then(() => factory(tui, this.theme, this.keybindings, done))
        .then((component) => {
          if (!isRenderableComponent(component)) {
            resolve(undefined as T);
            return;
          }
          const custom: ActiveCustomUi = {
            id,
            component,
            size,
            resolve: (value) => resolve(value as T),
            settled: false,
          };
          this.activeCustomUis.set(id, custom);
          this.emitCustomUiRender(custom);
        })
        .catch((error) => {
          this.emitError(`custom-ui:${id}`, "custom_ui", error);
          resolve(undefined as T);
        });
    });
  }

  private setStatus(key: string, text: string | undefined): void {
    if (text === undefined) this.extensionStatuses.delete(key);
    else this.extensionStatuses.set(key, text);
    this.emit({
      type: "extension_ui_request",
      id: randomUUID(),
      method: "setStatus",
      statusKey: key,
      statusText: text,
    } as ExtensionUiRequest as ExtensionUiAgentEvent);
  }

  private setChromeSlot(slot: "header" | "footer", content: unknown): void {
    const lines = content === undefined ? [] : normalizeLines(this.renderChromeContent(content));
    if (!lines) {
      this.recordCompatibility(`ctx.ui.set${slot === "header" ? "Header" : "Footer"}`, "degraded", "Unsupported header/footer content; renderable strings, string arrays, and functions returning lines are supported.");
      return;
    }
    if (slot === "header") this.headerLines = lines;
    else this.footerLines = lines;
    this.emitChrome();
  }

  private renderChromeContent(content: unknown): unknown {
    if (typeof content !== "function") return content;
    const size = { columns: DEFAULT_WIDGET_COLUMNS, rows: 3 };
    try {
      return content(this.createTui(size, () => this.emitChrome()), this.theme);
    } catch (error) {
      this.emitError("chrome", "set_chrome", error);
      return undefined;
    }
  }

  private setWorkingMessage(message: string | undefined): void {
    this.working = { ...this.working, message };
    this.emitChrome();
  }

  private setWorkingVisible(visible: boolean): void {
    this.working = { ...this.working, visible: Boolean(visible) };
    this.emitChrome();
  }

  private setWorkingIndicator(indicator: unknown): void {
    if (indicator && typeof indicator === "object") {
      const record = indicator as Record<string, unknown>;
      const frames = Array.isArray(record.frames)
        ? record.frames.filter((frame): frame is string => typeof frame === "string")
        : undefined;
      const intervalMs = typeof record.intervalMs === "number" ? record.intervalMs : undefined;
      this.working = { ...this.working, frames, intervalMs };
    } else {
      this.working = { ...this.working, frames: undefined, intervalMs: undefined };
    }
    this.emitChrome();
  }

  private emitChrome(): void {
    this.emit({
      type: "extension_ui_request",
      id: randomUUID(),
      method: "setChrome",
      chrome: this.getChrome(),
    } as ExtensionUiRequest as ExtensionUiAgentEvent);
  }

  private pasteEditorText(text: string): void {
    this.editorTextSnapshot += text;
    this.emit({
      type: "extension_ui_request",
      id: randomUUID(),
      method: "paste_editor_text",
      text,
    } as ExtensionUiRequest as ExtensionUiAgentEvent);
  }

  private addAutocompleteProvider(provider: unknown): () => void {
    const id = randomUUID();
    const label = resolveAutocompleteProviderLabel(provider);
    this.autocompleteProviders.set(id, { id, label, provider });
    this.recordCompatibility("ctx.ui.addAutocompleteProvider", "supported", "Provider is available in the web prompt editor completion menu.");
    this.emitAutocompleteProvider(id, label, true);
    return () => {
      this.autocompleteProviders.delete(id);
      this.emitAutocompleteProvider(id, label, false);
    };
  }

  private emitAutocompleteProvider(providerId: string, label: string | undefined, active: boolean): void {
    this.emit({
      type: "extension_ui_request",
      id: randomUUID(),
      method: "autocomplete_provider",
      providerId,
      label,
      active,
    } as ExtensionUiRequest as ExtensionUiAgentEvent);
  }

  private emitAutocompleteProviders(): void {
    for (const provider of this.autocompleteProviders.values()) {
      this.emitAutocompleteProvider(provider.id, provider.label, true);
    }
  }

  private setEditorComponent(component: unknown): void {
    if (component === undefined || component === null) {
      this.recordCompatibility("ctx.ui.setEditorComponent", "supported", "Custom editor component cleared; web uses the built-in textarea editor.");
      return;
    }
    this.recordCompatibility(
      "ctx.ui.setEditorComponent",
      "degraded",
      "pi-web keeps the built-in textarea and does not mount arbitrary React/TUI editor components; text APIs and autocomplete providers remain supported.",
    );
  }

  private getAllThemes(): unknown[] {
    return ["system", "light", "dark"];
  }

  private getTheme(name: string): unknown {
    if (["system", "light", "dark"].includes(name)) return this.theme;
    return undefined;
  }

  private setTheme(theme: unknown): { success: boolean; error?: string } {
    const themeName = typeof theme === "string" ? theme : typeof theme === "object" && theme && "name" in theme ? String((theme as { name?: unknown }).name) : undefined;
    if (!themeName || !["system", "light", "dark"].includes(themeName)) {
      const error = "pi-web can switch only built-in system/light/dark themes from extensions.";
      this.recordCompatibility("ctx.ui.setTheme", "degraded", error);
      return { success: false, error };
    }
    this.recordCompatibility("ctx.ui.setTheme", "degraded", "Theme request forwarded to the browser for web theme mapping; custom TUI color tokens are approximated.");
    this.emit({
      type: "extension_ui_request",
      id: randomUUID(),
      method: "setTheme",
      themeName,
      success: true,
    } as ExtensionUiRequest as ExtensionUiAgentEvent);
    return { success: true };
  }

  private recordCompatibility(api: string, status: ExtensionCompatibilityItem["status"], details: string): void {
    const key = `${api}:${status}`;
    this.compatibilityReports.set(key, { api, status, details });
    this.emit({
      type: "extension_ui_request",
      id: randomUUID(),
      method: "compatibility_report",
      reports: this.getCompatibilityReports(),
    } as ExtensionUiRequest as ExtensionUiAgentEvent);
  }
  private setWidget(key: string, content: unknown, options?: { placement?: "aboveEditor" | "belowEditor" }): void {
    const placement = options?.placement ?? "aboveEditor";
    const existing = this.extensionWidgets.get(key);

    if (content === undefined) {
      if (existing) {
        safeDispose(existing.component);
        safeInvalidate(existing.component);
      }
      this.extensionWidgets.delete(key);
      this.emitWidget(key, undefined, placement);
      return;
    }

    if (existing) {
      safeDispose(existing.component);
      safeInvalidate(existing.component);
    }

    const widget = this.createWidget(key, content, placement);
    if (!widget) return;
    this.extensionWidgets.set(key, widget);
    const rendered = this.renderWidget(widget);
    this.emitWidget(key, rendered.lines, rendered.placement);
  }

  private createWidget(
    key: string,
    content: unknown,
    placement: "aboveEditor" | "belowEditor",
  ): ActiveWidget | null {
    const staticLines = normalizeLines(content);
    if (staticLines) {
      return {
        key,
        placement,
        size: { columns: DEFAULT_WIDGET_COLUMNS, rows: DEFAULT_WIDGET_ROWS },
        lines: staticLines,
      };
    }

    let record: ActiveWidget | null = null;
    const size = { columns: DEFAULT_WIDGET_COLUMNS, rows: DEFAULT_WIDGET_ROWS };
    const tui = this.createTui(size, () => {
      if (!record) return;
      const rendered = this.renderWidget(record);
      this.emitWidget(record.key, rendered.lines, rendered.placement);
    });

    let renderedContent: unknown;
    try {
      renderedContent = typeof content === "function"
        ? content(tui, this.theme)
        : content;
    } catch (error) {
      this.emitError(`widget:${key}`, "set_widget", error);
      return null;
    }

    const lines = normalizeLines(renderedContent);
    if (lines) {
      return {
        key,
        placement,
        size,
        lines,
      };
    }

    if (!isRenderableComponent(renderedContent)) {
      this.emitError(`widget:${key}`, "set_widget", new Error("Unsupported widget content"));
      return null;
    }

    record = {
      key,
      placement,
      size,
      lines: [],
      component: renderedContent,
    };
    record.lines = safeRender(renderedContent, size.columns);
    return record;
  }

  private renderWidget(widget: ActiveWidget): ExtensionWidgetItem {
    if (widget.component) {
      widget.lines = safeRender(widget.component, widget.size.columns);
    }
    return {
      key: widget.key,
      placement: widget.placement,
      lines: widget.lines,
    };
  }

  private emitWidget(key: string, lines: string[] | undefined, placement: "aboveEditor" | "belowEditor"): void {
    this.emit({
      type: "extension_ui_request",
      id: randomUUID(),
      method: "setWidget",
      widgetKey: key,
      // Keep the server-side widget/component registered, but project an
      // empty render as a clear event so the browser does not show an empty card.
      widgetLines: lines && lines.length > 0 ? lines : undefined,
      widgetPlacement: placement,
    } as ExtensionUiRequest as ExtensionUiAgentEvent);
  }

  private emitCustomUiRender(custom: ActiveCustomUi): void {
    const lines = safeRender(custom.component, custom.size.columns);
    const event = {
      type: "extension_ui_request",
      id: custom.id,
      method: "custom",
      lines,
      columns: custom.size.columns,
      rows: custom.size.rows,
    } as ExtensionUiRequest as ExtensionUiAgentEvent;
    this.pendingUiRequests.set(custom.id, event);
    this.emit(event);
  }

  private closeCustomUi(id: string, value: unknown): void {
    const custom = this.activeCustomUis.get(id);
    if (!custom || custom.settled) return;
    custom.settled = true;
    this.activeCustomUis.delete(id);
    this.pendingUiRequests.delete(id);
    safeDispose(custom.component);
    this.emit({
      type: "extension_ui_request",
      id,
      method: "custom",
      lines: [],
      closed: true,
    } as ExtensionUiRequest as ExtensionUiAgentEvent);
    custom.resolve(value);
  }

  private createTui(size: TerminalSize, requestRender: () => void): CompatTui {
    return {
      terminal: size,
      requestRender,
    };
  }

  private setEditorText(text: string): void {
    this.editorTextSnapshot = text;
    this.emit({
      type: "extension_ui_request",
      id: randomUUID(),
      method: "set_editor_text",
      text,
    } as ExtensionUiRequest as ExtensionUiAgentEvent);
  }

  private renderAllActiveUi(): void {
    for (const custom of this.activeCustomUis.values()) this.emitCustomUiRender(custom);
    for (const widget of this.extensionWidgets.values()) {
      const rendered = this.renderWidget(widget);
      this.emitWidget(widget.key, rendered.lines, rendered.placement);
    }
  }

  private emitError(extensionPath: string, event: string, error: unknown): void {
    this.emit({
      type: "extension_error",
      extensionPath,
      event,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
