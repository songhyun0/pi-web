"use client";

import { useEffect, useState } from "react";
import { buildWebKeybindings, type WebKeybinding } from "@/lib/web-keybindings";

interface KeybindingsResponse {
  path?: string;
  keybindings?: WebKeybinding[];
  error?: string;
}

export function HotkeysModal({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<KeybindingsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/keybindings", { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json() as KeybindingsResponse;
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        return body;
      })
      .then((body) => { if (!cancelled) setData(body); })
      .catch((error) => { if (!cancelled) setData({ error: error instanceof Error ? error.message : String(error), keybindings: buildWebKeybindings() }); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const keybindings = data?.keybindings ?? buildWebKeybindings();

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }} onClick={onClose}>
      <div onClick={(event) => event.stopPropagation()} style={{ width: "min(860px, 96vw)", maxHeight: "86vh", overflow: "hidden", border: "1px solid var(--border)", borderRadius: 12, background: "var(--bg)", boxShadow: "0 20px 60px rgba(0,0,0,0.35)", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text)" }}>Keyboard shortcuts</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>
              {data?.path ? `Loaded from ${data.path}` : "Default pi-web shortcuts"}
            </div>
          </div>
          <button onClick={onClose} style={{ border: "1px solid var(--border)", background: "var(--bg-panel)", color: "var(--text)", borderRadius: 8, padding: "6px 10px", cursor: "pointer" }}>Close</button>
        </div>
        {data?.error && (
          <div style={{ padding: "10px 16px", color: "var(--error)", background: "color-mix(in srgb, var(--error) 10%, transparent)", borderBottom: "1px solid var(--border)", fontSize: 12 }}>
            Failed to load custom keybindings: {data.error}
          </div>
        )}
        <div style={{ overflow: "auto", padding: 16 }}>
          {loading ? (
            <div style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading shortcuts…</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
                  <th style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>Action</th>
                  <th style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>Keys</th>
                  <th style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>Scope</th>
                  <th style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>Source</th>
                  <th style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {keybindings.map((binding) => (
                  <tr key={binding.action}>
                    <td style={{ padding: "9px 8px", borderBottom: "1px solid var(--border)", verticalAlign: "top" }}>
                      <div style={{ color: "var(--text)", fontWeight: 500 }}>{binding.label}</div>
                      <div style={{ color: "var(--text-dim)", fontSize: 11, marginTop: 2, fontFamily: "var(--font-mono)" }}>{binding.action}</div>
                      <div style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 4 }}>{binding.description}</div>
                    </td>
                    <td style={{ padding: "9px 8px", borderBottom: "1px solid var(--border)", verticalAlign: "top" }}>
                      {binding.keys.length ? binding.keys.map((key) => (
                        <kbd key={key} style={{ display: "inline-block", margin: "0 4px 4px 0", padding: "2px 6px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-panel)", color: "var(--text)", fontFamily: "var(--font-mono)", fontSize: 11 }}>{key}</kbd>
                      )) : <span style={{ color: "var(--text-dim)" }}>Unbound</span>}
                    </td>
                    <td style={{ padding: "9px 8px", borderBottom: "1px solid var(--border)", color: "var(--text-muted)", verticalAlign: "top" }}>{binding.scope}</td>
                    <td style={{ padding: "9px 8px", borderBottom: "1px solid var(--border)", color: "var(--text-muted)", verticalAlign: "top" }}>{binding.source}{binding.owner ? ` / ${binding.owner}` : ""}</td>
                    <td style={{ padding: "9px 8px", borderBottom: "1px solid var(--border)", verticalAlign: "top" }}>
                      <span style={{ color: binding.status === "active" ? "var(--success)" : binding.status === "browser-conflict" ? "var(--warning)" : "var(--text-dim)" }}>{binding.status}</span>
                      {binding.conflict && <div style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 4 }}>{binding.conflict}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
