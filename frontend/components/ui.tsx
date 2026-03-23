"use client";

import { ReactNode } from "react";
import { useLocale } from "@/lib/locale-context";

// ── StatusDot ──
// The ONLY circular element in the design system.
// Semantic status indicator for agents, sessions, items, locations.

const DOT_VARIANTS: Record<string, string> = {
  acting:    "bg-primary shadow-[0_0_8px_var(--color-primary-glow-strong)]",
  dead:      "bg-danger shadow-[0_0_8px_theme(colors.danger.dim)]",
  idle:      "bg-t-dim",
  info:      "bg-info",
  warning:   "bg-warning",
  secondary: "bg-t-secondary",
  primary:   "bg-primary shadow-[0_0_8px_var(--color-primary-glow-strong)]",
  danger:    "bg-danger",
};

export function StatusDot({ status }: { status: string }) {
  return (
    <span
      className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${DOT_VARIANTS[status] || DOT_VARIANTS.idle}`}
    />
  );
}

// ── Badge ──
// Compact label for inventory items, status tags, and metadata.

const BADGE_VARIANTS: Record<string, string> = {
  default: "text-t-muted border-b-DEFAULT",
  warning: "text-warning border-warning",
  info:    "text-info border-info",
  danger:  "text-danger border-danger",
  primary: "text-primary border-primary",
};

export function Badge({
  children,
  variant = "default",
}: {
  children: ReactNode;
  variant?: "default" | "warning" | "info" | "danger" | "primary";
}) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 text-micro font-medium tracking-wider border leading-none ${BADGE_VARIANTS[variant]}`}
    >
      {children}
    </span>
  );
}

// ── ErrorBanner ──
// Full-width or inline error banner with dismiss button.
// "header": sticky top bar, bg-surface-1, border-b danger
// "inline" (default): bordered block, margin via className

export function ErrorBanner({
  message,
  onDismiss,
  variant = "inline",
  className = "",
}: {
  message: string;
  onDismiss: () => void;
  variant?: "header" | "inline";
  className?: string;
}) {
  const { t } = useLocale();
  const base =
    variant === "header"
      ? "px-6 py-3 bg-surface-1 border-b border-danger shrink-0"
      : "px-4 py-3 border border-danger";
  return (
    <div
      className={`${base} text-detail text-danger flex items-center justify-between animate-slide-down ${className}`}
      role="alert"
    >
      <span className="normal-case tracking-normal">{message}</span>
      <button
        onClick={onDismiss}
        className="text-micro text-danger hover:text-t-DEFAULT transition-colors ml-4"
        aria-label={t("dismiss")}
      >
        {t("dismiss")}
      </button>
    </div>
  );
}

// ── EmptyState ──
// Machine-style "// COMMENT" empty state with optional children (description, CTA).

export function EmptyState({
  label,
  children,
  className = "",
}: {
  label: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`border border-b-DEFAULT p-8 flex flex-col items-center gap-4 ${className}`}>
      <div className="text-micro text-t-dim tracking-widest">{label}</div>
      {children}
    </div>
  );
}

// ── SkeletonLine ──
// Shimmer loading placeholder. Pass h-*, w-*, and margin via className.

export function SkeletonLine({ className = "" }: { className?: string }) {
  return (
    <div
      className={`bg-gradient-to-r from-surface-2 via-surface-3 to-surface-2 bg-[length:200%_100%] animate-[shimmer_1.5s_ease_infinite] ${className}`}
    />
  );
}
