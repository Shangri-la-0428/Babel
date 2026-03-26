"use client";

import { useEffect, useRef, memo } from "react";
import { subscribe } from "@/lib/raf";

interface Location {
  name: string;
}

interface Agent {
  id: string;
  name: string;
  location: string;
  status: string;
}

interface Props {
  locations: Location[];
  agents: Agent[];
  isRunning: boolean;
  latestEventLocation: string;
  tick: number;
}

interface Pulse {
  x: number;
  y: number;
  size: number;
  alpha: number;
}

export default memo(function WorldRadar({
  locations,
  agents,
  isRunning,
  latestEventLocation,
  tick,
}: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const st = useRef({ locations, agents, isRunning, latestEventLocation, tick });
  const pulses = useRef<Pulse[]>([]);
  const sweep = useRef(0);
  const prevLoc = useRef("");
  const prevTick = useRef(0);

  st.current = { locations, agents, isRunning, latestEventLocation, tick };

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;

    // Layout cache — recomputed only on resize or location change
    let cachedW = 0;
    let cachedH = 0;
    let cachedLocCount = 0;
    let cachedPositions = new Map<string, { x: number; y: number }>();
    let cachedCx = 0;
    let cachedCy = 0;
    let cachedRad = 0;

    function recomputeLayout(w: number, h: number, locs: Location[]) {
      cachedW = w;
      cachedH = h;
      cachedLocCount = locs.length;
      cachedCx = w / 2;
      cachedCy = h / 2;
      cachedRad = Math.min(w, h) * 0.34;
      cachedPositions = new Map();
      locs.forEach((l, i) => {
        const a = (i / locs.length) * Math.PI * 2 - Math.PI / 2;
        cachedPositions.set(l.name, {
          x: cachedCx + Math.cos(a) * cachedRad,
          y: cachedCy + Math.sin(a) * cachedRad,
        });
      });
    }

    let displayW = 0;
    let displayH = 0;

    function resize() {
      const r = c!.getBoundingClientRect();
      displayW = r.width;
      displayH = r.height;
      c!.width = displayW * dpr;
      c!.height = displayH * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Invalidate layout cache on resize
      cachedW = 0;
    }
    const ro = new ResizeObserver(resize);
    ro.observe(c);
    resize();

    let lastFrame = 0;

    function loop(now: number) {
      const { locations, agents, isRunning, latestEventLocation, tick } =
        st.current;
      const w = displayW;
      const h = displayH;

      // Idle throttle: ~15fps when not running
      const interval = isRunning ? 0 : 66;
      if (now - lastFrame < interval) return;
      lastFrame = now;

      ctx!.clearRect(0, 0, w, h);

      if (!locations.length) return;

      // Recompute layout only when size or location count changes
      if (w !== cachedW || h !== cachedH || locations.length !== cachedLocCount) {
        recomputeLayout(w, h, locations);
      }
      const positions = cachedPositions;
      const cx = cachedCx;
      const cy = cachedCy;
      const rad = cachedRad;

      // ── Grid: concentric squares ──
      for (let i = 1; i <= 3; i++) {
        const s = rad * (i / 3);
        ctx!.strokeStyle = "rgba(192,254,4,0.04)";
        ctx!.lineWidth = 1;
        ctx!.strokeRect(cx - s, cy - s, s * 2, s * 2);
      }

      // ── Grid: crosshairs ──
      ctx!.strokeStyle = "rgba(192,254,4,0.03)";
      ctx!.beginPath();
      ctx!.moveTo(cx, cy - rad - 8);
      ctx!.lineTo(cx, cy + rad + 8);
      ctx!.moveTo(cx - rad - 8, cy);
      ctx!.lineTo(cx + rad + 8, cy);
      ctx!.stroke();

      // ── Sweep line (running) ──
      if (isRunning) {
        sweep.current += 0.012;
        const a = sweep.current;
        const sx = cx + Math.cos(a) * (rad + 10);
        const sy = cy + Math.sin(a) * (rad + 10);
        ctx!.beginPath();
        ctx!.moveTo(cx, cy);
        ctx!.lineTo(sx, sy);
        ctx!.strokeStyle = "rgba(192,254,4,0.12)";
        ctx!.lineWidth = 1;
        ctx!.stroke();

        // Sweep trail arc
        ctx!.beginPath();
        ctx!.arc(cx, cy, rad * 0.7, a - 0.4, a);
        ctx!.strokeStyle = "rgba(192,254,4,0.06)";
        ctx!.lineWidth = 1.5;
        ctx!.stroke();
      }

      // ── Connection lines ──
      positions.forEach((pos) => {
        ctx!.beginPath();
        ctx!.moveTo(cx, cy);
        ctx!.lineTo(pos.x, pos.y);
        ctx!.strokeStyle = "rgba(192,254,4,0.05)";
        ctx!.lineWidth = 1;
        ctx!.stroke();
      });

      // ── Location nodes ──
      ctx!.font = "9px 'JetBrains Mono',monospace";
      ctx!.textAlign = "center";
      ctx!.textBaseline = "top";

      positions.forEach((pos, name) => {
        const s = 3;
        ctx!.fillStyle = "rgba(192,254,4,0.25)";
        ctx!.fillRect(pos.x - s, pos.y - s, s * 2, s * 2);
        ctx!.strokeStyle = "rgba(192,254,4,0.4)";
        ctx!.lineWidth = 1;
        ctx!.strokeRect(pos.x - s, pos.y - s, s * 2, s * 2);

        const label =
          name.length > 10
            ? name.slice(0, 9) + "\u2026"
            : name;
        ctx!.fillStyle = "rgba(138,138,138,0.7)";
        ctx!.fillText(label.toUpperCase(), pos.x, pos.y + s + 3);
      });

      // ── Agent dots ──
      const byLoc = new Map<string, Agent[]>();
      agents.forEach((a) => {
        const list = byLoc.get(a.location) || [];
        list.push(a);
        byLoc.set(a.location, list);
      });

      byLoc.forEach((list, locName) => {
        const pos = positions.get(locName);
        if (!pos) return;

        list.forEach((ag, idx) => {
          const oa = (idx / Math.max(list.length, 1)) * Math.PI * 2;
          const or = 10 + idx * 2.5;
          const ax = pos.x + Math.cos(oa) * or;
          const ay = pos.y + Math.sin(oa) * or;

          const ds = ag.status === "acting" ? 3 : 2;
          const al = ag.status === "acting" ? 0.9 : 0.45;

          ctx!.fillStyle =
            ag.status === "dead"
              ? `rgba(242,71,35,${al})`
              : `rgba(192,254,4,${al})`;
          ctx!.fillRect(ax - ds / 2, ay - ds / 2, ds, ds);

          // Glow halo for acting agents
          if (ag.status === "acting") {
            ctx!.fillStyle = "rgba(192,254,4,0.08)";
            ctx!.fillRect(ax - 5, ay - 5, 10, 10);
          }
        });
      });

      // ── Event pulses ──
      if (latestEventLocation && latestEventLocation !== prevLoc.current) {
        prevLoc.current = latestEventLocation;
        const pos = positions.get(latestEventLocation);
        if (pos) {
          pulses.current.push({
            x: pos.x,
            y: pos.y,
            size: 4,
            alpha: 0.5,
          });
        }
      }

      // Center pulse on tick change
      if (tick !== prevTick.current) {
        prevTick.current = tick;
        pulses.current.push({ x: cx, y: cy, size: 2, alpha: 0.15 });
      }

      // Animate expanding square pulses (swap-and-pop for O(1) removal)
      for (let i = pulses.current.length - 1; i >= 0; i--) {
        const p = pulses.current[i];
        p.size += 0.6;
        p.alpha -= 0.008;
        if (p.alpha <= 0) {
          pulses.current[i] = pulses.current[pulses.current.length - 1];
          pulses.current.pop();
          continue;
        }
        ctx!.strokeStyle = `rgba(192,254,4,${p.alpha})`;
        ctx!.lineWidth = 1;
        ctx!.strokeRect(
          p.x - p.size,
          p.y - p.size,
          p.size * 2,
          p.size * 2,
        );
      }

      // Center pip
      ctx!.fillStyle = "rgba(192,254,4,0.1)";
      ctx!.fillRect(cx - 1.5, cy - 1.5, 3, 3);
    }

    const unsub = subscribe(loop);

    return () => {
      unsub();
      ro.disconnect();
    };
  }, []);

  return <canvas ref={ref} className="w-full h-full" aria-hidden="true" />;
});
