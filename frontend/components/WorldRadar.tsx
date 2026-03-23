"use client";

import { useEffect, useRef, memo } from "react";

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
  const raf = useRef(0);
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

    function resize() {
      const r = c!.getBoundingClientRect();
      c!.width = r.width * dpr;
      c!.height = r.height * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    const ro = new ResizeObserver(resize);
    ro.observe(c);
    resize();

    function getLayout(w: number, h: number, locs: Location[]) {
      const cx = w / 2;
      const cy = h / 2;
      const rad = Math.min(w, h) * 0.34;
      const positions = new Map<string, { x: number; y: number }>();
      locs.forEach((l, i) => {
        const a = (i / locs.length) * Math.PI * 2 - Math.PI / 2;
        positions.set(l.name, {
          x: cx + Math.cos(a) * rad,
          y: cy + Math.sin(a) * rad,
        });
      });
      return { positions, cx, cy, rad };
    }

    function loop() {
      const { locations, agents, isRunning, latestEventLocation, tick } =
        st.current;
      const rect = c!.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;

      ctx!.clearRect(0, 0, w, h);

      if (!locations.length) {
        raf.current = requestAnimationFrame(loop);
        return;
      }

      const { positions, cx, cy, rad } = getLayout(w, h, locations);

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

      // Animate expanding square pulses
      for (let i = pulses.current.length - 1; i >= 0; i--) {
        const p = pulses.current[i];
        p.size += 0.6;
        p.alpha -= 0.008;
        if (p.alpha <= 0) {
          pulses.current.splice(i, 1);
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

      raf.current = requestAnimationFrame(loop);
    }

    raf.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf.current);
      ro.disconnect();
    };
  }, []);

  return <canvas ref={ref} className="w-full h-full" aria-hidden="true" />;
});
