"use client";

import { useEffect, useMemo, useState } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { APP_DISPLAY_NAME_MAX_LENGTH, type AppSettings, DEFAULT_APP_SETTINGS } from "@/lib/app-settings";
import { SAFE_AREA_MODAL_MAX_HEIGHT, SAFE_AREA_MODAL_MAX_WIDTH, SAFE_AREA_MODAL_PADDING } from "@/lib/safe-area";

interface Props {
  settings: AppSettings;
  onClose: () => void;
  onSaved: (settings: AppSettings) => void;
}

function normalizeInput(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function SettingsModal({ settings, onClose, onSaved }: Props) {
  const isMobile = useIsMobile();
  const [displayName, setDisplayName] = useState(settings.displayName);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setDisplayName(settings.displayName);
    setSaveError(null);
  }, [settings.displayName]);

  const normalizedDisplayName = useMemo(() => normalizeInput(displayName), [displayName]);
  const validationError = useMemo(() => {
    if (!normalizedDisplayName) return "Display name cannot be empty.";
    if (normalizedDisplayName.length > APP_DISPLAY_NAME_MAX_LENGTH) {
      return `Display name must be ${APP_DISPLAY_NAME_MAX_LENGTH} characters or fewer.`;
    }
    return null;
  }, [normalizedDisplayName]);
  const changed = normalizedDisplayName !== settings.displayName;

  const handleSave = async () => {
    if (saving) return;
    if (validationError) {
      setSaveError(validationError);
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/app-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: normalizedDisplayName }),
      });
      const data = await res.json() as AppSettings | { error?: string };
      if (!res.ok) {
        throw new Error("error" in data && data.error ? data.error : `HTTP ${res.status}`);
      }
      onSaved(data as AppSettings);
      onClose();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", padding: SAFE_AREA_MODAL_PADDING, boxSizing: "border-box" }}
    >
      <button
        type="button"
        aria-label="Close settings"
        onClick={onClose}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", padding: 0, border: "none", background: "transparent", cursor: "default" }}
      />
      <div style={{ position: "relative", width: isMobile ? "100%" : 560, maxWidth: isMobile ? "100%" : SAFE_AREA_MODAL_MAX_WIDTH, maxHeight: SAFE_AREA_MODAL_MAX_HEIGHT, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, display: "flex", flexDirection: "column", boxShadow: "0 8px 32px rgba(0,0,0,0.18)", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>Settings</span>
            <code style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>~/.pi/agent/web-settings.json</code>
          </div>
          <button type="button" onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 20, lineHeight: 1, padding: "2px 6px" }}>×</button>
        </div>

        <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 18 }}>
          <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>General</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>Customize the display name shown in the sidebar, new-session welcome screen, and browser title.</div>
            </div>

            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500 }}>App display name</span>
              <input
                value={displayName}
                onChange={(e) => { setDisplayName(e.target.value); setSaveError(null); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void handleSave();
                  if (e.key === "Escape") onClose();
                }}
                maxLength={APP_DISPLAY_NAME_MAX_LENGTH * 2}
                style={{ padding: "8px 10px", background: "var(--bg-panel)", border: `1px solid ${saveError || validationError ? "#f87171" : "var(--border)"}`, borderRadius: 6, color: "var(--text)", fontSize: 13, outline: "none", width: "100%", boxSizing: "border-box" }}
              />
            </label>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <span style={{ fontSize: 11, color: validationError ? "#f87171" : "var(--text-dim)" }}>
                {validationError ?? `${normalizedDisplayName.length}/${APP_DISPLAY_NAME_MAX_LENGTH} characters`}
              </span>
              <button
                type="button"
                onClick={() => { setDisplayName(DEFAULT_APP_SETTINGS.displayName); setSaveError(null); }}
                style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 12, padding: 0 }}
              >
                Reset to default
              </button>
            </div>
          </section>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10, padding: "10px 18px", borderTop: "1px solid var(--border)", flexShrink: 0 }}>
          {saveError && <span style={{ fontSize: 12, color: "#f87171", flex: 1 }}>{saveError}</span>}
          <button type="button" onClick={onClose} style={{ padding: "6px 14px", background: "none", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-muted)", cursor: "pointer", fontSize: 13 }}>
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || Boolean(validationError) || !changed}
            style={{ padding: "6px 14px", background: changed && !validationError ? "var(--accent)" : "var(--bg-hover)", border: "1px solid var(--border)", borderRadius: 6, color: changed && !validationError ? "white" : "var(--text-muted)", cursor: saving || validationError || !changed ? "default" : "pointer", fontSize: 13, opacity: saving ? 0.7 : 1 }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
