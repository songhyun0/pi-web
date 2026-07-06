# Extension UI Compatibility Bridge Design

## Goal

Make TUI-oriented Pi extension UI features usable in pi-agent-web without adding per-plugin adapters. Extensions should keep using the existing Pi extension APIs (`ctx.ui.custom()`, `ctx.ui.setWidget()`, `ctx.ui.theme`, `keybindings`, and `tui.terminal`) while pi-agent-web provides a small compatibility host that renders those terminal components as ANSI-aware monospace lines in the browser.

This is a compatibility layer, not a full browser reimplementation of `@earendil-works/pi-tui`.

## Non-goals

- Do not rewrite installed plugins or add plugin-specific special cases.
- Do not implement full terminal/TUI parity such as alternate screens, mouse tracking, native terminal focus stacks, or arbitrary DOM widgets.
- Do not change the existing chat visual language. Dialogs, panels, widgets, notices, and status chips should keep the current pi-agent-web styling.
- Do not move agent/session lifecycle responsibilities out of `AgentSessionWrapper` beyond delegating extension UI concerns.

## Dependency direction

```text
AgentSessionWrapper
  owns AgentSession lifecycle, session registry, commands
  depends on ExtensionUiBridge only through a narrow adapter

ExtensionUiBridge
  owns extension UI state and protocol events
  depends on shared types and a callback that emits AgentEvents
  does not know about React, routes, or session registry

React client hooks
  own browser-side state projection from extension_ui_request events
  send only typed response/input/resize commands back to AgentSessionWrapper

React components
  own presentation only
  do not call agent/session APIs directly
```

This keeps the dependency flow server-runtime -> bridge -> protocol -> client-state -> components. UI components never reach back into the bridge directly.

## Server responsibilities

Create `lib/extension-ui-bridge.ts` with one class:

```ts
class ExtensionUiBridge {
  createContext(): ExtensionUiContextLike;
  getStatuses(): ExtensionStatusItem[];
  getWidgets(): ExtensionWidgetItem[];
  getPendingRequests(): AgentEvent[];
  resolveExtensionUiResponse(response: ExtensionUiResponse): void;
  handleExtensionUiInput(id: string, data: string): void;
  handleExtensionUiResize(id: string, size: { columns?: number; rows?: number }): void;
  clearPersistentUi(): void;
  destroy(): void;
}
```

The bridge owns:

- pending dialog request/response promises;
- active `ctx.ui.custom()` components;
- persistent status entries;
- persistent widget components and rendered widget lines;
- compatibility `theme`, `keybindings`, and `tui` objects.

`AgentSessionWrapper` should delegate all extension UI work to this bridge:

- extension binding uses `bridge.createContext()`;
- `get_state` returns `bridge.getStatuses()` and `bridge.getWidgets()`;
- `extension_ui_response`, `extension_ui_input`, and `extension_ui_resize` route to bridge methods;
- reload clears persistent bridge UI before rebinding;
- destroy closes pending UI through `bridge.destroy()`.

## Compatibility shims

### Theme

Provide a small ANSI-producing theme object with common methods used by Pi TUI plugins:

- `fg(token, text)`
- `bg(token, text)`
- `bold(text)`
- `dim(text)`
- `italic(text)`
- `underline(text)`

The browser already renders ANSI SGR sequences for custom panels; widget rendering will use the same presentation path.

### TUI

Provide a minimal TUI object:

```ts
{
  terminal: { columns, rows },
  requestRender(): void,
}
```

Default dimensions come from plugin options or safe fallbacks. The browser can send `extension_ui_resize` for custom panels so line wrapping can adjust to the real panel size.

### Keybindings

Provide `keybindings.matches(data, id)` for common Pi select/editor bindings and a few direct key aliases. This lets plugins that call `keybindings.matches(data, "tui.select.down")` work without a terminal keybinding manager.

### Custom UI

`ctx.ui.custom(factory, options)` flow:

1. Bridge creates a compat TUI host and calls `factory(tui, theme, keybindings, done)`.
2. The returned object must expose `render(width): string[]` and optionally `handleInput`, `dispose`, `invalidate`.
3. Bridge emits `{ type: "extension_ui_request", method: "custom", id, lines, columns, rows }`.
4. Browser displays the existing modal-style monospace panel.
5. Keyboard input posts `extension_ui_input` back to the session.
6. Bridge calls `handleInput(data)` and re-renders.
7. Browser resize posts `extension_ui_resize`; bridge updates dimensions and re-renders.

### Widgets

`ctx.ui.setWidget(key, content, options)` should accept:

- `undefined` to clear;
- `string[]` direct lines;
- component objects with `render(width): string[]`;
- factories `(tui, theme) => component | string[]`.

The bridge stores the widget and emits normalized `widgetLines`. Components can call `tui.requestRender()` to refresh.

## Client responsibilities

Split extension UI presentation into `components/ExtensionUiHost.tsx`:

- `ExtensionDialog`
- `ExtensionCustomPanel`
- `ExtensionStatusBar`
- `ExtensionWidgets`
- shared ANSI line renderer

`ChatWindow` should only pass state and callbacks into `ExtensionUiHost`, preserving existing styling and layout placement.

`useAgentSession` owns state updates and command dispatch:

- `extension_ui_request/custom` updates the active panel;
- `extension_ui_request/setWidget` updates widgets;
- custom panel input posts `extension_ui_input`;
- custom panel measurement posts `extension_ui_resize` when dimensions change.

## Validation plan

1. Typecheck with `node_modules/.bin/tsc --noEmit`.
2. Run lint if practical with `npm run lint`.
3. Ask an independent reviewer to compare implementation against this design and identify coupling regressions, missing API paths, and likely plugin compatibility gaps.

## Known limitations after this work

- `addAutocompleteProvider()` remains a no-op unless a later autocomplete bridge is added.
- `registerShortcut()` remains unsupported in the browser unless a later shortcut registry/UI is added.
- Complex TUI components relying on unsupported terminal APIs may still degrade to line rendering only.
