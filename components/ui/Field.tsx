"use client";

import {
  createContext,
  forwardRef,
  useContext,
  useId,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { cx } from "./cx";

interface FieldContextValue {
  id: string;
  describedBy?: string;
  invalid: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

export interface FieldProps {
  id?: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  optional?: boolean;
  children: ReactNode;
  className?: string;
}

export function Field({ id, label, hint, error, optional = false, children, className }: FieldProps) {
  const generatedId = useId();
  const controlId = id ?? `pi-field-${generatedId}`;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <FieldContext.Provider value={{ id: controlId, describedBy, invalid: Boolean(error) }}>
      <div className={cx("pi-field", className)}>
        <label className="pi-field__label" htmlFor={controlId}>
          <span>{label}</span>
          {optional && <span className="pi-field__optional">Optional</span>}
        </label>
        {children}
        {hint && <div id={hintId} className="pi-field__hint">{hint}</div>}
        {error && (
          <div id={errorId} className="pi-field__error" role="alert">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>{error}</span>
          </div>
        )}
      </div>
    </FieldContext.Provider>
  );
}

function useControlAccessibility(props: { id?: string; "aria-describedby"?: string; "aria-invalid"?: InputHTMLAttributes<HTMLInputElement>["aria-invalid"] }) {
  const field = useContext(FieldContext);
  const describedBy = [field?.describedBy, props["aria-describedby"]].filter(Boolean).join(" ") || undefined;
  return {
    id: props.id ?? field?.id,
    "aria-describedby": describedBy,
    "aria-invalid": props["aria-invalid"] ?? (field?.invalid || undefined),
  };
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  mono?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ className, mono = false, ...props }, ref) {
  const accessibility = useControlAccessibility(props);
  return <input {...props} {...accessibility} ref={ref} className={cx("pi-input", mono && "pi-control--mono", className)} />;
});

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  mono?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ className, mono = false, children, ...props }, ref) {
  const accessibility = useControlAccessibility(props);
  return (
    <select {...props} {...accessibility} ref={ref} className={cx("pi-select", mono && "pi-control--mono", className)}>
      {children}
    </select>
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  mono?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ className, mono = false, ...props }, ref) {
  const accessibility = useControlAccessibility(props);
  return <textarea {...props} {...accessibility} ref={ref} className={cx("pi-textarea", mono && "pi-control--mono", className)} />;
});

export interface SwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange" | "children"> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
}

export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(function Switch({
  checked,
  onCheckedChange,
  label,
  description,
  className,
  disabled,
  type = "button",
  ...props
}, ref) {
  return (
    <button
      {...props}
      ref={ref}
      type={type}
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={(event) => {
        props.onClick?.(event);
        if (!event.defaultPrevented) onCheckedChange(!checked);
      }}
      className={cx("pi-switch", className)}
    >
      <span className="pi-switch__copy">
        <span className="pi-switch__label">{label}</span>
        {description && <span className="pi-switch__description">{description}</span>}
      </span>
      <span className="pi-switch__track" aria-hidden="true">
        <span className="pi-switch__thumb" />
      </span>
    </button>
  );
});
