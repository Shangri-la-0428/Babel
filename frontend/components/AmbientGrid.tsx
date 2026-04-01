"use client";

import { useEffect, useRef, useImperativeHandle, forwardRef } from "react";

export interface AmbientGridHandle {
  /** Inject an impulse at screen coordinates */
  inject: (x: number, y: number, strength?: number) => void;
}

interface Props {
  /** Grid density — "sparse" (home bg), "dense" (boot screen) */
  density?: "sparse" | "dense";
  className?: string;
}

// ---------------------------------------------------------------------------
// Spring-mass grid simulation on <canvas>
// Adapted from babel-launch-ambient-demo.html
// ---------------------------------------------------------------------------

const AmbientGrid = forwardRef<AmbientGridHandle, Props>(function AmbientGrid(
  { density = "sparse", className = "" },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<ReturnType<typeof createState> | null>(null);

  // Expose inject() to parent
  useImperativeHandle(ref, () => ({
    inject(x: number, y: number, strength = 15) {
      const s = stateRef.current;
      if (!s) return;
      injectAt(s, x, y, strength);
    },
  }));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const s = createState(density);
    stateRef.current = s;

    function resize() {
      s.dpr = Math.min(window.devicePixelRatio || 1, 2);
      s.W = canvas!.clientWidth;
      s.H = canvas!.clientHeight;
      canvas!.width = Math.round(s.W * s.dpr);
      canvas!.height = Math.round(s.H * s.dpr);
      ctx!.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
      allocGrid(s);
      buildGrid(s);
    }

    let raf = 0;

    function draw(now: number) {
      if (!s.running) return;
      const t = now * 0.001;
      const dt = s.last ? Math.min(t - s.last, 0.1) : 0.016;
      s.last = t;

      if (!prefersReduced) {
        s.sinceImpulse += dt;
        const interval = 1.4 / s.IMPULSE_RATE;
        if (s.sinceImpulse >= interval) {
          injectEdge(s);
          s.sinceImpulse = Math.random() * 0.18;
        }
        simulate(s, t);
      }

      render(ctx!, s, t);
      raf = requestAnimationFrame(draw);
    }

    function onVisChange() {
      s.running = !document.hidden;
      if (s.running) {
        s.last = 0;
        raf = requestAnimationFrame(draw);
      }
    }

    function onPointerMove(e: PointerEvent) {
      if (prefersReduced || Math.random() > 0.03) return;
      const rect = canvas!.getBoundingClientRect();
      injectAt(s, e.clientX - rect.left, e.clientY - rect.top, 3);
    }

    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", onVisChange);
    canvas.addEventListener("pointermove", onPointerMove);

    resize();
    ctx.fillStyle = "rgba(0,0,0,1)";
    ctx.fillRect(0, 0, s.W, s.H);
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      s.running = false;
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisChange);
      canvas.removeEventListener("pointermove", onPointerMove);
    };
  }, [density]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`absolute inset-0 w-full h-full pointer-events-auto ${className}`}
    />
  );
});

export default AmbientGrid;

// ===========================================================================
// Simulation internals
// ===========================================================================

interface Flare { x: number; y: number; life: number; energy: number; radius: number }
interface Flash { x: number; y: number; life: number; ring: number }

interface GridState {
  dpr: number; W: number; H: number;
  COLS: number; ROWS: number;
  DAMPING: number; RETURN_FORCE: number; SPRING_K: number;
  IMPULSE_RATE: number; IMPULSE_STRENGTH: number; DRIFT_STRENGTH: number;
  running: boolean; last: number; sinceImpulse: number; screenFlash: number;
  flares: Flare[]; flashes: Flash[];
  spacingX: number; spacingY: number;
  posX: Float32Array; posY: Float32Array;
  velX: Float32Array; velY: Float32Array;
  restX: Float32Array; restY: Float32Array;
  springs: number[];
}

function createState(density: "sparse" | "dense"): GridState {
  const cols = density === "dense" ? 34 : 22;
  const rows = density === "dense" ? 22 : 14;
  const n = cols * rows;
  return {
    dpr: 1, W: 0, H: 0,
    COLS: cols, ROWS: rows,
    DAMPING: 0.982, RETURN_FORCE: 0.0032, SPRING_K: 0.11,
    IMPULSE_RATE: density === "dense" ? 0.56 : 0.32,
    IMPULSE_STRENGTH: density === "dense" ? 0.94 : 0.7,
    DRIFT_STRENGTH: 0.22,
    running: true, last: 0, sinceImpulse: 0, screenFlash: 0,
    flares: [], flashes: [],
    spacingX: 0, spacingY: 0,
    posX: new Float32Array(n), posY: new Float32Array(n),
    velX: new Float32Array(n), velY: new Float32Array(n),
    restX: new Float32Array(n), restY: new Float32Array(n),
    springs: [],
  };
}

function allocGrid(s: GridState) {
  const n = s.COLS * s.ROWS;
  s.posX = new Float32Array(n);
  s.posY = new Float32Array(n);
  s.velX = new Float32Array(n);
  s.velY = new Float32Array(n);
  s.restX = new Float32Array(n);
  s.restY = new Float32Array(n);
  s.springs = [];
}

function buildGrid(s: GridState) {
  s.spacingX = s.W / (s.COLS - 1);
  s.spacingY = s.H / (s.ROWS - 1);
  for (let r = 0; r < s.ROWS; r++) {
    for (let c = 0; c < s.COLS; c++) {
      const i = r * s.COLS + c;
      const x = c * s.spacingX;
      const y = r * s.spacingY;
      s.restX[i] = x; s.restY[i] = y;
      s.posX[i] = x; s.posY[i] = y;
      s.velX[i] = 0; s.velY[i] = 0;
    }
  }
  s.springs.length = 0;
  for (let r = 0; r < s.ROWS; r++) {
    for (let c = 0; c < s.COLS; c++) {
      const i = r * s.COLS + c;
      if (c < s.COLS - 1) s.springs.push(i, r * s.COLS + c + 1, s.spacingX);
      if (r < s.ROWS - 1) s.springs.push(i, (r + 1) * s.COLS + c, s.spacingY);
    }
  }
}

function injectAt(s: GridState, mx: number, my: number, strength: number) {
  const maxDist = 4.2 * Math.max(s.spacingX, s.spacingY);
  for (let r = 0; r < s.ROWS; r++) {
    for (let c = 0; c < s.COLS; c++) {
      const i = r * s.COLS + c;
      const dx = s.restX[i] - mx;
      const dy = s.restY[i] - my;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < maxDist && dist > 0.01) {
        const f = (1 - dist / maxDist) ** 2;
        s.velX[i] += (dx / dist) * strength * f;
        s.velY[i] += (dy / dist) * strength * f;
      }
    }
  }
  s.flashes.push({ x: mx, y: my, life: 1, ring: 1 });
  s.flares.push({ x: mx, y: my, life: 1, energy: Math.min(1.4, strength / 14), radius: 0 });
  s.screenFlash = Math.max(s.screenFlash, 0.028);
}

function injectEdge(s: GridState) {
  const edge = Math.floor(Math.random() * 4);
  const region = 4 + Math.floor(Math.random() * 5);
  const str = (18 + Math.random() * 9) * s.IMPULSE_STRENGTH;
  let fx = 0, fy = 0, start: number;

  if (edge === 0) {
    start = Math.floor(Math.random() * Math.max(1, s.COLS - region));
    fx = (start + region * 0.5) * s.spacingX; fy = 0;
    for (let c = start; c < start + region && c < s.COLS; c++) {
      const f = (1 - Math.abs(c - start - region * 0.5) / (region * 0.5)) ** 2;
      s.velY[c] += str * f;
    }
  } else if (edge === 1) {
    start = Math.floor(Math.random() * Math.max(1, s.ROWS - region));
    fx = (s.COLS - 1) * s.spacingX; fy = (start + region * 0.5) * s.spacingY;
    for (let r = start; r < start + region && r < s.ROWS; r++) {
      const f = (1 - Math.abs(r - start - region * 0.5) / (region * 0.5)) ** 2;
      s.velX[r * s.COLS + s.COLS - 1] -= str * f;
    }
  } else if (edge === 2) {
    start = Math.floor(Math.random() * Math.max(1, s.COLS - region));
    fx = (start + region * 0.5) * s.spacingX; fy = (s.ROWS - 1) * s.spacingY;
    for (let c = start; c < start + region && c < s.COLS; c++) {
      const f = (1 - Math.abs(c - start - region * 0.5) / (region * 0.5)) ** 2;
      s.velY[(s.ROWS - 1) * s.COLS + c] -= str * f;
    }
  } else {
    start = Math.floor(Math.random() * Math.max(1, s.ROWS - region));
    fx = 0; fy = (start + region * 0.5) * s.spacingY;
    for (let r = start; r < start + region && r < s.ROWS; r++) {
      const f = (1 - Math.abs(r - start - region * 0.5) / (region * 0.5)) ** 2;
      s.velX[r * s.COLS] += str * f;
    }
  }

  s.flashes.push({ x: fx, y: fy, life: 1, ring: 1 });
  s.flares.push({ x: fx, y: fy, life: 1, energy: 0.95 + Math.random() * 0.35, radius: 0 });
  s.screenFlash = Math.max(s.screenFlash, 0.015 + Math.random() * 0.015);
}

function simulate(s: GridState, t: number) {
  const springCount = s.springs.length / 3;
  for (let i = 0; i < springCount; i++) {
    const i3 = i * 3;
    const a = s.springs[i3], b = s.springs[i3 + 1], rest = s.springs[i3 + 2];
    const dx = s.posX[b] - s.posX[a];
    const dy = s.posY[b] - s.posY[a];
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 0.001) continue;
    const force = s.SPRING_K * (dist - rest) / dist;
    const fx = dx * force, fy = dy * force;
    s.velX[a] += fx; s.velY[a] += fy;
    s.velX[b] -= fx; s.velY[b] -= fy;
  }
  const n = s.COLS * s.ROWS;
  for (let i = 0; i < n; i++) {
    s.velX[i] += Math.sin(t * 0.55 + s.restX[i] * 0.0036 + s.restY[i] * 0.0018) * s.DRIFT_STRENGTH * 0.022;
    s.velY[i] += Math.cos(t * 0.48 + s.restY[i] * 0.0042) * s.DRIFT_STRENGTH * 0.018;
    s.velX[i] += (s.restX[i] - s.posX[i]) * s.RETURN_FORCE;
    s.velY[i] += (s.restY[i] - s.posY[i]) * s.RETURN_FORCE;
    s.velX[i] *= s.DAMPING; s.velY[i] *= s.DAMPING;
    s.posX[i] += s.velX[i]; s.posY[i] += s.velY[i];
  }
}

function tensionColor(tension: number, wave: number) {
  const t = Math.max(0, Math.min(1, tension));
  const pulse = 0.38 + Math.max(0, Math.min(1, wave)) * 0.62;
  const r = 150 + (192 - 150) * pulse + Math.max(0, (t - 0.58) / 0.42) * (239 - 192);
  const g = 214 + (254 - 214) * pulse + Math.max(0, (t - 0.58) / 0.42) * (255 - 254);
  const b = (4 * pulse) + Math.max(0, (t - 0.58) / 0.42) * 180;
  const a = 0.14 + t * 0.52;
  return { r: Math.round(r), g: Math.round(g), b: Math.round(Math.min(255, b)), a };
}

function render(ctx: CanvasRenderingContext2D, s: GridState, t: number) {
  // Fade previous frame
  const bg = ctx.createLinearGradient(0, 0, 0, s.H);
  bg.addColorStop(0, "rgba(4,8,1,0.18)");
  bg.addColorStop(1, "rgba(0,0,0,0.42)");
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, s.W, s.H);


  const avg = (s.spacingX + s.spacingY) * 0.5;
  const tScale = 1 / (avg * 0.32);
  const breathe = 0.9 + 0.16 * Math.sin(t * 0.78);

  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";

  // Draw springs
  const springCount = s.springs.length / 3;
  for (let i = 0; i < springCount; i++) {
    const i3 = i * 3;
    const a = s.springs[i3], b = s.springs[i3 + 1], rest = s.springs[i3 + 2];
    const ax = s.posX[a], ay = s.posY[a], bx = s.posX[b], by = s.posY[b];
    const dist = Math.sqrt((bx - ax) ** 2 + (by - ay) ** 2);
    const tension = Math.abs(dist - rest) * tScale;
    const wave = 0.5 + 0.5 * Math.sin(t * 1.6 + (ax + ay) * 0.004);
    const col = tensionColor(tension, wave);

    // Outer line
    const alpha = Math.min(0.28, (0.045 + tension * 0.2) * breathe);
    ctx.strokeStyle = `rgba(${col.r},${col.g},${col.b},${alpha})`;
    ctx.lineWidth = 1.2 + tension * 1.45;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();

    // Inner bright core
    ctx.strokeStyle = `rgba(${Math.min(255, col.r + 26)},${Math.min(255, col.g + 22)},${Math.min(255, col.b + 18)},${Math.min(0.82, col.a * 0.72)})`;
    ctx.lineWidth = 0.35 + tension * 0.56;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
  }

}
