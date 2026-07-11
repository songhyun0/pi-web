import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

export type FeedbackTone = "neutral" | "accent" | "success" | "warning" | "danger";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: FeedbackTone;
}

export function Badge({ tone = "neutral", className, children, ...props }: BadgeProps) {
  return <span {...props} className={cx("pi-badge", className)} data-tone={tone}>{children}</span>;
}

function ToneIcon({ tone }: { tone: FeedbackTone }) {
  if (tone === "success") {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10" /><polyline points="8 12 11 15 16 9" /></svg>;
  }
  if (tone === "warning") {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10.3 3.6 2.5 17.1A2 2 0 0 0 4.2 20h15.6a2 2 0 0 0 1.7-2.9L13.7 3.6a2 2 0 0 0-3.4 0Z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>;
  }
  if (tone === "danger") {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>;
  }
  if (tone === "accent") {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>;
  }
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10" /></svg>;
}

export interface NoticeProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  tone?: FeedbackTone;
  title?: ReactNode;
  actions?: ReactNode;
}

export function Notice({ tone = "neutral", title, actions, className, children, role, ...props }: NoticeProps) {
  const liveRole = role ?? (tone === "danger" ? "alert" : "status");
  return (
    <div {...props} className={cx("pi-notice", className)} data-tone={tone} role={liveRole}>
      <span className="pi-notice__icon"><ToneIcon tone={tone} /></span>
      <div className="pi-notice__content">
        {title && <div className="pi-notice__title">{title}</div>}
        <div className="pi-notice__message">{children}</div>
      </div>
      {actions && <div className="pi-notice__actions">{actions}</div>}
    </div>
  );
}

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}

export function EmptyState({ title, description, action, icon, className, ...props }: EmptyStateProps) {
  return (
    <div {...props} className={cx("pi-empty-state", className)}>
      {icon && <div className="pi-empty-state__icon" aria-hidden="true">{icon}</div>}
      <div className="pi-empty-state__title">{title}</div>
      {description && <div className="pi-empty-state__description">{description}</div>}
      {action && <div className="pi-empty-state__action">{action}</div>}
    </div>
  );
}

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  width?: string | number;
  height?: string | number;
}

export function Skeleton({ width, height, className, style, ...props }: SkeletonProps) {
  return (
    <div
      {...props}
      aria-hidden="true"
      className={cx("pi-skeleton", className)}
      style={{ width, height, ...style }}
    />
  );
}
