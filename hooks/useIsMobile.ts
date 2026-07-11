"use client";

import { useViewportTier } from "./useViewportTier";

/**
 * Backwards-compatible phone breakpoint helper.
 * New responsive work should prefer useViewportTier() so compact/tablet layouts
 * do not collapse into either the phone or desktop experience.
 */
export function useIsMobile(): boolean {
  return useViewportTier() === "phone";
}
