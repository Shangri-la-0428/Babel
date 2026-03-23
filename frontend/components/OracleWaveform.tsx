"use client";

import { useRef, useEffect, memo } from "react";

type WaveformState = "idle" | "thinking" | "received";

const INFO = [14, 165, 233] as const;
const H = 28;

export const OracleWaveform = memo(function OracleWaveform({
  state,
  open,
}: {
  state: WaveformState;
  open: boolean;
}) {
  const cvs = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<WaveformState>(state);
  const ampRef = useRef(0);
  const spikeRef = useRef(0);
  const frameId = useRef(0);

  stateRef.current = state;

  // Trigger spike burst on "received"
  useEffect(() => {
    if (state === "received") spikeRef.current = 1;
  }, [state]);

  useEffect(() => {
    const c = cvs.current;
    if (!c || !open) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const ctx = c.getContext("2d");
    if (!ctx) return;

    let alive = true;
    const dpr = devicePixelRatio || 1;
    const t0 = performance.now();
    let fc = 0;

    function resize() {
      if (!c) return;
      c.width = c.clientWidth * dpr;
      c.height = H * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();

    function draw(now: number) {
      if (!alive || !ctx || !c) return;

      const s = stateRef.current;
      fc++;

      // ── Always update at 60fps: smooth transitions stay responsive ──
      const target = s === "thinking" ? 0.85 : s === "received" ? 0.45 : 0.1;
      ampRef.current += (target - ampRef.current) * 0.05;
      if (spikeRef.current > 0.005) spikeRef.current *= 0.96;

      // ── Throttle idle draws to ~20fps ──
      if (s === "idle" && fc % 3 !== 0) {
        frameId.current = requestAnimationFrame(draw);
        return;
      }

      const t = (now - t0) / 1000;
      const w = c.clientWidth;
      const mid = H / 2;
      const amp = ampRef.current;
      const spd = s === "thinking" ? 2.0 : s === "received" ? 1.3 : 0.5;

      ctx.clearRect(0, 0, w, H);

      // Adaptive resolution: coarser steps when idle
      const step = s === "idle" ? 4 : 2;

      ctx.beginPath();
      for (let x = 0; x <= w; x += step) {
        const n = x / w;

        let y = Math.sin(n * 14 + t * spd * 2) * 0.28
              + Math.sin(n * 28 + t * spd * 3.5) * 0.22
              + Math.sin(n * 55 + t * spd * 5.8) * 0.14
              + Math.sin(n * 90 + t * spd * 1.7) * 0.08;

        if (s === "thinking") {
          y += Math.sin(n * 70 + t * 11) * 0.18
            +  Math.sin(n * 130 + t * 17) * 0.1;
        }

        if (spikeRef.current > 0.005) {
          y += Math.exp(-((n - 0.5) ** 2) * 25)
            * spikeRef.current
            * Math.sin(t * 25) * 0.5;
        }

        const edge = Math.min(n * 10, (1 - n) * 10, 1);
        const py = mid + y * amp * mid * 0.85 * edge;
        if (x === 0) ctx.moveTo(x, py); else ctx.lineTo(x, py);
      }

      // Primary stroke
      const a = s === "thinking" ? 0.55 : s === "received" ? 0.45 : 0.2;
      ctx.strokeStyle = `rgba(${INFO[0]},${INFO[1]},${INFO[2]},${a})`;
      ctx.lineWidth = s === "thinking" ? 1.5 : 1;
      ctx.stroke();

      // Glow layer — only when amplitude makes it visible
      if (amp > 0.15) {
        ctx.save();
        ctx.globalAlpha = amp * 0.2;
        ctx.lineWidth = 5;
        ctx.strokeStyle = `rgba(${INFO[0]},${INFO[1]},${INFO[2]},0.12)`;
        ctx.stroke();
        ctx.restore();
      }

      // Baseline — skip in idle (α=0.04 invisible at low amplitude)
      if (s !== "idle") {
        ctx.beginPath();
        ctx.moveTo(0, mid);
        ctx.lineTo(w, mid);
        ctx.strokeStyle = `rgba(${INFO[0]},${INFO[1]},${INFO[2]},0.04)`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      frameId.current = requestAnimationFrame(draw);
    }

    frameId.current = requestAnimationFrame(draw);
    const ro = new ResizeObserver(resize);
    ro.observe(c);

    return () => {
      alive = false;
      cancelAnimationFrame(frameId.current);
      ro.disconnect();
    };
  }, [open]);

  return (
    <canvas
      ref={cvs}
      className="w-full shrink-0 block"
      style={{ height: H }}
      aria-hidden="true"
    />
  );
});
