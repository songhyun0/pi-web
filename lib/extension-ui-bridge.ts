import { randomUUID } from "crypto";
import type { ExtensionUiContextLike } from "./pi-types";
import type { ExtensionStatusItem, ExtensionUiRequest, ExtensionUiResponse, ExtensionWidgetItem } from "./types";

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

type ThemeLike = {
  fg: (token: string, text: string) => string;
  bg: (token: string, text: string) => string;
  bold: (text: string) => string;
  dim: (text: string) => string;
  italic: (text: string) => string;
  underline: (text: string) => string;
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

function createCompatTheme(): ThemeLike {
  return {
    fg: (token, text) => sgr([ANSI_FG[token] ?? 39], text),
    bg: (token, text) => sgr([ANSI_BG[token] ?? 49], text),
    bold: (text) => sgr([1], text),
    dim: (text) => sgr([2], text),
    italic: (text) => sgr([3], text),
    underline: (text) => sgr([4], text),
  };
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
  private readonly theme = createCompatTheme();
  private readonly keybindings = createCompatKeybindings();
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
      setWorkingMessage: () => {},
      setWorkingVisible: () => {},
      setWorkingIndicator: () => {},
      setHiddenThinkingLabel: () => {},
      setWidget: (key, content, options) => this.setWidget(key, content, options),
      setFooter: () => {},
      setHeader: () => {},
      setTitle: (title) => {
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "setTitle",
          title,
        } as ExtensionUiRequest as ExtensionUiAgentEvent);
      },
      custom: <T = unknown>(factory: unknown, options?: unknown) => this.requestExtensionCustomUi<T>(factory, options),
      pasteToEditor: (text) => this.setEditorText(text),
      setEditorText: (text) => this.setEditorText(text),
      getEditorText: () => "",
      addAutocompleteProvider: () => {},
      setEditorComponent: () => {},
      getEditorComponent: () => undefined,
      get theme() { return createCompatTheme(); },
      getAllThemes: () => [],
      getTheme: () => undefined,
      setTheme: () => ({ success: false, error: "Theme switching is not supported in pi-web extension UI yet" }),
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
  }

  destroy(): void {
    for (const pending of this.pendingUiResponses.values()) pending.cancel();
    for (const id of Array.from(this.activeCustomUis.keys())) this.closeCustomUi(id, undefined);
    this.pendingUiResponses.clear();
    this.pendingUiRequests.clear();
    this.clearPersistentUi();
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
