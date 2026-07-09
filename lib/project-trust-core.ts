import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { homedir } from "os";
import path from "path";
import {
  CONFIG_DIR_NAME,
  getAgentDir,
  hasTrustRequiringProjectResources,
  ProjectTrustStore,
  SettingsManager,
  type DefaultProjectTrust,
  type ProjectTrustStoreEntry,
  type ProjectTrustUpdate,
} from "@earendil-works/pi-coding-agent";

export type ProjectTrustEffectiveSource =
  | "saved"
  | "inherited"
  | "defaultProjectTrust"
  | "noProjectResources"
  | "promptRequired";

export type ProjectTrustAction = "trust" | "trust-parent" | "deny" | "clear";

function normalizeSlashes(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

export interface ProjectTrustInventoryItem {
  kind:
    | "pi-settings"
    | "pi-extensions"
    | "pi-skills"
    | "agents-skills"
    | "pi-prompts"
    | "pi-themes"
    | "pi-system-prompt"
    | "pi-append-system-prompt"
    | "project-packages";
  label: string;
  path: string;
  exists: boolean;
  count: number;
  requiresTrust: boolean;
  details?: string[];
}

export interface ProjectTrustEffectiveState {
  trusted: boolean;
  source: ProjectTrustEffectiveSource;
  promptRequired: boolean;
  savedPath?: string;
  reason: string;
}

export interface ProjectTrustActionInfo {
  action: ProjectTrustAction;
  label: string;
  description: string;
  updates: ProjectTrustUpdate[];
}

export interface ProjectTrustStatus {
  cwd: string;
  agentDir: string;
  requiresTrust: boolean;
  savedDecision: ProjectTrustStoreEntry | null;
  defaultProjectTrust: DefaultProjectTrust;
  effective: ProjectTrustEffectiveState;
  inventory: ProjectTrustInventoryItem[];
  actions: ProjectTrustActionInfo[];
  appliesAfter: "new-session-or-reload";
}

function safeListDirectoryEntries(dir: string): string[] {
  try {
    return readdirSync(dir).filter((entry) => !entry.startsWith("."));
  } catch {
    return [];
  }
}

function countPath(target: string): number {
  try {
    const stats = statSync(target);
    if (stats.isDirectory()) return safeListDirectoryEntries(target).length;
    if (stats.isFile()) return 1;
  } catch {
    // ignore missing/unreadable paths
  }
  return 0;
}

function readJsonObject(filePath: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function item(
  kind: ProjectTrustInventoryItem["kind"],
  label: string,
  targetPath: string,
  requiresTrust = true,
  details?: string[],
): ProjectTrustInventoryItem {
  const exists = existsSync(targetPath);
  return {
    kind,
    label,
    path: targetPath,
    exists,
    count: exists ? countPath(targetPath) : 0,
    requiresTrust,
    ...(details && details.length ? { details } : {}),
  };
}

function collectAgentsSkillDirs(cwd: string): ProjectTrustInventoryItem[] {
  const items: ProjectTrustInventoryItem[] = [];
  const homeAgentsSkillsDir = normalizeSlashes(path.join(homedir(), ".agents", "skills"));
  let current = path.resolve(cwd);
  while (true) {
    const target = path.join(current, ".agents", "skills");
    if (existsSync(target) && normalizeSlashes(target) !== homeAgentsSkillsDir) {
      items.push(item("agents-skills", ".agents/skills", target));
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return items;
}

function collectProjectPackages(settingsPath: string): ProjectTrustInventoryItem {
  const parsed = readJsonObject(settingsPath);
  const packagesValue = parsed?.packages;
  const packages = Array.isArray(packagesValue)
    ? packagesValue
      .map((entry) => {
        if (typeof entry === "string") return entry;
        if (entry && typeof entry === "object" && typeof (entry as { source?: unknown }).source === "string") {
          return (entry as { source: string }).source;
        }
        return undefined;
      })
      .filter((entry): entry is string => typeof entry === "string")
    : [];

  return {
    kind: "project-packages",
    label: "Project packages from .pi/settings.json",
    path: settingsPath,
    exists: packages.length > 0,
    count: packages.length,
    requiresTrust: packages.length > 0,
    ...(packages.length ? { details: packages } : {}),
  };
}

export function collectProjectTrustInventory(cwd: string): ProjectTrustInventoryItem[] {
  const resolvedCwd = path.resolve(cwd);
  const piDir = path.join(resolvedCwd, CONFIG_DIR_NAME);
  const settingsPath = path.join(piDir, "settings.json");
  return [
    item("pi-settings", `${CONFIG_DIR_NAME}/settings.json`, settingsPath),
    item("pi-extensions", `${CONFIG_DIR_NAME}/extensions`, path.join(piDir, "extensions")),
    item("pi-skills", `${CONFIG_DIR_NAME}/skills`, path.join(piDir, "skills")),
    item("pi-prompts", `${CONFIG_DIR_NAME}/prompts`, path.join(piDir, "prompts")),
    item("pi-themes", `${CONFIG_DIR_NAME}/themes`, path.join(piDir, "themes")),
    item("pi-system-prompt", `${CONFIG_DIR_NAME}/SYSTEM.md`, path.join(piDir, "SYSTEM.md")),
    item("pi-append-system-prompt", `${CONFIG_DIR_NAME}/APPEND_SYSTEM.md`, path.join(piDir, "APPEND_SYSTEM.md")),
    collectProjectPackages(settingsPath),
    ...collectAgentsSkillDirs(resolvedCwd),
  ];
}

export function getProjectTrustActionUpdates(cwd: string, action: ProjectTrustAction): ProjectTrustUpdate[] {
  const trustPath = path.resolve(cwd);
  if (action === "trust") return [{ path: trustPath, decision: true }];
  if (action === "deny") return [{ path: trustPath, decision: false }];
  if (action === "clear") return [{ path: trustPath, decision: null }];

  const parentPath = path.dirname(trustPath);
  if (parentPath === trustPath) return [{ path: trustPath, decision: true }];
  return [
    { path: parentPath, decision: true },
    { path: trustPath, decision: null },
  ];
}

function buildActions(cwd: string): ProjectTrustActionInfo[] {
  const resolvedCwd = path.resolve(cwd);
  const parentPath = path.dirname(resolvedCwd);
  return [
    {
      action: "trust",
      label: "Trust this project",
      description: "Allow project-local pi settings, extensions, skills, prompts, themes, and packages for this folder.",
      updates: getProjectTrustActionUpdates(resolvedCwd, "trust"),
    },
    ...(parentPath !== resolvedCwd ? [{
      action: "trust-parent" as const,
      label: `Trust parent folder (${parentPath})`,
      description: "Allow this project and sibling projects under the parent folder, matching the CLI parent trust option.",
      updates: getProjectTrustActionUpdates(resolvedCwd, "trust-parent"),
    }] : []),
    {
      action: "deny",
      label: "Do not trust this project",
      description: "Block project-local resources unless a future trust decision changes this.",
      updates: getProjectTrustActionUpdates(resolvedCwd, "deny"),
    },
    {
      action: "clear",
      label: "Clear saved decision",
      description: "Remove the saved trust decision for this folder and fall back to inherited/default behavior.",
      updates: getProjectTrustActionUpdates(resolvedCwd, "clear"),
    },
  ];
}

function resolveEffectiveTrust(
  cwd: string,
  requiresTrust: boolean,
  savedDecision: ProjectTrustStoreEntry | null,
  defaultProjectTrust: DefaultProjectTrust,
): ProjectTrustEffectiveState {
  if (!requiresTrust) {
    return {
      trusted: true,
      source: "noProjectResources",
      promptRequired: false,
      reason: "No project-local pi resources requiring trust were detected.",
    };
  }

  if (savedDecision) {
    const normalizedCwd = normalizeSlashes(path.resolve(cwd));
    const normalizedSaved = normalizeSlashes(savedDecision.path);
    return {
      trusted: savedDecision.decision,
      source: normalizedCwd === normalizedSaved ? "saved" : "inherited",
      promptRequired: false,
      savedPath: savedDecision.path,
      reason: savedDecision.decision
        ? `Project is trusted by saved decision at ${savedDecision.path}.`
        : `Project is denied by saved decision at ${savedDecision.path}.`,
    };
  }

  if (defaultProjectTrust === "always") {
    return {
      trusted: true,
      source: "defaultProjectTrust",
      promptRequired: false,
      reason: "defaultProjectTrust is set to always.",
    };
  }

  if (defaultProjectTrust === "never") {
    return {
      trusted: false,
      source: "defaultProjectTrust",
      promptRequired: false,
      reason: "defaultProjectTrust is set to never.",
    };
  }

  return {
    trusted: false,
    source: "promptRequired",
    promptRequired: true,
    reason: "This project has trust-requiring resources and no saved decision.",
  };
}

export function getProjectTrustStatus(cwd: string): ProjectTrustStatus {
  const resolvedCwd = path.resolve(cwd);
  const agentDir = getAgentDir();
  const settingsManager = SettingsManager.create(resolvedCwd, agentDir, { projectTrusted: false });
  const defaultProjectTrust = settingsManager.getDefaultProjectTrust();
  const trustStore = new ProjectTrustStore(agentDir);
  const requiresTrust = hasTrustRequiringProjectResources(resolvedCwd);
  const savedDecision = trustStore.getEntry(resolvedCwd);

  return {
    cwd: resolvedCwd,
    agentDir,
    requiresTrust,
    savedDecision,
    defaultProjectTrust,
    effective: resolveEffectiveTrust(resolvedCwd, requiresTrust, savedDecision, defaultProjectTrust),
    inventory: collectProjectTrustInventory(resolvedCwd),
    actions: buildActions(resolvedCwd),
    appliesAfter: "new-session-or-reload",
  };
}

export function saveProjectTrustDecision(cwd: string, action: ProjectTrustAction): ProjectTrustStatus {
  const resolvedCwd = path.resolve(cwd);
  const trustStore = new ProjectTrustStore(getAgentDir());
  trustStore.setMany(getProjectTrustActionUpdates(resolvedCwd, action));
  return getProjectTrustStatus(resolvedCwd);
}
