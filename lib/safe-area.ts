export const SAFE_AREA_TOP = "env(safe-area-inset-top, 0px)";
export const SAFE_AREA_RIGHT = "env(safe-area-inset-right, 0px)";
export const SAFE_AREA_BOTTOM = "env(safe-area-inset-bottom, 0px)";
export const SAFE_AREA_LEFT = "env(safe-area-inset-left, 0px)";

export const SAFE_AREA_MODAL_MARGIN = "8px";

export const SAFE_AREA_MODAL_PADDING = `calc(${SAFE_AREA_MODAL_MARGIN} + ${SAFE_AREA_TOP}) calc(${SAFE_AREA_MODAL_MARGIN} + ${SAFE_AREA_RIGHT}) calc(${SAFE_AREA_MODAL_MARGIN} + ${SAFE_AREA_BOTTOM}) calc(${SAFE_AREA_MODAL_MARGIN} + ${SAFE_AREA_LEFT})`;
export const SAFE_AREA_MODAL_MAX_HEIGHT = `calc(100dvh - ${SAFE_AREA_TOP} - ${SAFE_AREA_BOTTOM} - 16px)`;
export const SAFE_AREA_MODAL_MAX_WIDTH = `calc(100vw - ${SAFE_AREA_LEFT} - ${SAFE_AREA_RIGHT} - 16px)`;

const SAFE_AREA_CUSTOM_PROPERTY = {
  top: "--pi-safe-area-top",
  right: "--pi-safe-area-right",
  bottom: "--pi-safe-area-bottom",
  left: "--pi-safe-area-left",
} as const;

export function readSafeAreaInsetPx(edge: keyof typeof SAFE_AREA_CUSTOM_PROPERTY): number {
  if (typeof window === "undefined") return 0;
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(SAFE_AREA_CUSTOM_PROPERTY[edge])
    .trim();
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}
