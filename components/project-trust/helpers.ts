import type {
  ProjectTrustAction,
  ProjectTrustEffectiveSource,
  ProjectTrustEffectiveState,
  ProjectTrustInventoryItem,
} from "@/lib/project-trust";

export type TrustTone = "success" | "warning" | "danger" | "neutral";

export function shortenTrustPath(value: string): string {
  return value.replace(/^\/(?:Users|home)\/[^/]+/, "~");
}

export function effectiveTrustSummary(effective: ProjectTrustEffectiveState): {
  title: string;
  eyebrow: string;
  tone: TrustTone;
} {
  if (effective.trusted) {
    return {
      title: "Trusted",
      eyebrow: effective.source === "noProjectResources" ? "No decision required" : "Project resources enabled",
      tone: "success",
    };
  }
  if (effective.promptRequired) {
    return { title: "Decision required", eyebrow: "Project resources paused", tone: "warning" };
  }
  return { title: "Not trusted", eyebrow: "Project resources blocked", tone: "danger" };
}

export function trustSourceLabel(source: ProjectTrustEffectiveSource): string {
  if (source === "saved") return "Saved for this project";
  if (source === "inherited") return "Inherited from a parent folder";
  if (source === "defaultProjectTrust") return "Runtime default";
  if (source === "noProjectResources") return "No local resources detected";
  return "Awaiting a decision";
}

export function trustActionTone(action: ProjectTrustAction): TrustTone {
  if (action === "trust" || action === "trust-parent") return "success";
  if (action === "deny") return "danger";
  return "neutral";
}

export function trustActionConfirmation(action: ProjectTrustAction): string {
  if (action === "trust-parent") return "Trust parent folder";
  if (action === "trust") return "Trust project";
  if (action === "deny") return "Block project";
  return "Clear decision";
}

export function trustDecisionLabel(decision: boolean | null): string {
  if (decision === true) return "Trust";
  if (decision === false) return "Block";
  return "Remove saved decision";
}

export function trustResourceSummary(entry: ProjectTrustInventoryItem): string {
  if (entry.count === 0) return "Detected";
  return `${entry.count} item${entry.count === 1 ? "" : "s"}`;
}
