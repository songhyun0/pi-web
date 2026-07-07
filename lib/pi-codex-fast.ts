import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { OpenAIFastModeConfigState, OpenAIFastModeState } from "./types";

export const PI_CODEX_FAST_PACKAGE_NAME = "pi-codex-fast";
export const PI_CODEX_FAST_COMMAND_NAME = "fast";
export const PI_CODEX_FAST_STATUS_KEY = "pi-fast-mode";

const DEFAULT_FAST_MODELS = [
  "openai/gpt-5.4",
  "openai/gpt-5.5",
  "openai-codex/gpt-5.4",
  "openai-codex/gpt-5.5",
];

type FastModeModelKey = { provider?: string; id?: string; modelId?: string } | null | undefined;
type RawFastModeConfig = { enabled?: unknown; models?: unknown };

function normalizeModelRef(ref: string): string {
  return ref.trim().toLowerCase();
}

function normalizeFastModels(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_FAST_MODELS];
  const seen = new Set<string>();
  const models: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const normalized = normalizeModelRef(entry);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    models.push(normalized);
  }
  return models.length > 0 ? models : [...DEFAULT_FAST_MODELS];
}

function readConfig(configPath: string): RawFastModeConfig {
  if (!existsSync(configPath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as RawFastModeConfig
      : {};
  } catch {
    return {};
  }
}

export function getPiCodexFastConfigPath(agentDir = getAgentDir()): string {
  return join(agentDir, "extensions", `${PI_CODEX_FAST_PACKAGE_NAME}.json`);
}

export function loadPiCodexFastModeConfig(agentDir = getAgentDir()): OpenAIFastModeConfigState {
  const raw = readConfig(getPiCodexFastConfigPath(agentDir));
  return {
    enabled: raw.enabled === true,
    models: normalizeFastModels(raw.models),
  };
}

function getModelId(model: FastModeModelKey): string | undefined {
  return model?.modelId ?? model?.id;
}

export function isPiCodexFastModelEligible(
  model: FastModeModelKey,
  config: OpenAIFastModeConfigState = loadPiCodexFastModeConfig()
): boolean {
  const provider = model?.provider;
  const modelId = getModelId(model);
  if (!provider || !modelId) return false;
  if (provider !== "openai" && provider !== "openai-codex") return false;

  const bare = normalizeModelRef(modelId);
  const full = normalizeModelRef(`${provider}/${modelId}`);
  return config.models.some((entry) => entry === bare || entry === full);
}

export function getPiCodexFastModeState(
  model: FastModeModelKey,
  config: OpenAIFastModeConfigState = loadPiCodexFastModeConfig()
): OpenAIFastModeState {
  const provider = model?.provider;
  const modelId = getModelId(model);
  const normalizedModel = provider && modelId ? { provider, modelId } : null;
  const eligible = isPiCodexFastModelEligible(model, config);
  const active = config.enabled && eligible;
  const status = !eligible ? "unavailable" : active ? "fast" : "normal";

  return {
    enabled: config.enabled,
    eligible,
    active,
    status,
    statusText: status === "fast" ? "Fast" : status === "normal" ? "Normal" : "Fast N/A",
    model: normalizedModel,
  };
}
