"use client";

import { useEffect, useRef } from "react";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  a: number;
}

const COUNT = 15;
const FRAME_SKIP = 4; // ~15fps (every 4th rAF at 60fps)

export default function AmbientVoid() {
  const ref = useRef<HTMLCanvasElement>(null);
  const particles = useRef<Particle[]>([]);
  const raf = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;

    let w = 0;
    let h = 0;
    const resize = () => {
      w = c.width = window.innerWidth;
      h = c.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    // Seed particles
    const ps = particles.current;
    ps.length = 0;
    for (let i = 0; i < COUNT; i++) ps.push(spawn(w, h));

    let fc = 0;

    const loop = () => {
      fc++;

      // Frame skip — only draw every Nth frame (~15fps)
      if (fc % FRAME_SKIP !== 0) {
        raf.current = requestAnimationFrame(loop);
        return;
      }

      ctx.clearRect(0, 0, w, h);

      for (const p of ps) {
        p.x += p.vx;
        p.y += p.vy;

        // Wrap around viewport edges
        if (p.x < -1) p.x = w + 1;
        else if (p.x > w + 1) p.x = -1;
        if (p.y < -1) p.y = h + 1;
        else if (p.y > h + 1) p.y = -1;

        ctx.fillStyle = `rgba(60,60,60,${p.a})`;
        ctx.fillRect(p.x | 0, p.y | 0, 1, 1);
      }

      raf.current = requestAnimationFrame(loop);
    };

    raf.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf.current);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      className="fixed inset-0 -z-20 pointer-events-none"
      aria-hidden="true"
    />
  );
}

function spawn(w: number, h: number): Particle {
  const angle = Math.random() * Math.PI * 2;
  const speed = 0.05 + Math.random() * 0.1;
  return {
    x: Math.random() * w,
    y: Math.random() * h,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    a: 0.02 + Math.random() * 0.04,
  };
}
