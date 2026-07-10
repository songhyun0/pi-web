import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { getToolNamesForPreset } from "./tool-presets";
import {
  ProfileValidationError,
  assertPackageSource,
  assertProfileRef,
  assertSkillRef,
  assertToolPreset,
  cloneJson,
  isRecord,
  type PackageSource,
  type ProfileRef,
  type SkillRef,
  type ToolPreset,
} from "./profiles";
import { withFileLock as withCrashRecoverableFileLock } from "./file-lock";

export interface PluginToolSnapshot {
  name: string;
  source: string;
  extension: string;
  provenance: "plugin";
  metadataResolved: boolean;
}

export interface ToolConflict {
  name: string;
  builtinSelected: boolean;
  selectedProvider: "builtin" | "plugin";
  pluginSource?: string;
  message: string;
}

export interface ProfileDiagnostic {
  type: "info" | "warning" | "error";
  message: string;
  source?: string;
  path?: string;
}

export interface CapabilitySnapshotV1 {
  version: 1;
  snapshotId: string;
  createdAt: string;
  profileRef: ProfileRef;
  profileName: string;
  cwd: string;
  projectRoot?: string;
  tools: {
    builtinPreset: ToolPreset;
    requestedBuiltinTools: string[];
    pluginTools?: PluginToolSnapshot[];
    activeToolNames: string[];
    conflicts: ToolConflict[];
  };
  plugins: PackageSource[];
  skills: {
    mode: "pluginDefaultThenNarrow";
    visibleSkillRefs: SkillRef[];
    hiddenSkillRefs: SkillRef[];
  };
  diagnostics: ProfileDiagnostic[];
}

export interface SessionProfileRecordV1 {
  sessionId: string;
  sessionFilePath?: string;
  cwd?: string;
  updatedAt: string;
  recordRevision: number;
  snapshot: CapabilitySnapshotV1;
}

export interface SessionProfilesFileV1 {
  version: 1;
  revision: number;
  sessions: Record<string, SessionProfileRecordV1>;
  [unknownKey: string]: unknown;
}

export interface SessionSnapshotWriteToken {
  storeRevision: number;
  recordRevision?: number;
  snapshotId?: string;
}

export type SessionProfileSnapshotLookup =
  | {
      state: "snapshot";
      snapshot: CapabilitySnapshotV1;
      record: SessionProfileRecordV1;
      writeToken: SessionSnapshotWriteToken;
    }
  | {
      state: "legacy";
      label: typeof LEGACY_PROFILE_LABEL;
      snapshot: null;
      writeToken: SessionSnapshotWriteToken;
    };

export type SessionProfileResponse =
  | {
      state: "snapshot";
      snapshot: CapabilitySnapshotV1;
      record: {
        sessionId: string;
        sessionFilePath?: string;
        updatedAt: string;
        recordRevision: number;
      };
    }
  | {
      state: "legacy";
      label: typeof LEGACY_PROFILE_LABEL;
      snapshot: null;
    };

export interface SessionProfileSnapshotMetadata {
  sessionFilePath?: string;
  cwd?: string;
  updatedAt?: string;
}

export interface SessionProfileStoreOptions {
  agentDir?: string;
  filePath?: string;
}

export type SessionProfileStoreErrorCode = "CAS_CONFLICT" | "VALIDATION" | "IO" | "LOCK_TIMEOUT";

export class SessionProfileStoreError extends Error {
  code: SessionProfileStoreErrorCode;
  statusCode: number;
  currentToken?: SessionSnapshotWriteToken;

  constructor(
    code: SessionProfileStoreErrorCode,
    message: string,
    options: { statusCode?: number; currentToken?: SessionSnapshotWriteToken; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "SessionProfileStoreError";
    this.code = code;
    this.statusCode = options.statusCode ?? (code === "CAS_CONFLICT" ? 409 : 400);
    this.currentToken = options.currentToken;
  }
}

const SESSION_PROFILES_FILE = "web-session-profiles.json";
const LEGACY_PROFILE_LABEL = "Legacy / current settings";

declare global {
  var __piSessionProfileStoreWriteQueue: Promise<void> | undefined;
}
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0);
}

function assertExactKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, label: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw validationError(`${label}.${key} is not supported`);
  }
}

function sameStringSet(left: string[], right: string[]): boolean {
  return left.length === new Set(left).size
    && right.length === new Set(right).size
    && left.length === right.length
    && left.every((item) => right.includes(item));
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
function validationError(message: string, cause?: unknown): SessionProfileStoreError {
  return new SessionProfileStoreError("VALIDATION", message, { statusCode: 400, cause });
}

function ioError(message: string, cause?: unknown): SessionProfileStoreError {
  return new SessionProfileStoreError("IO", message, { statusCode: 500, cause });
}

function wrapProfileValidation(assertion: () => void): void {
  try {
    assertion();
  } catch (error) {
    if (error instanceof ProfileValidationError) {
      throw validationError(error.message, error);
    }
    throw error;
  }
}

function assertSnapshotProfileRef(value: unknown, label: string): asserts value is ProfileRef {
  wrapProfileValidation(() => assertProfileRef(value, label));
}

function assertSnapshotToolPreset(value: unknown, label: string): asserts value is ToolPreset {
  wrapProfileValidation(() => assertToolPreset(value, label));
}

function assertSnapshotPackageSource(value: unknown, label: string): asserts value is PackageSource {
  wrapProfileValidation(() => assertPackageSource(value, label));
}

function assertSnapshotSkillRef(value: unknown, label: string): asserts value is SkillRef {
  wrapProfileValidation(() => assertSkillRef(value, label));
}

export function getSessionProfilesPath(options: SessionProfileStoreOptions = {}): string {
  if (options.filePath) return options.filePath;
  return join(options.agentDir ?? getAgentDir(), SESSION_PROFILES_FILE);
}

function emptySessionProfilesFile(): SessionProfilesFileV1 {
  return { version: 1, revision: 0, sessions: {} };
}

function assertTimestampLike(value: unknown, label: string): asserts value is string {
  if (!isNonEmptyString(value) || /[\u0000-\u001f]/.test(value) || Number.isNaN(Date.parse(value))) {
    throw validationError(`${label} must be an ISO timestamp string`);
  }
}

function assertOptionalString(value: unknown, label: string): asserts value is string | undefined {
  if (value !== undefined && typeof value !== "string") {
    throw validationError(`${label} must be a string when present`);
  }
}

function assertSessionId(value: unknown, label = "sessionId"): asserts value is string {
  if (!isNonEmptyString(value) || /[\u0000-\u001f]/.test(value) || value.length > 240) {
    throw validationError(`${label} must be a non-empty session id string`);
  }
}

function assertPluginToolSnapshot(value: unknown, label: string): asserts value is PluginToolSnapshot {
  if (!isRecord(value)) throw validationError(`${label} must be an object`);
  assertExactKeys(value, new Set(["name", "source", "extension", "provenance", "metadataResolved"]), label);
  if (!isNonEmptyString(value.name)) throw validationError(`${label}.name must be a non-empty string`);
  if (!isNonEmptyString(value.source)) throw validationError(`${label}.source must be a non-empty string`);
  if (!isNonEmptyString(value.extension)) throw validationError(`${label}.extension must be a non-empty string`);
  if (value.provenance !== "plugin") throw validationError(`${label}.provenance must be plugin`);
  if (value.metadataResolved !== true) throw validationError(`${label}.metadataResolved must be true`);
}

function assertToolConflict(value: unknown, label: string): asserts value is ToolConflict {
  if (!isRecord(value)) throw validationError(`${label} must be an object`);
  assertExactKeys(value, new Set(["name", "builtinSelected", "selectedProvider", "pluginSource", "message"]), label);
  if (!isNonEmptyString(value.name)) throw validationError(`${label}.name must be a non-empty string`);
  if (typeof value.builtinSelected !== "boolean") throw validationError(`${label}.builtinSelected must be a boolean`);
  if (value.selectedProvider !== "builtin" && value.selectedProvider !== "plugin") {
    throw validationError(`${label}.selectedProvider must be builtin or plugin`);
  }
  assertOptionalString(value.pluginSource, `${label}.pluginSource`);
  if (!isNonEmptyString(value.message)) throw validationError(`${label}.message must be a non-empty string`);
}

function assertProfileDiagnostic(value: unknown, label: string): asserts value is ProfileDiagnostic {
  if (!isRecord(value)) throw validationError(`${label} must be an object`);
  assertExactKeys(value, new Set(["type", "message", "source", "path"]), label);
  if (value.type !== "info" && value.type !== "warning" && value.type !== "error") {
    throw validationError(`${label}.type must be info, warning, or error`);
  }
  if (!isNonEmptyString(value.message)) throw validationError(`${label}.message must be a non-empty string`);
  assertOptionalString(value.source, `${label}.source`);
  assertOptionalString(value.path, `${label}.path`);
}

export function assertCapabilitySnapshotV1(value: unknown, label = "snapshot"): asserts value is CapabilitySnapshotV1 {
  if (!isRecord(value)) throw validationError(`${label} must be an object`);
  assertExactKeys(value, new Set(["version", "snapshotId", "createdAt", "profileRef", "profileName", "cwd", "projectRoot", "tools", "plugins", "skills", "diagnostics"]), label);
  if (value.version !== 1) throw validationError(`${label}.version must be 1`);
  if (!isNonEmptyString(value.snapshotId)) throw validationError(`${label}.snapshotId must be a non-empty string`);
  assertTimestampLike(value.createdAt, `${label}.createdAt`);
  assertSnapshotProfileRef(value.profileRef, `${label}.profileRef`);
  if (!isNonEmptyString(value.profileName)) throw validationError(`${label}.profileName must be a non-empty string`);
  if (!isNonEmptyString(value.cwd) || !isAbsolute(value.cwd)) throw validationError(`${label}.cwd must be an absolute path`);
  assertOptionalString(value.projectRoot, `${label}.projectRoot`);
  if (value.projectRoot !== undefined && !isAbsolute(value.projectRoot)) throw validationError(`${label}.projectRoot must be an absolute path`);

  if (!isRecord(value.tools)) throw validationError(`${label}.tools must be an object`);
  assertExactKeys(value.tools, new Set(["builtinPreset", "requestedBuiltinTools", "pluginTools", "activeToolNames", "conflicts"]), `${label}.tools`);
  assertSnapshotToolPreset(value.tools.builtinPreset, `${label}.tools.builtinPreset`);
  if (!isStringArray(value.tools.requestedBuiltinTools)) throw validationError(`${label}.tools.requestedBuiltinTools must be a string array`);
  if (value.tools.pluginTools !== undefined) {
    if (!Array.isArray(value.tools.pluginTools)) throw validationError(`${label}.tools.pluginTools must be an array when present`);
    value.tools.pluginTools.forEach((tool, index) => assertPluginToolSnapshot(tool, `${label}.tools.pluginTools[${index}]`));
  }
  if (!isStringArray(value.tools.activeToolNames)) throw validationError(`${label}.tools.activeToolNames must be a string array`);
  if (!Array.isArray(value.tools.conflicts)) throw validationError(`${label}.tools.conflicts must be an array`);
  value.tools.conflicts.forEach((conflict, index) => assertToolConflict(conflict, `${label}.tools.conflicts[${index}]`));

  const allowedBuiltins = new Set(getToolNamesForPreset(value.tools.builtinPreset));
  if (value.tools.requestedBuiltinTools.length !== new Set(value.tools.requestedBuiltinTools).size
    || value.tools.requestedBuiltinTools.some((name) => !allowedBuiltins.has(name))) {
    throw validationError(`${label}.tools.requestedBuiltinTools must be a unique subset selected by builtinPreset`);
  }
  const pluginTools = value.tools.pluginTools ?? [];
  if (pluginTools.length !== new Set(pluginTools.map((tool) => tool.name)).size) {
    throw validationError(`${label}.tools.pluginTools names must be unique`);
  }
  const expectedActive = [...new Set([...value.tools.requestedBuiltinTools, ...pluginTools.map((tool) => tool.name)])];
  if (!sameStringSet(value.tools.activeToolNames, expectedActive)) {
    throw validationError(`${label}.tools.activeToolNames must equal the selected built-in and plugin tool names`);
  }
  if (!Array.isArray(value.plugins)) throw validationError(`${label}.plugins must be an array`);
  value.plugins.forEach((plugin, index) => {
    assertSnapshotPackageSource(plugin, `${label}.plugins[${index}]`);
    if (typeof plugin === "string") throw validationError(`${label}.plugins[${index}] must be normalized object PackageSource`);
    if (plugin.prompts === undefined || plugin.prompts.length !== 0) throw validationError(`${label}.plugins[${index}].prompts must be []`);
    if (plugin.themes === undefined || plugin.themes.length !== 0) throw validationError(`${label}.plugins[${index}].themes must be []`);
  });
  const pluginSources = value.plugins.map((plugin) => (plugin as Exclude<PackageSource, string>).source);
  if (pluginSources.length !== new Set(pluginSources).size) throw validationError(`${label}.plugins sources must be unique`);
  for (const [index, tool] of pluginTools.entries()) {
    if (!pluginSources.includes(tool.source)) throw validationError(`${label}.tools.pluginTools[${index}].source must reference a selected plugin`);
  }
  for (const [index, conflict] of value.tools.conflicts.entries()) {
    const matching = pluginTools.find((tool) => tool.name === conflict.name && (!conflict.pluginSource || tool.source === conflict.pluginSource));
    if (!matching || !value.tools.requestedBuiltinTools.includes(conflict.name) || !conflict.builtinSelected || conflict.selectedProvider !== "plugin") {
      throw validationError(`${label}.tools.conflicts[${index}] must describe a selected plugin overriding a selected built-in`);
    }
  }

  if (!isRecord(value.skills)) throw validationError(`${label}.skills must be an object`);
  assertExactKeys(value.skills, new Set(["mode", "visibleSkillRefs", "hiddenSkillRefs"]), `${label}.skills`);
  if (value.skills.mode !== "pluginDefaultThenNarrow") throw validationError(`${label}.skills.mode must be pluginDefaultThenNarrow`);
  if (!Array.isArray(value.skills.visibleSkillRefs)) throw validationError(`${label}.skills.visibleSkillRefs must be an array`);
  if (!Array.isArray(value.skills.hiddenSkillRefs)) throw validationError(`${label}.skills.hiddenSkillRefs must be an array`);
  value.skills.visibleSkillRefs.forEach((skill, index) => assertSnapshotSkillRef(skill, `${label}.skills.visibleSkillRefs[${index}]`));
  value.skills.hiddenSkillRefs.forEach((skill, index) => assertSnapshotSkillRef(skill, `${label}.skills.hiddenSkillRefs[${index}]`));
  const visibleSkillKeys = new Set(value.skills.visibleSkillRefs.map((skill) => `${skill.source}\0${skill.path}`));
  if (value.skills.hiddenSkillRefs.some((skill) => visibleSkillKeys.has(`${skill.source}\0${skill.path}`))) {
    throw validationError(`${label}.skills visible and hidden refs must be disjoint`);
  }

  if (!Array.isArray(value.diagnostics)) throw validationError(`${label}.diagnostics must be an array`);
  value.diagnostics.forEach((diagnostic, index) => assertProfileDiagnostic(diagnostic, `${label}.diagnostics[${index}]`));
}

function assertSessionProfileRecord(value: unknown, sessionKey: string, label: string): asserts value is SessionProfileRecordV1 {
  if (!isRecord(value)) throw validationError(`${label} must be an object`);
  assertExactKeys(value, new Set(["sessionId", "sessionFilePath", "cwd", "updatedAt", "recordRevision", "snapshot"]), label);
  assertSessionId(value.sessionId, `${label}.sessionId`);
  if (value.sessionId !== sessionKey) throw validationError(`${label}.sessionId must match its sessions key`);
  assertOptionalString(value.sessionFilePath, `${label}.sessionFilePath`);
  assertOptionalString(value.cwd, `${label}.cwd`);
  assertTimestampLike(value.updatedAt, `${label}.updatedAt`);
  if (!isNonNegativeInteger(value.recordRevision) || value.recordRevision < 1) {
    throw validationError(`${label}.recordRevision must be a positive integer`);
  }
  assertCapabilitySnapshotV1(value.snapshot, `${label}.snapshot`);
  if (value.cwd !== undefined && value.cwd !== value.snapshot.cwd) throw validationError(`${label}.cwd must match snapshot.cwd`);
  if (value.sessionFilePath !== undefined && !isAbsolute(value.sessionFilePath)) throw validationError(`${label}.sessionFilePath must be an absolute path`);
}

export function assertSessionProfilesFileV1(value: unknown, label = "session profiles file"): asserts value is SessionProfilesFileV1 {
  if (!isRecord(value)) throw validationError(`${label} must be an object`);
  if (value.version !== 1) throw validationError(`${label}.version must be 1`);
  if (!isNonNegativeInteger(value.revision)) throw validationError(`${label}.revision must be a non-negative integer`);
  if (!isRecord(value.sessions)) throw validationError(`${label}.sessions must be an object`);
  for (const [sessionId, record] of Object.entries(value.sessions)) {
    assertSessionId(sessionId, `${label}.sessions key`);
    assertSessionProfileRecord(record, sessionId, `${label}.sessions[${sessionId}]`);
  }
}

async function readStoreFromPath(filePath: string): Promise<SessionProfilesFileV1> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptySessionProfilesFile();
    throw ioError(`Failed to read session profile store at ${filePath}`, error);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw validationError(`Invalid JSON in session profile store at ${filePath}`, error);
  }
  assertSessionProfilesFileV1(parsed);
  return cloneJson(parsed);
}

export async function readSessionProfilesFile(options: SessionProfileStoreOptions = {}): Promise<SessionProfilesFileV1> {
  return readStoreFromPath(getSessionProfilesPath(options));
}

function tokenFor(store: SessionProfilesFileV1, sessionId: string): SessionSnapshotWriteToken {
  const record = store.sessions[sessionId];
  return {
    storeRevision: store.revision,
    ...(record ? { recordRevision: record.recordRevision, snapshotId: record.snapshot.snapshotId } : {}),
  };
}

function targetRecordMatchesExpectedToken(current: SessionSnapshotWriteToken, expected: SessionSnapshotWriteToken): boolean {
  if (current.recordRevision !== expected.recordRevision) return false;
  if (expected.snapshotId !== undefined && current.snapshotId !== expected.snapshotId) return false;
  return true;
}

function assertExpectedToken(store: SessionProfilesFileV1, sessionId: string, expectedToken?: SessionSnapshotWriteToken): void {
  if (!expectedToken) return;
  const currentToken = tokenFor(store, sessionId);
  if (!targetRecordMatchesExpectedToken(currentToken, expectedToken)) {
    throw new SessionProfileStoreError("CAS_CONFLICT", "Session profile snapshot changed before the write could be applied", {
      statusCode: 409,
      currentToken,
    });
  }
}

async function withSessionProfileFileLock<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
  await mkdir(dirname(filePath), { recursive: true });
  try {
    return await withCrashRecoverableFileLock(`${filePath}.lock`, operation);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Timed out waiting for file lock:")) {
      throw new SessionProfileStoreError("LOCK_TIMEOUT", `Timed out waiting for session profile store lock at ${filePath}`, { statusCode: 503 });
    }
    throw error;
  }
}

function enqueueStoreWrite<T>(operation: () => Promise<T>): Promise<T> {
  const previous = globalThis.__piSessionProfileStoreWriteQueue ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  globalThis.__piSessionProfileStoreWriteQueue = next.then(() => undefined, () => undefined);
  return next;
}

async function writeStoreAtomic(filePath: string, nextStore: SessionProfilesFileV1): Promise<void> {
  assertSessionProfilesFileV1(nextStore);
  await mkdir(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  const data = `${JSON.stringify(nextStore, null, 2)}\n`;
  try {
    await writeFile(tempPath, data, { encoding: "utf8", flag: "wx" });
    await rename(tempPath, filePath);
  } catch (error) {
    await unlink(tempPath).catch(() => undefined);
    throw ioError(`Failed to write session profile store at ${filePath}`, error);
  }
}

async function mutateStore<T>(
  options: SessionProfileStoreOptions,
  operation: (store: SessionProfilesFileV1) => { changed: boolean; nextStore: SessionProfilesFileV1; result: T },
): Promise<T> {
  const filePath = getSessionProfilesPath(options);
  return enqueueStoreWrite(() => withSessionProfileFileLock(filePath, async () => {
    const currentStore = await readStoreFromPath(filePath);
    const { changed, nextStore, result } = operation(currentStore);
    if (changed) await writeStoreAtomic(filePath, nextStore);
    return result;
  }));
}

type SessionProfileResponseRecord = Extract<SessionProfileResponse, { state: "snapshot" }>["record"];

function makeRecordMetadata(record: SessionProfileRecordV1): SessionProfileResponseRecord {
  return {
    sessionId: record.sessionId,
    ...(record.sessionFilePath ? { sessionFilePath: record.sessionFilePath } : {}),
    updatedAt: record.updatedAt,
    recordRevision: record.recordRevision,
  };
}

export async function getSessionProfileSnapshot(sessionId: string, options: SessionProfileStoreOptions = {}): Promise<SessionProfileSnapshotLookup> {
  assertSessionId(sessionId);
  const store = await readSessionProfilesFile(options);
  const record = store.sessions[sessionId];
  if (!record) {
    return {
      state: "legacy",
      label: LEGACY_PROFILE_LABEL,
      snapshot: null,
      writeToken: tokenFor(store, sessionId),
    };
  }
  return {
    state: "snapshot",
    snapshot: cloneJson(record.snapshot),
    record: cloneJson(record),
    writeToken: tokenFor(store, sessionId),
  };
}

export async function getSessionProfileResponse(sessionId: string, options: SessionProfileStoreOptions = {}): Promise<SessionProfileResponse> {
  const result = await getSessionProfileSnapshot(sessionId, options);
  if (result.state === "legacy") {
    return { state: "legacy", label: LEGACY_PROFILE_LABEL, snapshot: null };
  }
  return {
    state: "snapshot",
    snapshot: result.snapshot,
    record: makeRecordMetadata(result.record),
  };
}

export type SessionProfileApiResult = {
  status: number;
  body: Record<string, unknown> | SessionProfileResponse;
};

export interface SessionProfileApiDependencies {
  resolveSessionPath: (sessionId: string) => Promise<string | null>;
  storeOptions?: SessionProfileStoreOptions;
}


export async function getSessionProfileApiResult(
  sessionId: string,
  dependencies: SessionProfileApiDependencies,
): Promise<SessionProfileApiResult> {
  const filePath = await dependencies.resolveSessionPath(sessionId);
  if (!filePath) return { status: 404, body: { error: "Session not found" } };
  return {
    status: 200,
    body: await getSessionProfileResponse(sessionId, dependencies.storeOptions),
  };
}


export async function setSessionProfileSnapshot(
  sessionId: string,
  snapshot: CapabilitySnapshotV1,
  metadata: SessionProfileSnapshotMetadata = {},
  expectedToken?: SessionSnapshotWriteToken,
  options: SessionProfileStoreOptions = {},
): Promise<{ record: SessionProfileRecordV1; previousRecord: SessionProfileRecordV1 | null; writeToken: SessionSnapshotWriteToken }> {
  assertSessionId(sessionId);
  assertCapabilitySnapshotV1(snapshot);
  assertOptionalString(metadata.sessionFilePath, "metadata.sessionFilePath");
  assertOptionalString(metadata.cwd, "metadata.cwd");
  if (metadata.updatedAt !== undefined) assertTimestampLike(metadata.updatedAt, "metadata.updatedAt");

  return mutateStore(options, (store) => {
    assertExpectedToken(store, sessionId, expectedToken);
    const previousRecord = store.sessions[sessionId] ? cloneJson(store.sessions[sessionId]) : null;
    const record: SessionProfileRecordV1 = {
      sessionId,
      ...(metadata.sessionFilePath ? { sessionFilePath: metadata.sessionFilePath } : {}),
      ...(metadata.cwd ? { cwd: metadata.cwd } : {}),
      updatedAt: metadata.updatedAt ?? new Date().toISOString(),
      recordRevision: (store.sessions[sessionId]?.recordRevision ?? 0) + 1,
      snapshot: cloneJson(snapshot),
    };
    const nextStore: SessionProfilesFileV1 = {
      ...store,
      version: 1,
      revision: store.revision + 1,
      sessions: {
        ...store.sessions,
        [sessionId]: record,
      },
    };
    return {
      changed: true,
      nextStore,
      result: {
        record: cloneJson(record),
        previousRecord,
        writeToken: tokenFor(nextStore, sessionId),
      },
    };
  });
}

export async function restoreSessionProfileSnapshot(
  sessionId: string,
  previousRecord: SessionProfileRecordV1 | null,
  expectedToken: SessionSnapshotWriteToken,
  options: SessionProfileStoreOptions = {},
): Promise<{ record: SessionProfileRecordV1 | null; writeToken: SessionSnapshotWriteToken }> {
  assertSessionId(sessionId);
  if (previousRecord !== null) {
    assertSessionProfileRecord(previousRecord, sessionId, "previousRecord");
  }

  return mutateStore(options, (store) => {
    assertExpectedToken(store, sessionId, expectedToken);
    const nextSessions = { ...store.sessions };
    if (previousRecord === null) {
      delete nextSessions[sessionId];
    } else {
      nextSessions[sessionId] = cloneJson(previousRecord);
    }
    const nextStore: SessionProfilesFileV1 = {
      ...store,
      version: 1,
      revision: store.revision + 1,
      sessions: nextSessions,
    };
    return {
      changed: true,
      nextStore,
      result: {
        record: previousRecord ? cloneJson(previousRecord) : null,
        writeToken: tokenFor(nextStore, sessionId),
      },
    };
  });
}

export async function deleteSessionProfileSnapshot(
  sessionId: string,
  expectedToken?: SessionSnapshotWriteToken,
  options: SessionProfileStoreOptions = {},
): Promise<{ deleted: boolean; writeToken: SessionSnapshotWriteToken }> {
  assertSessionId(sessionId);
  return mutateStore<{ deleted: boolean; writeToken: SessionSnapshotWriteToken }>(options, (store) => {
    assertExpectedToken(store, sessionId, expectedToken);
    if (!existsSync(getSessionProfilesPath(options)) && !store.sessions[sessionId]) {
      return { changed: false, nextStore: store, result: { deleted: false, writeToken: tokenFor(store, sessionId) } };
    }
    if (!store.sessions[sessionId]) {
      return { changed: false, nextStore: store, result: { deleted: false, writeToken: tokenFor(store, sessionId) } };
    }
    const nextSessions = { ...store.sessions };
    delete nextSessions[sessionId];
    const nextStore: SessionProfilesFileV1 = {
      ...store,
      version: 1,
      revision: store.revision + 1,
      sessions: nextSessions,
    };
    return {
      changed: true,
      nextStore,
      result: { deleted: true, writeToken: tokenFor(nextStore, sessionId) },
    };
  });
}

export { LEGACY_PROFILE_LABEL };
