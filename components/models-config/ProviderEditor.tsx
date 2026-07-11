"use client";

import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import {
  Badge,
  Button,
  Field,
  Input,
  Notice,
  SegmentedControl,
  Select,
  Switch,
} from "@/components/ui";
import styles from "../ModelsConfig.module.css";
import { SecretInput } from "./Controls";
import {
  API_OPTIONS,
  type ModelEntry,
  type ModelTestState,
  type ProviderEntry,
  THINKING_LEVELS,
  type ThinkingLevel,
} from "./types";

const DEEPSEEK_COMPAT = {
  thinkingFormat: "deepseek",
  requiresReasoningContentOnAssistantMessages: true,
} as const;

function hasDeepseekCompat(model: ModelEntry): boolean {
  return model.compat?.thinkingFormat === "deepseek";
}

function setDeepseekCompat(model: ModelEntry, enabled: boolean): ModelEntry {
  if (enabled) return { ...model, compat: { ...(model.compat ?? {}), ...DEEPSEEK_COMPAT } };
  if (!model.compat) return model;
  const rest = { ...model.compat };
  delete rest.thinkingFormat;
  delete rest.requiresReasoningContentOnAssistantMessages;
  return { ...model, compat: Object.keys(rest).length ? rest : undefined };
}

function FormSection({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={styles.formSection}>
      <div className={styles.formSectionHeader}>
        <div>
          <h3 className={styles.formSectionTitle}>{title}</h3>
          {description && <p className={styles.formSectionDescription}>{description}</p>}
        </div>
        {action && <div className={styles.formSectionAction}>{action}</div>}
      </div>
      <div className={styles.formSectionBody}>{children}</div>
    </section>
  );
}

export function ProviderEditor({
  name,
  provider,
  existingNames,
  onChange,
  onRename,
  onDelete,
}: {
  name: string;
  provider: ProviderEntry;
  existingNames: string[];
  onChange: (provider: ProviderEntry) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const [editingName, setEditingName] = useState(name);
  const set = <K extends keyof ProviderEntry>(key: K, value: ProviderEntry[K]) => onChange({ ...provider, [key]: value });

  useEffect(() => setEditingName(name), [name]);

  const nextName = editingName.trim();
  const nameError = !nextName
    ? "Provider name is required."
    : nextName !== name && existingNames.includes(nextName)
      ? "A provider with this name already exists."
      : undefined;
  const canRename = nextName !== name && !nameError;

  return (
    <div className={styles.editorStack}>
      <div className={styles.editorHeading}>
        <div>
          <Badge tone="neutral">Custom provider</Badge>
          <h2 className={styles.editorTitle}>{name}</h2>
          <p className={styles.editorDescription}>Configure the endpoint and authentication source used by this provider.</p>
        </div>
        <Button variant="danger" size="compact" onClick={onDelete}>Delete provider</Button>
      </div>

      <FormSection title="Connection" description="Provider identity, endpoint, and API protocol.">
        <div className={styles.formGridTwo}>
          <Field label="Provider name" error={nameError}>
            <Input value={editingName} onChange={(event) => setEditingName(event.target.value)} placeholder="provider-name" mono />
          </Field>
          <Field label="API protocol">
            <Select value={provider.api ?? "openai-completions"} onChange={(event) => set("api", event.target.value)}>
              {API_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
            </Select>
          </Field>
        </div>
        {canRename && (
          <div className={styles.inlineActions}>
            <Button size="compact" onClick={() => onRename(nextName)}>Rename provider</Button>
          </div>
        )}
        <Field label="Base URL" hint="Include the API version path when the provider requires one.">
          <Input
            value={provider.baseUrl ?? ""}
            onChange={(event) => set("baseUrl", event.target.value || undefined)}
            placeholder="https://api.example.com/v1"
            mono
          />
        </Field>
      </FormSection>

      <FormSection title="Authentication" description="Store a literal key, environment-variable name, or shell resolver.">
        <Field
          label="API key source"
          hint={<>Prefix with <code>!</code> to run a shell command, or enter an environment-variable name.</>}
        >
          <SecretInput
            value={provider.apiKey ?? ""}
            onChange={(value) => set("apiKey", value || undefined)}
            placeholder="ENV_VAR_NAME, !shell-command, or literal key"
          />
        </Field>
      </FormSection>
    </div>
  );
}

function ThinkingLevelMapEditor({
  value,
  onChange,
}: {
  value: Record<string, string | null> | undefined;
  onChange: (value: Record<string, string | null> | undefined) => void;
}) {
  const map = value ?? {};

  const setLevel = (level: ThinkingLevel, entry: string | null | "omit") => {
    const next = { ...map };
    if (entry === "omit") delete next[level];
    else next[level] = entry;
    onChange(Object.keys(next).length ? next : undefined);
  };

  return (
    <div className={styles.levelMap}>
      {THINKING_LEVELS.map((level) => {
        const raw = map[level];
        const state = !(level in map) ? "default" : raw === null ? "disabled" : "custom";
        const customValue = typeof raw === "string" ? raw : "";
        return (
          <div className={styles.levelRow} key={level}>
            <code className={styles.levelName}>{level}</code>
            <SegmentedControl
              value={state}
              options={[
                { value: "default", label: "Default" },
                { value: "disabled", label: "Disabled" },
                { value: "custom", label: "Custom" },
              ]}
              onValueChange={(next) => {
                if (next === "default") setLevel(level, "omit");
                else if (next === "disabled") setLevel(level, null);
                else setLevel(level, customValue || level);
              }}
              label={`${level} thinking level behavior`}
              fullWidth
              className={styles.levelControl}
            />
            <Input
              value={customValue}
              onChange={(event) => setLevel(level, event.target.value)}
              onFocus={() => { if (state !== "custom") setLevel(level, customValue || level); }}
              placeholder={level}
              maxLength={10}
              mono
              aria-label={`${level} custom thinking level value`}
              disabled={state !== "custom"}
              className={styles.levelInput}
            />
          </div>
        );
      })}
    </div>
  );
}

function testMeta(state: Exclude<ModelTestState, { phase: "idle" } | { phase: "testing" }>): string {
  return [
    state.latencyMs !== undefined ? `${state.latencyMs}ms` : null,
    state.status !== undefined ? `HTTP ${state.status}` : null,
  ].filter(Boolean).join(" · ");
}

export function ModelEditor({
  providerName,
  provider,
  model,
  onChange,
  onDelete,
}: {
  providerName: string;
  provider: ProviderEntry;
  model: ModelEntry;
  onChange: (model: ModelEntry) => void;
  onDelete: () => void;
}) {
  const [testState, setTestState] = useState<ModelTestState>({ phase: "idle" });
  const abortRef = useRef<AbortController | null>(null);
  const set = <K extends keyof ModelEntry>(key: K, value: ModelEntry[K]) => onChange({ ...model, [key]: value });
  const costValue = (key: keyof NonNullable<ModelEntry["cost"]>) => model.cost?.[key] !== undefined ? String(model.cost[key]) : "";
  const setCost = (key: keyof NonNullable<ModelEntry["cost"]>, value: string) => {
    const parsed = Number.parseFloat(value);
    const nextCost = { ...(model.cost ?? {}) };
    if (Number.isNaN(parsed)) delete nextCost[key];
    else nextCost[key] = parsed;
    onChange({ ...model, cost: Object.keys(nextCost).length ? nextCost : undefined });
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset test feedback whenever a connection input changes.
  useEffect(() => {
    setTestState({ phase: "idle" });
  }, [providerName, provider.baseUrl, provider.api, provider.apiKey, model.id, model.api]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const handleTest = useCallback(async () => {
    if (!model.id.trim() || testState.phase === "testing") return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setTestState({ phase: "testing" });
    try {
      const response = await fetch("/api/models-config/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerName, provider, model }),
        signal: controller.signal,
      });
      const data = await response.json() as {
        ok?: boolean;
        error?: string;
        latencyMs?: number;
        status?: number;
        responseText?: string;
      };
      if (!response.ok || !data.ok) {
        setTestState({
          phase: "error",
          message: data.error ?? `HTTP ${response.status}`,
          latencyMs: data.latencyMs,
          status: data.status,
        });
        return;
      }
      setTestState({
        phase: "success",
        latencyMs: data.latencyMs,
        status: data.status,
        responseText: data.responseText,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setTestState({ phase: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }, [model, provider, providerName, testState.phase]);

  const modelTitle = model.name?.trim() || model.id.trim() || "New model";
  const idError = model.id.trim() ? undefined : "Model ID is required before saving or testing.";

  return (
    <div className={styles.editorStack}>
      <div className={styles.editorHeading}>
        <div>
          <Badge tone={model.reasoning ? "accent" : "neutral"}>{model.reasoning ? "Reasoning model" : "Model"}</Badge>
          <h2 className={styles.editorTitle}>{modelTitle}</h2>
          <p className={styles.editorDescription}><code>{providerName}</code> provider configuration</p>
        </div>
        <div className={styles.headingActions}>
          <Button
            size="compact"
            loading={testState.phase === "testing"}
            disabled={!model.id.trim()}
            onClick={() => void handleTest()}
          >
            Test connection
          </Button>
          <Button variant="danger" size="compact" onClick={onDelete}>Remove model</Button>
        </div>
      </div>

      {testState.phase === "testing" && <Notice title="Testing connection">Sending a minimal request to this unsaved model configuration.</Notice>}
      {testState.phase === "success" && (
        <Notice tone="success" title="Connection successful">
          {[testMeta(testState), testState.responseText].filter(Boolean).join(" · ")}
        </Notice>
      )}
      {testState.phase === "error" && (
        <Notice tone="danger" title="Connection failed">
          {[testMeta(testState), testState.message].filter(Boolean).join(" · ")}
        </Notice>
      )}

      <FormSection title="Identity" description="Model registry identity and protocol override.">
        <div className={styles.formGridTwo}>
          <Field label="Model ID" error={idError}>
            <Input value={model.id} onChange={(event) => set("id", event.target.value)} placeholder="model-id" mono />
          </Field>
          <Field label="Display name">
            <Input value={model.name ?? ""} onChange={(event) => set("name", event.target.value || undefined)} placeholder="Optional label" />
          </Field>
        </div>
        <Field label="API override" hint="Leave inherited unless this model uses a different protocol than its provider.">
          <Select value={model.api ?? ""} onChange={(event) => set("api", event.target.value || undefined)}>
            <option value="">Inherit provider API</option>
            {API_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
          </Select>
        </Field>
      </FormSection>

      <FormSection title="Capabilities" description="Controls exposed to the runtime for this model.">
        <div className={styles.switchGrid}>
          <Switch
            checked={model.reasoning ?? false}
            onCheckedChange={(checked) => set("reasoning", checked || undefined)}
            label="Reasoning / thinking"
            description="Expose thinking-level controls for this model."
          />
          <Switch
            checked={model.input?.includes("image") ?? false}
            onCheckedChange={(checked) => set("input", checked ? ["text", "image"] : undefined)}
            label="Image input"
            description="Allow image content in user messages."
          />
        </div>
      </FormSection>

      {model.reasoning && (
        <FormSection
          title="Thinking levels"
          description="Map pi thinking levels to provider-specific values, inherit defaults, or disable unsupported levels."
          action={model.thinkingLevelMap ? (
            <Button variant="ghost" size="compact" onClick={() => set("thinkingLevelMap", undefined)}>Clear map</Button>
          ) : undefined}
        >
          <Switch
            checked={hasDeepseekCompat(model)}
            onCheckedChange={(checked) => onChange(setDeepseekCompat(model, checked))}
            label="DeepSeek thinking compatibility"
            description="Preserve reasoning content across assistant messages."
          />
          <ThinkingLevelMapEditor value={model.thinkingLevelMap} onChange={(value) => set("thinkingLevelMap", value)} />
        </FormSection>
      )}

      <FormSection title="Limits" description="Token budgets reported to pi for context and output planning.">
        <div className={styles.formGridTwo}>
          <Field label="Context window" hint="Tokens">
            <Input
              type="number"
              min={1}
              value={model.contextWindow !== undefined ? String(model.contextWindow) : ""}
              onChange={(event) => set("contextWindow", event.target.value ? Number.parseInt(event.target.value, 10) : undefined)}
              placeholder="128000"
              mono
            />
          </Field>
          <Field label="Maximum output" hint="Tokens">
            <Input
              type="number"
              min={1}
              value={model.maxTokens !== undefined ? String(model.maxTokens) : ""}
              onChange={(event) => set("maxTokens", event.target.value ? Number.parseInt(event.target.value, 10) : undefined)}
              placeholder="16384"
              mono
            />
          </Field>
        </div>
      </FormSection>

      <FormSection title="Cost" description="USD per million tokens; leave blank when pricing is unknown.">
        <div className={styles.costGrid}>
          {(["input", "output", "cacheRead", "cacheWrite"] as const).map((key) => (
            <Field key={key} label={key}>
              <Input
                type="number"
                min={0}
                step="any"
                value={costValue(key)}
                onChange={(event) => setCost(key, event.target.value)}
                placeholder="0"
                mono
              />
            </Field>
          ))}
        </div>
      </FormSection>
    </div>
  );
}
