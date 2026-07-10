"use client";

import type { ProfileDefinition, ProfileRef } from "@/lib/profiles";
import type { CapabilitySnapshotV1, ProfileDiagnostic, ToolConflict } from "@/lib/session-profile-store";
import type { RuntimeToolMetadata } from "@/lib/profile-runtime";

function issueLabel(diagnostics: ProfileDiagnostic[], conflicts: ToolConflict[]): string | null {
  if (diagnostics.length === 0 && conflicts.length === 0) return null;
  const parts = [];
  if (conflicts.length) parts.push(`${conflicts.length} conflict${conflicts.length === 1 ? "" : "s"}`);
  if (diagnostics.length) parts.push(`${diagnostics.length} diagnostic${diagnostics.length === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

function chipStyle(tone: "warning" | "error" | "info") {
  const color = tone === "error" ? "var(--danger)" : tone === "warning" ? "var(--warning)" : "var(--text-muted)";
  return {
    border: `1px solid color-mix(in srgb, ${color} 55%, transparent)`,
    color,
    borderRadius: 999,
    padding: "1px 6px",
    fontSize: 10,
    fontFamily: "var(--font-mono)",
  };
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
  const summary = issueLabel(diagnostics, conflicts);
  const disableSelect = disabled || applying;
  const selectedProfileMissing = Boolean(selectedProfileRef && !profiles.some((profile) => profile.id === selectedProfileRef));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
      <label style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }} title={summary ?? displayName}>
        <span style={{ color: "var(--text-dim)", fontSize: 11 }}>Profile</span>
        <select
          aria-label="Session capability profile"
          value={selectedProfileRef ?? ""}
          disabled={disableSelect}
          onChange={(event) => void onSelectProfile(event.target.value ? event.target.value as ProfileRef : null)}
          style={{
            maxWidth: 190,
            height: 30,
            border: "1px solid var(--border)",
            borderRadius: 8,
            background: disableSelect ? "var(--bg-hover)" : "var(--bg)",
            color: disableSelect ? "var(--text-dim)" : "var(--text)",
            fontSize: 12,
            padding: "0 8px",
          }}
        >
          {mode === "new" && <option value="">Use global default{globalDefaultProfileRef ? "" : " (server)"}</option>}
          {mode === "existing" && !selectedProfileRef && <option value="">{displayName}</option>}
          {selectedProfileMissing && selectedProfileRef && <option value={selectedProfileRef}>{displayName}</option>}
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>{profile.name}</option>
          ))}
        </select>
      </label>
      {conflicts.length > 0 && <span style={chipStyle("warning")}>conflict</span>}
      {diagnostics.some((diagnostic) => diagnostic.type === "error") && <span style={chipStyle("error")}>error</span>}
      {diagnostics.some((diagnostic) => diagnostic.type !== "error") && <span style={chipStyle("warning")}>warn</span>}
      {setupWarnings.length > 0 && <span style={chipStyle("warning")}>setup</span>}
      {error && <span role="alert" style={{ color: "var(--danger)", fontSize: 11, maxWidth: 320 }}>{error}</span>}
      <details style={{ position: "relative" }}>
        <summary style={{ cursor: "pointer", color: "var(--text-muted)", fontSize: 12, listStyle: "none" }}>Details</summary>
        <div style={{
          position: "absolute",
          right: 0,
          bottom: "calc(100% + 8px)",
          zIndex: 120,
          width: 340,
          maxHeight: 360,
          overflow: "auto",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
          padding: 12,
          color: "var(--text)",
          fontSize: 12,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>{displayName}</div>
          {mode === "new" && !selectedProfileRef && <div style={{ color: "var(--text-muted)", marginBottom: 8 }}>No explicit profile selected; the server global default will be used.</div>}
          {effectiveSnapshot && <div style={{ color: "var(--text-muted)", marginBottom: 8 }}>Snapshot {effectiveSnapshot.snapshotId}</div>}
          {setupWarnings.length > 0 && <div style={{ marginBottom: 10 }}>
            <div style={{ fontWeight: 600, color: "var(--warning)", marginBottom: 4 }}>Profile setup</div>
            {setupWarnings.map((warning) => <div key={warning} style={{ color: "var(--warning)", marginBottom: 5 }}>{warning}</div>)}
          </div>}
          {conflicts.length > 0 && <div style={{ marginBottom: 10 }}>
            <div style={{ fontWeight: 600, color: "var(--warning)", marginBottom: 4 }}>Tool conflicts</div>
            {conflicts.map((conflict) => (
              <div key={`${conflict.name}:${conflict.pluginSource ?? "builtin"}:${conflict.message}`} style={{ marginBottom: 5 }}>
                <span style={{ fontFamily: "var(--font-mono)" }}>{conflict.name}</span>: {conflict.message}
              </div>
            ))}
          </div>}
          {diagnostics.length > 0 && <div style={{ marginBottom: 10 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Diagnostics</div>
            {diagnostics.map((diagnostic) => (
              <div key={`${diagnostic.type}:${diagnostic.source ?? ""}:${diagnostic.path ?? ""}:${diagnostic.message}`} style={{ marginBottom: 5, color: diagnostic.type === "error" ? "var(--danger)" : diagnostic.type === "warning" ? "var(--warning)" : "var(--text-muted)" }}>
                <span style={{ textTransform: "uppercase", fontSize: 10 }}>{diagnostic.type}</span> {diagnostic.message}
                {(diagnostic.source || diagnostic.path) && <div style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 10 }}>{diagnostic.source}{diagnostic.path ? ` · ${diagnostic.path}` : ""}</div>}
              </div>
            ))}
          </div>}
          {runtimeTools.length > 0 && <div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Runtime tools</div>
            {runtimeTools.slice(0, 12).map((tool) => (
              <div key={`${tool.name}-${tool.provenance}`} style={{ display: "flex", justifyContent: "space-between", gap: 8, color: tool.active ? "var(--text)" : "var(--text-dim)" }}>
                <span>{tool.name}</span>
                <span>{tool.active ? "active" : "off"} · {tool.selectedProvider ?? tool.provenance}{tool.conflict ? " · conflict" : ""}</span>
              </div>
            ))}
          </div>}
          {!summary && setupWarnings.length === 0 && diagnostics.length === 0 && conflicts.length === 0 && <div style={{ color: "var(--text-muted)" }}>No profile diagnostics or tool conflicts.</div>}
          {error && <div style={{ color: "var(--danger)", marginTop: 8 }}>{error}</div>}
        </div>
      </details>
      <button
        type="button"
        onClick={onOpenManager}
        style={{ border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text-muted)", borderRadius: 8, height: 30, padding: "0 8px", fontSize: 12 }}
      >
        Manage
      </button>
      {applying && <span style={{ color: "var(--text-dim)", fontSize: 11 }}>Applying…</span>}
    </div>
  );
}
