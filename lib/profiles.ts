export type ToolPreset = "none" | "default" | "full";

export type ProfileRef = `profile:${string}` | `builtin:${string}`;

export type PackageSource =
  | string
  | {
      source: string;
      extensions?: string[];
      skills?: string[];
      prompts?: string[];
      themes?: string[];
    };

export interface SkillRef {
  source: string;
  scope?: "user" | "project" | "package" | "temporary" | string;
  path: string;
  name?: string;
}

export interface ProfileDefinition {
  id: ProfileRef;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  tools: {
    builtinPreset: ToolPreset;
    pluginTools: "fromSelectedPlugins";
  };
  plugins: PackageSource[];
  skills: {
    mode: "pluginDefaultThenNarrow";
    disabledSkillRefs?: SkillRef[];
  };
}

export interface ProfilesFileV1 {
  version: 1;
  defaults: {
    globalProfileRef: ProfileRef;
  };
  profiles: ProfileDefinition[];
}

export interface ProfileValidationIssue {
  path: string;
  message: string;
}

export class ProfileValidationError extends Error {
  statusCode = 400;
  issues: ProfileValidationIssue[];

  constructor(message: string, issues: ProfileValidationIssue[] = []) {
    super(message);
    this.name = "ProfileValidationError";
    this.issues = issues;
  }
}

export const BUILTIN_DEFAULT_PROFILE_REF = "builtin:default" satisfies ProfileRef;

const PROFILE_REF_RE = /^profile:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BUILTIN_REF_RE = /^builtin:[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const TOOL_PRESETS = new Set<ToolPreset>(["none", "default", "full"]);
const PROFILE_TOOL_KEYS = new Set(["builtinPreset", "pluginTools"]);
const PROFILE_SKILL_KEYS = new Set(["mode", "disabledSkillRefs"]);
const PACKAGE_SOURCE_KEYS = new Set(["source", "extensions", "skills", "prompts", "themes"]);
const SKILL_REF_KEYS = new Set(["source", "scope", "path", "name"]);
const FORBIDDEN_PROFILE_CAPABILITY_KEYS = new Set([
  "prompts",
  "promptTemplates",
  "themes",
  "extensions",
  "resources",
  "resourceBundles",
  "settings",
  "systemPrompt",
  "projectDefault",
  "projectDefaults",
]);

export const BUILTIN_PROFILE_REFS = new Set<ProfileRef>([BUILTIN_DEFAULT_PROFILE_REF]);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function fail(path: string, message: string): never {
  throw new ProfileValidationError(`${path}: ${message}`, [{ path, message }]);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function assertNonEmptyString(value: unknown, path: string): asserts value is string {
  if (!isNonEmptyString(value)) fail(path, "must be a non-empty string");
  if (/[\x00-\x1f]/.test(value)) fail(path, "must not contain control characters");
}

function assertOptionalString(value: unknown, path: string): asserts value is string | undefined {
  if (value !== undefined && typeof value !== "string") fail(path, "must be a string when present");
}

function assertStringArray(value: unknown, path: string): asserts value is string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    fail(path, "must be an array of strings");
  }
}

function assertTimestampLike(value: unknown, path: string): asserts value is string {
  assertNonEmptyString(value, path);
  if (Number.isNaN(Date.parse(value))) fail(path, "must be an ISO timestamp string");
}

export function isProfileRef(value: unknown): value is ProfileRef {
  return typeof value === "string" && (PROFILE_REF_RE.test(value) || BUILTIN_REF_RE.test(value));
}

export function isUserProfileRef(value: unknown): value is ProfileRef {
  return typeof value === "string" && PROFILE_REF_RE.test(value);
}

export function isBuiltinProfileRef(value: unknown): value is ProfileRef {
  return typeof value === "string" && BUILTIN_REF_RE.test(value);
}

export function isAllowedBuiltinProfileRef(value: unknown): value is ProfileRef {
  return isBuiltinProfileRef(value) && BUILTIN_PROFILE_REFS.has(value);
}

export function assertProfileRef(value: unknown, path = "profileRef"): asserts value is ProfileRef {
  if (!isProfileRef(value)) fail(path, "must be a profile:<uuid> or builtin:<name> ref");
}

export function assertUserProfileRef(value: unknown, path = "profileRef"): asserts value is ProfileRef {
  if (!isUserProfileRef(value)) fail(path, "must be a user profile:<uuid> ref");
}

export function assertToolPreset(value: unknown, path = "builtinPreset"): asserts value is ToolPreset {
  if (typeof value !== "string" || !TOOL_PRESETS.has(value as ToolPreset)) {
    fail(path, "must be one of: none, default, full");
  }
}

export function assertPackageSource(value: unknown, path = "packageSource"): asserts value is PackageSource {
  if (typeof value === "string") {
    assertNonEmptyString(value, path);
    return;
  }

  if (!isRecord(value)) fail(path, "must be a string or object PackageSource");
  for (const key of Object.keys(value)) {
    if (!PACKAGE_SOURCE_KEYS.has(key)) fail(`${path}.${key}`, "is not a supported PackageSource key");
  }
  assertNonEmptyString(value.source, `${path}.source`);
  for (const key of ["extensions", "skills", "prompts", "themes"] as const) {
    if (value[key] !== undefined) assertStringArray(value[key], `${path}.${key}`);
  }
}

export function assertSkillRef(value: unknown, path = "skillRef"): asserts value is SkillRef {
  if (!isRecord(value)) fail(path, "must be an object");
  for (const key of Object.keys(value)) {
    if (!SKILL_REF_KEYS.has(key)) fail(`${path}.${key}`, "is not a supported SkillRef key");
  }
  assertNonEmptyString(value.source, `${path}.source`);
  assertNonEmptyString(value.path, `${path}.path`);
  assertOptionalString(value.scope, `${path}.scope`);
  assertOptionalString(value.name, `${path}.name`);
}

export function assertProfileDefinition(value: unknown, path = "profile", options: { allowBuiltinId?: boolean } = {}): asserts value is ProfileDefinition {
  if (!isRecord(value)) fail(path, "must be an object");
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_PROFILE_CAPABILITY_KEYS.has(key)) fail(`${path}.${key}`, "is not supported for profile definitions");
  }
  if (options.allowBuiltinId) {
    assertProfileRef(value.id, `${path}.id`);
    if (isBuiltinProfileRef(value.id) && !isAllowedBuiltinProfileRef(value.id)) {
      fail(`${path}.id`, "must be an allowed built-in profile ref");
    }
  } else {
    assertUserProfileRef(value.id, `${path}.id`);
  }
  assertNonEmptyString(value.name, `${path}.name`);
  assertOptionalString(value.description, `${path}.description`);
  assertTimestampLike(value.createdAt, `${path}.createdAt`);
  assertTimestampLike(value.updatedAt, `${path}.updatedAt`);

  if (!isRecord(value.tools)) fail(`${path}.tools`, "must be an object");
  for (const key of Object.keys(value.tools)) {
    if (!PROFILE_TOOL_KEYS.has(key)) fail(`${path}.tools.${key}`, "is not supported for profile tools");
  }
  assertToolPreset(value.tools.builtinPreset, `${path}.tools.builtinPreset`);
  if (value.tools.pluginTools !== "fromSelectedPlugins") {
    fail(`${path}.tools.pluginTools`, "must be fromSelectedPlugins");
  }

  if (!Array.isArray(value.plugins)) fail(`${path}.plugins`, "must be an array");
  value.plugins.forEach((plugin, index) => assertPackageSource(plugin, `${path}.plugins[${index}]`));

  if (!isRecord(value.skills)) fail(`${path}.skills`, "must be an object");
  for (const key of Object.keys(value.skills)) {
    if (!PROFILE_SKILL_KEYS.has(key)) fail(`${path}.skills.${key}`, "is not supported for profile skills");
  }
  if (value.skills.mode !== "pluginDefaultThenNarrow") {
    fail(`${path}.skills.mode`, "must be pluginDefaultThenNarrow");
  }
  if (value.skills.disabledSkillRefs !== undefined) {
    if (!Array.isArray(value.skills.disabledSkillRefs)) fail(`${path}.skills.disabledSkillRefs`, "must be an array when present");
    value.skills.disabledSkillRefs.forEach((skill, index) => assertSkillRef(skill, `${path}.skills.disabledSkillRefs[${index}]`));
  }
}

export function assertProfilesFileV1(value: unknown, path = "profilesFile"): asserts value is ProfilesFileV1 {
  if (!isRecord(value)) fail(path, "must be an object");
  if (value.version !== 1) fail(`${path}.version`, "must be 1");
  if (!isRecord(value.defaults)) fail(`${path}.defaults`, "must be an object");
  assertProfileRef(value.defaults.globalProfileRef, `${path}.defaults.globalProfileRef`);
  if (!Array.isArray(value.profiles)) fail(`${path}.profiles`, "must be an array");

  const seen = new Set<string>();
  value.profiles.forEach((profile, index) => {
    assertProfileDefinition(profile, `${path}.profiles[${index}]`);
    if (seen.has(profile.id)) fail(`${path}.profiles[${index}].id`, "must be unique");
    seen.add(profile.id);
  });

  const defaultRef = value.defaults.globalProfileRef;
  if (!seen.has(defaultRef) && !isAllowedBuiltinProfileRef(defaultRef)) {
    fail(`${path}.defaults.globalProfileRef`, "must reference an existing profile or allowed built-in profile");
  }
}

export function normalizeProfilePackageSource(source: PackageSource): Exclude<PackageSource, string> {
  assertPackageSource(source);
  if (typeof source === "string") {
    return { source, prompts: [], themes: [] };
  }
  return {
    source: source.source,
    ...(source.extensions !== undefined ? { extensions: [...source.extensions] } : {}),
    ...(source.skills !== undefined ? { skills: [...source.skills] } : {}),
    prompts: [],
    themes: [],
  };
}

export function normalizeProfilePackages(sources: PackageSource[]): Exclude<PackageSource, string>[] {
  if (!Array.isArray(sources)) fail("plugins", "must be an array");
  return sources.map((source, index) => {
    try {
      return normalizeProfilePackageSource(source);
    } catch (error) {
      if (error instanceof ProfileValidationError) throw error;
      throw new ProfileValidationError(`plugins[${index}]: invalid PackageSource`);
    }
  });
}

export function createBuiltinDefaultProfile(now = new Date().toISOString()): ProfileDefinition {
  return {
    id: BUILTIN_DEFAULT_PROFILE_REF,
    name: "Built-in Default",
    description: "Temporary built-in fallback until a saved default profile is bootstrapped.",
    createdAt: now,
    updatedAt: now,
    tools: {
      builtinPreset: "full",
      pluginTools: "fromSelectedPlugins",
    },
    plugins: [],
    skills: {
      mode: "pluginDefaultThenNarrow",
    },
  };
}

export function createBuiltinProfiles(now?: string): ProfileDefinition[] {
  return [createBuiltinDefaultProfile(now)];
}

export function assertApiProfileDraft(value: unknown, path = "profile"): asserts value is Omit<ProfileDefinition, "id" | "createdAt" | "updatedAt"> {
  if (!isRecord(value)) fail(path, "must be an object");
  const allowed = new Set(["name", "description", "tools", "plugins", "skills"]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${path}.${key}`, "is not supported for profile definitions");
  }

  const now = "2026-01-01T00:00:00.000Z";
  assertProfileDefinition({ id: "profile:123e4567-e89b-12d3-a456-426614174000", createdAt: now, updatedAt: now, ...value }, path);
}
