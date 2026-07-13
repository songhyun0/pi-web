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
export type DialogHeight = "content" | "viewport";
export type DialogBodyLayout = "padded" | "flush";
export type DialogInitialFocus = "panel" | "first-tabbable";

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  variant?: DialogVariant;
  size?: DialogSize;
  height?: DialogHeight;
  bodyLayout?: DialogBodyLayout;
  closeLabel?: string;
  dismissible?: boolean;
  hideClose?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  initialFocus?: DialogInitialFocus;
  onEscapeKeyDown?: (event: KeyboardEvent) => void;
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

function isTabbable(element: HTMLElement, panel: HTMLElement): boolean {
  if (!element.isConnected || !panel.contains(element) || element.tabIndex < 0) return false;
  if (element.matches(":disabled") || element.getAttribute("aria-disabled") === "true") return false;
  if (element.closest("[hidden], [inert], [aria-hidden='true']")) return false;

  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    const style = window.getComputedStyle(current);
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false;
    if (current !== panel && Number.parseFloat(style.opacity) === 0) return false;
    if (current === panel) break;
  }

  return element.getClientRects().length > 0;
}

function getTabbableElements(panel: HTMLElement, root: ParentNode = panel): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((element) => isTabbable(element, panel));
}

function focusWithoutScroll(element: HTMLElement): void {
  element.focus({ preventScroll: true });
}

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
  height = "content",
  bodyLayout = "padded",
  closeLabel = "Close dialog",
  dismissible = true,
  hideClose = false,
  initialFocusRef,
  initialFocus = "panel",
  onEscapeKeyDown,
  className,
  bodyClassName,
}: DialogProps) {
  const [mounted, setMounted] = useState(false);
  const generatedId = useId();
  const instanceId = `pi-dialog-${generatedId}`;
  const titleId = `${instanceId}-title`;
  const descriptionId = description ? `${instanceId}-description` : undefined;
  const overlayRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const onOpenChangeRef = useRef(onOpenChange);
  const onEscapeKeyDownRef = useRef(onEscapeKeyDown);
  const dismissibleRef = useRef(dismissible);
  const initialFocusTargetRef = useRef(initialFocusRef);
  const initialFocusPolicyRef = useRef(initialFocus);
  onOpenChangeRef.current = onOpenChange;
  onEscapeKeyDownRef.current = onEscapeKeyDown;
  dismissibleRef.current = dismissible;
  initialFocusTargetRef.current = initialFocusRef;
  initialFocusPolicyRef.current = initialFocus;

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const visualViewport = window.visualViewport;
    openDialogStack.push(instanceId);
    lockBody();

    const updateViewport = () => {
      const overlay = overlayRef.current;
      if (!overlay) return;
      const viewportTop = visualViewport?.offsetTop ?? 0;
      const viewportLeft = visualViewport?.offsetLeft ?? 0;
      const viewportWidth = visualViewport?.width ?? window.innerWidth;
      const viewportHeight = visualViewport?.height ?? window.innerHeight;
      overlay.style.setProperty("--pi-dialog-viewport-top", `${Math.max(0, viewportTop)}px`);
      overlay.style.setProperty("--pi-dialog-viewport-left", `${Math.max(0, viewportLeft)}px`);
      overlay.style.setProperty("--pi-dialog-viewport-width", `${Math.max(1, viewportWidth)}px`);
      overlay.style.setProperty("--pi-dialog-viewport-height", `${Math.max(1, viewportHeight)}px`);
    };
    updateViewport();
    visualViewport?.addEventListener("resize", updateViewport);
    visualViewport?.addEventListener("scroll", updateViewport);
    window.addEventListener("resize", updateViewport);

    const focusFrame = window.requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;

      const preferred = initialFocusTargetRef.current?.current;
      const explicitTarget = preferred && isTabbable(preferred, panel) ? preferred : null;
      const body = panel.querySelector<HTMLElement>(".pi-dialog__body");
      const policyTarget = initialFocusPolicyRef.current === "first-tabbable"
        ? getTabbableElements(panel, body ?? panel)[0] ?? getTabbableElements(panel)[0]
        : null;
      focusWithoutScroll(explicitTarget ?? policyTarget ?? panel);
      updateViewport();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (openDialogStack[openDialogStack.length - 1] !== instanceId) return;
      if (event.key === "Escape") {
        onEscapeKeyDownRef.current?.(event);
        if (!event.defaultPrevented && dismissibleRef.current) {
          event.preventDefault();
          onOpenChangeRef.current(false);
        } else if (!event.defaultPrevented) {
          event.preventDefault();
        }
        event.stopImmediatePropagation();
        return;
      }
      const panel = panelRef.current;
      if (event.key !== "Tab" || !panel) return;

      const focusable = getTabbableElements(panel);
      if (focusable.length === 0) {
        event.preventDefault();
        focusWithoutScroll(panel);
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;
      const activeIsTabbable = activeElement instanceof HTMLElement && focusable.includes(activeElement);
      if (!activeIsTabbable) {
        event.preventDefault();
        focusWithoutScroll(event.shiftKey ? last : first);
      } else if (event.shiftKey && activeElement === first) {
        event.preventDefault();
        focusWithoutScroll(last);
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        focusWithoutScroll(first);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
      visualViewport?.removeEventListener("resize", updateViewport);
      visualViewport?.removeEventListener("scroll", updateViewport);
      window.removeEventListener("resize", updateViewport);
      removeFromStack(instanceId);
      unlockBody();
      if (previouslyFocused?.isConnected) focusWithoutScroll(previouslyFocused);
    };
  }, [instanceId, open]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      ref={overlayRef}
      className="pi-dialog"
      data-variant={variant}
      data-has-footer={Boolean(footer)}
      data-dialog-id={instanceId}
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
        data-height={height}
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
        <div className={cx("pi-dialog__body", bodyClassName)} data-layout={bodyLayout}>{children}</div>
        {footer && <footer className="pi-dialog__footer">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
