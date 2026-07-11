import { IconButton } from "@/components/ui";
import type { SessionStatsInfo } from "@/lib/pi-types";
import styles from "../AppShell.module.css";

export type SessionCopyField = "file" | "id";

interface ContextUsage {
  percent: number | null;
  contextWindow: number;
  tokens: number | null;
}

interface Props {
  sessionStats: SessionStatsInfo | null;
  contextUsage: ContextUsage | null;
  copiedField: SessionCopyField | null;
  onCopy: (field: SessionCopyField, value: string) => void;
}

function formatCompact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}k`;
  return String(value);
}

function InfoSection({ title, rows, align = "left", compact = false }: {
  title: string;
  rows: string[][];
  align?: "left" | "right";
  compact?: boolean;
}) {
  return (
    <section className={styles.infoSection}>
      <h3 className={styles.infoSectionTitle}>{title}</h3>
      <div className={styles.infoRows} data-compact={compact || undefined}>
        {rows.map(([label, value]) => (
          <div key={`${title}:${label}`} className={styles.contents}>
            <span className={styles.infoLabel}>{label}</span>
            <span className={styles.infoValue} data-align={align}>{value}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function CopyIcon({ copied }: { copied: boolean }) {
  return copied ? (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ) : (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

export function SessionInfoPanel({ sessionStats, contextUsage, copiedField, onCopy }: Props) {
  if (!sessionStats) {
    return <div className={styles.panelEmpty}>Send a message or run /session to load session info</div>;
  }

  const sessionRows = [
    ...(sessionStats.sessionName ? [{ label: "Name", value: sessionStats.sessionName, copyField: null }] : []),
    { label: "File", value: sessionStats.sessionFile ?? "In-memory", copyField: "file" as const },
    { label: "ID", value: sessionStats.sessionId, copyField: "id" as const },
  ];
  const messageRows = [
    ["User", sessionStats.userMessages.toLocaleString()],
    ["Assistant", sessionStats.assistantMessages.toLocaleString()],
    ["Tool Calls", sessionStats.toolCalls.toLocaleString()],
    ["Tool Results", sessionStats.toolResults.toLocaleString()],
    ["Total", sessionStats.totalMessages.toLocaleString()],
  ];
  const tokenRows = [
    ["Input", sessionStats.tokens.input.toLocaleString()],
    ["Output", sessionStats.tokens.output.toLocaleString()],
    ...(sessionStats.tokens.cacheRead > 0 ? [["Cache Read", sessionStats.tokens.cacheRead.toLocaleString()]] : []),
    ...(sessionStats.tokens.cacheWrite > 0 ? [["Cache Write", sessionStats.tokens.cacheWrite.toLocaleString()]] : []),
    ["Total", sessionStats.tokens.total.toLocaleString()],
  ];
  const effectiveContext = contextUsage ?? sessionStats.contextUsage;
  const extraTokenRows = [
    ...(sessionStats.cost > 0 ? [["Cost", `$${sessionStats.cost.toFixed(4)}`]] : []),
    ...(effectiveContext?.contextWindow
      ? [["Context", `${effectiveContext.percent !== null ? `${effectiveContext.percent.toFixed(1)}%` : "?"} / ${formatCompact(effectiveContext.contextWindow)}`]]
      : []),
  ];

  return (
    <div className={styles.sessionInfo}>
      <div className={styles.sessionInfoGrid}>
        <section className={styles.infoSection}>
          <h3 className={styles.infoSectionTitle}>Session info</h3>
          <div className={styles.sessionRows}>
            {sessionRows.map((row) => {
              const copyField = row.copyField;
              const copied = copyField ? copiedField === copyField : false;
              return (
                <div key={`session:${row.label}`} className={styles.contents}>
                  <span className={styles.infoLabel}>{row.label}</span>
                  <span className={styles.infoValue}>{row.value}</span>
                  <span>
                    {copyField && (
                      <IconButton
                        label={copied ? "Copied" : `Copy ${copyField === "file" ? "file path" : "session ID"}`}
                        size="compact"
                        selected={copied}
                        className={styles.copyButton}
                        onClick={() => onCopy(copyField, row.value)}
                      >
                        <CopyIcon copied={copied} />
                      </IconButton>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
        <InfoSection title="Messages" rows={messageRows} />
        <InfoSection title="Tokens" rows={[...tokenRows, ...extraTokenRows]} align="right" compact />
      </div>
    </div>
  );
}
