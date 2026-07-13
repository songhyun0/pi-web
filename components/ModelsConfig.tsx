"use client";

import { type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Badge, Button, cx, Dialog, EmptyState, Notice, Skeleton } from "@/components/ui";
import { useViewportTier } from "@/hooks/useViewportTier";
import styles from "./ModelsConfig.module.css";
import { AddProviderDialog } from "./models-config/AddProviderDialog";
import { ApiKeyEditor, OAuthEditor } from "./models-config/AuthEditor";
import { ModelEditor, ProviderEditor } from "./models-config/ProviderEditor";
import { ProviderIcon } from "./models-config/ProviderIcon";
import type {
  ApiKeyProvider,
  ModelEntry,
  ModelsJson,
  OAuthProvider,
  ProviderEntry,
  Selection,
} from "./models-config/types";

type DeleteIntent =
  | { type: "provider"; name: string }
  | { type: "model"; providerName: string; index: number; label: string };

type DiscardReason = "close" | "detail";

function selectionEquals(left: Selection | null, right: Selection): boolean {
  if (!left || left.type !== right.type) return false;
  if (left.type === "provider" && right.type === "provider") return left.name === right.name;
  if (left.type === "model" && right.type === "model") {
    return left.providerName === right.providerName && left.index === right.index;
  }
  if (left.type === "oauth" && right.type === "oauth") return left.providerId === right.providerId;
  return left.type === "apikey" && right.type === "apikey" && left.providerId === right.providerId;
}

function selectionTitle(
  selection: Selection | null,
  config: ModelsJson,
  oauthProviders: OAuthProvider[],
  apiKeyProviders: ApiKeyProvider[],
): string {
  if (!selection) return "Provider inventory";
  if (selection.type === "oauth") {
    return oauthProviders.find((provider) => provider.id === selection.providerId)?.name ?? selection.providerId;
  }
  if (selection.type === "apikey") {
    return apiKeyProviders.find((provider) => provider.id === selection.providerId)?.displayName ?? selection.providerId;
  }
  if (selection.type === "provider") return selection.name;
  const model = config.providers?.[selection.providerName]?.models?.[selection.index];
  return model?.name?.trim() || model?.id.trim() || "New model";
}

function InventorySkeleton() {
  return (
    <output className={styles.loadingNavigation} aria-live="polite" aria-label="Loading providers">
      {[0, 1, 2, 3, 4].map((item) => <Skeleton key={item} width={item % 2 ? "72%" : "88%"} height={36} />)}
    </output>
  );
}

function DetailSkeleton() {
  return (
    <output className={styles.loadingDetail} aria-live="polite" aria-label="Loading model configuration">
      <Skeleton width="34%" height={24} />
      <Skeleton width="72%" height={14} />
      <Skeleton width="100%" height={150} />
      <Skeleton width="100%" height={210} />
    </output>
  );
}

function CustomProviderGlyph() {
  return (
    <span className={styles.customProviderIcon} aria-hidden="true">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <rect x="9" y="9" width="6" height="6" />
        <line x1="9" y1="1" x2="9" y2="4" />
        <line x1="15" y1="1" x2="15" y2="4" />
        <line x1="9" y1="20" x2="9" y2="23" />
        <line x1="15" y1="20" x2="15" y2="23" />
      </svg>
    </span>
  );
}

function ProviderInventory({
  loading,
  loadError,
  authError,
  oauthProviders,
  apiKeyProviders,
  providers,
  selection,
  onSelect,
  onAddModel,
  onAddProvider,
  onRetry,
}: {
  loading: boolean;
  loadError: string | null;
  authError: string | null;
  oauthProviders: OAuthProvider[];
  apiKeyProviders: ApiKeyProvider[];
  providers: [string, ProviderEntry][];
  selection: Selection | null;
  onSelect: (selection: Selection) => void;
  onAddModel: (providerName: string) => void;
  onAddProvider: () => void;
  onRetry: () => void;
}) {
  const activeOAuth = oauthProviders.filter((provider) => provider.loggedIn);
  const activeApiKeys = apiKeyProviders.filter((provider) => provider.configured);
  const hasManaged = activeOAuth.length > 0 || activeApiKeys.length > 0;
  const hasAny = hasManaged || providers.length > 0;

  return (
    <aside className={styles.navigation} aria-label="Model provider inventory">
      <div className={styles.navigationHeader}>
        <h2 className={styles.navigationTitle}>Provider inventory</h2>
        <p className={styles.navigationDescription}>Accounts, custom endpoints, and their registered models.</p>
      </div>
      <div className={styles.inventoryScroll}>
        {loading ? (
          <InventorySkeleton />
        ) : loadError ? (
          <Notice
            tone="danger"
            title="Models could not be loaded"
            actions={<Button size="compact" onClick={onRetry}>Retry</Button>}
          >
            {loadError}
          </Notice>
        ) : (
          <>
            {authError && <Notice tone="warning" title="Authentication status unavailable">{authError}</Notice>}
            {hasManaged && (
              <section className={styles.navSection}>
                <h3 className={styles.navSectionHeading}>
                  <span>Connected accounts</span>
                  <span>{activeOAuth.length + activeApiKeys.length}</span>
                </h3>
                {activeOAuth.map((provider) => {
                  const active = selection?.type === "oauth" && selection.providerId === provider.id;
                  return (
                    <button
                      type="button"
                      className={cx(styles.navRow, active && styles.navRowSelected)}
                      aria-current={active ? "page" : undefined}
                      key={`oauth:${provider.id}`}
                      onClick={() => onSelect({ type: "oauth", providerId: provider.id })}
                    >
                      <ProviderIcon id={provider.id} />
                      <span className={styles.navCopy}>
                        <span className={styles.navLabel}>{provider.name}</span>
                        <span className={styles.navMeta}>Subscription</span>
                      </span>
                    </button>
                  );
                })}
                {activeApiKeys.map((provider) => {
                  const active = selection?.type === "apikey" && selection.providerId === provider.id;
                  return (
                    <button
                      type="button"
                      className={cx(styles.navRow, active && styles.navRowSelected)}
                      aria-current={active ? "page" : undefined}
                      key={`apikey:${provider.id}`}
                      onClick={() => onSelect({ type: "apikey", providerId: provider.id })}
                    >
                      <ProviderIcon id={provider.id} />
                      <span className={styles.navCopy}>
                        <span className={styles.navLabel}>{provider.displayName}</span>
                        <span className={styles.navMeta}>{provider.modelCount} models · API key</span>
                      </span>
                    </button>
                  );
                })}
              </section>
            )}

            {providers.length > 0 && (
              <section className={styles.navSection}>
                <h3 className={styles.navSectionHeading}>
                  <span>Custom providers</span>
                  <span>{providers.length}</span>
                </h3>
                {providers.map(([providerName, provider]) => {
                  const providerActive = selection?.type === "provider" && selection.name === providerName;
                  return (
                    <div className={styles.providerBlock} key={providerName}>
                      <button
                        type="button"
                        className={cx(styles.navRow, providerActive && styles.navRowSelected)}
                        aria-current={providerActive ? "page" : undefined}
                        onClick={() => onSelect({ type: "provider", name: providerName })}
                      >
                        <CustomProviderGlyph />
                        <span className={styles.navCopy}>
                          <span className={styles.navLabel}>{providerName}</span>
                          <span className={styles.navMeta}>{provider.models?.length ?? 0} model{provider.models?.length === 1 ? "" : "s"}</span>
                        </span>
                      </button>
                      {(provider.models ?? []).map((model, index) => {
                        const modelActive = selection?.type === "model" &&
                          selection.providerName === providerName && selection.index === index;
                        return (
                          <button
                            type="button"
                            className={cx(styles.modelRow, modelActive && styles.navRowSelected)}
                            aria-current={modelActive ? "page" : undefined}
                            // biome-ignore lint/suspicious/noArrayIndexKey: model array position is its persisted identity in models.json.
                            key={`${providerName}:${index}`}
                            onClick={() => onSelect({ type: "model", providerName, index })}
                          >
                            <span className={styles.navCopy}>
                              <span className={styles.navLabel}>{model.name?.trim() || model.id || "New model"}</span>
                              {model.name?.trim() && <span className={styles.navMeta}>{model.id || "ID required"}</span>}
                            </span>
                            {model.reasoning && <span className={styles.reasoningMark}>T</span>}
                          </button>
                        );
                      })}
                      <button type="button" className={styles.addModelButton} onClick={() => onAddModel(providerName)}>
                        + Add model
                      </button>
                    </div>
                  );
                })}
              </section>
            )}

            {!hasAny && (
              <div className={styles.inventoryEmpty}>
                <EmptyState title="No providers configured" description="Connect an account or add a custom endpoint to begin." />
              </div>
            )}
          </>
        )}
      </div>
      <div className={styles.navigationFooter}>
        <Button className={styles.addProviderButton} onClick={onAddProvider}>+ Add provider</Button>
      </div>
    </aside>
  );
}

export function ModelsConfig({ onClose }: { onClose: () => void }) {
  const viewportTier = useViewportTier();
  const isPhone = viewportTier === "phone";
  const historyMarker = `pi-models-${useId()}`;
  const detailHistoryActiveRef = useRef(false);
  const transientDirtyRef = useRef(false);
  const [config, setConfig] = useState<ModelsJson>({ providers: {} });
  const [savedConfig, setSavedConfig] = useState<ModelsJson>({ providers: {} });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [oauthProviders, setOauthProviders] = useState<OAuthProvider[]>([]);
  const [apiKeyProviders, setApiKeyProviders] = useState<ApiKeyProvider[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [deleteIntent, setDeleteIntent] = useState<DeleteIntent | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [discardReason, setDiscardReason] = useState<DiscardReason>("close");
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [transientDirty, setTransientDirty] = useState(false);

  const providers = useMemo(() => Object.entries(config.providers ?? {}), [config.providers]);
  const activeOAuth = useMemo(() => oauthProviders.filter((provider) => provider.loggedIn), [oauthProviders]);
  const activeApiKeys = useMemo(() => apiKeyProviders.filter((provider) => provider.configured), [apiKeyProviders]);
  const configDirty = useMemo(() => JSON.stringify(config) !== JSON.stringify(savedConfig), [config, savedConfig]);
  const authError = [oauthError, apiKeyError].filter(Boolean).join(" ") || null;
  const validationError = useMemo(() => {
    for (const [providerName, provider] of providers) {
      const emptyIndex = (provider.models ?? []).findIndex((model) => !model.id.trim());
      if (emptyIndex >= 0) return `${providerName}: model ${emptyIndex + 1} needs an ID before saving.`;
    }
    return null;
  }, [providers]);

  const clearSaveFeedback = useCallback(() => {
    setSaveError(null);
    setSaveMessage(null);
  }, []);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch("/api/models-config", { cache: "no-store" });
      const data = await response.json() as ModelsJson | { error?: string };
      if (!response.ok) {
        const message = typeof data.error === "string" && data.error ? data.error : `HTTP ${response.status}`;
        throw new Error(message);
      }
      const next = (data as ModelsJson).providers ? data as ModelsJson : { ...(data as ModelsJson), providers: {} };
      setConfig(next);
      setSavedConfig(next);
    } catch (error) {
      setConfig({ providers: {} });
      setSavedConfig({ providers: {} });
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadOAuthProviders = useCallback(async () => {
    setOauthError(null);
    try {
      const response = await fetch("/api/auth/providers", { cache: "no-store" });
      const data = await response.json() as { providers?: OAuthProvider[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
      setOauthProviders(data.providers ?? []);
    } catch (error) {
      setOauthError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const loadApiKeyProviders = useCallback(async () => {
    setApiKeyError(null);
    try {
      const response = await fetch("/api/auth/all-providers", { cache: "no-store" });
      const data = await response.json() as { providers?: ApiKeyProvider[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
      setApiKeyProviders(data.providers ?? []);
    } catch (error) {
      setApiKeyError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => {
    void loadConfig();
    void loadOAuthProviders();
    void loadApiKeyProviders();
  }, [loadApiKeyProviders, loadConfig, loadOAuthProviders]);

  useEffect(() => {
    if (loading || isPhone || selection) return;
    if (activeOAuth[0]) setSelection({ type: "oauth", providerId: activeOAuth[0].id });
    else if (activeApiKeys[0]) setSelection({ type: "apikey", providerId: activeApiKeys[0].id });
    else if (providers[0]) setSelection({ type: "provider", name: providers[0][0] });
  }, [activeApiKeys, activeOAuth, isPhone, loading, providers, selection]);

  const handleTransientDirtyChange = useCallback((dirty: boolean) => {
    transientDirtyRef.current = dirty;
    setTransientDirty(dirty);
  }, []);

  const selectNow = useCallback((next: Selection) => {
    transientDirtyRef.current = false;
    setTransientDirty(false);
    if (isPhone) {
      const state = { ...(window.history.state ?? {}), piModelsDetail: historyMarker };
      if (detailHistoryActiveRef.current) window.history.replaceState(state, "", window.location.href);
      else window.history.pushState(state, "", window.location.href);
      detailHistoryActiveRef.current = true;
    }
    setSelection(next);
  }, [historyMarker, isPhone]);

  const returnToInventory = useCallback(() => {
    transientDirtyRef.current = false;
    setTransientDirty(false);
    if (isPhone && detailHistoryActiveRef.current && window.history.state?.piModelsDetail === historyMarker) {
      window.history.back();
      return;
    }
    detailHistoryActiveRef.current = false;
    setSelection(null);
  }, [historyMarker, isPhone]);

  const finishClose = useCallback(() => {
    if (detailHistoryActiveRef.current && window.history.state?.piModelsDetail === historyMarker) {
      detailHistoryActiveRef.current = false;
      window.history.back();
    }
    onClose();
  }, [historyMarker, onClose]);

  const requestAction = useCallback((action: () => void, reason: DiscardReason) => {
    const shouldConfirm = transientDirtyRef.current || (reason === "close" && configDirty);
    if (!shouldConfirm) {
      action();
      return;
    }
    setDiscardReason(reason);
    setPendingAction(() => action);
    setDiscardOpen(true);
  }, [configDirty]);

  const requestClose = useCallback(() => {
    if (saving) return;
    requestAction(finishClose, "close");
  }, [finishClose, requestAction, saving]);

  const requestSelection = useCallback((next: Selection) => {
    if (selectionEquals(selection, next)) return;
    requestAction(() => selectNow(next), "detail");
  }, [requestAction, selectNow, selection]);

  const requestBack = useCallback(() => {
    requestAction(returnToInventory, "detail");
  }, [requestAction, returnToInventory]);

  useEffect(() => {
    if (!isPhone) {
      if (detailHistoryActiveRef.current && window.history.state?.piModelsDetail === historyMarker) {
        detailHistoryActiveRef.current = false;
        window.history.back();
      }
      return;
    }
    const handlePopState = (event: PopStateEvent) => {
      if (!detailHistoryActiveRef.current || event.state?.piModelsDetail === historyMarker) return;
      if (transientDirtyRef.current) {
        window.history.pushState({ ...(event.state ?? {}), piModelsDetail: historyMarker }, "", window.location.href);
        detailHistoryActiveRef.current = true;
        setDiscardReason("detail");
        setPendingAction(() => () => {
          transientDirtyRef.current = false;
          setTransientDirty(false);
          window.history.back();
        });
        setDiscardOpen(true);
        return;
      }
      detailHistoryActiveRef.current = false;
      setSelection(null);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [historyMarker, isPhone]);

  const closeDiscard = () => {
    setDiscardOpen(false);
    setPendingAction(null);
  };

  const confirmDiscard = () => {
    const action = pendingAction;
    transientDirtyRef.current = false;
    setTransientDirty(false);
    setDiscardOpen(false);
    setPendingAction(null);
    action?.();
  };

  const addCustomProviderNow = useCallback(() => {
    let name = "new-provider";
    let suffix = 1;
    while (config.providers?.[name]) name = `new-provider-${suffix++}`;
    clearSaveFeedback();
    setConfig((current) => ({
      ...current,
      providers: { ...(current.providers ?? {}), [name]: { api: "openai-completions" } },
    }));
    selectNow({ type: "provider", name });
  }, [clearSaveFeedback, config.providers, selectNow]);

  const requestAddCustomProvider = useCallback(() => {
    requestAction(addCustomProviderNow, "detail");
  }, [addCustomProviderNow, requestAction]);

  const updateProvider = useCallback((name: string, provider: ProviderEntry) => {
    clearSaveFeedback();
    setConfig((current) => ({
      ...current,
      providers: { ...(current.providers ?? {}), [name]: provider },
    }));
  }, [clearSaveFeedback]);

  const renameProvider = useCallback((oldName: string, newName: string) => {
    clearSaveFeedback();
    setConfig((current) => {
      const entries = Object.entries(current.providers ?? {});
      const index = entries.findIndex(([name]) => name === oldName);
      if (index < 0) return current;
      entries[index] = [newName, entries[index][1]];
      return { ...current, providers: Object.fromEntries(entries) };
    });
    selectNow({ type: "provider", name: newName });
  }, [clearSaveFeedback, selectNow]);

  const addModelNow = useCallback((providerName: string) => {
    const index = config.providers?.[providerName]?.models?.length ?? 0;
    clearSaveFeedback();
    setConfig((current) => {
      const provider = current.providers?.[providerName] ?? {};
      return {
        ...current,
        providers: {
          ...(current.providers ?? {}),
          [providerName]: { ...provider, models: [...(provider.models ?? []), { id: "" }] },
        },
      };
    });
    selectNow({ type: "model", providerName, index });
  }, [clearSaveFeedback, config.providers, selectNow]);

  const requestAddModel = useCallback((providerName: string) => {
    requestAction(() => addModelNow(providerName), "detail");
  }, [addModelNow, requestAction]);

  const updateModel = useCallback((providerName: string, index: number, model: ModelEntry) => {
    clearSaveFeedback();
    setConfig((current) => {
      const provider = current.providers?.[providerName] ?? {};
      const models = [...(provider.models ?? [])];
      models[index] = model;
      return {
        ...current,
        providers: { ...(current.providers ?? {}), [providerName]: { ...provider, models } },
      };
    });
  }, [clearSaveFeedback]);

  const confirmDelete = () => {
    if (!deleteIntent) return;
    clearSaveFeedback();
    if (deleteIntent.type === "provider") {
      const remaining = Object.keys(config.providers ?? {}).filter((name) => name !== deleteIntent.name);
      setConfig((current) => {
        const nextProviders = { ...(current.providers ?? {}) };
        delete nextProviders[deleteIntent.name];
        return { ...current, providers: nextProviders };
      });
      if (isPhone) returnToInventory();
      else setSelection(remaining[0] ? { type: "provider", name: remaining[0] } : null);
    } else {
      const { providerName, index } = deleteIntent;
      setConfig((current) => {
        const provider = current.providers?.[providerName] ?? {};
        const models = [...(provider.models ?? [])];
        models.splice(index, 1);
        return {
          ...current,
          providers: {
            ...(current.providers ?? {}),
            [providerName]: { ...provider, models: models.length ? models : undefined },
          },
        };
      });
      selectNow({ type: "provider", name: providerName });
    }
    setDeleteIntent(null);
  };

  const handleSave = useCallback(async () => {
    if (!configDirty || validationError || saving) return;
    setSaving(true);
    setSaveError(null);
    setSaveMessage(null);
    try {
      const response = await fetch("/api/models-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const data = await response.json() as { success?: boolean; error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      setSavedConfig(config);
      setSaveMessage("Model configuration saved.");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }, [config, configDirty, saving, validationError]);

  let detailContent: ReactNode = null;
  if (selection?.type === "oauth") {
    const provider = oauthProviders.find((candidate) => candidate.id === selection.providerId);
    if (provider) {
      detailContent = (
        <OAuthEditor
          key={provider.id}
          provider={provider}
          onRefresh={loadOAuthProviders}
          onTransientDirtyChange={handleTransientDirtyChange}
        />
      );
    }
  } else if (selection?.type === "apikey") {
    const provider = apiKeyProviders.find((candidate) => candidate.id === selection.providerId);
    if (provider) {
      detailContent = (
        <ApiKeyEditor
          key={provider.id}
          provider={provider}
          onRefresh={loadApiKeyProviders}
          onTransientDirtyChange={handleTransientDirtyChange}
        />
      );
    }
  } else if (selection?.type === "provider") {
    const provider = config.providers?.[selection.name];
    if (provider) {
      detailContent = (
        <ProviderEditor
          key={selection.name}
          name={selection.name}
          provider={provider}
          existingNames={providers.map(([name]) => name)}
          onChange={(next) => updateProvider(selection.name, next)}
          onRename={(nextName) => renameProvider(selection.name, nextName)}
          onDelete={() => setDeleteIntent({ type: "provider", name: selection.name })}
        />
      );
    }
  } else if (selection?.type === "model") {
    const provider = config.providers?.[selection.providerName];
    const model = provider?.models?.[selection.index];
    if (provider && model) {
      detailContent = (
        <ModelEditor
          key={`${selection.providerName}:${selection.index}`}
          providerName={selection.providerName}
          provider={provider}
          model={model}
          onChange={(next) => updateModel(selection.providerName, selection.index, next)}
          onDelete={() => setDeleteIntent({
            type: "model",
            providerName: selection.providerName,
            index: selection.index,
            label: model.name?.trim() || model.id || "New model",
          })}
        />
      );
    }
  }

  const title = selectionTitle(selection, config, oauthProviders, apiKeyProviders);
  const hasUnsavedChanges = configDirty || transientDirty;
  const footer = (
    <div className={styles.footer}>
      <div className={styles.footerStatus} aria-live="polite">
        <Badge tone={saveError || validationError ? "danger" : saveMessage ? "success" : hasUnsavedChanges ? "warning" : "neutral"}>
          {saveError || validationError ? "Needs attention" : saveMessage ? "Saved" : hasUnsavedChanges ? "Unsaved" : "Current"}
        </Badge>
        <span className={styles.footerStatusText}>
          {saveError ?? validationError ?? saveMessage ?? (transientDirty ? "Authentication entry is not saved" : configDirty ? "models.json has unsaved changes" : "models.json is up to date")}
        </span>
      </div>
      <Button
        variant="primary"
        loading={saving}
        disabled={!configDirty || Boolean(validationError)}
        onClick={() => void handleSave()}
      >
        Save changes
      </Button>
    </div>
  );

  return (
    <>
      <Dialog
        open
        onOpenChange={(nextOpen) => { if (!nextOpen) requestClose(); }}
        title="Models & providers"
        description={<code>~/.pi/agent/models.json</code>}
        variant="adaptive"
        size="xl"
        dismissible={!saving}
        bodyClassName={styles.dialogBody}
        footer={footer}
      >
        <div className={styles.workspace} data-detail={Boolean(selection)}>
          <ProviderInventory
            loading={loading}
            loadError={loadError}
            authError={authError}
            oauthProviders={oauthProviders}
            apiKeyProviders={apiKeyProviders}
            providers={providers}
            selection={selection}
            onSelect={requestSelection}
            onAddModel={requestAddModel}
            onAddProvider={() => setPickerOpen(true)}
            onRetry={() => void loadConfig()}
          />

          <main className={styles.detailPanel}>
            {isPhone && selection && (
              <div className={styles.mobileDetailHeader}>
                <Button
                  variant="ghost"
                  size="touch"
                  onClick={requestBack}
                  aria-label="Back to provider inventory"
                  leadingIcon={(
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <line x1="19" y1="12" x2="5" y2="12" />
                      <polyline points="12 19 5 12 12 5" />
                    </svg>
                  )}
                >
                  Back
                </Button>
                <span className={styles.mobileTitle}>{title}</span>
              </div>
            )}
            <div className={styles.detailScroll}>
              <div className={styles.detailContent}>
                {saveError && <Notice tone="danger" title="Model configuration was not saved">{saveError}</Notice>}
                {validationError && <Notice tone="warning" title="Complete the draft before saving">{validationError}</Notice>}
                {saveMessage && <Notice tone="success" title="Configuration saved">{saveMessage}</Notice>}
                {loading ? (
                  <DetailSkeleton />
                ) : loadError ? (
                  <Notice tone="danger" title="Models could not be loaded" actions={<Button size="compact" onClick={() => void loadConfig()}>Retry</Button>}>
                    {loadError}
                  </Notice>
                ) : detailContent ?? (
                  <div className={styles.detailEmpty}>
                    <EmptyState title="Select a provider or model" description="Choose an item from the inventory to inspect or edit it." />
                  </div>
                )}
              </div>
            </div>
          </main>
        </div>
      </Dialog>

      <AddProviderDialog
        open={pickerOpen}
        oauthProviders={oauthProviders}
        apiKeyProviders={apiKeyProviders}
        onSelectOAuth={(providerId) => requestSelection({ type: "oauth", providerId })}
        onSelectApiKey={(providerId) => requestSelection({ type: "apikey", providerId })}
        onAddCustom={requestAddCustomProvider}
        onClose={() => setPickerOpen(false)}
      />

      <Dialog
        open={discardOpen}
        onOpenChange={(nextOpen) => { if (!nextOpen) closeDiscard(); }}
        title={discardReason === "close" ? "Discard unsaved changes?" : "Leave this authentication form?"}
        description={discardReason === "close"
          ? "Unsaved model or authentication values will be lost."
          : "The value entered for this provider has not been saved."}
        variant="sheet"
        size="sm"
        footer={(
          <>
            <Button variant="ghost" onClick={closeDiscard}>Keep editing</Button>
            <Button variant="danger" onClick={confirmDiscard}>Discard changes</Button>
          </>
        )}
      >
        <Notice tone="warning" title="Unsaved configuration">
          {discardReason === "close" && configDirty && transientDirty
            ? "models.json and the current authentication form both contain unsaved values."
            : discardReason === "close" && configDirty
              ? "The models.json draft has not been saved."
              : "The current authentication value has not been submitted."}
        </Notice>
      </Dialog>

      <Dialog
        open={Boolean(deleteIntent)}
        onOpenChange={(nextOpen) => { if (!nextOpen) setDeleteIntent(null); }}
        title={deleteIntent?.type === "provider" ? `Delete ${deleteIntent.name}?` : `Remove ${deleteIntent?.label ?? "model"}?`}
        description={deleteIntent?.type === "provider"
          ? "The provider and all model entries nested under it will be removed from this draft."
          : "The model entry will be removed from this provider draft."}
        variant="sheet"
        size="sm"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setDeleteIntent(null)}>Cancel</Button>
            <Button variant="danger" onClick={confirmDelete}>{deleteIntent?.type === "provider" ? "Delete provider" : "Remove model"}</Button>
          </>
        )}
      >
        <Notice tone="warning" title="Save is still required">You can close the editor without saving to abandon this deletion.</Notice>
      </Dialog>
    </>
  );
}
