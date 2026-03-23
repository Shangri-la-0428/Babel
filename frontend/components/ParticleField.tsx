"use client";

import { useEffect, useRef } from "react";

interface Props {
  status: string;
  isNight: boolean;
  eventCount: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  s: number;
  a: number;
  life: number;
  max: number;
  lime: boolean;
}

const BASE_COUNT = 50;
const RUN_COUNT = 90;
const BURST_SIZE = 12;
const CAP = 200;

export default function ParticleField({ status, isNight, eventCount }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const state = useRef({ status, isNight, eventCount });
  const particles = useRef<Particle[]>([]);
  const raf = useRef(0);

  state.current = { status, isNight, eventCount };

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

    // Seed initial particles
    const ps = particles.current;
    for (let i = 0; i < BASE_COUNT; i++) ps.push(spawn(w, h, false));

    let prevEC = state.current.eventCount;

    const loop = () => {
      const { status, isNight, eventCount } = state.current;
      const run = status === "running";

      ctx.clearRect(0, 0, w, h);

      // Event burst — spawn lime particles from random point
      if (eventCount > prevEC) {
        prevEC = eventCount;
        const bx = w * (0.15 + Math.random() * 0.7);
        const by = h * (0.15 + Math.random() * 0.7);
        for (let i = 0; i < BURST_SIZE; i++) {
          const ang = Math.random() * Math.PI * 2;
          const spd = 0.8 + Math.random() * 2;
          ps.push({
            x: bx,
            y: by,
            vx: Math.cos(ang) * spd,
            vy: Math.sin(ang) * spd,
            s: 1 + Math.random(),
            a: 0.5 + Math.random() * 0.5,
            life: 30 + Math.random() * 40,
            max: 70,
            lime: true,
          });
        }
      }

      // Maintain particle count
      const target = run ? RUN_COUNT : BASE_COUNT;
      while (ps.length < target) ps.push(spawn(w, h, run));

      const spd = run ? 1.0 : 0.25;
      const baseAlpha = isNight ? 0.08 : 0.15;

      for (let i = ps.length - 1; i >= 0; i--) {
        const p = ps[i];
        p.x += p.vx * spd;
        p.y += p.vy * spd;
        p.life--;

        if (
          p.life <= 0 ||
          p.x < -10 ||
          p.x > w + 10 ||
          p.y < -10 ||
          p.y > h + 10
        ) {
          ps.splice(i, 1);
          continue;
        }

        const lp = p.life / p.max;
        const alpha = p.a * lp * baseAlpha;
        if (alpha < 0.005) continue;

        if (p.lime) {
          ctx.fillStyle = `rgba(192,254,4,${Math.min(alpha * 3, 0.4)})`;
        } else {
          const v = isNight ? 40 : 80;
          ctx.fillStyle = `rgba(${v},${v},${v},${alpha})`;
        }
        ctx.fillRect(p.x | 0, p.y | 0, p.s, p.s);
      }

      // Hard cap
      if (ps.length > CAP) ps.splice(0, ps.length - (CAP - 50));

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
      className="absolute inset-0 -z-10 pointer-events-none"
      aria-hidden="true"
    />
  );
}

function spawn(w: number, h: number, running: boolean): Particle {
  return {
    x: Math.random() * w,
    y: Math.random() * h,
    vx: (Math.random() - 0.5) * 0.4,
    vy: (Math.random() - 0.5) * 0.3 - 0.1,
    s: Math.random() > 0.9 ? 2 : 1,
    a: 0.2 + Math.random() * 0.8,
    life: 300 + Math.random() * 500,
    max: 800,
    lime: running && Math.random() > 0.65,
  };
}
