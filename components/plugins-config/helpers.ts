import type { PluginPackageInfo } from "@/lib/api-types";

export type PluginScope = PluginPackageInfo["scope"];
export type PluginAction = "install" | "remove" | "update" | "disable" | "enable";

export function shortenPath(path: string): string {
  return path.replace(/^\/(?:Users|home)\/[^/]+/, "~");
}

export function packageKey(pkg: Pick<PluginPackageInfo, "source" | "scope">): string {
  return `${pkg.scope}\0${pkg.source}`;
}

export function resourceSummary(pkg: PluginPackageInfo): string {
  if (pkg.disabled) return "Disabled";
  const parts = [
    pkg.counts.extensions ? `${pkg.counts.extensions} extension${pkg.counts.extensions === 1 ? "" : "s"}` : "",
    pkg.counts.skills ? `${pkg.counts.skills} skill${pkg.counts.skills === 1 ? "" : "s"}` : "",
    pkg.counts.prompts ? `${pkg.counts.prompts} prompt${pkg.counts.prompts === 1 ? "" : "s"}` : "",
    pkg.counts.themes ? `${pkg.counts.themes} theme${pkg.counts.themes === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "No resolved resources";
}

export function versionSummary(pkg: PluginPackageInfo): string {
  const parts: string[] = [];
  if (pkg.version) parts.push(`installed ${pkg.version}`);
  if (pkg.configuredVersion) parts.push(`configured ${pkg.configuredVersion}`);
  return parts.length ? parts.join(" · ") : "Unknown";
}

export function installLocation(scope: PluginScope, cwd: string): string {
  return scope === "project"
    ? `${shortenPath(cwd)}/.pi/agent/{npm,git}`
    : "~/.pi/agent/{npm,git}";
}

export function findInstalledPackage(
  packages: PluginPackageInfo[],
  source: string,
  scope: PluginScope,
): PluginPackageInfo | undefined {
  const trimmed = source.trim();
  const withoutNpmPrefix = trimmed.startsWith("npm:") ? trimmed.slice(4) : trimmed;
  return packages.find((pkg) => pkg.scope === scope && pkg.source === trimmed)
    ?? packages.find((pkg) => pkg.scope === scope && pkg.source === `npm:${withoutNpmPrefix}`)
    ?? packages.find((pkg) => pkg.scope === scope && pkg.source.endsWith(trimmed));
}

export function statusTone(status: PluginPackageInfo["status"]): "neutral" | "warning" | "danger" {
  if (status === "missing") return "danger";
  if (status === "installed") return "warning";
  return "neutral";
}
