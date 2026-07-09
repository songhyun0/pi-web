import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "fs";
import { randomUUID } from "crypto";
import path from "path";

export type SettingsJsonObject = Record<string, unknown>;

type LockedWriteResult = string | { content: string; afterWrite?: () => void };

function settingsFileError(message: string, statusCode = 409): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}

function isRecord(value: unknown): value is SettingsJsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPathInside(target: string, root: string): boolean {
  const resolvedTarget = path.resolve(target);
  const resolvedRoot = path.resolve(root);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function readJsonObject(filePath: string): SettingsJsonObject {
  if (!existsSync(filePath)) return {};
  const parsed = JSON.parse(readFileSync(filePath, "utf8"));
  if (!isRecord(parsed)) {
    throw settingsFileError(`Invalid settings file ${filePath}: expected an object`);
  }
  return parsed;
}

export function parseSettingsForLockedWrite(current: string | undefined, settingsPath: string): SettingsJsonObject {
  if (!current) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(current);
  } catch (error) {
    throw settingsFileError(`Invalid settings file ${settingsPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(parsed)) throw settingsFileError(`Invalid settings file ${settingsPath}: expected an object`);
  return parsed;
}

export function assertSafeSettingsWritePath(filePath: string, root: string): void {
  const realRoot = realpathSync.native(root);
  const dir = path.dirname(filePath);
  if (existsSync(dir)) {
    if (lstatSync(dir).isSymbolicLink()) throw settingsFileError(`Refusing to write through symlinked settings directory: ${dir}`);
    if (!isPathInside(realpathSync.native(dir), realRoot)) throw settingsFileError(`Settings directory escapes trusted root: ${dir}`);
  } else {
    const parent = path.dirname(dir);
    if (!isPathInside(realpathSync.native(parent), realRoot)) throw settingsFileError(`Settings directory parent escapes trusted root: ${parent}`);
  }
  if (existsSync(filePath) && lstatSync(filePath).isSymbolicLink()) {
    throw settingsFileError(`Refusing to write through symlinked settings file: ${filePath}`);
  }
}

function waitForSettingsLock(): void {
  const buffer = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(buffer), 0, 0, 25);
}

export function withSettingsFileLock(filePath: string, root: string, fn: (current: string | undefined) => LockedWriteResult): void {
  const dir = path.dirname(filePath);
  mkdirSync(dir, { recursive: true });
  assertSafeSettingsWritePath(filePath, root);
  const lockPath = `${filePath}.lock`;
  let fd: number | undefined;
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      assertSafeSettingsWritePath(filePath, root);
      fd = openSync(lockPath, "wx");
      break;
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined;
      if (code !== "EEXIST") throw error;
      waitForSettingsLock();
    }
  }
  if (fd === undefined) throw settingsFileError(`Timed out waiting for settings lock: ${lockPath}`);
  try {
    assertSafeSettingsWritePath(filePath, root);
    const current = existsSync(filePath) ? readFileSync(filePath, "utf8") : undefined;
    assertSafeSettingsWritePath(filePath, root);
    const result = fn(current);
    const content = typeof result === "string" ? result : result.content;
    const afterWrite = typeof result === "string" ? undefined : result.afterWrite;
    const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    const tempFd = openSync(tempPath, "wx", 0o600);
    try {
      writeFileSync(tempFd, content, "utf8");
    } finally {
      closeSync(tempFd);
    }
    assertSafeSettingsWritePath(filePath, root);
    renameSync(tempPath, filePath);
    assertSafeSettingsWritePath(filePath, root);
    afterWrite?.();
  } finally {
    closeSync(fd);
    try { unlinkSync(lockPath); } catch { /* ignore stale cleanup failure */ }
  }
}
