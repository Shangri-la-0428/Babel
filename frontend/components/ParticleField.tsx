"use client";

import { useEffect, useRef } from "react";
import { subscribe } from "@/lib/raf";

interface Props {
  status: string;
  isNight: boolean;
  eventCount: number;
  ripple: number; // 0-1, shockwave intensity for scatter effect
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
const SHOCKWAVE_BURST = 24;
const CAP = 300;

export default function ParticleField({ status, isNight, eventCount, ripple }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const state = useRef({ status, isNight, eventCount, ripple });
  const particles = useRef<Particle[]>([]);

  state.current = { status, isNight, eventCount, ripple };

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

    const ps = particles.current;
    for (let i = 0; i < BASE_COUNT; i++) ps.push(spawn(w, h, false));

    let prevEC = state.current.eventCount;
    let prevRipple = 0;
    let lastFrame = 0;

    const loop = (now: number) => {
      if (now - lastFrame < 33) return; // 30fps throttle
      lastFrame = now;

      const { status, isNight, eventCount, ripple } = state.current;
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

      // Shockwave scatter — massive radial burst from center on ripple spike
      if (ripple > 0.5 && prevRipple <= 0.5) {
        const cx = w * 0.5;
        const cy = h * 0.5;
        for (let i = 0; i < SHOCKWAVE_BURST; i++) {
          const ang = (i / SHOCKWAVE_BURST) * Math.PI * 2 + Math.random() * 0.3;
          const spd = 2.5 + Math.random() * 4;
          ps.push({
            x: cx + Math.cos(ang) * 20,
            y: cy + Math.sin(ang) * 20,
            vx: Math.cos(ang) * spd,
            vy: Math.sin(ang) * spd,
            s: 1.5 + Math.random(),
            a: 0.8 + Math.random() * 0.2,
            life: 40 + Math.random() * 60,
            max: 100,
            lime: true,
          });
        }
      }
      prevRipple = ripple;

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

        // Friction for shockwave particles (fast ones decelerate)
        if (Math.abs(p.vx) > 1.5 || Math.abs(p.vy) > 1.5) {
          p.vx *= 0.97;
          p.vy *= 0.97;
        }

        if (
          p.life <= 0 ||
          p.x < -10 ||
          p.x > w + 10 ||
          p.y < -10 ||
          p.y > h + 10
        ) {
          ps[i] = ps[ps.length - 1];
          ps.pop();
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
      if (ps.length > CAP) ps.length = CAP - 50;
    };

    const unsub = subscribe(loop);

    return () => {
      unsub();
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
