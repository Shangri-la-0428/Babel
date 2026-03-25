"use client";

import { useEffect, useRef, useState } from "react";

const GLITCH_SET = "█▓▒░▀▄│─╬";
const BOOT_DURATION = 1200; // total overlay duration ms
const DECODE_DURATION = 600;

interface Props {
  worldName: string;
  onComplete: () => void;
}

/**
 * Full-screen "world boot" overlay.
 * Sequence: void → world name decodes → horizontal boot-sweep → navigate.
 * Used when launching a world from Home or Create page.
 */
export default function WorldBootOverlay({ worldName, onComplete }: Props) {
  const nameRef = useRef<HTMLSpanElement>(null);
  const [phase, setPhase] = useState<"decode" | "sweep" | "done">("decode");

  // Glitch-decode the world name
  useEffect(() => {
    const el = nameRef.current;
    if (!el) return;

    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.textContent = worldName;
      const t = setTimeout(onComplete, 400);
      return () => clearTimeout(t);
    }

    const start = performance.now();
    let raf = 0;

    function tick(now: number) {
      const p = Math.min((now - start) / DECODE_DURATION, 1);
      const count = Math.floor(worldName.length * p);
      let display = worldName.slice(0, count);
      for (let i = count; i < worldName.length; i++) {
        display += worldName[i] === " " ? " " : GLITCH_SET[((now / 40 + i * 11) | 0) % GLITCH_SET.length];
      }
      if (el) el.textContent = display;
      if (p < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        setPhase("sweep");
      }
    }

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [worldName]);

  // After sweep, fire onComplete
  useEffect(() => {
    if (phase !== "sweep") return;
    const t = setTimeout(() => {
      setPhase("done");
      onComplete();
    }, BOOT_DURATION - DECODE_DURATION);
    return () => clearTimeout(t);
  }, [phase, onComplete]);

  return (
    <div
      className="fixed inset-0 z-[9999] bg-void flex flex-col items-center justify-center scanlines"
      aria-live="assertive"
      role="status"
    >
      {/* System status label */}
      <div className="text-micro text-t-dim tracking-widest mb-4 animate-[fade-in_200ms_ease_both]">
        {"// INITIALIZING WORLD"}
      </div>

      {/* World name — glitch decode */}
      <span
        ref={nameRef}
        className="font-sans font-bold text-[clamp(2rem,4vw,3rem)] tracking-tight text-primary drop-shadow-[0_0_24px_var(--color-primary-glow-strong)]"
      >
        {worldName}
      </span>

      {/* Horizontal boot sweep line */}
      {phase === "sweep" && (
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-px overflow-hidden">
          <div
            className="h-full bg-primary shadow-[0_0_16px_var(--color-primary-glow-strong)] animate-[boot-line-expand_500ms_cubic-bezier(0.16,1,0.3,1)_both]"
          />
        </div>
      )}

      {/* System online label */}
      {phase === "sweep" && (
        <div className="mt-6 text-micro text-primary tracking-widest animate-[fade-in_300ms_ease_200ms_both]">
          {"// SYSTEMS ONLINE"}
        </div>
      )}
    </div>
  );
}
