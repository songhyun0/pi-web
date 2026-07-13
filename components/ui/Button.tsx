import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cx } from "./cx";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ControlSize = "compact" | "default" | "touch";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ControlSize;
  loading?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
}

function LoadingGlyph() {
  return <span className="pi-loading-glyph" aria-hidden="true" />;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({
  variant = "secondary",
  size = "default",
  loading = false,
  leadingIcon,
  trailingIcon,
  className,
  children,
  disabled,
  type = "button",
  ...props
}, ref) {
  const unavailable = disabled || loading;
  return (
    <button
      {...props}
      ref={ref}
      type={type}
      disabled={unavailable}
      aria-busy={loading || undefined}
      className={cx("pi-button", className)}
      data-variant={variant}
      data-size={size}
    >
      {loading ? <LoadingGlyph /> : leadingIcon ? <span className="pi-button__icon" aria-hidden="true">{leadingIcon}</span> : null}
      <span className="pi-button__label">{children}</span>
      {!loading && trailingIcon ? <span className="pi-button__icon" aria-hidden="true">{trailingIcon}</span> : null}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label"> {
  label: string;
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ControlSize;
  loading?: boolean;
  selected?: boolean;
  /** Optional native title tooltip. Accessible naming always comes from `label`. */
  tooltip?: string | false;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({
  label,
  variant = "ghost",
  size = "default",
  loading = false,
  selected = false,
  tooltip,
  className,
  disabled,
  title,
  type = "button",
  children,
  ...props
}, ref) {
  const unavailable = disabled || loading;
  const pressed = props["aria-pressed"] ?? (selected ? true : undefined);
  return (
    <button
      {...props}
      ref={ref}
      type={type}
      disabled={unavailable}
      aria-label={label}
      aria-busy={loading || undefined}
      aria-pressed={pressed}
      title={tooltip === false ? undefined : tooltip ?? title}
      className={cx("pi-icon-button", className)}
      data-variant={variant}
      data-size={size}
      data-selected={selected || undefined}
    >
      {loading ? <LoadingGlyph /> : children}
    </button>
  );
});
