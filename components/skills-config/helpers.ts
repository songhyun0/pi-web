import type { SkillDiagnostic, SkillInfo } from "@/lib/api-types";

export type SkillSourceGroup = "project" | "global" | "path";

export function shortenPath(path: string): string {
  return path.replace(/^\/(?:Users|home)\/[^/]+/, "~");
}

export function sourceGroup(skill: SkillInfo): SkillSourceGroup {
  const source = skill.sourceInfo?.source;
  const scope = skill.sourceInfo?.scope;
  if (scope === "user" || source === "user") return "global";
  if (scope === "project" || source === "project") return "project";
  return "path";
}

export function displaySkillPath(skill: SkillInfo, cwd: string): string {
  const insideProject = skill.filePath === cwd
    || skill.filePath.startsWith(`${cwd}/`)
    || skill.filePath.startsWith(`${cwd}\\`);
  if (sourceGroup(skill) === "project" && insideProject) {
    const relative = skill.filePath.slice(cwd.length).replace(/^[/\\]/, "");
    return `./${relative}`;
  }
  return shortenPath(skill.filePath);
}

export function sourceSummary(skill: SkillInfo): string {
  const source = skill.sourceInfo?.source;
  if (skill.sourceInfo?.origin === "package" && source) return source;
  return shortenPath(skill.baseDir || (source?.startsWith("/") ? source : "") || skill.filePath);
}

export function sourceKind(skill: SkillInfo): "Package" | "Project" | "Global" | "Path" {
  if (skill.sourceInfo?.origin === "package") return "Package";
  const group = sourceGroup(skill);
  if (group === "project") return "Project";
  if (group === "global") return "Global";
  return "Path";
}

export function splitSearchPackage(pkg: string): { repository: string; skill: string } {
  const separator = pkg.indexOf("@");
  if (separator < 0) return { repository: pkg, skill: pkg };
  return {
    repository: pkg.slice(0, separator),
    skill: pkg.slice(separator + 1) || pkg,
  };
}

function pathMatches(candidate: string | undefined, skill: SkillInfo): boolean {
  if (!candidate) return false;
  return candidate === skill.filePath
    || candidate === skill.sourceInfo?.path
    || candidate.startsWith(`${skill.baseDir}/`)
    || skill.filePath.startsWith(`${candidate}/`);
}

export function diagnosticMatchesSkill(diagnostic: SkillDiagnostic, skill: SkillInfo): boolean {
  const paths = [
    diagnostic.path,
    diagnostic.collision?.winnerPath,
    diagnostic.collision?.loserPath,
  ];
  if (paths.every((path) => !path)) return true;
  return paths.some((path) => pathMatches(path, skill));
}
