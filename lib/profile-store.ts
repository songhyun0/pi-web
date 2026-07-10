import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";
import {
  BUILTIN_DEFAULT_PROFILE_REF,
  ProfileValidationError,
  assertApiProfileDraft,
  assertProfileDefinition,
  assertProfileRef,
  assertProfilesFileV1,
  assertUserProfileRef,
  cloneJson,
  createBuiltinProfiles,
  isAllowedBuiltinProfileRef,
  isRecord,
  isUserProfileRef,
  normalizeProfilePackages,
  type PackageSource,
  type ProfileDefinition,
  type ProfileRef,
  type ProfilesFileV1,
} from "./profiles";
import { withFileLock } from "./file-lock";

const PROFILES_FILE = "web-profiles.json";

type JsonObject = Record<string, unknown>;

declare global {
  var __piProfileStoreWriteQueue: Promise<void> | undefined;
}

export interface ProfileStoreOptions {
  agentDir?: string;
  filePath?: string;
  cwd?: string;
}

export interface ProfileListResponse {
  version: 1;
  defaults: ProfilesFileV1["defaults"];
  profiles: ProfileDefinition[];
  builtinProfiles: ProfileDefinition[];
  warnings: string[];
}

export interface ResolvedProfilesFile {
  store: ProfilesFileV1;
  warnings: string[];
}

export type ProfileApiResult = {
  status: number;
  body: Record<string, unknown> | ProfileListResponse | ProfileDefinition;
};

export interface ProfileCreateInput {
  name?: unknown;
  description?: unknown;
  tools?: unknown;
  plugins?: unknown;
  skills?: unknown;
}

export type ProfileUpdateInput = Partial<ProfileCreateInput>;

function validationError(message: string): ProfileValidationError {
  return new ProfileValidationError(message);
}

function ioError(message: string, cause?: unknown): Error {
  const error = new Error(message, cause === undefined ? undefined : { cause });
  (error as Error & { statusCode?: number }).statusCode = 500;
  return error;
}

export function getProfilesPath(options: ProfileStoreOptions = {}): string {
  if (options.filePath) return options.filePath;
  return join(options.agentDir ?? getAgentDir(), PROFILES_FILE);
}

function emptyRawProfilesFile(): ProfilesFileV1 {
  return {
    version: 1,
    defaults: { globalProfileRef: BUILTIN_DEFAULT_PROFILE_REF },
    profiles: [],
  };
}

function makeBootstrapProfile(packages: PackageSource[], timestamp = nowIso()): ProfileDefinition {
  const profile: ProfileDefinition = {
    id: `profile:${randomUUID()}`,
    name: "Coding Full",
    description: "Server-owned default profile bootstrapped from global package settings.",
    createdAt: timestamp,
    updatedAt: timestamp,
    tools: { builtinPreset: "full", pluginTools: "fromSelectedPlugins" },
    plugins: normalizeProfilePackages(packages),
    skills: { mode: "pluginDefaultThenNarrow" },
  };
  assertProfileDefinition(profile);
  return profile;
}

function readGlobalPackageSettings(options: ProfileStoreOptions, filePath: string): PackageSource[] {
  const agentDir = options.agentDir ?? dirname(filePath);
  let settingsManager: SettingsManager;
  try {
    settingsManager = SettingsManager.create(options.cwd ?? process.cwd(), agentDir, { projectTrusted: false });
  } catch (error) {
    throw ioError("Failed to read global package settings while bootstrapping profiles.", error);
  }

  const globalErrors = settingsManager.drainErrors().filter((entry) => entry.scope === "global");
  if (globalErrors.length > 0) {
    throw ioError(
      `Failed to read global package settings while bootstrapping profiles: ${globalErrors.map((entry) => entry.error.message).join("; ")}`,
      globalErrors[0].error,
    );
  }

  const globalSettings = settingsManager.getGlobalSettings() as unknown;
  if (!isRecord(globalSettings)) {
    throw ioError("Global settings must be a JSON object while bootstrapping profiles.");
  }
  const packages = globalSettings.packages;
  if (packages === undefined) return [];
  if (!Array.isArray(packages)) {
    throw ioError("Global package settings must be an array while bootstrapping profiles.");
  }
  try {
    return normalizeProfilePackages(packages as PackageSource[]);
  } catch (error) {
    throw ioError("Global package settings contain an invalid PackageSource while bootstrapping profiles.", error);
  }
}

function sanitizeProfilesFile(value: ProfilesFileV1): ProfilesFileV1 {
  return {
    ...(value as unknown as JsonObject),
    version: 1,
    defaults: { globalProfileRef: value.defaults.globalProfileRef },
    profiles: value.profiles.map((profile) => ({ ...(profile as unknown as JsonObject) })) as unknown as ProfileDefinition[],
  };
}

interface RawProfilesFileRead {
  store: ProfilesFileV1;
  missingFile: boolean;
  defaultNeedsRepair: boolean;
}

async function readStoreStateFromPath(filePath: string): Promise<RawProfilesFileRead> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { store: emptyRawProfilesFile(), missingFile: true, defaultNeedsRepair: false };
    }
    throw ioError(`Failed to read profile store at ${filePath}`, error);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw validationError(`Invalid JSON in profile store at ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    assertProfilesFileV1(parsed);
    return { store: sanitizeProfilesFile(parsed), missingFile: false, defaultNeedsRepair: false };
  } catch (error) {
    // Phase 09 may safely repair only the global default field. Validate the
    // remainder of the file by substituting the known-safe built-in ref; any
    // other schema error remains blocking.
    if (!isRecord(parsed)) throw error;
    const existingDefaults = isRecord(parsed.defaults) ? parsed.defaults : {};
    const repairCandidate = {
      ...parsed,
      defaults: { ...existingDefaults, globalProfileRef: BUILTIN_DEFAULT_PROFILE_REF },
    };
    try {
      assertProfilesFileV1(repairCandidate);
    } catch {
      throw error;
    }
    return { store: sanitizeProfilesFile(repairCandidate), missingFile: false, defaultNeedsRepair: true };
  }
}

async function readStoreFromPath(filePath: string): Promise<ProfilesFileV1> {
  return (await readStoreStateFromPath(filePath)).store;
}

export async function readProfilesFile(options: ProfileStoreOptions = {}): Promise<ProfilesFileV1> {
  return cloneJson((await resolveProfilesFile(options)).store);
}

function enqueueStoreWrite<T>(operation: () => Promise<T>): Promise<T> {
  const previous = globalThis.__piProfileStoreWriteQueue ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  globalThis.__piProfileStoreWriteQueue = next.then(() => undefined, () => undefined);
  return next;
}

async function withProfileFileLock<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
  await mkdir(dirname(filePath), { recursive: true });
  try {
    return await withFileLock(`${filePath}.lock`, operation);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Timed out waiting for file lock:")) {
      const timeoutError = new Error(`Timed out waiting for profile store lock at ${filePath}`);
      (timeoutError as Error & { statusCode?: number }).statusCode = 503;
      throw timeoutError;
    }
    throw error;
  }
}

async function writeStoreAtomic(filePath: string, nextStore: ProfilesFileV1): Promise<void> {
  assertProfilesFileV1(nextStore);
  await mkdir(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  const data = `${JSON.stringify(sanitizeProfilesFile(nextStore), null, 2)}\n`;
  try {
    await writeFile(tempPath, data, { encoding: "utf8", flag: "wx" });
    await rename(tempPath, filePath);
  } catch (error) {
    await unlink(tempPath).catch(() => undefined);
    throw ioError(`Failed to write profile store at ${filePath}`, error);
  }
}

async function mutateProfiles<T>(
  options: ProfileStoreOptions,
  operation: (store: ProfilesFileV1) => { changed: boolean; nextStore: ProfilesFileV1; result: T },
): Promise<T> {
  const filePath = getProfilesPath(options);
  return enqueueStoreWrite(() => withProfileFileLock(filePath, async () => {
    const current = await readStoreFromPath(filePath);
    const { changed, nextStore, result } = operation(current);
    assertProfilesFileV1(nextStore);
    if (changed) await writeStoreAtomic(filePath, nextStore);
    return result;
  }));
}

export async function resolveProfilesFile(options: ProfileStoreOptions = {}): Promise<ResolvedProfilesFile> {
  const filePath = getProfilesPath(options);
  return enqueueStoreWrite(() => withProfileFileLock(filePath, async () => {
    const raw = await readStoreStateFromPath(filePath);
    const store = raw.store;
    const needsBootstrap = raw.missingFile || raw.defaultNeedsRepair;

    if (!needsBootstrap) {
      return { store: cloneJson(store), warnings: [] };
    }

    const defaultProfile = makeBootstrapProfile(readGlobalPackageSettings(options, filePath));
    const nextStore = sanitizeProfilesFile({
      ...(store as unknown as JsonObject),
      version: 1,
      defaults: { globalProfileRef: defaultProfile.id },
      profiles: [defaultProfile, ...store.profiles],
    });
    await writeStoreAtomic(filePath, nextStore);

    const warning = raw.missingFile
      ? "Created the initial server default profile from global package settings."
      : "The stored global default profile was missing or invalid; a safe default profile was created and selected.";
    return { store: cloneJson(nextStore), warnings: [warning] };
  }));
}

async function ensureBootstrappedProfilesFile(options: ProfileStoreOptions = {}): Promise<ProfilesFileV1> {
  return (await resolveProfilesFile(options)).store;
}

function profileIndex(store: ProfilesFileV1, id: string): number {
  return store.profiles.findIndex((profile) => profile.id === id);
}

function requireEditableProfile(store: ProfilesFileV1, id: string): number {
  assertUserProfileRef(id, "profile id");
  const index = profileIndex(store, id);
  if (index === -1) throw notFoundError("Profile not found");
  return index;
}

function notFoundError(message: string): Error {
  const error = new Error(message);
  (error as Error & { statusCode?: number }).statusCode = 404;
  return error;
}

function nowIso(): string {
  return new Date().toISOString();
}

function makeProfileFromInput(input: ProfileCreateInput, timestamp = nowIso()): ProfileDefinition {
  assertApiProfileDraft(input);
  const profile: ProfileDefinition = {
    id: `profile:${randomUUID()}`,
    name: input.name.trim(),
    ...(input.description !== undefined ? { description: input.description } : {}),
    createdAt: timestamp,
    updatedAt: timestamp,
    tools: cloneJson(input.tools) as ProfileDefinition["tools"],
    plugins: cloneJson(input.plugins) as PackageSource[],
    skills: cloneJson(input.skills) as ProfileDefinition["skills"],
  };
  assertProfileDefinition(profile);
  return profile;
}

function assertUpdateBody(value: unknown): asserts value is ProfileUpdateInput {
  if (!isRecord(value)) throw validationError("Request body must be an object");
  const allowed = new Set(["name", "description", "tools", "plugins", "skills"]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw validationError(`${key} is not supported for profile updates`);
  }
}

function makeUpdatedProfile(existing: ProfileDefinition, input: ProfileUpdateInput, timestamp = nowIso()): ProfileDefinition {
  assertUpdateBody(input);
  const next = {
    ...(existing as unknown as JsonObject),
    ...(input.name !== undefined ? { name: typeof input.name === "string" ? input.name.trim() : input.name } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.tools !== undefined ? { tools: cloneJson(input.tools) } : {}),
    ...(input.plugins !== undefined ? { plugins: cloneJson(input.plugins) } : {}),
    ...(input.skills !== undefined ? { skills: cloneJson(input.skills) } : {}),
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: timestamp,
  } as unknown as ProfileDefinition;
  assertProfileDefinition(next);
  return next;
}

export async function listProfiles(options: ProfileStoreOptions = {}): Promise<ProfileListResponse> {
  const resolved = await resolveProfilesFile(options);
  return {
    version: 1,
    defaults: cloneJson(resolved.store.defaults),
    profiles: cloneJson(resolved.store.profiles),
    builtinProfiles: createBuiltinProfiles(),
    warnings: [...resolved.warnings],
  };
}

export async function createProfile(input: ProfileCreateInput, options: ProfileStoreOptions = {}): Promise<ProfileDefinition> {
  await ensureBootstrappedProfilesFile(options);
  return mutateProfiles(options, (store) => {
    const profile = makeProfileFromInput(input);
    const nextStore: ProfilesFileV1 = {
      ...store,
      profiles: [...store.profiles, profile],
    };
    return { changed: true, nextStore, result: cloneJson(profile) };
  });
}

export async function updateProfile(id: string, input: ProfileUpdateInput, options: ProfileStoreOptions = {}): Promise<ProfileDefinition> {
  await ensureBootstrappedProfilesFile(options);
  return mutateProfiles(options, (store) => {
    const index = requireEditableProfile(store, id);
    const profile = makeUpdatedProfile(store.profiles[index], input);
    const profiles = [...store.profiles];
    profiles[index] = profile;
    return { changed: true, nextStore: { ...store, profiles }, result: cloneJson(profile) };
  });
}

export async function setGlobalDefaultProfileRef(profileRef: ProfileRef, options: ProfileStoreOptions = {}): Promise<ProfileListResponse> {
  assertProfileRef(profileRef);
  await ensureBootstrappedProfilesFile(options);
  return mutateProfiles(options, (store) => {
    const exists = store.profiles.some((profile) => profile.id === profileRef);
    if (!exists && !isAllowedBuiltinProfileRef(profileRef)) {
      throw validationError("globalProfileRef must reference an existing profile or allowed built-in profile");
    }
    const nextStore = {
      ...store,
      defaults: { globalProfileRef: profileRef },
    } satisfies ProfilesFileV1;
    return {
      changed: store.defaults.globalProfileRef !== profileRef,
      nextStore,
      result: {
        version: 1,
        defaults: cloneJson(nextStore.defaults),
        profiles: cloneJson(nextStore.profiles),
        builtinProfiles: createBuiltinProfiles(),
        warnings: [],
      },
    };
  });
}

export async function deleteProfile(
  id: string,
  options: ProfileStoreOptions = {},
  replacementGlobalProfileRef?: ProfileRef,
): Promise<ProfileListResponse> {
  await ensureBootstrappedProfilesFile(options);
  return mutateProfiles(options, (store) => {
    const index = requireEditableProfile(store, id);
    let nextDefault = store.defaults.globalProfileRef;
    const deletingDefault = nextDefault === id;
    if (deletingDefault) {
      if (!replacementGlobalProfileRef) {
        throw validationError("Deleting the global default profile requires replacementGlobalProfileRef");
      }
      assertProfileRef(replacementGlobalProfileRef, "replacementGlobalProfileRef");
      if (replacementGlobalProfileRef === id) {
        throw validationError("replacementGlobalProfileRef cannot be the deleted profile");
      }
      const replacementExists = store.profiles.some((profile) => profile.id === replacementGlobalProfileRef);
      if (!replacementExists && !isAllowedBuiltinProfileRef(replacementGlobalProfileRef)) {
        throw validationError("replacementGlobalProfileRef must reference an existing profile or allowed built-in profile");
      }
      nextDefault = replacementGlobalProfileRef;
    }
    const profiles = store.profiles.filter((_, profileIndexValue) => profileIndexValue !== index);
    const nextStore = {
      ...store,
      defaults: { globalProfileRef: nextDefault },
      profiles,
    } satisfies ProfilesFileV1;
    return {
      changed: true,
      nextStore,
      result: {
        version: 1,
        defaults: cloneJson(nextStore.defaults),
        profiles: cloneJson(nextStore.profiles),
        builtinProfiles: createBuiltinProfiles(),
        warnings: [],
      },
    };
  });
}

export function normalizeEffectiveProfilePackages(profile: ProfileDefinition): Exclude<PackageSource, string>[] {
  assertProfileDefinition(profile, "profile", { allowBuiltinId: true });
  return normalizeProfilePackages(profile.plugins);
}

export async function getProfilesApiResult(options: ProfileStoreOptions = {}): Promise<ProfileApiResult> {
  return { status: 200, body: await listProfiles(options) };
}

export async function postProfilesApiResult(body: unknown, options: ProfileStoreOptions = {}): Promise<ProfileApiResult> {
  const setup = await resolveProfilesFile(options);
  const profile = await createProfile(body as ProfileCreateInput, options);
  return { status: 201, body: { ...profile, warnings: setup.warnings } };
}

export async function patchProfileApiResult(id: string, body: unknown, options: ProfileStoreOptions = {}): Promise<ProfileApiResult> {
  const setup = await resolveProfilesFile(options);
  const profile = await updateProfile(id, body as ProfileUpdateInput, options);
  return { status: 200, body: { ...profile, warnings: setup.warnings } };
}

export async function deleteProfileApiResult(id: string, body: unknown, options: ProfileStoreOptions = {}): Promise<ProfileApiResult> {
  const setup = await resolveProfilesFile(options);
  const replacementGlobalProfileRef = isRecord(body) && body.replacementGlobalProfileRef !== undefined
    ? body.replacementGlobalProfileRef
    : undefined;
  if (replacementGlobalProfileRef !== undefined) assertProfileRef(replacementGlobalProfileRef, "replacementGlobalProfileRef");
  const result = await deleteProfile(id, options, replacementGlobalProfileRef as ProfileRef | undefined);
  return { status: 200, body: { ...result, warnings: setup.warnings } };
}

export async function patchDefaultProfileApiResult(body: unknown, options: ProfileStoreOptions = {}): Promise<ProfileApiResult> {
  if (!isRecord(body)) throw validationError("Request body must be an object");
  assertProfileRef(body.globalProfileRef, "globalProfileRef");
  const setup = await resolveProfilesFile(options);
  const result = await setGlobalDefaultProfileRef(body.globalProfileRef, options);
  return { status: 200, body: { ...result, warnings: setup.warnings } };
}

export function hasPersistedProfileStore(options: ProfileStoreOptions = {}): boolean {
  return existsSync(getProfilesPath(options));
}

export function isEditableProfileRef(value: unknown): value is ProfileRef {
  return isUserProfileRef(value);
}
