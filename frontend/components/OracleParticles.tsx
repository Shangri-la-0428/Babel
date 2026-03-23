"use client";

import { useRef, useEffect, memo } from "react";

const GLYPHS = "█▓▒░▀▄│─╬";
const N = 30;
const MAX_DPR = 2; // 10px text at α≤0.1 doesn't benefit from 3x

interface P {
  x: number; y: number; c: string;
  a: number; s: number; d: number;
}

export const OracleParticles = memo(function OracleParticles({
  thinking,
  open,
}: {
  thinking: boolean;
  open: boolean;
}) {
  const cvs = useRef<HTMLCanvasElement>(null);
  const frameId = useRef(0);
  const thinkRef = useRef(thinking);
  const pts = useRef<P[]>([]);

  thinkRef.current = thinking;

  useEffect(() => {
    const c = cvs.current;
    if (!c || !open) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const ctx = c.getContext("2d");
    if (!ctx) return;

    let alive = true;
    const dpr = Math.min(devicePixelRatio || 1, MAX_DPR);
    let fc = 0;

    function resize() {
      if (!c) return;
      c.width = c.clientWidth * dpr;
      c.height = c.clientHeight * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();

    // In-place particle reset — zero allocation
    function reset(p: P, forceX?: number, forceY?: number) {
      const w = c!.clientWidth, h = c!.clientHeight;
      p.x = forceX !== undefined ? forceX : Math.random() * w;
      p.y = forceY !== undefined ? forceY : Math.random() * h;
      p.c = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
      p.a = 0.03 + Math.random() * 0.04;
      p.s = 0.12 + Math.random() * 0.25;
      p.d = (Math.random() - 0.5) * 0.18;
    }

    // Seed particles
    pts.current = Array.from({ length: N }, () => {
      const p: P = { x: 0, y: 0, c: "", a: 0, s: 0, d: 0 };
      reset(p);
      return p;
    });

    let prev = performance.now();

    function draw(now: number) {
      if (!alive || !ctx || !c) return;

      const fast = thinkRef.current;
      fc++;

      // Throttle idle to ~30fps — slow dim particles are smooth enough
      if (!fast && fc % 2 !== 0) {
        frameId.current = requestAnimationFrame(draw);
        return;
      }

      const dt = Math.min((now - prev) / 16.67, 3);
      prev = now;

      const w = c.clientWidth, h = c.clientHeight;
      ctx.clearRect(0, 0, w, h);

      ctx.font = "10px 'JetBrains Mono',monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      // Pre-compute multipliers outside loop
      const sMult = fast ? 2.8 : 1;
      const aMult = fast ? 2.5 : 1;

      for (const p of pts.current) {
        p.y -= p.s * sMult * dt;
        p.x += p.d * dt;

        // Recycle off-screen — in-place reset, no temp objects
        if (p.y < -12) reset(p, undefined, h + 10);
        else if (p.x < -10 || p.x > w + 10) reset(p, undefined, p.y);

        ctx.fillStyle = `rgba(14,165,233,${Math.min(p.a * aMult, 0.14)})`;
        ctx.fillText(p.c, p.x, p.y);
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
      className="absolute inset-0 w-full h-full pointer-events-none z-0"
      aria-hidden="true"
    />
  );
});
