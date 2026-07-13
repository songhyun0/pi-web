"use client";

import { type RefObject, useEffect, useState, useSyncExternalStore } from "react";

export const PHONE_MAX_WIDTH = 640;
export const COMPACT_MAX_WIDTH = 1024;
export const CENTER_COMPACT_MAX_WIDTH = 720;
export const DESKTOP_CENTER_MIN_WIDTH = 480;
export const SIDEBAR_MIN_WIDTH = 240;
export const SIDEBAR_MAX_WIDTH = 520;
export const RIGHT_PANEL_MIN_WIDTH = 300;
export const RIGHT_PANEL_MAX_WIDTH = 960;

export type ViewportTier = "phone" | "compact" | "desktop";
export type CenterChromeDensity = "compact" | "desktop";
export type ShellPanelWidths = { sidebar: number; right: number };

const PHONE_QUERY = `(max-width: ${PHONE_MAX_WIDTH}px)`;
const COMPACT_QUERY = `(max-width: ${COMPACT_MAX_WIDTH}px)`;

function clampPanelWidth(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.round(value), min), Math.max(min, max));
}

function getBasePanelMaxWidths(viewportWidth: number): ShellPanelWidths {
  if (viewportWidth <= COMPACT_MAX_WIDTH) {
    return { sidebar: SIDEBAR_MAX_WIDTH, right: RIGHT_PANEL_MAX_WIDTH };
  }
  const panelBudget = Math.max(0, viewportWidth - DESKTOP_CENTER_MIN_WIDTH);
  return {
    sidebar: Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, Math.floor(viewportWidth * 0.5), panelBudget)),
    right: Math.max(RIGHT_PANEL_MIN_WIDTH, Math.min(RIGHT_PANEL_MAX_WIDTH, Math.floor(viewportWidth * 0.75), panelBudget)),
  };
}

export function getDesktopPanelMaxWidths(
  viewportWidth: number,
  widths: ShellPanelWidths,
  sidebarOpen: boolean,
  rightPanelOpen: boolean,
): ShellPanelWidths {
  const base = getBasePanelMaxWidths(viewportWidth);
  if (viewportWidth <= COMPACT_MAX_WIDTH || !sidebarOpen || !rightPanelOpen) return base;
  const panelBudget = viewportWidth - DESKTOP_CENTER_MIN_WIDTH;
  return {
    sidebar: Math.max(SIDEBAR_MIN_WIDTH, Math.min(base.sidebar, panelBudget - widths.right)),
    right: Math.max(RIGHT_PANEL_MIN_WIDTH, Math.min(base.right, panelBudget - widths.sidebar)),
  };
}

export function fitDesktopPanelWidths(
  viewportWidth: number,
  widths: ShellPanelWidths,
  sidebarOpen: boolean,
  rightPanelOpen: boolean,
): ShellPanelWidths {
  const base = getBasePanelMaxWidths(viewportWidth);
  let sidebar = clampPanelWidth(widths.sidebar, SIDEBAR_MIN_WIDTH, base.sidebar);
  let right = clampPanelWidth(widths.right, RIGHT_PANEL_MIN_WIDTH, base.right);
  if (viewportWidth <= COMPACT_MAX_WIDTH || !sidebarOpen || !rightPanelOpen) return { sidebar, right };

  const panelBudget = viewportWidth - DESKTOP_CENTER_MIN_WIDTH;
  let excess = Math.max(0, sidebar + right - panelBudget);
  const rightReduction = Math.min(excess, right - RIGHT_PANEL_MIN_WIDTH);
  right -= rightReduction;
  excess -= rightReduction;
  const sidebarReduction = Math.min(excess, sidebar - SIDEBAR_MIN_WIDTH);
  sidebar -= sidebarReduction;
  return { sidebar, right };
}

export function getCenterChromeDensity(width: number | null): CenterChromeDensity {
  return width !== null && width <= CENTER_COMPACT_MAX_WIDTH ? "compact" : "desktop";
}

export function useObservedElementWidth<T extends HTMLElement>(ref: RefObject<T | null>): number | null {
  const [width, setWidth] = useState<number | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => {
      const nextWidth = Math.round(element.getBoundingClientRect().width);
      setWidth((current) => current === nextWidth ? current : nextWidth);
    };
    update();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return width;
}

function subscribe(listener: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const phone = window.matchMedia(PHONE_QUERY);
  const compact = window.matchMedia(COMPACT_QUERY);
  phone.addEventListener("change", listener);
  compact.addEventListener("change", listener);
  return () => {
    phone.removeEventListener("change", listener);
    compact.removeEventListener("change", listener);
  };
}

function getSnapshot(): ViewportTier {
  if (typeof window === "undefined" || !window.matchMedia) return "desktop";
  if (window.matchMedia(PHONE_QUERY).matches) return "phone";
  if (window.matchMedia(COMPACT_QUERY).matches) return "compact";
  return "desktop";
}

function getServerSnapshot(): ViewportTier {
  return "desktop";
}

export function useViewportTier(): ViewportTier {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
