import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { DefaultPackageManager, getAgentDir, SettingsManager, type ResolvedResource } from "@earendil-works/pi-coding-agent";
import { getToolNamesForPreset } from "./tool-presets";
import {
  ProfileValidationError,
  assertApiProfileDraft,
  assertProfileRef,
  cloneJson,
  createBuiltinDefaultProfile,
  isAllowedBuiltinProfileRef,
  isBuiltinProfileRef,
  isRecord,
  normalizeProfilePackages,
  type PackageSource,
  type ProfileDefinition,
  type ProfileRef,
  type SkillRef,
} from "./profiles";
import { resolveProfilesFile, type ProfileStoreOptions } from "./profile-store";
import { getProjectTrustStatus } from "./project-trust-core";
import type { ProfileDiagnostic, ToolConflict } from "./session-profile-store";

export interface PluginToolPreview {
  name: string;
  source: string;
  extension: string;
  provenance: "plugin";
  metadataResolved: boolean;
}

export interface ProfilePreviewResult {
  profileRef?: ProfileRef;
  profileName: string;
  cwd: string;
  plugins: Exclude<PackageSource, string>[];
  tools: {
    builtinPreset: ProfileDefinition["tools"]["builtinPreset"];
    requestedBuiltinTools: string[];
    pluginTools: PluginToolPreview[];
    conflicts: ToolConflict[];
    unknownToolMetadata: boolean;
    activeToolNames?: string[];
  };
  skills: {
    mode: "pluginDefaultThenNarrow";
    visibleSkillRefs: SkillRef[];
    hiddenSkillRefs: SkillRef[];
  };
  diagnostics: ProfileDiagnostic[];
  safeToApply: boolean;
}

export interface ProfilePreviewRequest {
  cwd?: unknown;
  profileRef?: unknown;
  draftProfile?: unknown;
}

export interface ProfilePreviewOptions {
  agentDir?: string;
  profileStoreOptions?: ProfileStoreOptions;
}

export class ProfilePreviewError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "ProfilePreviewError";
    this.statusCode = statusCode;
  }
}

type NormalizedProfilePackage = Exclude<PackageSource, string>;

const STATIC_REGISTER_TOOL_RE = /(?:\b\w+\s*\.\s*)?registerTool\s*\(\s*\{[\s\S]*?\bname\s*:\s*["'`]([A-Za-z0-9_.-]+)["'`]/g;
const REGISTER_TOOL_CALL_RE = /(?:\b\w+\s*\.\s*)?registerTool\s*\(/g;
const BRACKET_REGISTER_TOOL_RE = /\[["'`]registerTool["'`]\]\s*\(/g;
const TOOL_HELPER_WITH_PI_CALL_RE = /\b(?:reg(?:ister)?|setup|initialize|init|create)[A-Za-z_$][\w$]*\s*\(\s*pi\b/g;
const DYNAMIC_RESOURCE_DISCOVERY_RE = /\.on\s*\(\s*["'`]resources_discover["'`]/;
export const INCOMPLETE_TOOL_METADATA_MESSAGE = "Enabled extension tool metadata will be resolved from the isolated session runtime.";

function previewErrorFromUnknown(error: unknown): never {
  if (error instanceof ProfilePreviewError) throw error;
  if (error instanceof ProfileValidationError) throw new ProfilePreviewError(error.message, error.statusCode);
  throw error;
}

function assertCwd(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) throw new ProfilePreviewError("cwd is required", 400);
}

function packageSourceString(source: PackageSource): string {
  return typeof source === "string" ? source : source.source;
}

function diagnostic(type: ProfileDiagnostic["type"], message: string, source?: string, resourcePath?: string): ProfileDiagnostic {
  return {
    type,
    message,
    ...(source ? { source } : {}),
    ...(resourcePath ? { path: resourcePath } : {}),
  };
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function draftToProfile(value: unknown): ProfileDefinition {
  assertApiProfileDraft(value, "draftProfile");
  const now = "2026-01-01T00:00:00.000Z";
  return {
    id: "profile:123e4567-e89b-42d3-a456-426614174000",
    createdAt: now,
    updatedAt: now,
    ...(cloneJson(value) as Omit<ProfileDefinition, "id" | "createdAt" | "updatedAt">),
  };
}

async function resolveProfileFromRequest(request: ProfilePreviewRequest, options: ProfilePreviewOptions): Promise<{ profile: ProfileDefinition; profileRef?: ProfileRef; diagnostics: ProfileDiagnostic[] }> {
  const hasProfileRef = request.profileRef !== undefined;
  const hasDraftProfile = request.draftProfile !== undefined;
  if (hasProfileRef === hasDraftProfile) throw new ProfilePreviewError("Exactly one of profileRef or draftProfile is required", 400);

  try {
    if (hasDraftProfile) return { profile: draftToProfile(request.draftProfile), diagnostics: [] };
    assertProfileRef(request.profileRef);
    const profileRef = request.profileRef;
    const resolved = await resolveProfilesFile(options.profileStoreOptions ?? (options.agentDir ? { agentDir: options.agentDir } : {}));
    const setupDiagnostics = resolved.warnings.map((message) => diagnostic("warning", message, resolved.store.defaults.globalProfileRef));
    if (isAllowedBuiltinProfileRef(profileRef)) {
      return { profile: createBuiltinDefaultProfile(), profileRef, diagnostics: setupDiagnostics };
    }
    if (isBuiltinProfileRef(profileRef)) throw new ProfilePreviewError("Unknown built-in profile", 400);
    const profile = resolved.store.profiles.find((item) => item.id === profileRef);
    if (!profile) throw new ProfilePreviewError("Profile not found", 404);
    return {
      profile,
      profileRef,
      diagnostics: setupDiagnostics,
    };
  } catch (error) {
    previewErrorFromUnknown(error);
  }
}

function resourceRequested(plugin: NormalizedProfilePackage, key: "extensions" | "skills"): boolean {
  const value = plugin[key];
  return value === undefined || value.length > 0;
}

async function resolveSelectedPackageResources(cwd: string, agentDir: string, plugins: NormalizedProfilePackage[]): Promise<{
  resolved: Awaited<ReturnType<DefaultPackageManager["resolve"]>>;
  missingSources: Set<string>;
  diagnostics: ProfileDiagnostic[];
}> {
  const missingSources = new Set<string>();
  const settingsManager = SettingsManager.inMemory({
    packages: cloneJson(plugins),
    extensions: ["!**"],
    skills: ["!**"],
    prompts: ["!**"],
    themes: ["!**"],
  });
  const packageManager = new DefaultPackageManager({ cwd, agentDir, settingsManager });
  const diagnostics: ProfileDiagnostic[] = [];
  const resolved = await packageManager.resolve(async (source) => {
    missingSources.add(source);
    return "skip";
  });
  return { resolved, missingSources, diagnostics };
}

async function resolveStandaloneSkillResources(cwd: string, agentDir: string): Promise<{ skills: ResolvedResource[]; diagnostics: ProfileDiagnostic[] }> {
  const projectTrusted = getProjectTrustStatus(cwd, agentDir).effective.trusted;
  const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted });
  const diagnostics: ProfileDiagnostic[] = settingsManager.drainErrors().map((item) => diagnostic(
    "error",
    `${item.scope}: ${item.error.message}`,
  ));
  const globalSettings = settingsManager.getGlobalSettings() as unknown;
  const projectSettings = settingsManager.getProjectSettings() as unknown;
  if (!isRecord(globalSettings)) diagnostics.push(diagnostic("error", "Global settings.json must contain a JSON object."));
  if (projectTrusted && !isRecord(projectSettings)) diagnostics.push(diagnostic("error", "Project .pi/settings.json must contain a JSON object."));
  if (diagnostics.some((item) => item.type === "error")) return { skills: [], diagnostics };
  try {
    const packageManager = new DefaultPackageManager({ cwd, agentDir, settingsManager });
    const resolved = await packageManager.resolve(async () => "skip");
    return {
      skills: resolved.skills.filter((resource) => resource.metadata.origin === "top-level"),
      diagnostics,
    };
  } catch (error) {
    return {
      skills: [],
      diagnostics: [...diagnostics, diagnostic("error", `Unable to resolve standalone skills: ${error instanceof Error ? error.message : String(error)}`)],
    };
  }
}

function selectedPackageSources(plugins: NormalizedProfilePackage[]): Set<string> {
  return new Set(plugins.map((plugin) => packageSourceString(plugin)));
}

function sourceHasResolvedResource(resolvedResources: ResolvedResource[], source: string): boolean {
  return resolvedResources.some((resource) => resource.metadata.origin === "package" && resource.metadata.source === source);
}

function buildMissingPackageDiagnostics(plugins: NormalizedProfilePackage[], resolved: Awaited<ReturnType<DefaultPackageManager["resolve"]>>, missingSources: Set<string>): { diagnostics: ProfileDiagnostic[]; safe: boolean; unknownToolMetadata: boolean } {
  const diagnostics: ProfileDiagnostic[] = [];
  let safe = true;
  let unknownToolMetadata = false;
  const allResources = [...resolved.extensions, ...resolved.skills, ...resolved.prompts, ...resolved.themes];
  for (const plugin of plugins) {
    const source = packageSourceString(plugin);
    const missing = missingSources.has(source) || !sourceHasResolvedResource(allResources, source);
    if (!missing) continue;
    const extensionsRequested = resourceRequested(plugin, "extensions");
    const skillsRequested = resourceRequested(plugin, "skills");
    const capabilityRequested = extensionsRequested || skillsRequested;
    diagnostics.push(diagnostic(
      capabilityRequested ? "error" : "warning",
      capabilityRequested
        ? "Selected package could not be resolved for requested extensions or skills."
        : "Selected package could not be resolved, but no extension or skill capability was requested.",
      source,
    ));
    if (extensionsRequested) unknownToolMetadata = true;
    if (capabilityRequested) safe = false;
  }
  return { diagnostics, safe, unknownToolMetadata };
}

function relativeResourcePath(resource: ResolvedResource): string {
  const baseDir = resource.metadata.baseDir;
  if (!baseDir) return resource.path;
  return path.relative(baseDir, resource.path).split(path.sep).join("/");
}

async function readExtensionToolMetadata(extension: ResolvedResource): Promise<{ tools: PluginToolPreview[]; unknown: boolean; unsafe: boolean; diagnostic?: ProfileDiagnostic }> {
  const relativePath = relativeResourcePath(extension);
  let content: string;
  try {
    content = await readFile(extension.path, "utf8");
  } catch (error) {
    return {
      tools: [],
      unknown: true,
      unsafe: true,
      diagnostic: diagnostic("error", `Unable to read enabled extension for tool metadata: ${error instanceof Error ? error.message : String(error)}`, extension.metadata.source, relativePath),
    };
  }

  const tools: PluginToolPreview[] = [];
  const staticMatches = [...content.matchAll(STATIC_REGISTER_TOOL_RE)];
  for (const match of staticMatches) {
    tools.push({
      name: match[1],
      source: extension.metadata.source,
      extension: relativePath,
      provenance: "plugin",
      metadataResolved: true,
    });
  }

  if (DYNAMIC_RESOURCE_DISCOVERY_RE.test(content)) {
    return {
      tools,
      unknown: true,
      unsafe: true,
      diagnostic: diagnostic("error", "Enabled extension resources cannot be resolved without executing extension code.", extension.metadata.source, relativePath),
    };
  }
  const callCount = [...content.matchAll(REGISTER_TOOL_CALL_RE)].length + [...content.matchAll(BRACKET_REGISTER_TOOL_RE)].length;
  const unknown = callCount !== staticMatches.length || TOOL_HELPER_WITH_PI_CALL_RE.test(content);
  return {
    tools,
    unknown,
    unsafe: false,
    ...(unknown ? { diagnostic: diagnostic("warning", INCOMPLETE_TOOL_METADATA_MESSAGE, extension.metadata.source, relativePath) } : {}),
  };
}

async function buildToolPreview(profile: ProfileDefinition, extensions: ResolvedResource[]): Promise<{ tools: ProfilePreviewResult["tools"]; diagnostics: ProfileDiagnostic[]; safe: boolean }> {
  const requestedBuiltinTools = getToolNamesForPreset(profile.tools.builtinPreset);
  const diagnostics: ProfileDiagnostic[] = [];
  const pluginTools: PluginToolPreview[] = [];
  let unknownToolMetadata = false;
  let unsafeToolMetadata = false;

  for (const extension of extensions.filter((resource) => resource.enabled && resource.metadata.origin === "package")) {
    const metadata = await readExtensionToolMetadata(extension);
    pluginTools.push(...metadata.tools);
    if (metadata.unknown) unknownToolMetadata = true;
    if (metadata.unsafe) unsafeToolMetadata = true;
    if (metadata.diagnostic) diagnostics.push(metadata.diagnostic);
  }

  const pluginToolCounts = new Map<string, number>();
  for (const tool of pluginTools) pluginToolCounts.set(tool.name, (pluginToolCounts.get(tool.name) ?? 0) + 1);
  const ambiguousPluginToolNames = [...pluginToolCounts.entries()].filter(([, count]) => count > 1).map(([name]) => name);
  for (const name of ambiguousPluginToolNames) {
    diagnostics.push(diagnostic("error", `Multiple selected plugin extensions register tool '${name}'; provider selection is ambiguous.`, name));
  }
  unsafeToolMetadata ||= ambiguousPluginToolNames.length > 0;

  const builtinSet = new Set(requestedBuiltinTools);
  const conflicts: ToolConflict[] = [];
  for (const tool of pluginTools) {
    if (!builtinSet.has(tool.name)) continue;
    conflicts.push({
      name: tool.name,
      builtinSelected: true,
      selectedProvider: "plugin",
      pluginSource: tool.source,
      message: `Plugin tool '${tool.name}' from ${tool.source} may override the selected built-in tool.`,
    });
  }

  const tools: ProfilePreviewResult["tools"] = {
    builtinPreset: profile.tools.builtinPreset,
    requestedBuiltinTools,
    pluginTools,
    conflicts,
    unknownToolMetadata,
    activeToolNames: uniqueStrings([...requestedBuiltinTools, ...pluginTools.map((tool) => tool.name)]),
  };
  return { tools, diagnostics, safe: !unsafeToolMetadata };
}

function skillNameFromPath(skillPath: string): string {
  const parts = skillPath.split("/");
  if (parts[parts.length - 1] === "SKILL.md" && parts.length >= 2) return parts[parts.length - 2];
  return parts[parts.length - 1]?.replace(/\.md$/i, "") || skillPath;
}

function skillRefForResource(resource: ResolvedResource): SkillRef {
  if (resource.metadata.origin !== "package") {
    const absolutePath = path.resolve(resource.path);
    return {
      source: absolutePath,
      scope: resource.metadata.scope,
      path: absolutePath,
      name: skillNameFromPath(absolutePath),
    };
  }
  const skillPath = relativeResourcePath(resource);
  return {
    source: resource.metadata.source,
    scope: "package",
    path: skillPath,
    name: skillNameFromPath(skillPath),
  };
}

function buildSkillPreview(profile: ProfileDefinition, skills: ResolvedResource[]): { skills: ProfilePreviewResult["skills"]; diagnostics: ProfileDiagnostic[] } {
  const diagnostics: ProfileDiagnostic[] = [];
  const visibleSkillRefs: SkillRef[] = [];
  const hiddenSkillRefs: SkillRef[] = [];

  for (const skill of skills) {
    const ref = skillRefForResource(skill);
    if (skill.enabled) visibleSkillRefs.push(ref);
    else hiddenSkillRefs.push(ref);
  }

  for (const disabled of profile.skills.disabledSkillRefs ?? []) {
    const before = visibleSkillRefs.length;
    for (let index = visibleSkillRefs.length - 1; index >= 0; index -= 1) {
      const ref = visibleSkillRefs[index];
      if (ref.source === disabled.source && ref.path === disabled.path) {
        visibleSkillRefs.splice(index, 1);
        hiddenSkillRefs.push(ref);
      }
    }
    if (visibleSkillRefs.length !== before) {
      diagnostics.push(diagnostic("warning", "A disabled skill ref matched an enabled skill; hidden wins for this preview.", disabled.source, disabled.path));
    }
  }

  return {
    skills: { mode: "pluginDefaultThenNarrow", visibleSkillRefs, hiddenSkillRefs },
    diagnostics,
  };
}

export async function resolveProfilePreview(request: ProfilePreviewRequest, options: ProfilePreviewOptions = {}): Promise<ProfilePreviewResult> {
  assertCwd(request.cwd);
  let cwd: string;
  try {
    cwd = await realpath(path.resolve(request.cwd));
  } catch (error) {
    throw new ProfilePreviewError(`cwd must resolve to an existing directory: ${error instanceof Error ? error.message : String(error)}`, 400);
  }
  const agentDir = options.agentDir ?? getAgentDir();
  const { profile, profileRef, diagnostics: profileDiagnostics } = await resolveProfileFromRequest(request, options);
  const plugins = normalizeProfilePackages(profile.plugins);
  const { resolved, missingSources, diagnostics: resolveDiagnostics } = await resolveSelectedPackageResources(cwd, agentDir, plugins);
  const selectedSources = selectedPackageSources(plugins);
  const selectedExtensions = resolved.extensions.filter((resource) => resource.metadata.origin === "package" && selectedSources.has(resource.metadata.source));
  const selectedSkills = resolved.skills.filter((resource) => resource.metadata.origin === "package" && selectedSources.has(resource.metadata.source));

  const missing = buildMissingPackageDiagnostics(plugins, resolved, missingSources);
  const toolPreview = await buildToolPreview(profile, selectedExtensions);
  const standalone = await resolveStandaloneSkillResources(cwd, agentDir);
  const skillPreview = buildSkillPreview(profile, [...selectedSkills, ...standalone.skills]);
  const tools = missing.unknownToolMetadata
    ? { ...toolPreview.tools, unknownToolMetadata: true, activeToolNames: undefined }
    : toolPreview.tools;

  const diagnostics = [
    ...profileDiagnostics,
    ...resolveDiagnostics,
    ...standalone.diagnostics,
    ...missing.diagnostics,
    ...toolPreview.diagnostics,
    ...skillPreview.diagnostics,
  ];
  const safeToApply = missing.safe && toolPreview.safe
    && !resolveDiagnostics.some((item) => item.type === "error")
    && !standalone.diagnostics.some((item) => item.type === "error");

  return {
    ...(profileRef ? { profileRef } : {}),
    profileName: profile.name,
    cwd,
    plugins,
    tools,
    skills: skillPreview.skills,
    diagnostics,
    safeToApply,
  };
}

export async function postProfilePreviewApiResult(body: unknown, options: ProfilePreviewOptions = {}): Promise<{ status: number; body: Record<string, unknown> | ProfilePreviewResult }> {
  try {
    if (!isRecord(body)) throw new ProfilePreviewError("Request body must be an object", 400);
    const preview = await resolveProfilePreview(body, options);
    return { status: 200, body: preview };
  } catch (error) {
    const status = error instanceof ProfilePreviewError ? error.statusCode : ((error as Error & { statusCode?: number }).statusCode ?? 500);
    return {
      status,
      body: { error: error instanceof Error ? error.message : String(error) },
    };
  }
}
