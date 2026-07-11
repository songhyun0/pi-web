import type { WebKeybinding, WebKeybindingScope } from "@/lib/web-keybindings";

export type HotkeyFilter = "all" | "custom" | "issues";
export type HotkeyTone = "neutral" | "accent" | "warning";

export function shortenHotkeyPath(value: string): string {
  return value.replace(/^\/(?:Users|home)\/[^/]+/, "~");
}
const SCOPE_ORDER: WebKeybindingScope[] = ["global", "chatInput", "autocomplete", "tree", "modal", "extension"];

export function hotkeyScopeLabel(scope: WebKeybindingScope): string {
  if (scope === "chatInput") return "Chat input";
  if (scope === "autocomplete") return "Autocomplete";
  if (scope === "tree") return "Session tree";
  if (scope === "modal") return "Modals";
  if (scope === "extension") return "Extensions";
  return "Global";
}

export function hotkeyStatusLabel(status: WebKeybinding["status"]): string {
  if (status === "browser-conflict") return "Browser conflict";
  if (status === "unbound") return "Unbound";
  return "Active";
}

export function hotkeyStatusTone(status: WebKeybinding["status"]): HotkeyTone {
  return status === "browser-conflict" ? "warning" : "neutral";
}

export function hotkeySourceLabel(binding: WebKeybinding): string {
  if (binding.source === "user") return "Customized";
  if (binding.source === "extension") return binding.owner ? `Extension · ${binding.owner}` : "Extension";
  return "Default";
}

export function splitKeySequence(combo: string): string[][] {
  return combo.trim().split(/\s+/).filter(Boolean).map((chord) => chord.split("+").filter(Boolean));
}

export function bindingMatches(binding: WebKeybinding, query: string, filter: HotkeyFilter): boolean {
  if (filter === "custom" && binding.source === "default") return false;
  if (filter === "issues" && binding.status === "active") return false;
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return [
    binding.label,
    binding.action,
    binding.description,
    binding.scope,
    binding.source,
    binding.owner ?? "",
    binding.keys.join(" "),
  ].some((value) => value.toLowerCase().includes(normalized));
}

export function groupKeybindings(bindings: WebKeybinding[]): Array<{ scope: WebKeybindingScope; bindings: WebKeybinding[] }> {
  return SCOPE_ORDER.map((scope) => ({ scope, bindings: bindings.filter((binding) => binding.scope === scope) }))
    .filter((group) => group.bindings.length > 0);
}

export function hotkeyStats(bindings: WebKeybinding[]): { active: number; custom: number; conflicts: number; unbound: number } {
  return {
    active: bindings.filter((binding) => binding.status === "active").length,
    custom: bindings.filter((binding) => binding.source !== "default").length,
    conflicts: bindings.filter((binding) => binding.status === "browser-conflict").length,
    unbound: bindings.filter((binding) => binding.status === "unbound").length,
  };
}
