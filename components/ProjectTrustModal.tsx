"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Dialog, EmptyState, Notice, Skeleton } from "@/components/ui";
import type {
  ProjectTrustAction,
  ProjectTrustActionInfo,
  ProjectTrustStatus,
} from "@/lib/project-trust";
import styles from "./ProjectTrustModal.module.css";
import {
  effectiveTrustSummary,
  shortenTrustPath,
  trustActionConfirmation,
  trustActionTone,
  trustDecisionLabel,
  trustResourceSummary,
  trustSourceLabel,
} from "./project-trust/helpers";

interface Props {
  cwd: string;
  onClose: () => void;
  onChanged?: () => void;
}

async function readTrustResponse(response: Response): Promise<ProjectTrustStatus> {
  const body = await response.json().catch(() => ({})) as ProjectTrustStatus & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
}

export function ProjectTrustModal({ cwd, onClose, onChanged }: Props) {
  const [status, setStatus] = useState<ProjectTrustStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingAction, setSavingAction] = useState<ProjectTrustAction | null>(null);
  const [actionIntent, setActionIntent] = useState<ProjectTrustActionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const busy = savingAction !== null;

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    setSavedMessage(null);
    try {
      const response = await fetch(`/api/project-trust?cwd=${encodeURIComponent(cwd)}`, { cache: "no-store", signal });
      setStatus(await readTrustResponse(response));
    } catch (loadError) {
      if ((loadError as Error).name !== "AbortError") {
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const save = async (action: ProjectTrustAction) => {
    setSavingAction(action);
    setError(null);
    setSavedMessage(null);
    try {
      const response = await fetch("/api/project-trust", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, action }),
      });
      setStatus(await readTrustResponse(response));
      setActionIntent(null);
      setSavedMessage("Trust decision saved. Existing live sessions may need /reload or a new session before project-local resources change.");
      onChanged?.();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSavingAction(null);
    }
  };

  const resources = useMemo(() => status?.inventory.filter((entry) => entry.exists) ?? [], [status]);
  const trustSummary = status ? effectiveTrustSummary(status.effective) : null;
  const footerStatus = savingAction
    ? "Saving trust decision…"
    : loading
      ? "Refreshing trust state…"
      : savedMessage
        ? "Decision saved"
        : trustSummary?.title ?? "Trust state unavailable";
  return (
    <>
      <Dialog
        open
        onOpenChange={(nextOpen) => { if (!nextOpen && !busy && !actionIntent) onClose(); }}
        title="Project trust"
        description={<code>{shortenTrustPath(cwd)}</code>}
        variant="adaptive"
        size="xl"
        bodyClassName={styles.dialogBody}
        dismissible={!busy && !actionIntent}
        footer={
          <div className={styles.footer}>
            <span className={styles.footerStatus} aria-live="polite">{footerStatus}</span>
            <Button loading={loading} disabled={busy || loading} onClick={() => void load()}>Refresh</Button>
          </div>
        }
      >
        <div className={styles.workspace} aria-busy={loading || undefined}>
          {loading && !status ? (
            <div className={styles.loadingState}>
              <Skeleton height={176} width="100%" />
              <div className={styles.loadingColumns}>
                <Skeleton height={300} width="100%" />
                <Skeleton height={300} width="100%" />
              </div>
            </div>
          ) : error && !status ? (
            <div className={styles.loadFailure}>
              <Notice tone="danger" title="Trust state could not be loaded" actions={<Button size="compact" onClick={() => void load()}>Retry</Button>}>{error}</Notice>
              <EmptyState title="Project trust unavailable" description="No trust decision can be made until the server state is available." />
            </div>
          ) : status && trustSummary ? (
            <div className={styles.content}>
              {loading && <div className={styles.refreshingBar}><Skeleton height={4} width="100%" /></div>}
              <section className={styles.statusCard} data-tone={trustSummary.tone}>
                <div className={styles.statusLead}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 3 20 6v5c0 5-3.4 8.6-8 10-4.6-1.4-8-5-8-10V6l8-3Z" />
                    {status.effective.trusted ? <polyline points="8.5 12 11 14.5 16 9.5" /> : <path d="M9 9l6 6m0-6-6 6" />}
                  </svg>
                  <div>
                    <span className={styles.statusEyebrow}>{trustSummary.eyebrow}</span>
                    <h2>{trustSummary.title}</h2>
                    <p>{status.effective.reason}</p>
                  </div>
                </div>
                <div className={styles.statusBadges}>
                  <Badge tone={trustSummary.tone}>{trustSourceLabel(status.effective.source)}</Badge>
                  {status.effective.savedPath && <Badge tone="neutral">saved path</Badge>}
                </div>
                <dl className={styles.statusFacts}>
                  <div><dt>Detected resources</dt><dd>{resources.length}</dd></div>
                  <div><dt>Saved decision</dt><dd>{status.savedDecision ? (status.savedDecision.decision ? "Trust" : "Block") : "None"}</dd></div>
                  <div><dt>Runtime default</dt><dd><code>{status.defaultProjectTrust}</code></dd></div>
                  <div><dt>Applies after</dt><dd>Reload or new session</dd></div>
                </dl>
                {status.effective.savedPath && (
                  <div className={styles.savedPath}><span>Decision source</span><code title={status.effective.savedPath}>{shortenTrustPath(status.effective.savedPath)}</code></div>
                )}
              </section>

              {savedMessage && <Notice tone="success" title="Trust decision saved">{savedMessage}</Notice>}
              {error && <Notice tone="danger" title="Trust action failed">{error}</Notice>}

              <Notice tone={status.requiresTrust ? "warning" : "neutral"} title={status.requiresTrust ? "Review local code before trusting" : "No trust-requiring resources detected"}>
                {status.requiresTrust
                  ? <>Project-local <code>.pi/extensions</code> and pi packages can execute local code. Only trust repositories you understand.</>
                  : "No project-local extensions or packages need review for this folder."}
              </Notice>

              <div className={styles.mainGrid} data-single={resources.length === 0 || undefined}>
                {resources.length > 0 && (
                  <section className={styles.panel}>
                    <div className={styles.panelHeader}>
                      <div>
                        <h3>Detected project resources</h3>
                        <p>Server inventory of local configuration and executable resources.</p>
                      </div>
                      <Badge tone="warning">{resources.length}</Badge>
                    </div>
                    <div className={styles.resourceList}>
                      {resources.map((entry) => (
                        <article className={styles.resourceRow} key={`${entry.kind}:${entry.path}`}>
                          <div className={styles.resourceHeading}>
                            <strong>{entry.label}</strong>
                            <Badge tone={entry.requiresTrust ? "warning" : "neutral"}>{trustResourceSummary(entry)}</Badge>
                          </div>
                          <code title={entry.path}>{shortenTrustPath(entry.path)}</code>
                          {entry.details && entry.details.length > 0 && (
                            <details className={styles.resourceDetails}>
                              <summary>{entry.details.length} configured source{entry.details.length === 1 ? "" : "s"}</summary>
                              <div>
                                {entry.details.map((detail) => <code key={detail}>{detail}</code>)}
                              </div>
                            </details>
                          )}
                        </article>
                      ))}
                    </div>
                  </section>
                )}

                <aside className={styles.panel}>
                  <div className={styles.panelHeader}>
                    <div>
                      <h3>{status.requiresTrust ? "Decision" : "Optional saved decision"}</h3>
                      <p>{status.requiresTrust ? "Choose the narrowest trust boundary that matches your intent." : "No decision is required now; you may still save an explicit policy for this folder."}</p>
                    </div>
                  </div>
                  {status.savedDecision && (
                    <div className={styles.currentDecision}>
                      <span>Current stored decision</span>
                      <strong>{status.savedDecision.decision ? "Trust" : "Block"}</strong>
                      <code title={status.savedDecision.path}>{shortenTrustPath(status.savedDecision.path)}</code>
                    </div>
                  )}
                  <div className={styles.actionList}>
                    {status.actions.map((action) => (
                      <button
                        type="button"
                        className={styles.actionCard}
                        data-tone={trustActionTone(action.action)}
                        disabled={busy}
                        key={action.action}
                        onClick={() => { setError(null); setSavedMessage(null); setActionIntent(action); }}
                      >
                        <span className={styles.actionCardTop}>
                          <strong>{action.label}</strong>
                          <Badge tone={trustActionTone(action.action)}>{action.updates.length} update{action.updates.length === 1 ? "" : "s"}</Badge>
                        </span>
                        <span>{action.description}</span>
                        <small>Review decision →</small>
                      </button>
                    ))}
                  </div>
                </aside>
              </div>
            </div>
          ) : null}
        </div>
      </Dialog>

      <Dialog
        open={Boolean(actionIntent)}
        onOpenChange={(nextOpen) => { if (!nextOpen && !busy) setActionIntent(null); }}
        title={actionIntent?.label ?? "Confirm trust decision"}
        description="Review the persisted trust-store changes before continuing."
        size="sm"
        dismissible={!busy}
        footer={
          <>
            <Button disabled={busy} onClick={() => setActionIntent(null)}>Cancel</Button>
            <Button
              variant={actionIntent?.action === "deny" ? "danger" : actionIntent?.action === "clear" ? "secondary" : "primary"}
              loading={Boolean(actionIntent && savingAction === actionIntent.action)}
              disabled={!actionIntent}
              onClick={() => { if (actionIntent) void save(actionIntent.action); }}
            >
              {actionIntent ? trustActionConfirmation(actionIntent.action) : "Confirm"}
            </Button>
          </>
        }
      >
        {actionIntent && (
          <div className={styles.confirmation}>
            <Notice
              tone={actionIntent.action === "deny" ? "danger" : "warning"}
              title={actionIntent.action === "trust" || actionIntent.action === "trust-parent" ? "Local code may run" : actionIntent.action === "deny" ? "Project resources will be blocked" : "Fallback behavior will apply"}
            >
              The decision affects project-local resources after <code>/reload</code> or when a new session starts.
            </Notice>
            <div className={styles.updateList}>
              {actionIntent.updates.map((update) => (
                <div key={`${update.path}:${String(update.decision)}`}>
                  <Badge tone={update.decision === true ? "success" : update.decision === false ? "danger" : "neutral"}>{trustDecisionLabel(update.decision)}</Badge>
                  <code title={update.path}>{shortenTrustPath(update.path)}</code>
                </div>
              ))}
            </div>
            {error && <Notice tone="danger" title="Trust action failed">{error}</Notice>}
          </div>
        )}
      </Dialog>
    </>
  );
}
