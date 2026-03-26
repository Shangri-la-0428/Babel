"use client";

import { useEffect, useRef, useState } from "react";
import { GlitchReveal } from "./ui";

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
  const [phase, setPhase] = useState<"link" | "decode" | "sweep" | "done">("link");
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  // Transition link → decode after brief establishing phase
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const t = setTimeout(() => onCompleteRef.current(), 400);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setPhase("decode"), 400);
    return () => clearTimeout(t);
  }, []);

  // Transition decode → sweep after GlitchReveal duration
  useEffect(() => {
    if (phase !== "decode") return;
    const t = setTimeout(() => setPhase("sweep"), DECODE_DURATION);
    return () => clearTimeout(t);
  }, [phase]);

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
      className="fixed inset-0 z-boot-screen bg-void flex flex-col items-center justify-center scanlines"
      aria-live="assertive"
      role="status"
    >
      {/* System status label */}
      <div className="text-micro text-t-dim tracking-widest mb-4 animate-[fade-in_200ms_ease_both]">
        {phase === "link" ? (
          <GlitchReveal text="// ESTABLISHING LINK" duration={300} />
        ) : (
          <GlitchReveal text="// INITIALIZING WORLD" duration={400} />
        )}
      </div>

      {/* World name — glitch decode via shared GlitchReveal */}
      <GlitchReveal
        text={worldName}
        duration={DECODE_DURATION}
        className="font-sans font-bold text-[clamp(2rem,4vw,3rem)] tracking-tight text-primary drop-shadow-[0_0_24px_var(--color-primary-glow-strong)]"
      />

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
