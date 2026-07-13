"use client";

import { type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Badge, Button, cx, Dialog, EmptyState, Notice, Skeleton } from "@/components/ui";
import { useViewportTier } from "@/hooks/useViewportTier";
import { sendAgentCommand } from "@/lib/agent-client";
import type { PluginDiagnostic, PluginPackageInfo, PluginsResponse } from "@/lib/api-types";
import styles from "./PluginsConfig.module.css";
import {
  findInstalledPackage,
  type PluginAction,
  type PluginScope,
  packageKey,
  resourceSummary,
  shortenPath,
  statusTone,
  versionSummary,
} from "./plugins-config/helpers";
import { AddPluginPanel, PackageDetail } from "./plugins-config/PluginDetail";

interface UndoAction {
  key: string;
  action: "enable" | "disable";
}

function InventorySkeleton() {
  return (
    <output className={styles.loadingList} aria-live="polite" aria-label="Loading plugins">
      {[0, 1, 2, 3, 4].map((item) => <Skeleton key={item} width={item % 2 ? "72%" : "92%"} height={44} />)}
    </output>
  );
}

function PluginInventory({
  loading,
  error,
  packages,
  diagnostics,
  selected,
  addMode,
  onSelect,
  onAdd,
  onRetry,
}: {
  loading: boolean;
  error: string | null;
  packages: PluginPackageInfo[];
  diagnostics: PluginDiagnostic[];
  selected: string | null;
  addMode: boolean;
  onSelect: (key: string) => void;
  onAdd: () => void;
  onRetry: () => void;
}) {
  const grouped = (["project", "global"] as PluginScope[])
    .map((scope) => ({ scope, packages: packages.filter((pkg) => pkg.scope === scope) }))
    .filter((group) => group.packages.length > 0);
  const hasDiagnosticError = diagnostics.some((diagnostic) => diagnostic.type === "error");

  return (
    <aside className={styles.navigation} aria-label="Plugin package inventory">
      <div className={styles.navigationHeader}>
        <h2 className={styles.navigationTitle}>Package inventory</h2>
        <p className={styles.navigationDescription}>Installed plugin packages and their loaded resources.</p>
      </div>
      <div className={styles.inventoryScroll}>
        {loading ? (
          <InventorySkeleton />
        ) : error ? (
          <Notice tone="danger" title="Plugins could not be loaded" actions={<Button size="compact" onClick={onRetry}>Retry</Button>}>
            {error}
          </Notice>
        ) : (
          <>
            {diagnostics.length > 0 && (
              <Notice tone={hasDiagnosticError ? "danger" : "warning"} title={`${diagnostics.length} diagnostic${diagnostics.length === 1 ? "" : "s"}`}>
                {diagnostics[0]?.message}
              </Notice>
            )}
            {grouped.map((group) => (
              <section className={styles.navSection} key={group.scope}>
                <h3 className={styles.navSectionHeading}>
                  <span>{group.scope}</span>
                  <span>{group.packages.length}</span>
                </h3>
                {group.packages.map((pkg) => {
                  const key = packageKey(pkg);
                  const active = !addMode && selected === key;
                  return (
                    <button
                      type="button"
                      className={cx(styles.packageRow, active && styles.packageRowSelected)}
                      aria-current={active ? "page" : undefined}
                      key={key}
                      onClick={() => onSelect(key)}
                    >
                      <span className={styles.packageRowTop}>
                        <code className={styles.packageSource}>{pkg.source}</code>
                        <Badge tone={statusTone(pkg.status)}>{pkg.status}</Badge>
                      </span>
                      <span className={styles.packageSummary}>{resourceSummary(pkg)}</span>
                      {(pkg.version || pkg.configuredVersion) && (
                        <code className={styles.packageVersion}>{versionSummary(pkg)}</code>
                      )}
                    </button>
                  );
                })}
              </section>
            ))}
            {packages.length === 0 && (
              <div className={styles.inventoryEmpty}>
                <EmptyState title="No plugins configured" description="Add an npm package, git repository, or local plugin directory." />
              </div>
            )}
          </>
        )}
      </div>
      <div className={styles.navigationFooter}>
        <Button
          className={cx(styles.addButton, addMode && styles.addButtonSelected)}
          aria-pressed={addMode}
          onClick={onAdd}
        >
          + Add plugin
        </Button>
      </div>
    </aside>
  );
}

export function PluginsConfig({
  cwd,
  sessionId,
  onClose,
  onReloaded,
}: {
  cwd: string;
  sessionId: string | null;
  onClose: () => void;
  onReloaded?: () => void;
}) {
  const viewportTier = useViewportTier();
  const isPhone = viewportTier === "phone";
  const historyMarker = `pi-plugins-${useId()}`;
  const detailHistoryActiveRef = useRef(false);
  const transientDirtyRef = useRef(false);
  const [data, setData] = useState<PluginsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [addMode, setAddMode] = useState(false);
  const [installSource, setInstallSource] = useState("");
  const [installScope, setInstallScope] = useState<PluginScope>("global");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [undoAction, setUndoAction] = useState<UndoAction | null>(null);
  const [removeIntent, setRemoveIntent] = useState<PluginPackageInfo | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  const packages = useMemo(() => data?.packages ?? [], [data?.packages]);
  const selectedPackage = packages.find((pkg) => packageKey(pkg) === selected) ?? null;
  const detailOpen = addMode || Boolean(selectedPackage);
  const installDirty = addMode && Boolean(installSource.trim());
  const diagnostics = data?.diagnostics ?? [];

  useEffect(() => {
    transientDirtyRef.current = installDirty;
  }, [installDirty]);

  const clearFeedback = useCallback(() => {
    setActionError(null);
    setActionMessage(null);
    setUndoAction(null);
  }, []);

  const loadPlugins = useCallback(async () => {
    setLoading(true);
    setError(null);
    setActionError(null);
    setActionMessage(null);
    setUndoAction(null);
    try {
      const response = await fetch(`/api/plugins?cwd=${encodeURIComponent(cwd)}`, { cache: "no-store" });
      const next = await response.json() as PluginsResponse & { error?: string };
      if (!response.ok || next.error) throw new Error(next.error ?? `HTTP ${response.status}`);
      setData(next);
      setSelected((current) => current && next.packages.some((pkg) => packageKey(pkg) === current) ? current : null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    void loadPlugins();
  }, [loadPlugins]);

  useEffect(() => {
    if (loading || isPhone || selected || addMode) return;
    if (packages[0]) setSelected(packageKey(packages[0]));
    else setAddMode(true);
  }, [addMode, isPhone, loading, packages, selected]);

  const selectNow = useCallback((key: string) => {
    transientDirtyRef.current = false;
    setInstallSource("");
    if (isPhone) {
      const state = { ...(window.history.state ?? {}), piPluginsDetail: historyMarker };
      if (detailHistoryActiveRef.current) window.history.replaceState(state, "", window.location.href);
      else window.history.pushState(state, "", window.location.href);
      detailHistoryActiveRef.current = true;
    }
    setSelected(key);
    setAddMode(false);
    clearFeedback();
  }, [clearFeedback, historyMarker, isPhone]);

  const openAddNow = useCallback(() => {
    if (isPhone) {
      const state = { ...(window.history.state ?? {}), piPluginsDetail: historyMarker };
      if (detailHistoryActiveRef.current) window.history.replaceState(state, "", window.location.href);
      else window.history.pushState(state, "", window.location.href);
      detailHistoryActiveRef.current = true;
    }
    setSelected(null);
    setAddMode(true);
    clearFeedback();
  }, [clearFeedback, historyMarker, isPhone]);

  const returnToInventory = useCallback(() => {
    transientDirtyRef.current = false;
    setInstallSource("");
    clearFeedback();
    if (isPhone && detailHistoryActiveRef.current && window.history.state?.piPluginsDetail === historyMarker) {
      window.history.back();
      return;
    }
    detailHistoryActiveRef.current = false;
    setSelected(null);
    setAddMode(false);
  }, [clearFeedback, historyMarker, isPhone]);

  const finishClose = useCallback(() => {
    if (detailHistoryActiveRef.current && window.history.state?.piPluginsDetail === historyMarker) {
      detailHistoryActiveRef.current = false;
      window.history.back();
    }
    onClose();
  }, [historyMarker, onClose]);

  const requestAction = useCallback((action: () => void) => {
    if (busyKey) return;
    if (!transientDirtyRef.current) {
      action();
      return;
    }
    setPendingAction(() => action);
    setDiscardOpen(true);
  }, [busyKey]);

  const requestSelection = useCallback((key: string) => {
    if (!addMode && selected === key) return;
    requestAction(() => selectNow(key));
  }, [addMode, requestAction, selectNow, selected]);

  const requestAdd = useCallback(() => {
    if (addMode) return;
    requestAction(openAddNow);
  }, [addMode, openAddNow, requestAction]);

  const requestBack = useCallback(() => requestAction(returnToInventory), [requestAction, returnToInventory]);
  const requestClose = useCallback(() => requestAction(finishClose), [finishClose, requestAction]);

  useEffect(() => {
    if (!isPhone) {
      if (detailHistoryActiveRef.current && window.history.state?.piPluginsDetail === historyMarker) {
        detailHistoryActiveRef.current = false;
        window.history.back();
      }
      return;
    }
    const handlePopState = (event: PopStateEvent) => {
      if (!detailHistoryActiveRef.current || event.state?.piPluginsDetail === historyMarker) return;
      if (transientDirtyRef.current) {
        window.history.pushState({ ...(event.state ?? {}), piPluginsDetail: historyMarker }, "", window.location.href);
        detailHistoryActiveRef.current = true;
        setPendingAction(() => () => {
          transientDirtyRef.current = false;
          setInstallSource("");
          window.history.back();
        });
        setDiscardOpen(true);
        return;
      }
      detailHistoryActiveRef.current = false;
      setSelected(null);
      setAddMode(false);
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
    setInstallSource("");
    setDiscardOpen(false);
    setPendingAction(null);
    action?.();
  };

  const runAction = useCallback(async (
    action: PluginAction,
    pkg: PluginPackageInfo,
    recordUndo = true,
  ): Promise<boolean> => {
    const key = packageKey(pkg);
    setBusyKey(`${action}:${key}`);
    setActionError(null);
    setActionMessage(null);
    setUndoAction(null);
    try {
      const response = await fetch("/api/plugins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, source: pkg.source, scope: pkg.scope, cwd }),
      });
      const next = await response.json() as PluginsResponse & { error?: string };
      if (!response.ok || next.error) throw new Error(next.error ?? `HTTP ${response.status}`);
      setData(next);
      if (action === "remove") {
        if (isPhone) returnToInventory();
        else {
          const first = next.packages[0];
          setSelected(first ? packageKey(first) : null);
          setAddMode(!first);
        }
        setActionMessage("Package removed.");
      } else {
        setSelected(key);
        const messages = { update: "Package updated.", disable: "Package disabled.", enable: "Package enabled." };
        setActionMessage(recordUndo ? messages[action as keyof typeof messages] : "Package state restored.");
        if (recordUndo && (action === "enable" || action === "disable")) {
          setUndoAction({ key, action: action === "enable" ? "disable" : "enable" });
        }
      }
      return true;
    } catch (actionFailure) {
      setActionError(actionFailure instanceof Error ? actionFailure.message : String(actionFailure));
      return false;
    } finally {
      setBusyKey(null);
    }
  }, [cwd, isPhone, returnToInventory]);

  const undoLastAction = useCallback(() => {
    if (!undoAction) return;
    const pkg = packages.find((candidate) => packageKey(candidate) === undoAction.key);
    if (pkg) void runAction(undoAction.action, pkg, false);
  }, [packages, runAction, undoAction]);

  const installPlugin = useCallback(async () => {
    const source = installSource.trim();
    if (!source || busyKey) return;
    const key = `${installScope}\0${source}`;
    setBusyKey(`install:${key}`);
    setActionError(null);
    setActionMessage(null);
    setUndoAction(null);
    try {
      const response = await fetch("/api/plugins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "install", source, scope: installScope, cwd }),
      });
      const next = await response.json() as PluginsResponse & { error?: string };
      if (!response.ok || next.error) throw new Error(next.error ?? `HTTP ${response.status}`);
      const installed = findInstalledPackage(next.packages, source, installScope);
      const fallback = next.packages[0];
      const nextKey = installed ? packageKey(installed) : fallback ? packageKey(fallback) : null;
      setData(next);
      setInstallSource("");
      transientDirtyRef.current = false;
      setSelected(nextKey);
      setAddMode(!nextKey);
      setActionMessage("Package installed.");
    } catch (installError) {
      setActionError(installError instanceof Error ? installError.message : String(installError));
    } finally {
      setBusyKey(null);
    }
  }, [busyKey, cwd, installScope, installSource]);

  const reloadSession = useCallback(async () => {
    if (!sessionId || busyKey) return;
    setBusyKey("reload");
    setActionError(null);
    setActionMessage(null);
    setUndoAction(null);
    try {
      await sendAgentCommand(sessionId, { type: "reload" });
      onReloaded?.();
      await loadPlugins();
      setActionMessage("Session reloaded with the current package configuration.");
    } catch (reloadError) {
      setActionError(reloadError instanceof Error ? reloadError.message : String(reloadError));
    } finally {
      setBusyKey(null);
    }
  }, [busyKey, loadPlugins, onReloaded, sessionId]);

  const confirmRemove = useCallback(async () => {
    if (!removeIntent) return;
    const removed = await runAction("remove", removeIntent);
    if (removed) setRemoveIntent(null);
  }, [removeIntent, runAction]);

  const selectedDiagnostics = selectedPackage
    ? diagnostics.filter((diagnostic) => !diagnostic.source || diagnostic.source === selectedPackage.source)
    : [];
  const addBusy = busyKey?.startsWith("install:") ?? false;
  const diagnosticErrors = diagnostics.some((diagnostic) => diagnostic.type === "error");
  const detailTitle = addMode ? "Add plugin" : selectedPackage?.packageName ?? selectedPackage?.source ?? "Plugin details";

  let detailContent: ReactNode = null;
  if (addMode) {
    detailContent = (
      <AddPluginPanel
        cwd={cwd}
        source={installSource}
        scope={installScope}
        busy={addBusy}
        actionError={actionError}
        actionMessage={actionMessage}
        onSourceChange={(value) => { setInstallSource(value); setActionError(null); setActionMessage(null); }}
        onScopeChange={(scope) => { setInstallScope(scope); setActionError(null); setActionMessage(null); }}
        onInstall={() => void installPlugin()}
      />
    );
  } else if (selectedPackage) {
    detailContent = (
      <PackageDetail
        key={packageKey(selectedPackage)}
        pkg={selectedPackage}
        cwd={cwd}
        busyKey={busyKey}
        actionError={actionError}
        actionMessage={actionMessage}
        diagnostics={selectedDiagnostics}
        sessionId={sessionId}
        canUndo={undoAction?.key === packageKey(selectedPackage)}
        onAction={(action, pkg) => void runAction(action, pkg)}
        onUndo={undoLastAction}
        onReloadSession={() => void reloadSession()}
        onRequestRemove={() => setRemoveIntent(selectedPackage)}
      />
    );
  }

  const footer = (
    <div className={styles.footer}>
      <div className={styles.footerStatus} aria-live="polite">
        <Badge tone={error || actionError ? "danger" : busyKey ? "accent" : actionMessage ? "success" : diagnosticErrors ? "danger" : diagnostics.length ? "warning" : "neutral"}>
          {error || actionError ? "Error" : busyKey ? "Working" : actionMessage ? "Updated" : diagnosticErrors ? "Diagnostics" : diagnostics.length ? "Warnings" : "Current"}
        </Badge>
        <span className={styles.footerStatusText}>
          {error ?? actionError ?? actionMessage ?? (diagnostics.length
            ? `${diagnostics.length} diagnostic${diagnostics.length === 1 ? "" : "s"}`
            : data
              ? `${data.totals.extensions} extensions · ${data.totals.skills} skills · ${data.totals.prompts} prompts · ${data.totals.themes} themes`
              : "Loading package inventory…")}
        </span>
      </div>
      <Button disabled={loading || Boolean(busyKey)} onClick={() => void loadPlugins()}>Refresh</Button>
    </div>
  );

  return (
    <>
      <Dialog
        open
        onOpenChange={(nextOpen) => { if (!nextOpen) requestClose(); }}
        title="Plugins"
        description={<code>{shortenPath(cwd)}</code>}
        variant="adaptive"
        size="xl"
        dismissible={!busyKey}
        bodyClassName={styles.dialogBody}
        footer={footer}
      >
        <div className={styles.workspace} data-detail={detailOpen}>
          <PluginInventory
            loading={loading}
            error={error}
            packages={packages}
            diagnostics={diagnostics}
            selected={selected}
            addMode={addMode}
            onSelect={requestSelection}
            onAdd={requestAdd}
            onRetry={() => void loadPlugins()}
          />
          <main className={styles.detailPanel}>
            {isPhone && detailOpen && (
              <div className={styles.mobileDetailHeader}>
                <Button variant="ghost" size="touch" className={styles.mobileBackButton} onClick={requestBack}>
                  <span aria-hidden="true">←</span> Back
                </Button>
                <strong title={detailTitle}>{detailTitle}</strong>
              </div>
            )}
            <div className={styles.detailScroll}>
              {detailContent ?? (
                loading ? (
                  <div className={styles.detailLoading}>
                    <Skeleton width="38%" height={24} />
                    <Skeleton width="100%" height={180} />
                    <Skeleton width="100%" height={220} />
                  </div>
                ) : (
                  <div className={styles.detailEmpty}>
                    <EmptyState title="Select a package" description="Choose an installed package to inspect its resources and configuration." />
                  </div>
                )
              )}
            </div>
          </main>
        </div>
      </Dialog>

      <Dialog
        open={discardOpen}
        onOpenChange={(nextOpen) => { if (!nextOpen) closeDiscard(); }}
        title="Discard plugin source?"
        description="The package source has not been installed."
        variant="sheet"
        size="sm"
        footer={(
          <div className={styles.confirmActions}>
            <Button onClick={closeDiscard}>Keep editing</Button>
            <Button variant="danger" onClick={confirmDiscard}>Discard source</Button>
          </div>
        )}
      >
        <Notice tone="warning" title="Unsaved installation draft">
          Leaving this screen will clear the package source you entered.
        </Notice>
      </Dialog>

      <Dialog
        open={Boolean(removeIntent)}
        onOpenChange={(nextOpen) => { if (!nextOpen && !busyKey) setRemoveIntent(null); }}
        title="Remove plugin?"
        description={removeIntent ? <code>{removeIntent.source}</code> : undefined}
        variant="sheet"
        size="sm"
        dismissible={!busyKey}
        footer={(
          <div className={styles.confirmActions}>
            <Button disabled={Boolean(busyKey)} onClick={() => setRemoveIntent(null)}>Cancel</Button>
            <Button
              variant="danger"
              loading={Boolean(removeIntent && busyKey === `remove:${packageKey(removeIntent)}`)}
              onClick={() => void confirmRemove()}
            >
              Remove plugin
            </Button>
          </div>
        )}
      >
        <div className={styles.confirmStack}>
          <Notice tone="danger" title="Package configuration will be removed">
            The {removeIntent?.scope} package entry and its loaded resources will be removed from pi configuration.
          </Notice>
          {actionError && <Notice tone="danger" title="Package was not removed">{actionError}</Notice>}
        </div>
      </Dialog>
    </>
  );
}
