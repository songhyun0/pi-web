import type { ToolPreset } from "./tool-presets";

export type AgentProfileScope = "global" | "project";
export type AgentProfileSource = "builtin" | AgentProfileScope;
export type BuiltInAgentProfileId = "no-tools" | "default" | "full";
export type AgentProfileRef =
  | `builtin:${BuiltInAgentProfileId}`
  | `global:${string}`
  | `project:${string}`;

export const AGENT_PROFILE_THINKING_LEVELS = [
  "auto",
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;

export type AgentProfileThinkingLevel = typeof AGENT_PROFILE_THINKING_LEVELS[number];
export type AgentProfileAppliedThinkingLevel = Exclude<AgentProfileThinkingLevel, "auto">;

export interface AgentProfileModel {
  provider: string;
  modelId: string;
}

export interface PresetAgentProfileTools {
  mode: "preset";
  preset: ToolPreset;
  /**
   * Whether non-built-in extension/package tools should remain available when this
   * profile is applied. Built-in default/full profiles set this to true to
   * preserve the legacy preset behavior; no-tools sets it to false.
   */
  includeExtensionTools?: boolean;
}

export interface CustomAgentProfileTools {
  mode: "custom";
  toolNames: string[];
  /** Custom tool sets must opt in explicitly to extension/package tools. */
  includeExtensionTools: boolean;
}

export type AgentProfileTools = PresetAgentProfileTools | CustomAgentProfileTools;

export type AgentProfileResourceScope = "global" | "project";

export interface AgentProfilePathRef {
  /** `global` resolves relative paths from the agent dir; `project` resolves from the session cwd. */
  scope: AgentProfileResourceScope;
  path: string;
}

export type AgentProfileInstructionMode = "default" | "append" | "replace";

export interface AgentProfileInstructions {
  mode: AgentProfileInstructionMode;
  text?: string;
  files?: AgentProfilePathRef[];
}

export interface AgentProfileResources {
  skillPaths?: AgentProfilePathRef[];
  promptPaths?: AgentProfilePathRef[];
  themePaths?: AgentProfilePathRef[];
}

export interface StoredAgentProfile {
  id: string;
  name: string;
  description?: string;
  model?: AgentProfileModel | null;
  thinkingLevel?: AgentProfileThinkingLevel;
  tools?: AgentProfileTools;
  /** Legacy import compatibility for early profile experiments. Persisted output uses `tools`. */
  toolPreset?: ToolPreset;
  instructions?: AgentProfileInstructions;
  resources?: AgentProfileResources;
  createdAt?: string;
  updatedAt?: string;
}

export interface NormalizedAgentProfile extends Omit<StoredAgentProfile, "toolPreset" | "tools" | "thinkingLevel" | "instructions" | "resources"> {
  thinkingLevel: AgentProfileThinkingLevel;
  tools: AgentProfileTools;
  instructions: AgentProfileInstructions;
  resources: Required<AgentProfileResources>;
}

export interface AgentProfilesSettings {
  version: 1;
  defaultProfileRef?: AgentProfileRef;
  profiles: StoredAgentProfile[];
}

export interface ResolvedAgentProfile extends NormalizedAgentProfile {
  ref: AgentProfileRef;
  source: AgentProfileSource;
  readonly: boolean;
}

export interface AgentProfileDiagnostic {
  scope: AgentProfileScope;
  type: "warning" | "error";
  message: string;
  profileId?: string;
  path?: string;
}

export interface AgentProfilesResponse {
  cwd: string;
  agentDir: string;
  projectTrusted: boolean;
  projectTrustSource: "none-required" | "saved" | "defaultProjectTrust" | "untrusted";
  scopes: {
    global: { path: string; writable: boolean };
    project: { path: string; readable: boolean; writable: boolean; blockedReason?: string };
  };
  profiles: ResolvedAgentProfile[];
  globalDefaultProfileRef?: AgentProfileRef;
  projectDefaultProfileRef?: AgentProfileRef;
  effectiveDefaultProfileRef: AgentProfileRef;
  diagnostics: AgentProfileDiagnostic[];
}

export interface ResolvedAgentProfilePath extends AgentProfilePathRef {
  resolvedPath: string;
}

export type AgentProfileExtensionToolMode = "none" | "all" | "selected";

export interface AgentProfileSessionOptions {
  profileRef: AgentProfileRef;
  profileName: string;
  toolNames: string[];
  includeExtensionTools: boolean;
  extensionToolMode: AgentProfileExtensionToolMode;
  provider?: string;
  modelId?: string;
  thinkingLevel?: AgentProfileAppliedThinkingLevel;
  instructions: Omit<AgentProfileInstructions, "files"> & { files: ResolvedAgentProfilePath[] };
  resources: {
    skillPaths: ResolvedAgentProfilePath[];
    promptPaths: ResolvedAgentProfilePath[];
    themePaths: ResolvedAgentProfilePath[];
  };
}

export type AgentProfilesApiAction = "upsert" | "delete" | "set-default" | "clear-default";

export interface AgentProfilesMutationRequest {
  cwd: string;
  action: AgentProfilesApiAction;
  scope: AgentProfileScope;
  profile?: StoredAgentProfile;
  id?: string;
  ref?: AgentProfileRef;
}

export interface AgentProfilesMutationResponse extends AgentProfilesResponse {
  changed: string[];
}
