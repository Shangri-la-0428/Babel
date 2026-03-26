"use client";

import { useState, useRef, useEffect } from "react";

interface WorldTransitions {
  showWorldBoot: boolean;
  showWorldEnded: boolean;
}

/**
 * Manages world boot scan and world ended overlay transitions
 * based on simulation status changes.
 */
export function useWorldTransitions(status: string): WorldTransitions {
  const [showWorldBoot, setShowWorldBoot] = useState(false);
  const [showWorldEnded, setShowWorldEnded] = useState(false);
  const prevStatus = useRef(status);

  useEffect(() => {
    // Boot scan on paused → running
    if (prevStatus.current !== "running" && status === "running") {
      setShowWorldBoot(true);
      const t = setTimeout(() => setShowWorldBoot(false), 600);
      prevStatus.current = status;
      return () => clearTimeout(t);
    }
    // Ended overlay on any status → ended
    if (prevStatus.current !== "ended" && status === "ended") {
      setShowWorldEnded(true);
      const t = setTimeout(() => setShowWorldEnded(false), 1500);
      prevStatus.current = status;
      return () => clearTimeout(t);
    }
    prevStatus.current = status;
  }, [status]);

  return { showWorldBoot, showWorldEnded };
}
