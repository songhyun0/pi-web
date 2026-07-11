"use client";

import { createPortal } from "react-dom";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { IconButton } from "./Button";
import { cx } from "./cx";

export type DialogVariant = "dialog" | "adaptive" | "sheet" | "fullscreen";
export type DialogSize = "sm" | "md" | "lg" | "xl";

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  variant?: DialogVariant;
  size?: DialogSize;
  closeLabel?: string;
  dismissible?: boolean;
  hideClose?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  className?: string;
  bodyClassName?: string;
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
  "[contenteditable='true']",
].join(",");

let bodyLockCount = 0;
let bodyOverflowBeforeLock = "";
const openDialogStack: string[] = [];

function lockBody(): void {
  if (bodyLockCount === 0) {
    bodyOverflowBeforeLock = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  bodyLockCount += 1;
}

function unlockBody(): void {
  bodyLockCount = Math.max(0, bodyLockCount - 1);
  if (bodyLockCount === 0) document.body.style.overflow = bodyOverflowBeforeLock;
}

function removeFromStack(id: string): void {
  const index = openDialogStack.lastIndexOf(id);
  if (index >= 0) openDialogStack.splice(index, 1);
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  variant = "dialog",
  size = "md",
  closeLabel = "Close dialog",
  dismissible = true,
  hideClose = false,
  initialFocusRef,
  className,
  bodyClassName,
}: DialogProps) {
  const [mounted, setMounted] = useState(false);
  const generatedId = useId();
  const instanceId = `pi-dialog-${generatedId}`;
  const titleId = `${instanceId}-title`;
  const descriptionId = description ? `${instanceId}-description` : undefined;
  const panelRef = useRef<HTMLDivElement>(null);
  const onOpenChangeRef = useRef(onOpenChange);
  const dismissibleRef = useRef(dismissible);
  const initialFocusTargetRef = useRef(initialFocusRef);
  onOpenChangeRef.current = onOpenChange;
  dismissibleRef.current = dismissible;
  initialFocusTargetRef.current = initialFocusRef;

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    openDialogStack.push(instanceId);
    lockBody();

    const focusFrame = window.requestAnimationFrame(() => {
      const preferred = initialFocusTargetRef.current?.current;
      const firstFocusable = panelRef.current?.querySelector<HTMLElement>(".pi-dialog__body")?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
        ?? panelRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (preferred ?? firstFocusable ?? panelRef.current)?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (openDialogStack[openDialogStack.length - 1] !== instanceId) return;
      if (event.key === "Escape" && dismissibleRef.current) {
        event.preventDefault();
        onOpenChangeRef.current(false);
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;

      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        .filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
      if (focusable.length === 0) {
        event.preventDefault();
        panelRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
      removeFromStack(instanceId);
      unlockBody();
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [instanceId, open]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="pi-dialog"
      data-variant={variant}
      role="presentation"
      onPointerDown={(event) => {
        if (dismissible && event.target === event.currentTarget && openDialogStack[openDialogStack.length - 1] === instanceId) {
          onOpenChange(false);
        }
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className={cx("pi-dialog__panel", className)}
        data-size={size}
      >
        <header className="pi-dialog__header">
          <div className="pi-dialog__heading">
            <h2 id={titleId} className="pi-dialog__title">{title}</h2>
            {description && <p id={descriptionId} className="pi-dialog__description">{description}</p>}
          </div>
          {!hideClose && dismissible && (
            <IconButton
              label={closeLabel}
              size="compact"
              onClick={() => onOpenChange(false)}
              disabled={!dismissible}
              className="pi-dialog__close"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="18" y1="6" x2="6" y2="18" />
              </svg>
            </IconButton>
          )}
        </header>
        <div className={cx("pi-dialog__body", bodyClassName)}>{children}</div>
        {footer && <footer className="pi-dialog__footer">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
