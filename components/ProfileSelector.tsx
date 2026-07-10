"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RuntimeToolMetadata } from "@/lib/profile-runtime";
import type { ProfileDefinition, ProfileRef } from "@/lib/profiles";
import type { CapabilitySnapshotV1, ProfileDiagnostic, ToolConflict } from "@/lib/session-profile-store";

const ERROR_COLOR = "#ef4444";
const WARNING_COLOR = "#f59e0b";

function presetLabel(preset: CapabilitySnapshotV1["tools"]["builtinPreset"]): string {
  if (preset === "none") return "No built-ins";
  if (preset === "full") return "Full tools";
  return "Standard tools";
}

function issueLabel(diagnostics: ProfileDiagnostic[], conflicts: ToolConflict[]): string | null {
  const errorCount = diagnostics.filter((diagnostic) => diagnostic.type === "error").length;
  const warningCount = diagnostics.filter((diagnostic) => diagnostic.type === "warning").length;
  const parts: string[] = [];
  if (errorCount) parts.push(`${errorCount} error${errorCount === 1 ? "" : "s"}`);
  if (conflicts.length) parts.push(`${conflicts.length} tool override${conflicts.length === 1 ? "" : "s"}`);
  if (warningCount) parts.push(`${warningCount} warning${warningCount === 1 ? "" : "s"}`);
  return parts.length ? parts.join(" · ") : null;
}

export interface ProfileSelectorProps {
  profiles: ProfileDefinition[];
  globalDefaultProfileRef?: ProfileRef | null;
  mode: "new" | "existing";
  selectedProfileRef?: ProfileRef | null;
  displayName: string;
  effectiveSnapshot?: CapabilitySnapshotV1 | null;
  diagnostics?: ProfileDiagnostic[];
  conflicts?: ToolConflict[];
  setupWarnings?: string[];
  runtimeTools?: RuntimeToolMetadata[];
  disabled?: boolean;
  applying?: boolean;
  error?: string | null;
  onSelectProfile: (profileRef: ProfileRef | null) => void | Promise<void>;
  onOpenManager: () => void;
}

export function ProfileSelector({
  profiles,
  globalDefaultProfileRef,
  mode,
  selectedProfileRef,
  displayName,
  effectiveSnapshot,
  diagnostics = effectiveSnapshot?.diagnostics ?? [],
  conflicts = effectiveSnapshot?.tools.conflicts ?? [],
  setupWarnings = [],
  runtimeTools = [],
  disabled,
  applying,
  error,
  onSelectProfile,
  onOpenManager,
}: ProfileSelectorProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const disableSelect = Boolean(disabled || applying);
  const selectedProfileMissing = Boolean(selectedProfileRef && !profiles.some((profile) => profile.id === selectedProfileRef));
  const globalDefault = profiles.find((profile) => profile.id === globalDefaultProfileRef);
  const summary = issueLabel(diagnostics, conflicts);
  const hasError = Boolean(error || diagnostics.some((diagnostic) => diagnostic.type === "error"));
  const issueTone = hasError ? ERROR_COLOR : summary ? WARNING_COLOR : null;
  const activeToolCount = runtimeTools.length
    ? runtimeTools.filter((tool) => tool.active).length
    : effectiveSnapshot?.tools.activeToolNames.length ?? 0;
  const capabilitySummary = useMemo(() => {
    if (!effectiveSnapshot) return null;
    return [
      presetLabel(effectiveSnapshot.tools.builtinPreset),
      `${activeToolCount} tool${activeToolCount === 1 ? "" : "s"}`,
      `${effectiveSnapshot.plugins.length} plugin${effectiveSnapshot.plugins.length === 1 ? "" : "s"}`,
    ].join(" · ");
  }, [activeToolCount, effectiveSnapshot]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const selectProfile = (profileRef: ProfileRef | null) => {
    if (disableSelect) return;
    setOpen(false);
    void onSelectProfile(profileRef);
  };

  const optionStyle = (active: boolean, unavailable = false) => ({
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "7px 10px",
    border: "none",
    background: active ? "var(--bg-selected)" : "transparent",
    color: active ? "var(--text)" : "var(--text-muted)",
    cursor: unavailable ? "default" : "pointer",
    opacity: unavailable ? 0.55 : 1,
    textAlign: "left" as const,
    fontSize: 12,
  });

  return (
    <div ref={containerRef} style={{ position: "relative", minWidth: 0 }}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        title={[displayName, summary, disableSelect ? "Profile switching is unavailable right now" : ""].filter(Boolean).join(" · ")}
        onClick={() => setOpen((value) => !value)}
        style={{
          height: 32,
          maxWidth: 190,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 5,
          padding: "0 8px",
          border: "none",
          borderRadius: 9,
          background: open ? "var(--bg-hover)" : "transparent",
          color: open ? "var(--text)" : "var(--text-muted)",
          cursor: "pointer",
          fontSize: 12,
          transition: "background 0.12s, color 0.12s",
        }}
        onMouseEnter={(event) => {
          event.currentTarget.style.background = "var(--bg-hover)";
          event.currentTarget.style.color = "var(--text)";
        }}
        onMouseLeave={(event) => {
          event.currentTarget.style.background = open ? "var(--bg-hover)" : "transparent";
          event.currentTarget.style.color = open ? "var(--text)" : "var(--text-muted)";
        }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
          <path d="m12 3 8 4-8 4-8-4 8-4Z" />
          <path d="m4 12 8 4 8-4" />
          <path d="m4 17 8 4 8-4" />
        </svg>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{applying ? "Applying…" : displayName}</span>
        {issueTone && <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: "50%", background: issueTone, flexShrink: 0 }} />}
        <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" style={{ flexShrink: 0, transform: open ? "rotate(180deg)" : undefined, transition: "transform 0.12s" }}>
          <path d="m2 3.5 3 3 3-3" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Profiles"
          style={{
            position: "absolute",
            right: 0,
            bottom: "calc(100% + 6px)",
            zIndex: 120,
            width: 280,
            maxWidth: "calc(100vw - 24px)",
            maxHeight: "min(420px, calc(100vh - 120px))",
            overflow: "auto",
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 9,
            boxShadow: "0 -4px 18px rgba(0,0,0,0.14)",
            padding: 4,
            color: "var(--text)",
          }}
        >
          <div style={{ padding: "7px 9px 6px" }}>
            <div style={{ fontSize: 12, fontWeight: 650 }}>Profile</div>
            {capabilitySummary && <div style={{ marginTop: 2, color: "var(--text-dim)", fontSize: 10 }}>{capabilitySummary}</div>}
          </div>

          <div style={{ display: "grid", gap: 1 }}>
            {mode === "new" && (
              <button type="button" role="menuitemradio" aria-checked={!selectedProfileRef} disabled={disableSelect} onClick={() => selectProfile(null)} style={optionStyle(!selectedProfileRef, disableSelect)}>
                {!selectedProfileRef
                  ? <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}><polyline points="1.5 5 4 7.5 8.5 2.5" /></svg>
                  : <span style={{ width: 10, flexShrink: 0 }} />}
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block" }}>Default</span>
                  <span style={{ display: "block", color: "var(--text-dim)", fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{globalDefault?.name ?? "Server default"}</span>
                </span>
              </button>
            )}

            {mode === "existing" && !selectedProfileRef && (
              <div style={optionStyle(true, true)}>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}><polyline points="1.5 5 4 7.5 8.5 2.5" /></svg>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{displayName}</span>
              </div>
            )}

            {selectedProfileMissing && selectedProfileRef && (
              <div style={optionStyle(true, true)}>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}><polyline points="1.5 5 4 7.5 8.5 2.5" /></svg>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{displayName}</span>
              </div>
            )}

            {profiles.map((profile) => {
              const active = selectedProfileRef === profile.id;
              return (
                <button key={profile.id} type="button" role="menuitemradio" aria-checked={active} disabled={disableSelect} onClick={() => selectProfile(profile.id)} style={optionStyle(active, disableSelect)}>
                  {active
                    ? <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}><polyline points="1.5 5 4 7.5 8.5 2.5" /></svg>
                    : <span style={{ width: 10, flexShrink: 0 }} />}
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{profile.name}</span>
                  {globalDefaultProfileRef === profile.id && <span style={{ color: "var(--text-dim)", fontSize: 10 }}>default</span>}
                </button>
              );
            })}
          </div>

          {(summary || error || setupWarnings.length > 0) && (
            <details style={{ marginTop: 4, borderTop: "1px solid var(--border)", padding: "6px 9px 2px" }}>
              <summary style={{ cursor: "pointer", color: hasError ? ERROR_COLOR : summary ? WARNING_COLOR : "var(--text-muted)", fontSize: 11 }}>{error ? "Profile error" : summary ?? "Profile setup"}</summary>
              <div style={{ display: "grid", gap: 5, marginTop: 7, paddingBottom: 4, fontSize: 11, lineHeight: 1.35 }}>
                {error && <div role="alert" style={{ color: ERROR_COLOR }}>{error}</div>}
                {conflicts.map((conflict) => <div key={`${conflict.name}:${conflict.pluginSource ?? "builtin"}`} style={{ color: "var(--text-muted)" }}><code>{conflict.name}</code> uses {conflict.pluginSource ?? conflict.selectedProvider}</div>)}
                {diagnostics.filter((diagnostic) => diagnostic.type !== "info").map((diagnostic) => (
                  <div key={`${diagnostic.type}:${diagnostic.source ?? ""}:${diagnostic.path ?? ""}:${diagnostic.message}`} style={{ color: diagnostic.type === "error" ? ERROR_COLOR : "var(--text-muted)" }}>{diagnostic.message}</div>
                ))}
                {setupWarnings.map((warning) => <div key={warning} style={{ color: "var(--text-muted)" }}>{warning}</div>)}
              </div>
            </details>
          )}

          <button
            type="button"
            onClick={() => { setOpen(false); onOpenManager(); }}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginTop: 4,
              padding: "8px 10px",
              border: "none",
              borderTop: "1px solid var(--border)",
              background: "transparent",
              color: "var(--text-muted)",
              cursor: "pointer",
              textAlign: "left",
              fontSize: 12,
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.1A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.1A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.1A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.14.38.36.72.66 1 .3.28.68.42 1.1.4h.1v4h-.1a1.7 1.7 0 0 0-1.76.6Z" />
            </svg>
            Manage profiles
          </button>
        </div>
      )}
    </div>
  );
}
