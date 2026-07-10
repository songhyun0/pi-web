import { randomUUID } from "crypto";
import { open, readFile, rename, stat, unlink } from "fs/promises";

interface LockOwner {
  pid: number;
  token: string;
  createdAt: string;
}

export interface FileLockOptions {
  attempts?: number;
  retryDelayMs?: number;
  staleAfterMs?: number;
}

function isLockOwner(value: unknown): value is LockOwner {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const owner = value as Partial<LockOwner>;
  return Number.isInteger(owner.pid) && (owner.pid ?? 0) > 0
    && typeof owner.token === "string" && owner.token.length > 0
    && typeof owner.createdAt === "string";
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function readOwner(filePath: string): Promise<LockOwner | null> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    return isLockOwner(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function ageMs(filePath: string): Promise<number | null> {
  try {
    return Date.now() - (await stat(filePath)).mtimeMs;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function sameOwner(left: LockOwner | null, right: LockOwner | null): boolean {
  return Boolean(left && right && left.pid === right.pid && left.token === right.token && left.createdAt === right.createdAt);
}

function abandoned(owner: LockOwner | null, fileAgeMs: number, staleAfterMs: number): boolean {
  return owner ? !processIsAlive(owner.pid) : fileAgeMs >= staleAfterMs;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function writeExclusive(filePath: string, owner: LockOwner): Promise<boolean> {
  try {
    const handle = await open(filePath, "wx", 0o600);
    try {
      await handle.writeFile(JSON.stringify(owner), "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
}

async function restoreMovedFile(movedPath: string, destinationPath: string): Promise<void> {
  for (let attempt = 0; attempt < 250; attempt += 1) {
    try {
      await rename(movedPath, destinationPath);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return;
      if (code !== "EEXIST") throw error;
      await delay(1);
    }
  }
  throw new Error(`Timed out restoring file-lock owner at ${destinationPath}`);
}

async function releaseOwnedPath(filePath: string, token: string): Promise<void> {
  const owner = await readOwner(filePath);
  if (owner?.token !== token) return;
  await unlink(filePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}

async function cleanupAbandonedPublishedOwner(filePath: string, staleAfterMs: number): Promise<void> {
  const observedAge = await ageMs(filePath);
  if (observedAge === null) return;
  const observedOwner = await readOwner(filePath);
  if (!abandoned(observedOwner, observedAge, staleAfterMs)) return;
  const movedPath = `${filePath}.stale-${process.pid}-${randomUUID()}`;
  try {
    await rename(filePath, movedPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "EEXIST") return;
    throw error;
  }
  const movedOwner = await readOwner(movedPath);
  if (sameOwner(observedOwner, movedOwner) || (!observedOwner && !movedOwner)) {
    await unlink(movedPath).catch(() => undefined);
  } else {
    await restoreMovedFile(movedPath, filePath);
  }
}

async function acquireRecoveryClaim(
  lockPath: string,
  staleAfterMs: number,
  retryDelayMs: number,
): Promise<{ path: string; token: string } | null> {
  const recoveryPath = `${lockPath}.recovery`;
  const token = randomUUID();
  const owner: LockOwner = { pid: process.pid, token, createdAt: new Date().toISOString() };

  if (await writeExclusive(recoveryPath, owner)) {
    // A concurrent stale-claim reclaimer may have moved our file. Never operate on
    // the data lock unless our recovery token is still the published owner.
    if ((await readOwner(recoveryPath))?.token === token) return { path: recoveryPath, token };
    return null;
  }

  await cleanupAbandonedPublishedOwner(recoveryPath, staleAfterMs);
  await delay(retryDelayMs);
  return null;
}

async function breakAbandonedLock(lockPath: string, staleAfterMs: number, retryDelayMs: number): Promise<boolean> {
  const candidateAge = await ageMs(lockPath);
  if (candidateAge === null) return true;
  const candidateOwner = await readOwner(lockPath);
  if (!abandoned(candidateOwner, candidateAge, staleAfterMs)) return false;

  const claim = await acquireRecoveryClaim(lockPath, staleAfterMs, retryDelayMs);
  if (!claim) return false;
  try {
    const observedAge = await ageMs(lockPath);
    if (observedAge === null) return true;
    const observedOwner = await readOwner(lockPath);
    if (!abandoned(observedOwner, observedAge, staleAfterMs)) return false;

    const movedPath = `${lockPath}.abandoned-${process.pid}-${randomUUID()}`;
    try {
      await rename(lockPath, movedPath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return true;
      throw error;
    }
    const movedOwner = await readOwner(movedPath);
    if (sameOwner(observedOwner, movedOwner) || (!observedOwner && !movedOwner)) {
      await unlink(movedPath).catch(() => undefined);
      return true;
    }
    // The data-lock owner changed after observation. It is never ours to delete.
    await restoreMovedFile(movedPath, lockPath);
    return false;
  } finally {
    await releaseOwnedPath(claim.path, claim.token);
  }
}

async function releaseOwnedLock(lockPath: string, token: string): Promise<void> {
  await releaseOwnedPath(lockPath, token);
}

export async function withFileLock<T>(
  lockPath: string,
  work: () => Promise<T>,
  options: FileLockOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? 250;
  const retryDelayMs = options.retryDelayMs ?? 20;
  const staleAfterMs = options.staleAfterMs ?? 30_000;
  const token = randomUUID();
  const owner: LockOwner = { pid: process.pid, token, createdAt: new Date().toISOString() };
  const recoveryPath = `${lockPath}.recovery`;

  let acquired = false;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await ageMs(recoveryPath) !== null) {
      // Help clean an abandoned recovery claim, but never create a claim here.
      await cleanupAbandonedPublishedOwner(recoveryPath, staleAfterMs);
      await delay(retryDelayMs);
      continue;
    }

    if (await writeExclusive(lockPath, owner)) {
      // A reclaimer that raced our first check owns the transition. Relinquish this
      // uncommitted claim before entering the caller's critical section.
      if (await ageMs(recoveryPath) !== null) {
        await releaseOwnedLock(lockPath, token);
        await delay(retryDelayMs);
        continue;
      }
      acquired = true;
      break;
    }

    if (await breakAbandonedLock(lockPath, staleAfterMs, retryDelayMs)) continue;
    await delay(retryDelayMs);
  }

  if (!acquired) throw new Error(`Timed out waiting for file lock: ${lockPath}`);
  try {
    return await work();
  } finally {
    await releaseOwnedLock(lockPath, token);
  }
}
