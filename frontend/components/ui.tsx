"use client";

import { ReactNode, memo, useEffect, useRef } from "react";
import { useLocale } from "@/lib/locale-context";

// ── StatusDot ──
// The ONLY circular element in the design system.
// Semantic status indicator for agents, sessions, items, locations.

const DOT_VARIANTS: Record<string, string> = {
  acting:     "bg-primary shadow-[0_0_8px_var(--color-primary-glow-strong)]",
  running:    "bg-primary animate-pulse-glow",
  dead:       "bg-danger shadow-[0_0_8px_var(--color-danger-glow)]",
  idle:       "bg-t-dim",
  info:       "bg-info shadow-[0_0_6px_rgba(14,165,233,0.4)] animate-pulse-glow",
  warning:    "bg-warning",
  secondary:  "bg-t-secondary",
  primary:    "bg-primary shadow-[0_0_8px_var(--color-primary-glow-strong)]",
  danger:     "bg-danger shadow-[0_0_6px_var(--color-danger-glow)]",
  connecting: "bg-t-dim animate-[blink_1s_step-end_infinite]",
};

export function StatusDot({ status, className }: { status: string; className?: string }) {
  return (
    <span
      className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${DOT_VARIANTS[status] || DOT_VARIANTS.idle}${className ? ` ${className}` : ""}`}
      aria-hidden="true"
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
        type="button"
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

const EMPTY_VARIANTS = {
  default: "bg-t-dim",
  waiting: "bg-primary/60 shadow-[0_0_8px_var(--color-primary-glow)]",
  scanning: "bg-info/60 shadow-[0_0_8px_rgba(14,165,233,0.3)]",
};

export function EmptyState({
  label,
  children,
  className = "",
  variant = "default",
}: {
  label: string;
  children?: ReactNode;
  className?: string;
  variant?: "default" | "waiting" | "scanning";
}) {
  return (
    <div className={`border border-b-DEFAULT p-8 flex flex-col items-center gap-4 ${className}`}>
      <div className="text-micro text-t-dim tracking-widest">
        {label}
        <span className={`inline-block w-[1ch] h-[1.15em] ml-0.5 align-text-bottom animate-[cursor-pulse_1s_step-end_infinite] ${EMPTY_VARIANTS[variant]}`} aria-hidden="true" />
      </div>
      {children}
    </div>
  );
}

// ── SkeletonLine ──
// Shimmer loading placeholder. Pass h-*, w-*, and margin via className.

export function SkeletonLine({ className = "", variant = "default" }: { className?: string; variant?: "default" | "scan" }) {
  return (
    <div
      className={`bg-[length:200%_100%] animate-[shimmer_1.5s_linear_infinite] ${
        variant === "scan"
          ? "bg-gradient-to-r from-surface-2 via-info/10 to-surface-2"
          : "bg-gradient-to-r from-surface-2 via-surface-3 to-surface-2"
      } ${className}`}
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

// ── SystemMessage ──
// Reusable "// MESSAGE" pattern with optional DecodeText animation.
// Used for machine-voice status messages throughout the interface.

export function SystemMessage({
  text,
  decode = false,
  className = "",
}: {
  text: string;
  decode?: boolean;
  className?: string;
}) {
  return (
    <div className={`text-micro text-t-dim tracking-widest ${className}`}>
      {decode ? <DecodeText text={text} duration={800} /> : text}
    </div>
  );
}

// ── FormLabel ──
// Standard form/section label. 84+ occurrences of this pattern across codebase.

export function FormLabel({
  children,
  htmlFor,
  className = "",
}: {
  children: ReactNode;
  htmlFor?: string;
  className?: string;
}) {
  return (
    <label htmlFor={htmlFor} className={`text-micro text-t-muted tracking-widest mb-1.5 block ${className}`}>
      {children}
    </label>
  );
}

// ── DetailSection ──
// Bordered section with label + content. Used heavily in AssetPanel for agent/item details.

export function DetailSection({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`px-4 py-2 border-b border-b-DEFAULT ${className}`}>
      <div className="text-micro text-t-muted tracking-widest mb-1">{label}</div>
      <div className="text-detail text-t-secondary normal-case tracking-normal leading-relaxed">
        {children}
      </div>
    </div>
  );
}

// ── DecodeText ──
// Glitch/decode transmission effect. Progressively reveals text with
// random block characters, like a signal being decoded from noise.

export const DecodeText = memo(function DecodeText({
  text,
  duration = 800,
  glitchIntensity = 1,
}: {
  text: string;
  duration?: number;
  /** 0 = subtle (fewer glitch chars), 1 = dramatic (full block chars). Default 1. */
  glitchIntensity?: number;
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
    let lastPaint = 0;
    const FRAME_INTERVAL = 33; // ~30fps

    function tick(now: number) {
      if (now - lastPaint < FRAME_INTERVAL) {
        frameRef.current = requestAnimationFrame(tick);
        return;
      }
      lastPaint = now;

      const p = Math.min((now - start) / duration, 1);
      const count = Math.floor(text.length * p);

      if (spanRef.current) spanRef.current.textContent = text.slice(0, count);

      if (p >= 1) {
        if (glitchRef.current) glitchRef.current.textContent = "";
        return;
      }

      if (glitchRef.current) {
        const remaining = text.slice(count);
        const chars: string[] = [];
        for (let i = 0; i < remaining.length; i++) {
          const useGlitch = Math.random() < glitchIntensity;
          chars.push(
            remaining[i] === " "
              ? " "
              : useGlitch
              ? GLITCH_CHARS[((now / 50 + i * 7) | 0) % GLITCH_CHARS.length]
              : "·"
          );
        }
        glitchRef.current.textContent = chars.join("");
      }

      frameRef.current = requestAnimationFrame(tick);
    }
    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [text, duration, glitchIntensity]);

  return (
    <>
      <span ref={spanRef} />
      <span ref={glitchRef} className="text-t-dim" />
    </>
  );
});
