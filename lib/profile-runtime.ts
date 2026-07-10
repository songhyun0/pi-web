import path from "node:path";
import {
  type CreateAgentSessionServicesOptions,
  type ResourceDiagnostic,
  SettingsManager,
  type Skill,
  type SourceInfo,
} from "@earendil-works/pi-coding-agent";
import { cloneJson, INCOMPLETE_TOOL_METADATA_MESSAGE, normalizeProfilePackages, type PackageSource, type SkillRef } from "./profiles";
import type { CapabilitySnapshotV1, PluginToolSnapshot, ProfileDiagnostic, ToolConflict } from "./session-profile-store";

const RESOURCE_KEYS = ["packages", "extensions", "skills", "prompts", "themes"] as const;
const SUPPRESS_AUTO_AND_TOP_LEVEL_RESOURCES = ["!**"];
const EMPTY_RESOURCE_PATHS: string[] = [];

type ResourceKey = typeof RESOURCE_KEYS[number];
type PiSettings = ReturnType<SettingsManager["getGlobalSettings"]>;
type ResourceLoaderOptions = NonNullable<CreateAgentSessionServicesOptions["resourceLoaderOptions"]>;

type MutableSettingsManager = SettingsManager & {
  getGlobalSettings: () => PiSettings;
  getProjectSettings: () => PiSettings;
  getPackages: () => PackageSource[];
  getExtensionPaths: () => string[];
  getSkillPaths: () => string[];
  getPromptTemplatePaths: () => string[];
  getThemePaths: () => string[];
  setPackages: (packages: PackageSource[]) => void;
  setProjectPackages: (packages: PackageSource[]) => void;
  setExtensionPaths: (paths: string[]) => void;
  setProjectExtensionPaths: (paths: string[]) => void;
  setSkillPaths: (paths: string[]) => void;
  setProjectSkillPaths: (paths: string[]) => void;
  setPromptTemplatePaths: (paths: string[]) => void;
  setProjectPromptTemplatePaths: (paths: string[]) => void;
  setThemePaths: (paths: string[]) => void;
  setProjectThemePaths: (paths: string[]) => void;
  reload: () => Promise<void>;
  applyOverrides: (overrides: Partial<PiSettings>) => void;
};

export interface CreateProfileScopedSettingsManagerOptions {
  cwd: string;
  agentDir?: string;
  snapshot: CapabilitySnapshotV1;
  projectTrusted?: boolean;
}

export interface ProfileScopedRuntimeOptions {
  settingsManager: SettingsManager;
  resourceLoaderOptions: ResourceLoaderOptions;
}

export interface RuntimeToolMetadata {
  name: string;
  description?: string;
  active: boolean;
  provenance: "builtin" | "plugin" | "unknown";
  selectedProvider?: "builtin" | "plugin";
  pluginSource?: string;
  pluginPath?: string;
  pluginOrigin?: string;
  conflict?: boolean;
  conflictMessage?: string;
}

interface RuntimeToolLike {
  name: string;
  description?: string;
  sourceInfo?: SourceInfo;
}

interface RuntimeSkillLike {
  name: string;
  filePath: string;
  sourceInfo?: SourceInfo;
}

export interface ProfileToolPolicySession {
  getAllTools(): RuntimeToolLike[];
  getActiveToolNames(): string[];
  setActiveToolsByName(names: string[]): void;
  resourceLoader?: {
    getSkills(): { skills: RuntimeSkillLike[]; diagnostics?: ResourceDiagnostic[] };
  };
}

function isSettingsObject(value: unknown): value is PiSettings {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertValidProfileSettings(
  base: SettingsManager,
  projectTrusted: boolean,
  getGlobalSettings = () => base.getGlobalSettings(),
  getProjectSettings = () => base.getProjectSettings(),
): void {
  const errors = base.drainErrors();
  if (errors.length > 0) {
    throw new Error(`Profile-backed sessions require valid Pi settings: ${errors.map((item) => `${item.scope}: ${item.error.message}`).join("; ")}`);
  }
  if (!isSettingsObject(getGlobalSettings())) {
    throw new Error("Profile-backed sessions require global settings.json to contain a JSON object.");
  }
  if (projectTrusted && !isSettingsObject(getProjectSettings())) {
    throw new Error("Profile-backed sessions require trusted project .pi/settings.json to contain a JSON object.");
  }
}

function cloneSettings(settings: PiSettings): PiSettings {
  return cloneJson(settings);
}

function withoutResourceSettings(settings: PiSettings): PiSettings {
  const next = cloneSettings(settings);
  for (const key of RESOURCE_KEYS) delete next[key as ResourceKey];
  return next;
}

function suppressedResourcePatterns(): string[] {
  return [...SUPPRESS_AUTO_AND_TOP_LEVEL_RESOURCES];
}

function standaloneSkillPatterns(snapshot: CapabilitySnapshotV1, scope: "global" | "project"): string[] {
  const refs = snapshot.skills.visibleSkillRefs.filter((ref) => ref.scope !== "package"
    && (scope === "project" ? ref.scope === "project" : ref.scope !== "project"));
  return ["!**", ...refs.map((ref) => `+${ref.path}`)];
}

function withGlobalProfileResources(settings: PiSettings, packages: PackageSource[], skillPatterns: string[]): PiSettings {
  return {
    ...withoutResourceSettings(settings),
    packages: cloneJson(packages),
    extensions: suppressedResourcePatterns(),
    skills: [...skillPatterns],
    prompts: suppressedResourcePatterns(),
    themes: suppressedResourcePatterns(),
  };
}

function withSuppressedProjectResources(settings: PiSettings, skillPatterns: string[]): PiSettings {
  return {
    ...withoutResourceSettings(settings),
    packages: [],
    extensions: suppressedResourcePatterns(),
    skills: [...skillPatterns],
    prompts: suppressedResourcePatterns(),
    themes: suppressedResourcePatterns(),
  };
}

function stripResourceOverrides(overrides: Partial<PiSettings>): Partial<PiSettings> {
  const next = cloneJson(overrides);
  for (const key of RESOURCE_KEYS) delete next[key as ResourceKey];
  return next;
}

function rejectResourcePersistence(): never {
  throw new Error("Profile-scoped settings managers cannot persist resource capability settings.");
}

export function createProfileScopedSettingsManager(options: CreateProfileScopedSettingsManagerOptions): SettingsManager {
  const projectTrusted = options.projectTrusted ?? false;
  const base = SettingsManager.create(options.cwd, options.agentDir, { projectTrusted });
  assertValidProfileSettings(base, projectTrusted);
  const manager = base as MutableSettingsManager;
  const profilePackages = normalizeProfilePackages(options.snapshot.plugins);
  const globalSkillPatterns = standaloneSkillPatterns(options.snapshot, "global");
  const projectSkillPatterns = standaloneSkillPatterns(options.snapshot, "project");
  const combinedSkillPatterns = ["!**", ...globalSkillPatterns.slice(1), ...projectSkillPatterns.slice(1)];

  const baseGetGlobalSettings = manager.getGlobalSettings.bind(manager);
  const baseGetProjectSettings = manager.getProjectSettings.bind(manager);
  const baseReload = manager.reload.bind(manager);
  const baseApplyOverrides = manager.applyOverrides.bind(manager);

  manager.getGlobalSettings = () => withGlobalProfileResources(baseGetGlobalSettings(), profilePackages, globalSkillPatterns);
  manager.getProjectSettings = () => withSuppressedProjectResources(baseGetProjectSettings(), projectSkillPatterns);
  manager.getPackages = () => cloneJson(profilePackages);
  manager.getExtensionPaths = () => [...EMPTY_RESOURCE_PATHS];
  manager.getSkillPaths = () => [...combinedSkillPatterns];
  manager.getPromptTemplatePaths = () => [...EMPTY_RESOURCE_PATHS];
  manager.getThemePaths = () => [...EMPTY_RESOURCE_PATHS];

  manager.setPackages = rejectResourcePersistence;
  manager.setProjectPackages = rejectResourcePersistence;
  manager.setExtensionPaths = rejectResourcePersistence;
  manager.setProjectExtensionPaths = rejectResourcePersistence;
  manager.setSkillPaths = rejectResourcePersistence;
  manager.setProjectSkillPaths = rejectResourcePersistence;
  manager.setPromptTemplatePaths = rejectResourcePersistence;
  manager.setProjectPromptTemplatePaths = rejectResourcePersistence;
  manager.setThemePaths = rejectResourcePersistence;
  manager.setProjectThemePaths = rejectResourcePersistence;

  manager.applyOverrides = (overrides) => baseApplyOverrides(stripResourceOverrides(overrides));
  manager.reload = async () => {
    await baseReload();
    assertValidProfileSettings(base, projectTrusted, baseGetGlobalSettings, baseGetProjectSettings);
  };

  return manager;
}

function normalizeRefPath(value: string): string {
  return value.split(path.sep).join("/");
}

function skillRelativePath(skill: RuntimeSkillLike): string | undefined {
  const baseDir = skill.sourceInfo?.baseDir;
  const sourcePath = skill.sourceInfo?.path ?? skill.filePath;
  if (!baseDir || !sourcePath) return undefined;
  return normalizeRefPath(path.relative(baseDir, sourcePath));
}

function skillMatchesRef(skill: RuntimeSkillLike, ref: SkillRef): boolean {
  const sourceInfo = skill.sourceInfo;
  if (ref.scope && ref.scope !== "package") {
    if (sourceInfo?.origin === "package" || (sourceInfo?.scope && sourceInfo.scope !== ref.scope)) return false;
    // Standalone skill identity is its canonical path and scope; frontmatter names are mutable display metadata.
    return normalizeRefPath(skill.filePath) === normalizeRefPath(ref.path);
  }
  if (sourceInfo?.source !== ref.source) return false;
  if (ref.scope === "package") {
    if (sourceInfo.origin !== "package") return false;
  } else if (ref.scope && sourceInfo.scope !== ref.scope) return false;
  if (ref.name && skill.name !== ref.name) return false;

  const refPath = normalizeRefPath(ref.path);
  const relativePath = skillRelativePath(skill);
  const candidates = new Set<string>([
    normalizeRefPath(skill.filePath),
    ...(sourceInfo?.path ? [normalizeRefPath(sourceInfo.path)] : []),
    ...(relativePath ? [relativePath] : []),
  ]);
  return candidates.has(refPath);
}

function skillHiddenRefMatchBeforeMetadata(skill: RuntimeSkillLike, ref: SkillRef): "match" | "no-match" | "unverifiable" {
  if (ref.scope && ref.scope !== "package") return skillMatchesRef(skill, ref) ? "match" : "no-match";
  if (skill.sourceInfo?.origin === "package") return skillMatchesRef(skill, ref) ? "match" : "no-match";
  if (ref.name && skill.name !== ref.name) return "no-match";
  const filePath = normalizeRefPath(skill.filePath);
  const refPath = normalizeRefPath(ref.path);
  if (filePath !== refPath && !filePath.endsWith(`/${refPath}`)) return "no-match";
  if (skill.sourceInfo?.source) return skill.sourceInfo.source === ref.source ? "match" : "no-match";
  if (path.isAbsolute(ref.source)) {
    const relative = path.relative(ref.source, skill.filePath);
    if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) return "match";
  }
  return "unverifiable";
}

export function createProfileSkillsOverride(snapshot: CapabilitySnapshotV1): ResourceLoaderOptions["skillsOverride"] {
  const hiddenRefs = cloneJson(snapshot.skills.hiddenSkillRefs ?? []);
  return (base: { skills: Skill[]; diagnostics: ResourceDiagnostic[] }) => {
    if (hiddenRefs.length === 0) return base;
    const diagnostics = [...base.diagnostics];
    const skills = base.skills.filter((skill) => {
      const matches = hiddenRefs.map((ref) => ({ ref, result: skillHiddenRefMatchBeforeMetadata(skill, ref) }));
      if (matches.some((item) => item.result === "match")) return false;
      for (const { ref, result } of matches) {
        if (result !== "unverifiable") continue;
        diagnostics.push({
          type: "error",
          message: `Cannot verify package source '${ref.source}' while applying hidden skill ref '${ref.path}'.`,
          path: skill.filePath,
        });
      }
      return true;
    });
    return { skills, diagnostics };
  };
}

export function createProfileResourceLoaderOptions(snapshot: CapabilitySnapshotV1): ResourceLoaderOptions {
  return {
    skillsOverride: createProfileSkillsOverride(snapshot),
    promptsOverride: (base) => ({ ...base, prompts: [] }),
    themesOverride: (base) => ({ ...base, themes: [] }),
  };
}

export function createProfileScopedRuntimeOptions(options: CreateProfileScopedSettingsManagerOptions): ProfileScopedRuntimeOptions {
  return {
    settingsManager: createProfileScopedSettingsManager(options),
    resourceLoaderOptions: createProfileResourceLoaderOptions(options.snapshot),
  };
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function isBuiltinSource(sourceInfo: SourceInfo | undefined): boolean {
  return sourceInfo?.source === "builtin" || Boolean(sourceInfo?.path?.startsWith("<builtin:"));
}

function isSdkSource(sourceInfo: SourceInfo | undefined): boolean {
  return sourceInfo?.source === "sdk" || Boolean(sourceInfo?.path?.startsWith("<sdk:"));
}

function toolProvenance(tool: RuntimeToolLike): RuntimeToolMetadata["provenance"] {
  if (isBuiltinSource(tool.sourceInfo)) return "builtin";
  if (!tool.sourceInfo || isSdkSource(tool.sourceInfo)) return "unknown";
  return tool.sourceInfo.origin === "package" ? "plugin" : "unknown";
}

export function getProfileActiveToolNames(_session: ProfileToolPolicySession, snapshot: CapabilitySnapshotV1): string[] {
  return uniqueStrings(snapshot.tools.activeToolNames);
}

export function getProfileRuntimeToolMetadata(session: ProfileToolPolicySession, snapshot: CapabilitySnapshotV1): RuntimeToolMetadata[] {
  const active = new Set(session.getActiveToolNames());
  const requestedBuiltins = new Set(snapshot.tools.requestedBuiltinTools);

  return session.getAllTools().map((tool) => {
    const provenance = toolProvenance(tool);
    const pluginCollision = provenance === "plugin" && requestedBuiltins.has(tool.name);
    return {
      name: tool.name,
      description: tool.description,
      active: active.has(tool.name),
      provenance,
      ...(pluginCollision ? { selectedProvider: "plugin" as const } : {}),
      ...(provenance === "builtin" && requestedBuiltins.has(tool.name) ? { selectedProvider: "builtin" as const } : {}),
      ...(provenance === "plugin" ? { pluginSource: tool.sourceInfo?.source, pluginPath: tool.sourceInfo?.path, pluginOrigin: tool.sourceInfo?.origin } : {}),
      ...(pluginCollision
        ? {
            conflict: true,
            conflictMessage: `Plugin tool '${tool.name}' from ${tool.sourceInfo?.source ?? "unknown"} overrides the selected built-in tool.`,
          }
        : {}),
    };
  });
}

export function resolveProfileSnapshotToolsFromRuntime(
  session: ProfileToolPolicySession,
  snapshot: CapabilitySnapshotV1,
): CapabilitySnapshotV1 {
  const selectedSources = new Set(snapshot.plugins.map((plugin) => typeof plugin === "string" ? plugin : plugin.source));
  const pluginTools: PluginToolSnapshot[] = [];
  const diagnostics: ProfileDiagnostic[] = [];
  for (const tool of session.getAllTools()) {
    if (toolProvenance(tool) !== "plugin") continue;
    const source = tool.sourceInfo?.source;
    const extension = tool.sourceInfo?.path;
    if (!source || !selectedSources.has(source)) continue;
    if (!extension) {
      diagnostics.push({
        type: "error",
        message: `Selected plugin tool '${tool.name}' has no runtime extension path.`,
        source,
      });
      continue;
    }
    pluginTools.push({
      name: tool.name,
      source,
      extension: normalizeRefPath(extension),
      provenance: "plugin",
      metadataResolved: true,
    });
  }
  pluginTools.sort((left, right) => left.name.localeCompare(right.name) || left.source.localeCompare(right.source));
  if (pluginTools.length !== new Set(pluginTools.map((tool) => tool.name)).size) {
    diagnostics.push({ type: "error", message: "Multiple selected plugin providers registered the same tool name at runtime." });
  }
  if (diagnostics.length > 0) {
    const error = new Error("Selected plugin tool metadata could not be resolved from the isolated runtime.");
    (error as Error & { diagnostics?: ProfileDiagnostic[] }).diagnostics = diagnostics;
    throw error;
  }

  const requestedBuiltins = [...snapshot.tools.requestedBuiltinTools];
  const requestedBuiltinSet = new Set(requestedBuiltins);
  const conflicts: ToolConflict[] = pluginTools
    .filter((tool) => requestedBuiltinSet.has(tool.name))
    .map((tool) => ({
      name: tool.name,
      builtinSelected: true,
      selectedProvider: "plugin" as const,
      pluginSource: tool.source,
      message: `Plugin tool '${tool.name}' from ${tool.source} overrides the selected built-in tool.`,
    }));
  return {
    ...cloneJson(snapshot),
    diagnostics: snapshot.diagnostics.filter((diagnostic) => (
      diagnostic.type !== "warning" || diagnostic.message !== INCOMPLETE_TOOL_METADATA_MESSAGE
    )),
    tools: {
      ...cloneJson(snapshot.tools),
      pluginTools,
      activeToolNames: uniqueStrings([...requestedBuiltins, ...pluginTools.map((tool) => tool.name)]),
      conflicts,
    },
  };
}

export function applyProfileToolPolicy(session: ProfileToolPolicySession, snapshot: CapabilitySnapshotV1): RuntimeToolMetadata[] {
  session.setActiveToolsByName(getProfileActiveToolNames(session, snapshot));
  return getProfileRuntimeToolMetadata(session, snapshot);
}

function sortedToolNames(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

function setEquals(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
}

function describeToolNameDiff(expected: string[], actual: string[]): string {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const missing = expected.filter((name) => !actualSet.has(name));
  const unexpected = actual.filter((name) => !expectedSet.has(name));
  return [
    missing.length ? `missing active tools: ${missing.join(", ")}` : "",
    unexpected.length ? `unexpected active tools: ${unexpected.join(", ")}` : "",
  ].filter(Boolean).join("; ");
}

function conflictKey(conflict: Pick<ToolConflict, "name" | "selectedProvider" | "pluginSource">): string {
  return `${conflict.name}\0${conflict.selectedProvider}\0${conflict.pluginSource ?? ""}`;
}

function runtimeConflictKey(tool: RuntimeToolMetadata): string {
  return `${tool.name}\0${tool.selectedProvider ?? ""}\0${tool.pluginSource ?? ""}`;
}

function normalizedRuntimePath(value: string | undefined): string {
  if (!value) return "";
  return normalizeRefPath(value);
}

function pluginToolMatchesSnapshot(runtimeTool: RuntimeToolMetadata, snapshotTool: PluginToolSnapshot): boolean {
  if (runtimeTool.name !== snapshotTool.name) return false;
  if (runtimeTool.pluginSource !== snapshotTool.source) return false;
  const runtimePath = normalizedRuntimePath(runtimeTool.pluginPath);
  const snapshotExtension = normalizeRefPath(snapshotTool.extension);
  return runtimePath === snapshotExtension || runtimePath.endsWith(`/${snapshotExtension}`);
}


export interface ProfileRuntimeValidationResult {
  metadata: RuntimeToolMetadata[];
  diagnostics: ProfileDiagnostic[];
}

export function validateProfileRuntimeAgainstSnapshot(
  session: ProfileToolPolicySession,
  snapshot: CapabilitySnapshotV1,
  metadata: RuntimeToolMetadata[] = getProfileRuntimeToolMetadata(session, snapshot),
): ProfileRuntimeValidationResult {
  const diagnostics: ProfileDiagnostic[] = [];
  const expectedActive = sortedToolNames(snapshot.tools.activeToolNames);
  const actualActive = sortedToolNames(session.getActiveToolNames());

  if (!setEquals(expectedActive, actualActive)) {
    diagnostics.push({
      type: "error",
      message: `Profile runtime active tools do not match the immutable capability snapshot (${describeToolNameDiff(expectedActive, actualActive)}).`,
      source: snapshot.profileRef,
    });
  }

  const snapshotPluginTools = snapshot.tools.pluginTools ?? [];
  for (const expectedName of expectedActive) {
    const runtimeTool = metadata.find((tool) => tool.name === expectedName);
    if (!runtimeTool) continue;
    const expectedPlugin = snapshotPluginTools.find((tool) => tool.name === expectedName);
    if (expectedPlugin) {
      if (runtimeTool.provenance !== "plugin" || !pluginToolMatchesSnapshot(runtimeTool, expectedPlugin)) {
        diagnostics.push({
          type: "error",
          message: `Active tool '${expectedName}' is not provided by the snapshotted plugin ${expectedPlugin.source}/${expectedPlugin.extension}.`,
          source: expectedPlugin.source,
          path: expectedPlugin.extension,
        });
      }
    } else if (runtimeTool.provenance !== "builtin") {
      diagnostics.push({
        type: "error",
        message: `Active tool '${expectedName}' must be provided by the selected built-in implementation.`,
        source: runtimeTool.pluginSource ?? expectedName,
        path: runtimeTool.pluginPath,
      });
    }
  }
  for (const tool of metadata) {
    if (!tool.active) continue;
    if (tool.provenance === "unknown") {
      diagnostics.push({
        type: "error",
        message: `Active tool '${tool.name}' has unknown runtime provenance and cannot be admitted into a profile snapshot.`,
        source: tool.name,
      });
    }
  }
  const expectedConflictKeys = new Set(snapshot.tools.conflicts.map(conflictKey));
  const runtimeConflicts = metadata.filter((tool) => tool.conflict);
  const runtimeConflictKeys = new Set(runtimeConflicts.map(runtimeConflictKey));

  for (const conflict of snapshot.tools.conflicts) {
    if (!runtimeConflictKeys.has(conflictKey(conflict))) {
      diagnostics.push({
        type: "error",
        message: `Runtime tool conflict for '${conflict.name}' does not match the immutable capability snapshot.`,
        source: conflict.pluginSource ?? conflict.name,
      });
    }
  }

  for (const conflict of runtimeConflicts) {
    if (!expectedConflictKeys.has(runtimeConflictKey(conflict))) {
      diagnostics.push({
        type: "error",
        message: `Runtime discovered an unsnapshotted tool conflict for '${conflict.name}'.`,
        source: conflict.pluginSource ?? conflict.name,
      });
    }
  }

  const runtimeSkills = session.resourceLoader?.getSkills();
  if (runtimeSkills) {
    for (const runtimeDiagnostic of (runtimeSkills.diagnostics ?? []).filter((item) => item.type === "error" || item.type === "collision")) {
      diagnostics.push({
        type: "error",
        message: `Profile runtime skill loading failed: ${runtimeDiagnostic.message}`,
        source: snapshot.profileRef,
        path: runtimeDiagnostic.path,
      });
    }

    const loadedSkills = runtimeSkills.skills;
    const selectedSources = new Set(snapshot.plugins.map((plugin) => typeof plugin === "string" ? plugin : plugin.source));
    for (const loaded of loadedSkills) {
      const sourceInfo = loaded.sourceInfo;
      const selectedPackageSkill = sourceInfo?.origin === "package" && selectedSources.has(sourceInfo.source);
      const selectedStandaloneSkill = sourceInfo?.origin !== "package"
        && snapshot.skills.visibleSkillRefs.some((visible) => visible.scope !== "package" && skillMatchesRef(loaded, visible));
      if (!selectedPackageSkill && !selectedStandaloneSkill) {
        diagnostics.push({
          type: "error",
          message: `Profile runtime loaded skill '${loaded.name}' outside the immutable skill capability set.`,
          source: sourceInfo?.source,
          path: skillRelativePath(loaded) ?? loaded.filePath,
        });
        continue;
      }
      if (snapshot.skills.hiddenSkillRefs.some((hidden) => skillMatchesRef(loaded, hidden))) {
        diagnostics.push({
          type: "error",
          message: `Profile runtime loaded hidden skill '${loaded.name}'.`,
          source: sourceInfo?.source ?? loaded.filePath,
          path: skillRelativePath(loaded) ?? loaded.filePath,
        });
      }
    }
  }

  return { metadata, diagnostics };
}
