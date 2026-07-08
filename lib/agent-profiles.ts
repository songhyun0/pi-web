import { existsSync, realpathSync, statSync } from "fs";
import path from "path";
import { getAllowedFileRoots, isFilePathAllowed } from "./file-access";
export * from "./agent-profiles-core";

export async function validateAgentProfilesCwd(cwd: string): Promise<string> {
  const resolvedCwd = path.resolve(cwd);
  if (!existsSync(resolvedCwd)) throw Object.assign(new Error(`Directory does not exist: ${resolvedCwd}`), { statusCode: 400 });
  const realCwd = realpathSync.native(resolvedCwd);
  if (!statSync(realCwd).isDirectory()) throw Object.assign(new Error(`Path is not a directory: ${realCwd}`), { statusCode: 400 });
  const allowedRoots = await getAllowedFileRoots();
  if (!isFilePathAllowed(resolvedCwd, allowedRoots) || !isFilePathAllowed(realCwd, allowedRoots)) {
    throw Object.assign(new Error(`Access denied for cwd: ${resolvedCwd}`), { statusCode: 403 });
  }
  return realCwd;
}
