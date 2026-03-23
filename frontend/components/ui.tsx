"use client";

import { ReactNode, memo, useEffect, useRef } from "react";
import { useLocale } from "@/lib/locale-context";

// ── StatusDot ──
// The ONLY circular element in the design system.
// Semantic status indicator for agents, sessions, items, locations.

const DOT_VARIANTS: Record<string, string> = {
  acting:    "bg-primary shadow-[0_0_8px_var(--color-primary-glow-strong)]",
  dead:      "bg-danger shadow-[0_0_8px_var(--color-danger-glow)]",
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
  children,
}: {
  message: string;
  onDismiss: () => void;
  variant?: "header" | "inline";
  className?: string;
  children?: ReactNode;
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
      <div className="flex items-center min-w-0">
        <span className="normal-case tracking-normal">{message}</span>
        {children}
      </div>
      <button
        onClick={onDismiss}
        className="text-micro text-danger hover:text-t-DEFAULT transition-colors ml-4 shrink-0"
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
      <div className="text-micro text-t-dim tracking-widest">
        {label}
        <span className="inline-block w-[0.55em] h-[1.1em] bg-t-dim ml-0.5 align-text-bottom animate-[cursor-pulse_1s_step-end_infinite]" aria-hidden="true" />
      </div>
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

// ── DecodeText ──
// Glitch/decode transmission effect. Progressively reveals text with
// random block characters, like a signal being decoded from noise.

const GLITCH_CHARS = "█▓▒░▀▄│─╬";

// ── GlitchReveal ──
// Dramatic decode animation for display titles. Glitch characters
// decode into final text, all in the same color (no dim overlay).
// Used for hero titles and system boot moments.

const GLITCH_SET = "█▓▒░▀▄│─╬";

export const GlitchReveal = memo(function GlitchReveal({
  text,
  duration = 600,
  className = "",
}: {
  text: string;
  duration?: number;
  className?: string;
}) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const frameRef = useRef(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.textContent = text;
      return;
    }

    const start = performance.now();

    function tick(now: number) {
      const p = Math.min((now - start) / duration, 1);
      const count = Math.floor(text.length * p);

      let display = text.slice(0, count);
      for (let i = count; i < text.length; i++) {
        display +=
          text[i] === " "
            ? " "
            : GLITCH_SET[((now / 40 + i * 11) | 0) % GLITCH_SET.length];
      }

      if (el) el.textContent = display;
      if (p < 1) frameRef.current = requestAnimationFrame(tick);
    }

    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [text, duration]);

  return <span ref={containerRef} className={className}>{text}</span>;
});

// ── DecodeText ──
// Glitch/decode transmission effect. Progressively reveals text with
// random block characters, like a signal being decoded from noise.

export const DecodeText = memo(function DecodeText({
  text,
  duration = 800,
}: {
  text: string;
  duration?: number;
}) {
  const spanRef = useRef<HTMLSpanElement>(null);
  const glitchRef = useRef<HTMLSpanElement>(null);
  const frameRef = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      if (spanRef.current) spanRef.current.textContent = text;
      if (glitchRef.current) glitchRef.current.textContent = "";
      return;
    }

    const start = performance.now();
    function tick(now: number) {
      const p = Math.min((now - start) / duration, 1);
      const count = Math.floor(text.length * p);

      if (spanRef.current) spanRef.current.textContent = text.slice(0, count);

      if (p >= 1) {
        if (glitchRef.current) glitchRef.current.textContent = "";
        return;
      }

      if (glitchRef.current) {
        const remaining = text.slice(count);
        let glitched = "";
        for (let i = 0; i < remaining.length; i++) {
          glitched +=
            remaining[i] === " "
              ? " "
              : GLITCH_CHARS[((now / 50 + i * 7) | 0) % GLITCH_CHARS.length];
        }
        glitchRef.current.textContent = glitched;
      }

      frameRef.current = requestAnimationFrame(tick);
    }
    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [text, duration]);

  return (
    <>
      <span ref={spanRef} />
      <span ref={glitchRef} className="text-t-dim" />
    </>
  );
});
