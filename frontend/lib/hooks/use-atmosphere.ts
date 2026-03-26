"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { WorldState } from "@/lib/api";

interface AtmosphereState {
  isNight: boolean;
  shaderEnergy: number;
  shaderRipple: number;
  tension: number; // dead agents / total agents
}

/**
 * Computes atmosphere values for WorldShader and tension vignette
 * from world state, simulation status, and event count.
 */
export function useAtmosphere(
  state: WorldState | null,
  status: string,
  eventCount: number
): AtmosphereState {
  const [shaderRipple, setShaderRipple] = useState(0);
  const prevEventCountRef = useRef(0);

  // Pulse shader on new events
  useEffect(() => {
    if (eventCount > prevEventCountRef.current && prevEventCountRef.current > 0) {
      setShaderRipple(1);
      const t = setTimeout(() => setShaderRipple(0), 600);
      return () => clearTimeout(t);
    }
    prevEventCountRef.current = eventCount;
  }, [eventCount]);

  const isNight = state?.world_time?.is_night ?? false;
  const shaderEnergy = status === "running" ? 1 : 0;

  const tension = useMemo(() => {
    if (!state?.agents) return 0;
    const agents = Object.values(state.agents);
    if (agents.length === 0) return 0;
    const dead = agents.filter((a) => a.status === "dead").length;
    return Math.min(dead / agents.length, 1);
  }, [state?.agents]);

  return { isNight, shaderEnergy, shaderRipple, tension };
}
