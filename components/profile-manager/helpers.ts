import type { PackageSource, ProfileDefinition, ToolPreset } from "@/lib/profiles";

export function shortenPath(value: string): string {
  return value.replace(/^\/(?:Users|home)\/[^/]+/, "~");
}

export function packageSource(plugin: PackageSource): string {
  return typeof plugin === "string" ? plugin : plugin.source;
}

export function packageLabel(source: string): string {
  if (source.startsWith("npm:")) return source.slice(4);
  const parts = source.replace(/\/$/, "").split("/");
  return source.startsWith("~") ? source : parts[parts.length - 1] || source;
}

export function presetLabel(preset: ToolPreset): string {
  if (preset === "none") return "No built-ins";
  if (preset === "full") return "Full tools";
  return "Standard tools";
}

export function presetDescription(preset: ToolPreset): string {
  if (preset === "none") return "Only tools supplied by selected plugins.";
  if (preset === "full") return "Standard tools plus project search and file listing.";
  return "Read, edit, write, and shell tools for routine work.";
}

export function profileSummary(profile: ProfileDefinition): string {
  const hiddenSkills = profile.skills.disabledSkillRefs?.length ?? 0;
  const parts = [
    presetLabel(profile.tools.builtinPreset),
    `${profile.plugins.length} plugin${profile.plugins.length === 1 ? "" : "s"}`,
  ];
  if (hiddenSkills) parts.push(`${hiddenSkills} skill${hiddenSkills === 1 ? "" : "s"} hidden`);
  return parts.join(" · ");
}

export function formatProfileDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return value;
  return new Intl.DateTimeFormat("en", { year: "numeric", month: "short", day: "numeric" }).format(parsed);
}
