export type WebKeybindingScope = "global" | "chatInput" | "autocomplete" | "modal" | "tree" | "extension";

export interface WebKeybindingDefinition {
  action: string;
  label: string;
  description: string;
  scope: WebKeybindingScope;
  defaultKeys: string[];
}

export interface WebKeybinding extends WebKeybindingDefinition {
  keys: string[];
  source: "default" | "user" | "extension";
  owner?: string;
  status: "active" | "browser-conflict" | "unbound";
  conflict?: string;
}

export type WebKeybindingConfig = Record<string, string | string[]> | {
  bindings?: Record<string, string | string[]>;
  shortcuts?: Record<string, string | string[]>;
};

export const DEFAULT_WEB_KEYBINDINGS: WebKeybindingDefinition[] = [
  {
    action: "chat.submit",
    label: "Submit message",
    description: "Send the current chat input.",
    scope: "chatInput",
    defaultKeys: ["Enter"],
  },
  {
    action: "chat.newline",
    label: "Insert newline",
    description: "Insert a newline in the chat input.",
    scope: "chatInput",
    defaultKeys: ["Shift+Enter"],
  },
  {
    action: "chat.editor.external",
    label: "Prompt editor",
    description: "Open a fullscreen prompt editor, replacing the CLI external editor shortcut in the browser.",
    scope: "chatInput",
    defaultKeys: ["Ctrl+G"],
  },
  {
    action: "chat.queue.followUp",
    label: "Queue follow-up",
    description: "Queue the current message as a follow-up while the agent is running.",
    scope: "chatInput",
    defaultKeys: ["Alt+Enter"],
  },
  {
    action: "chat.queue.recall",
    label: "Recall queued message",
    description: "Recall the next queued message into the editor.",
    scope: "chatInput",
    defaultKeys: ["Alt+ArrowUp"],
  },
  {
    action: "autocomplete.down",
    label: "Autocomplete down",
    description: "Move down in slash or file autocomplete.",
    scope: "autocomplete",
    defaultKeys: ["ArrowDown"],
  },
  {
    action: "autocomplete.up",
    label: "Autocomplete up",
    description: "Move up in slash or file autocomplete.",
    scope: "autocomplete",
    defaultKeys: ["ArrowUp"],
  },
  {
    action: "autocomplete.accept",
    label: "Accept autocomplete",
    description: "Accept the selected slash command or file completion.",
    scope: "autocomplete",
    defaultKeys: ["Tab", "Enter"],
  },
  {
    action: "autocomplete.cancel",
    label: "Close autocomplete",
    description: "Close the active autocomplete menu.",
    scope: "autocomplete",
    defaultKeys: ["Escape"],
  },
  {
    action: "app.hotkeys",
    label: "Show hotkeys",
    description: "Open the pi-web hotkeys modal.",
    scope: "global",
    defaultKeys: ["Ctrl+/"],
  },
  {
    action: "tree.open",
    label: "Open session tree",
    description: "Open the session tree navigator.",
    scope: "global",
    defaultKeys: ["Escape Escape"],
  },
];

const BROWSER_CONFLICTS = new Set(["Ctrl+R", "Meta+R", "Ctrl+L", "Meta+L", "Ctrl+W", "Meta+W", "Ctrl+T", "Meta+T"]);

export function normalizeKeyCombo(combo: string): string {
  const parts = combo.split("+").map((part) => part.trim()).filter(Boolean);
  const modifiers = new Set<string>();
  let key = "";
  for (const raw of parts) {
    const lower = raw.toLowerCase();
    if (lower === "ctrl" || lower === "control") modifiers.add("Ctrl");
    else if (lower === "cmd" || lower === "command" || lower === "meta") modifiers.add("Meta");
    else if (lower === "mod") modifiers.add(typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "Meta" : "Ctrl");
    else if (lower === "alt" || lower === "option") modifiers.add("Alt");
    else if (lower === "shift") modifiers.add("Shift");
    else key = normalizeEventKey(raw);
  }
  const ordered = ["Ctrl", "Meta", "Alt", "Shift"].filter((modifier) => modifiers.has(modifier));
  return [...ordered, key].filter(Boolean).join("+");
}

function normalizeEventKey(key: string): string {
  if (key === " ") return "Space";
  if (key.length === 1) return key.toUpperCase();
  const lower = key.toLowerCase();
  if (lower === "esc") return "Escape";
  if (lower === "up") return "ArrowUp";
  if (lower === "down") return "ArrowDown";
  if (lower === "left") return "ArrowLeft";
  if (lower === "right") return "ArrowRight";
  return key.slice(0, 1).toUpperCase() + key.slice(1);
}

export function comboFromKeyboardEvent(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">): string {
  const modifiers = [
    event.ctrlKey ? "Ctrl" : "",
    event.metaKey ? "Meta" : "",
    event.altKey ? "Alt" : "",
    event.shiftKey ? "Shift" : "",
  ].filter(Boolean);
  return [...modifiers, normalizeEventKey(event.key)].join("+");
}

function coerceKeys(value: string | string[] | undefined): string[] | undefined {
  if (typeof value === "string") return value.trim() ? [value] : [];
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string");
  return undefined;
}

function extractUserBindings(config?: WebKeybindingConfig | null): Record<string, string[]> {
  if (!config || typeof config !== "object") return {};
  const source = "bindings" in config && config.bindings && typeof config.bindings === "object"
    ? config.bindings
    : "shortcuts" in config && config.shortcuts && typeof config.shortcuts === "object"
      ? config.shortcuts
      : config as Record<string, string | string[]>;
  const out: Record<string, string[]> = {};
  for (const [action, value] of Object.entries(source)) {
    const keys = coerceKeys(value);
    if (keys) out[action] = keys;
  }
  return out;
}

export function buildWebKeybindings(config?: WebKeybindingConfig | null): WebKeybinding[] {
  const userBindings = extractUserBindings(config);
  return DEFAULT_WEB_KEYBINDINGS.map((definition) => {
    const userKeys = userBindings[definition.action];
    const keys = (userKeys ?? definition.defaultKeys).map(normalizeKeyCombo).filter(Boolean);
    const conflict = keys.find((key) => BROWSER_CONFLICTS.has(key));
    return {
      ...definition,
      keys,
      source: userKeys ? "user" : "default",
      status: keys.length === 0 ? "unbound" : conflict ? "browser-conflict" : "active",
      ...(conflict ? { conflict: `${conflict} is usually reserved by the browser or OS.` } : {}),
    };
  });
}

export function findWebKeybinding(bindings: readonly WebKeybinding[], action: string): WebKeybinding | undefined {
  return bindings.find((binding) => binding.action === action);
}

export function eventMatchesWebAction(
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">,
  bindings: readonly WebKeybinding[],
  action: string,
): boolean {
  const binding = findWebKeybinding(bindings, action);
  if (!binding || binding.status !== "active") return false;
  const combo = comboFromKeyboardEvent(event);
  return binding.keys.includes(combo);
}
