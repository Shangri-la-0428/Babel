"use client";

import { useRef, useEffect, useCallback, useState } from "react";

interface SpringConfig {
  tension?: number;   // stiffness — higher = snappier (default 170)
  friction?: number;  // damping — higher = less bounce (default 26)
  mass?: number;      // inertia — higher = heavier (default 1)
  precision?: number; // settle threshold (default 0.01)
}

/**
 * Lightweight spring physics hook. Returns the animated value.
 *
 * @param target - Value the spring moves toward
 * @param config - Spring parameters
 * @param from   - Initial value (only used on first render, ignored after)
 */
export function useSpring(target: number, config: SpringConfig = {}, from?: number): number {
  const {
    tension = 170,
    friction = 26,
    mass = 1,
    precision = 0.01,
  } = config;

  const initial = useRef(from ?? target);
  const [value, setValue] = useState(initial.current);
  const stateRef = useRef({
    value: initial.current,
    velocity: 0,
    settled: initial.current === target,
  });
  const targetRef = useRef(target);
  const configRef = useRef({ tension, friction, mass, precision });
  const rafRef = useRef(0);
  const lastTimeRef = useRef(0);
  const lastRendered = useRef(initial.current);

  configRef.current = { tension, friction, mass, precision };
  targetRef.current = target;

  const tick = useCallback(() => {
    const now = performance.now();
    const dt = Math.min((now - lastTimeRef.current) / 1000, 0.064);
    lastTimeRef.current = now;

    const s = stateRef.current;
    const c = configRef.current;
    const t = targetRef.current;

    // F = -k(x - target) - d·v
    const accel = (-c.tension * (s.value - t) - c.friction * s.velocity) / c.mass;
    s.velocity += accel * dt;
    s.value += s.velocity * dt;

    if (Math.abs(s.velocity) < c.precision && Math.abs(s.value - t) < c.precision) {
      s.value = t;
      s.velocity = 0;
      s.settled = true;
      lastRendered.current = t;
      setValue(t);
    } else {
      s.settled = false;
      // Only re-render when delta is perceptible (skip sub-pixel changes)
      if (Math.abs(s.value - lastRendered.current) > 0.005) {
        lastRendered.current = s.value;
        setValue(s.value);
      }
      rafRef.current = requestAnimationFrame(tick);
    }
  }, []);

  useEffect(() => {
    // Instant for reduced-motion users
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      stateRef.current = { value: target, velocity: 0, settled: true };
      setValue(target);
      return;
    }

    if (stateRef.current.settled && Math.abs(stateRef.current.value - target) < configRef.current.precision) {
      return;
    }

    stateRef.current.settled = false;
    lastTimeRef.current = performance.now();
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(rafRef.current);
  }, [target, tick]);

  return value;
}
