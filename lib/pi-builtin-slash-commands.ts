import { join } from "path";
import { pathToFileURL } from "url";
import { IMPLEMENTED_WEB_BUILTIN_SLASH_COMMANDS, getWebBuiltinSlashCommand, type SlashCommandInfo } from "./slash-command-registry";

type PiCodingAgentModule = {
  getPackageDir?: () => string;
};

type PiSlashCommandsModule = {
  BUILTIN_SLASH_COMMANDS?: Array<{ name?: unknown; description?: unknown }>;
};

let cached: Promise<SlashCommandInfo[]> | null = null;

function fallbackBuiltinCommands(): SlashCommandInfo[] {
  return IMPLEMENTED_WEB_BUILTIN_SLASH_COMMANDS.map(({ name, description }) => ({
    name,
    description,
    source: "builtin",
  }));
}

export function loadPiBuiltinSlashCommands(): Promise<SlashCommandInfo[]> {
  cached ??= (async () => {
    try {
      const pi = (await import("@earendil-works/pi-coding-agent")) as PiCodingAgentModule;
      const packageDir = pi.getPackageDir?.();
      if (!packageDir) return fallbackBuiltinCommands();

      const moduleUrl = pathToFileURL(join(packageDir, "dist", "core", "slash-commands.js")).href;
      const mod = (await import(moduleUrl)) as PiSlashCommandsModule;
      const commands = mod.BUILTIN_SLASH_COMMANDS;
      if (!Array.isArray(commands)) return fallbackBuiltinCommands();

      const normalized = commands
        .map((command) => ({
          name: typeof command.name === "string" ? command.name : "",
          description: typeof command.description === "string" ? command.description : undefined,
          source: "builtin" as const,
        }))
        .filter((command) => {
          const webCommand = getWebBuiltinSlashCommand(command.name);
          return Boolean(webCommand && webCommand.mode !== "unsupported");
        });

      return normalized.length > 0 ? normalized : fallbackBuiltinCommands();
    } catch {
      return fallbackBuiltinCommands();
    }
  })();
  return cached;
}
