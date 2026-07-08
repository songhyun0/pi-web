import { existsSync, statSync } from "fs";
import path from "path";
import { getAllowedFileRoots, isFilePathAllowed } from "./file-access";
export * from "./project-trust-core";

export async function validateProjectTrustCwd(cwd: string): Promise<string> {
  const resolvedCwd = path.resolve(cwd);
  if (!existsSync(resolvedCwd)) throw new Error(`Directory does not exist: ${resolvedCwd}`);
  const stats = statSync(resolvedCwd);
  if (!stats.isDirectory()) throw new Error(`Path is not a directory: ${resolvedCwd}`);
  const allowedRoots = await getAllowedFileRoots();
  if (!isFilePathAllowed(resolvedCwd, allowedRoots)) {
    throw Object.assign(new Error(`Access denied for cwd: ${resolvedCwd}`), { statusCode: 403 });
  }
  return resolvedCwd;
}
