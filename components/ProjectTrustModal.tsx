"use client";

import { useEffect, useState } from "react";
import type { ProjectTrustAction, ProjectTrustStatus } from "@/lib/project-trust";

interface Props {
  cwd: string;
  onClose: () => void;
  onChanged?: () => void;
}

function statusColor(trusted: boolean, promptRequired: boolean): string {
  if (trusted) return "var(--success)";
  return promptRequired ? "var(--warning)" : "var(--error)";
}

export function ProjectTrustModal({ cwd, onClose, onChanged }: Props) {
  const [status, setStatus] = useState<ProjectTrustStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingAction, setSavingAction] = useState<ProjectTrustAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    fetch(`/api/project-trust?cwd=${encodeURIComponent(cwd)}`, { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        return body as ProjectTrustStatus;
      })
      .then(setStatus)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  };

  useEffect(load, [cwd]);

  const save = async (action: ProjectTrustAction) => {
    setSavingAction(action);
    setError(null);
    setSavedMessage(null);
    try {
      const res = await fetch("/api/project-trust", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, action }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setStatus(body as ProjectTrustStatus);
      setSavedMessage("Trust decision saved. Existing live sessions may need /reload or a new session before project-local resources change.");
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingAction(null);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.48)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }} onClick={onClose}>
      <div onClick={(event) => event.stopPropagation()} style={{ width: "min(820px, 96vw)", maxHeight: "86vh", overflow: "hidden", border: "1px solid var(--border)", borderRadius: 12, background: "var(--bg)", boxShadow: "0 20px 60px rgba(0,0,0,0.35)", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text)" }}>Project trust</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3, fontFamily: "var(--font-mono)", wordBreak: "break-all" }}>{cwd}</div>
          </div>
          <button onClick={onClose} style={{ alignSelf: "flex-start", border: "1px solid var(--border)", background: "var(--bg-panel)", color: "var(--text)", borderRadius: 8, padding: "6px 10px", cursor: "pointer" }}>Close</button>
        </div>
        <div style={{ overflow: "auto", padding: 16 }}>
          {loading ? (
            <div style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading trust state…</div>
          ) : error ? (
            <div style={{ color: "var(--error)", fontSize: 13 }}>{error}</div>
          ) : status ? (
            <div style={{ display: "grid", gap: 16 }}>
              <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 14, background: "var(--bg-panel)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ color: statusColor(status.effective.trusted, status.effective.promptRequired), fontWeight: 600 }}>
                    {status.effective.trusted ? "Trusted" : status.effective.promptRequired ? "Needs decision" : "Not trusted"}
                  </span>
                  <span style={{ color: "var(--text-dim)", fontSize: 12, fontFamily: "var(--font-mono)" }}>{status.effective.source}</span>
                </div>
                <div style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 8 }}>{status.effective.reason}</div>
                <div style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 8 }}>
                  defaultProjectTrust: <code>{status.defaultProjectTrust}</code> · applies after: <code>{status.appliesAfter}</code>
                </div>
              </div>

              <div style={{ border: "1px solid color-mix(in srgb, var(--warning) 35%, var(--border))", borderRadius: 10, padding: 14, background: "color-mix(in srgb, var(--warning) 8%, transparent)", color: "var(--text)" }}>
                Project-local <code>.pi/extensions</code> and pi packages can execute local code. Only trust repositories you understand. Trusting enables project-local settings, extensions, skills, prompts, themes, and packages.
              </div>

              <div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: "var(--text)" }}>Detected project-local resources</div>
                <div style={{ display: "grid", gap: 6 }}>
                  {status.inventory.filter((entry) => entry.exists).length === 0 ? (
                    <div style={{ color: "var(--text-muted)", fontSize: 13 }}>No trust-requiring project-local resources were detected.</div>
                  ) : status.inventory.filter((entry) => entry.exists).map((entry) => (
                    <div key={`${entry.kind}:${entry.path}`} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "7px 9px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg-panel)", fontSize: 12 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ color: "var(--text)", fontWeight: 500 }}>{entry.label}</div>
                        <div style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.path}</div>
                      </div>
                      <div style={{ color: "var(--text-muted)", flexShrink: 0 }}>{entry.count}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: "var(--text)" }}>Decision</div>
                <div style={{ display: "grid", gap: 8 }}>
                  {status.actions.map((action) => (
                    <button key={action.action} disabled={savingAction !== null} onClick={() => save(action.action)} style={{ textAlign: "left", border: "1px solid var(--border)", borderRadius: 10, background: "var(--bg-panel)", color: "var(--text)", padding: 12, cursor: savingAction ? "default" : "pointer", opacity: savingAction && savingAction !== action.action ? 0.6 : 1 }}>
                      <div style={{ fontWeight: 600 }}>{savingAction === action.action ? "Saving… " : ""}{action.label}</div>
                      <div style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 4 }}>{action.description}</div>
                    </button>
                  ))}
                </div>
              </div>

              {savedMessage && (
                <div style={{ border: "1px solid color-mix(in srgb, var(--success) 45%, var(--border))", borderRadius: 10, padding: 12, color: "var(--success)", background: "color-mix(in srgb, var(--success) 9%, transparent)", fontSize: 13 }}>
                  {savedMessage}
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
