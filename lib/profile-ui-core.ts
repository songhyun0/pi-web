import type { PackageSource, ProfileDefinition, ProfileRef, SkillRef } from "./profiles";
import type { CapabilitySnapshotV1, ProfileDiagnostic, ToolConflict } from "./session-profile-store";

export const LAST_USED_PROFILE_REF_STORAGE_KEY = "pi-web-last-used-profile-ref";
export const REQUIRED_PROFILE_SWITCH_RUNNING_MESSAGE = "Wait for the current response to finish before switching profiles.";

export function profileRefExists(profileRef: string | null | undefined, profiles: Pick<ProfileDefinition, "id">[]): profileRef is ProfileRef {
  return typeof profileRef === "string" && profiles.some((profile) => profile.id === profileRef);
}

export function readValidatedLastUsedProfileRef(profiles: Pick<ProfileDefinition, "id">[]): ProfileRef | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(LAST_USED_PROFILE_REF_STORAGE_KEY);
    return profileRefExists(value, profiles) ? value : null;
  } catch {
    return null;
  }
}

export function writeLastUsedProfileRef(profileRef: ProfileRef | null): void {
  if (typeof window === "undefined") return;
  try {
    if (profileRef) window.localStorage.setItem(LAST_USED_PROFILE_REF_STORAGE_KEY, profileRef);
    else window.localStorage.removeItem(LAST_USED_PROFILE_REF_STORAGE_KEY);
  } catch {
    // Ignore storage failures; the server remains authoritative.
  }
}

export interface NewSessionProfilePayloadOptions {
  cwd: string;
  type?: string;
  profileRef?: ProfileRef | null;
  provider?: string;
  modelId?: string;
  thinkingLevel?: string;
}

export function buildNewSessionProfilePayload(options: NewSessionProfilePayloadOptions): Record<string, unknown> {
  return {
    cwd: options.cwd,
    type: options.type ?? "ensure_session",
    ...(options.profileRef ? { profileRef: options.profileRef } : {}),
    ...(options.provider && options.modelId ? { provider: options.provider, modelId: options.modelId } : {}),
    ...(options.thinkingLevel && options.thinkingLevel !== "auto" ? { thinkingLevel: options.thinkingLevel } : {}),
  };
}

export interface ProfileIssueSummary {
  diagnostics: ProfileDiagnostic[];
  conflicts: ToolConflict[];
  warningCount: number;
  errorCount: number;
  conflictCount: number;
  hasIssues: boolean;
}

export function summarizeProfileIssues(snapshot: CapabilitySnapshotV1 | null | undefined): ProfileIssueSummary {
  const diagnostics = snapshot?.diagnostics ?? [];
  const conflicts = snapshot?.tools.conflicts ?? [];
  const warningCount = diagnostics.filter((diagnostic) => diagnostic.type === "warning").length;
  const errorCount = diagnostics.filter((diagnostic) => diagnostic.type === "error").length;
  return {
    diagnostics,
    conflicts,
    warningCount,
    errorCount,
    conflictCount: conflicts.length,
    hasIssues: diagnostics.length > 0 || conflicts.length > 0,
  };
}

export function profileDisplayName(options: {
  profileRef?: ProfileRef | null;
  profiles: Pick<ProfileDefinition, "id" | "name">[];
  globalDefaultProfileRef?: ProfileRef | null;
  snapshot?: CapabilitySnapshotV1 | null;
  legacyLabel?: string | null;
  newSession?: boolean;
}): string {
  if (options.snapshot) return options.snapshot.profileName;
  if (options.legacyLabel) return options.legacyLabel;
  const ref = options.profileRef ?? (options.newSession ? options.globalDefaultProfileRef : null);
  const profile = ref ? options.profiles.find((candidate) => candidate.id === ref) : null;
  if (profile && options.newSession && !options.profileRef) return `Default: ${profile.name}`;
  return profile?.name ?? (options.newSession ? "Server default" : "Legacy / current settings");
}

export function reconcileHiddenSkillRefsForPlugins(hiddenSkillRefs: SkillRef[] | undefined, selectedPluginSources: string[]): SkillRef[] {
  if (!hiddenSkillRefs?.length) return [];
  const selected = new Set(selectedPluginSources);
  return hiddenSkillRefs.filter((ref) => ref.scope !== "package" || selected.has(ref.source));
}

function packageSource(plugin: PackageSource): string {
  return typeof plugin === "string" ? plugin : plugin.source;
}

export function updatePackageSkillVisibility(
  plugins: PackageSource[],
  allSkillRefs: SkillRef[],
  visibleSkillRefs: SkillRef[],
  target: SkillRef,
  visible: boolean,
 ): { plugins: PackageSource[]; visiblePaths: Set<string> } {
  const sourceSkills = allSkillRefs.filter((ref) => ref.source === target.source);
  const visiblePaths = new Set(
    visibleSkillRefs.filter((ref) => ref.source === target.source).map((ref) => ref.path),
  );
  if (visible) visiblePaths.add(target.path);
  else visiblePaths.delete(target.path);

  const allPaths = [...new Set(sourceSkills.map((ref) => ref.path))].sort();
  const selectedPaths = allPaths.filter((skillPath) => visiblePaths.has(skillPath));
  const skills = selectedPaths.length === allPaths.length
    ? undefined
    : selectedPaths.length === 0
      ? []
      : ["!**", ...selectedPaths.map((skillPath) => `+${skillPath}`)];

  return {
    plugins: plugins.map((plugin) => {
      if (packageSource(plugin) !== target.source) return plugin;
      const next: Exclude<PackageSource, string> = typeof plugin === "string" ? { source: plugin } : { ...plugin };
      if (skills === undefined) delete next.skills;
      else next.skills = skills;
      return next;
    }),
    visiblePaths,
  };
}

export function preserveEffectiveSnapshotOnApplyFailure<T>(previous: T, ok: boolean, next: T): T {
  return ok ? next : previous;
}
