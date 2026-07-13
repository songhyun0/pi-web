import type { MouseEventHandler } from "react";

export interface OpenAIFastControlState {
  active: boolean;
  unavailable: boolean;
  compactState: "Unavailable" | "On" | "Off";
}

export function deriveOpenAIFastControlState(
  eligible: boolean | undefined,
  modeActive: boolean | undefined,
): OpenAIFastControlState {
  const unavailable = eligible === false;
  const active = !unavailable && modeActive === true;

  return {
    active,
    unavailable,
    compactState: unavailable ? "Unavailable" : active ? "On" : "Off",
  };
}

interface OpenAIFastCompactControlProps {
  state: OpenAIFastControlState;
  disabled?: boolean;
  onToggle: MouseEventHandler<HTMLButtonElement>;
  classNames?: {
    control?: string;
    executionLabel?: string;
    toggleState?: string;
  };
}

export function OpenAIFastCompactControl({
  state,
  disabled = false,
  onToggle,
  classNames,
}: OpenAIFastCompactControlProps) {
  return (
    <button
      type="button"
      className={classNames?.control}
      data-kind="toggle"
      data-active={state.active || undefined}
      onClick={onToggle}
      disabled={disabled || state.unavailable}
      aria-label={`OpenAI Fast — ${state.compactState}`}
      aria-pressed={state.active}
    >
      <span className={classNames?.executionLabel}>OpenAI Fast</span>
      <span className={classNames?.toggleState} data-checked={state.active || undefined} aria-hidden="true" />
    </button>
  );
}
