export type SlashCommandSource = "builtin" | "extension" | "prompt" | "skill";

export type BuiltinSlashCommandMode =
  | "agent"
  | "client"
  | "client-ui"
  | "unsupported";

export interface SlashCommandSourceInfo {
  path: string;
  source: string;
  scope: "user" | "project" | "temporary";
  origin: "package" | "top-level";
  baseDir?: string;
}

export interface SlashCommandInfo {
  name: string;
  description?: string;
  source: SlashCommandSource;
  sourceInfo?: SlashCommandSourceInfo;
}

export interface WebBuiltinSlashCommand extends SlashCommandInfo {
  source: "builtin";
  mode: BuiltinSlashCommandMode;
  argHint?: string;
}

export type SlashUiAction =
  | { type: "openSessionStats" }
  | { type: "openBranchNavigator" }
  | { type: "openForkSelector" }
  | { type: "openModelsConfig"; section?: "models" | "auth" | "scoped" }
  | { type: "openProjectTrust" }
  | { type: "newSession" }
  | { type: "openSessionSidebar" }

export const WEB_BUILTIN_SLASH_COMMANDS: WebBuiltinSlashCommand[] = [
  { name: "settings", description: "Open settings menu", source: "builtin", mode: "client-ui" },
  { name: "model", description: "Select or set model", source: "builtin", mode: "client-ui", argHint: "[provider/model]" },
  { name: "scoped-models", description: "Enable/disable models for model cycling", source: "builtin", mode: "client-ui" },
  { name: "export", description: "Export session (HTML default, or specify path: .html/.jsonl)", source: "builtin", mode: "client", argHint: "[path]" },
  { name: "import", description: "Import and resume a session from a JSONL file", source: "builtin", mode: "unsupported" },
  { name: "share", description: "Share session as a secret GitHub gist", source: "builtin", mode: "unsupported" },
  { name: "copy", description: "Copy the last assistant message", source: "builtin", mode: "client" },
  { name: "name", description: "Set session display name", source: "builtin", mode: "agent", argHint: "<name>" },
  { name: "session", description: "Show session message, token, and cost stats", source: "builtin", mode: "client-ui" },
  { name: "changelog", description: "Show changelog entries", source: "builtin", mode: "unsupported" },
  { name: "hotkeys", description: "Show all keyboard shortcuts", source: "builtin", mode: "unsupported" },
  { name: "fork", description: "Create a new fork from a previous user message", source: "builtin", mode: "client-ui" },
  { name: "clone", description: "Duplicate the current session at the current position", source: "builtin", mode: "agent" },
  { name: "tree", description: "Navigate session tree (switch branches)", source: "builtin", mode: "client-ui" },
  { name: "trust", description: "Save project trust decision for future sessions", source: "builtin", mode: "client-ui" },
  { name: "login", description: "Configure provider authentication", source: "builtin", mode: "client-ui", argHint: "[provider]" },
  { name: "logout", description: "Remove provider authentication", source: "builtin", mode: "client-ui", argHint: "[provider]" },
  { name: "new", description: "Start a new session", source: "builtin", mode: "client-ui" },
  { name: "compact", description: "Compress context, optionally with instructions", source: "builtin", mode: "agent", argHint: "[instructions]" },
  { name: "resume", description: "Resume a different session", source: "builtin", mode: "client-ui" },
  { name: "reload", description: "Reload extensions, skills, prompts, and tools", source: "builtin", mode: "agent" },
  { name: "quit", description: "Quit pi", source: "builtin", mode: "unsupported" },
];

export const IMPLEMENTED_WEB_BUILTIN_SLASH_COMMANDS = WEB_BUILTIN_SLASH_COMMANDS.filter(
  (command) => command.mode !== "unsupported"
);

const WEB_BUILTIN_SLASH_COMMANDS_BY_NAME = new Map(
  WEB_BUILTIN_SLASH_COMMANDS.map((command) => [command.name, command])
);

export function getWebBuiltinSlashCommand(name: string): WebBuiltinSlashCommand | undefined {
  return WEB_BUILTIN_SLASH_COMMANDS_BY_NAME.get(name.toLowerCase());
}

export function isWebBuiltinSlashCommand(name: string): boolean {
  return WEB_BUILTIN_SLASH_COMMANDS_BY_NAME.has(name.toLowerCase());
}
