import { execFile } from "child_process";
import { readFileSync, statSync } from "fs";
import { devNull } from "os";
import path from "path";
import { promisify } from "util";
import type { GitChangeFile, GitChangesResponse, GitDiffResponse } from "./types";

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 10_000;
const DIFF_MAX_BUFFER = 8 * 1024 * 1024;
const TEXT_STAT_MAX_BYTES = 512 * 1024;

interface GitRepositoryInfo {
  repoRoot: string;
  branch: string | null;
  base: "HEAD" | "index";
  scopePath: string | null;
}

type ExecFileError = Error & {
  code?: number | string;
  stdout?: string | Buffer;
  stderr?: string | Buffer;
};

function outputToString(value: string | Buffer | undefined): string {
  if (typeof value === "string") return value;
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  return "";
}

function extractGitError(error: unknown): string {
  const e = error as ExecFileError;
  const stderr = outputToString(e.stderr).trim();
  if (stderr) return stderr;
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

async function git(cwd: string, args: string[], options?: { allowedExitCodes?: number[]; maxBuffer?: number }): Promise<string> {
  const allowedExitCodes = options?.allowedExitCodes ?? [0];
  try {
    const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: options?.maxBuffer ?? DIFF_MAX_BUFFER,
      env: { ...process.env, LC_ALL: "C" },
    });
    return outputToString(stdout);
  } catch (error) {
    const e = error as ExecFileError;
    const code = typeof e.code === "number" ? e.code : Number(e.code);
    if (Number.isFinite(code) && allowedExitCodes.includes(code)) {
      return outputToString(e.stdout);
    }
    throw new Error(extractGitError(error));
  }
}

function normalizeGitPath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/\/+$/, "");
}

function validateRelativeGitPath(filePath: string): string {
  const normalized = normalizeGitPath(filePath.trim());
  if (!normalized || normalized === ".") throw new Error("path is required");
  if (path.posix.isAbsolute(normalized) || normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) {
    throw new Error("Invalid git path");
  }
  return normalized;
}

function isWithinScope(filePath: string, scopePath: string | null): boolean {
  if (!scopePath) return true;
  return filePath === scopePath || filePath.startsWith(`${scopePath}/`);
}

function splitNul(out: string): string[] {
  return out.split("\0").filter(Boolean);
}

async function tryGit(cwd: string, args: string[]): Promise<string> {
  try {
    return await git(cwd, args);
  } catch {
    return "";
  }
}

export async function resolveGitRepository(cwd: string): Promise<GitRepositoryInfo | null> {
  let repoRoot: string;
  try {
    repoRoot = (await git(cwd, ["rev-parse", "--path-format=absolute", "--show-toplevel"])).trim();
  } catch {
    return null;
  }

  const branchOut = (await tryGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
  const branch = branchOut && branchOut !== "HEAD" ? branchOut : null;

  let hasHead = true;
  try {
    await git(cwd, ["rev-parse", "--verify", "--quiet", "HEAD"]);
  } catch {
    hasHead = false;
  }

  let scopePath: string | null = null;
  try {
    const relative = normalizeGitPath(path.relative(repoRoot, cwd));
    if (relative && relative !== "." && !relative.startsWith("../")) scopePath = relative;
  } catch {
    scopePath = null;
  }

  return {
    repoRoot,
    branch,
    base: hasHead ? "HEAD" : "index",
    scopePath,
  };
}

function parseNameStatus(out: string): Map<string, GitChangeFile> {
  const files = new Map<string, GitChangeFile>();
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const raw = parts[0] ?? "M";
    const first = raw[0] ?? "M";
    const status = first === "A" || first === "D" || first === "R" || first === "C" || first === "U" ? first : "M";
    const oldPath = (status === "R" || status === "C") ? parts[1] : undefined;
    const filePath = (status === "R" || status === "C") ? (parts[2] ?? parts[1]) : parts[1];
    if (!filePath) continue;
    files.set(filePath, {
      path: filePath,
      oldPath,
      status,
      additions: 0,
      deletions: 0,
      binary: false,
      staged: false,
      unstaged: false,
      untracked: false,
    });
  }
  return files;
}

function applyNumstat(files: Map<string, GitChangeFile>, out: string): void {
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    const additionsRaw = parts[0];
    const deletionsRaw = parts[1];
    const filePath = parts.slice(2).join("\t");
    if (!filePath) continue;
    const binary = additionsRaw === "-" || deletionsRaw === "-";
    const additions = binary ? null : Number(additionsRaw);
    const deletions = binary ? null : Number(deletionsRaw);
    const existing = files.get(filePath);
    if (existing) {
      existing.additions = Number.isFinite(additions) ? additions : null;
      existing.deletions = Number.isFinite(deletions) ? deletions : null;
      existing.binary = binary;
    } else {
      files.set(filePath, {
        path: filePath,
        status: "M",
        additions: Number.isFinite(additions) ? additions : null,
        deletions: Number.isFinite(deletions) ? deletions : null,
        binary,
        staged: false,
        unstaged: false,
        untracked: false,
      });
    }
  }
}

function safeAbsolutePath(repoRoot: string, gitPath: string): string | null {
  const abs = path.resolve(repoRoot, gitPath);
  const root = path.resolve(repoRoot);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (abs !== root && !abs.startsWith(rootWithSep)) return null;
  return abs;
}

function countTextLines(text: string): number {
  if (!text) return 0;
  const normalized = text.endsWith("\n") ? text.slice(0, -1) : text;
  if (!normalized) return 1;
  return normalized.split(/\r\n|\r|\n/).length;
}

function statUntrackedFile(repoRoot: string, gitPath: string): Pick<GitChangeFile, "additions" | "deletions" | "binary"> {
  const abs = safeAbsolutePath(repoRoot, gitPath);
  if (!abs) return { additions: null, deletions: 0, binary: false };
  try {
    const stat = statSync(abs);
    if (!stat.isFile()) return { additions: 0, deletions: 0, binary: false };
    if (stat.size > TEXT_STAT_MAX_BYTES) return { additions: null, deletions: 0, binary: false };
    const buf = readFileSync(abs);
    const binary = buf.includes(0);
    if (binary) return { additions: null, deletions: 0, binary: true };
    return { additions: countTextLines(buf.toString("utf8")), deletions: 0, binary: false };
  } catch {
    return { additions: null, deletions: 0, binary: false };
  }
}

function sortedFiles(files: GitChangeFile[]): GitChangeFile[] {
  const weight: Record<string, number> = { M: 0, A: 1, D: 2, R: 3, C: 4, U: 5, "?": 6 };
  return [...files].sort((a, b) => {
    const byStatus = (weight[a.status] ?? 9) - (weight[b.status] ?? 9);
    if (byStatus !== 0) return byStatus;
    return a.path.localeCompare(b.path);
  });
}

function sumKnown(value: number | null): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export async function getGitChanges(cwd: string): Promise<GitChangesResponse> {
  const repo = await resolveGitRepository(cwd);
  if (!repo) {
    return {
      isGit: false,
      repoRoot: null,
      branch: null,
      base: "HEAD",
      scopePath: null,
      totals: { files: 0, additions: 0, deletions: 0 },
      files: [],
    };
  }

  const pathspec = repo.scopePath ? [repo.scopePath] : [];
  const diffBaseArgs = repo.base === "HEAD" ? ["HEAD"] : ["--cached"];
  const nameStatusOut = await git(repo.repoRoot, ["diff", "--name-status", "--find-renames", ...diffBaseArgs, "--", ...pathspec]);
  const files = parseNameStatus(nameStatusOut);

  const numstatOut = await git(repo.repoRoot, ["diff", "--numstat", "--find-renames", ...diffBaseArgs, "--", ...pathspec]);
  applyNumstat(files, numstatOut);

  const stagedPaths = new Set(splitNul(await tryGit(repo.repoRoot, ["diff", "--name-only", "--cached", "-z", "--", ...pathspec])));
  const unstagedPaths = new Set(splitNul(await tryGit(repo.repoRoot, ["diff", "--name-only", "-z", "--", ...pathspec])));
  for (const file of files.values()) {
    file.staged = stagedPaths.has(file.path) || (file.oldPath ? stagedPaths.has(file.oldPath) : false);
    file.unstaged = unstagedPaths.has(file.path) || (file.oldPath ? unstagedPaths.has(file.oldPath) : false);
  }

  const untracked = splitNul(await git(repo.repoRoot, ["ls-files", "--others", "--exclude-standard", "-z", "--", ...pathspec]));
  for (const filePath of untracked) {
    if (!isWithinScope(filePath, repo.scopePath)) continue;
    if (files.has(filePath)) continue;
    const stats = statUntrackedFile(repo.repoRoot, filePath);
    files.set(filePath, {
      path: filePath,
      status: "?",
      additions: stats.additions,
      deletions: stats.deletions,
      binary: stats.binary,
      staged: false,
      unstaged: false,
      untracked: true,
    });
  }

  const list = sortedFiles([...files.values()]);
  return {
    isGit: true,
    repoRoot: repo.repoRoot,
    branch: repo.branch,
    base: repo.base === "HEAD" ? "HEAD" : "index",
    scopePath: repo.scopePath,
    totals: {
      files: list.length,
      additions: list.reduce((sum, file) => sum + sumKnown(file.additions), 0),
      deletions: list.reduce((sum, file) => sum + sumKnown(file.deletions), 0),
    },
    files: list,
  };
}

async function isUntracked(repoRoot: string, gitPath: string): Promise<boolean> {
  const out = await git(repoRoot, ["ls-files", "--others", "--exclude-standard", "-z", "--", gitPath]);
  return splitNul(out).includes(gitPath);
}

export async function getGitDiff(cwd: string, filePath: string): Promise<GitDiffResponse> {
  const repo = await resolveGitRepository(cwd);
  if (!repo) throw new Error("Not a git repository");

  const gitPath = validateRelativeGitPath(filePath);
  if (!isWithinScope(gitPath, repo.scopePath)) throw new Error("Path is outside the selected project");

  let diff: string;
  const untracked = await isUntracked(repo.repoRoot, gitPath);
  if (untracked) {
    diff = await git(repo.repoRoot, ["diff", "--no-index", "--no-ext-diff", "--", devNull, gitPath], {
      allowedExitCodes: [0, 1],
      maxBuffer: DIFF_MAX_BUFFER,
    });
  } else if (repo.base === "HEAD") {
    diff = await git(repo.repoRoot, ["diff", "--no-ext-diff", "--find-renames", "HEAD", "--", gitPath], { maxBuffer: DIFF_MAX_BUFFER });
  } else {
    diff = await git(repo.repoRoot, ["diff", "--no-ext-diff", "--cached", "--", gitPath], { maxBuffer: DIFF_MAX_BUFFER });
  }

  return {
    isGit: true,
    repoRoot: repo.repoRoot,
    branch: repo.branch,
    base: repo.base === "HEAD" ? "HEAD" : "index",
    path: gitPath,
    diff,
    binary: /Binary files .* differ/.test(diff),
  };
}
