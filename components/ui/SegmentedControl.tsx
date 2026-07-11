"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "./cx";

export interface SegmentedOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
  ariaLabel?: string;
}

export interface SegmentedControlProps {
  value: string;
  options: SegmentedOption[];
  onValueChange: (value: string) => void;
  label: string;
  className?: string;
  fullWidth?: boolean;
}

export function SegmentedControl({ value, options, onValueChange, label, className, fullWidth = false }: SegmentedControlProps) {
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = options.findIndex((option) => option.value === value && !option.disabled);
  const fallbackIndex = options.findIndex((option) => !option.disabled);
  const focusableIndex = selectedIndex >= 0 ? selectedIndex : fallbackIndex;

  const moveSelection = (currentIndex: number, direction: 1 | -1) => {
    if (options.length === 0) return;
    for (let step = 1; step <= options.length; step++) {
      const nextIndex = (currentIndex + direction * step + options.length) % options.length;
      const option = options[nextIndex];
      if (option.disabled) continue;
      onValueChange(option.value);
      buttonRefs.current[nextIndex]?.focus();
      return;
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      moveSelection(index, 1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      moveSelection(index, -1);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const ordered = event.key === "Home" ? options : [...options].reverse();
      const option = ordered.find((candidate) => !candidate.disabled);
      if (!option) return;
      const nextIndex = options.indexOf(option);
      onValueChange(option.value);
      buttonRefs.current[nextIndex]?.focus();
    }
  };

  return (
    <fieldset className={cx("pi-segmented", fullWidth && "pi-segmented--full", className)}>
      <legend className="pi-sr-only">{label}</legend>
      {options.map((option, index) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            ref={(node) => { buttonRefs.current[index] = node; }}
            type="button"
            aria-pressed={active}
            aria-label={option.ariaLabel}
            disabled={option.disabled}
            tabIndex={index === focusableIndex ? 0 : -1}
            className="pi-segmented__option"
            onClick={() => onValueChange(option.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            {option.label}
          </button>
        );
      })}
    </fieldset>
  );
}
