"use client";

import { type AriaAttributes, type KeyboardEventHandler, useEffect, useState } from "react";
import { IconButton, Input } from "@/components/ui";
import styles from "../ModelsConfig.module.css";

export function SecretInput({
  value,
  onChange,
  placeholder,
  onKeyDown,
  disabled = false,
  autoComplete = "off",
  id,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
  disabled?: boolean;
  autoComplete?: string;
  id?: string;
} & Pick<AriaAttributes, "aria-describedby" | "aria-invalid">) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!value) setVisible(false);
  }, [value]);

  return (
    <div className={styles.secretInput}>
      <Input
        id={id}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        type={visible ? "text" : "password"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        autoComplete={autoComplete}
        spellCheck={false}
        mono
        disabled={disabled}
        className={styles.secretInputControl}
      />
      <IconButton
        type="button"
        variant="ghost"
        size="compact"
        label={visible ? "Hide API key" : "Show API key"}
        onClick={() => setVisible((current) => !current)}
        disabled={disabled}
        className={styles.secretToggle}
      >
        {visible ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20C7 20 2.73 16.89 1 12a18.45 18.45 0 0 1 5.06-6.94" />
            <path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c5 0 9.27 3.11 11 8a18.5 18.5 0 0 1-2.16 3.19" />
            <path d="M14.12 14.12A3 3 0 0 1 9.88 9.88" />
            <path d="M1 1l22 22" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12Z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </IconButton>
    </div>
  );
}
