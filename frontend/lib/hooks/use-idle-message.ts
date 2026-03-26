"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import type { TransKey } from "@/lib/i18n";

const IDLE_KEYS: TransKey[] = ["idle_0", "idle_1", "idle_2", "idle_3", "idle_4"];
const IDLE_DELAY = 10000;
const IDLE_CYCLE = 15000;
const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "scroll", "touchstart"];

/**
 * Cycles through idle personality messages after user inactivity.
 * Resets on any user interaction.
 */
export function useIdleMessage(t: (key: TransKey, ...args: string[]) => string): string | null {
  const [message, setMessage] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const cycleRef = useRef<ReturnType<typeof setInterval>>();
  const idxRef = useRef(0);

  const reset = useCallback(() => {
    setMessage(null);
    clearTimeout(timerRef.current);
    clearInterval(cycleRef.current);
    timerRef.current = setTimeout(() => {
      idxRef.current = 0;
      setMessage(t(IDLE_KEYS[0]));
      cycleRef.current = setInterval(() => {
        idxRef.current = (idxRef.current + 1) % IDLE_KEYS.length;
        setMessage(t(IDLE_KEYS[idxRef.current]));
      }, IDLE_CYCLE);
    }, IDLE_DELAY);
  }, [t]);

  useEffect(() => {
    reset();
    ACTIVITY_EVENTS.forEach((e) =>
      document.addEventListener(e, reset, { passive: true })
    );
    return () => {
      clearTimeout(timerRef.current);
      clearInterval(cycleRef.current);
      ACTIVITY_EVENTS.forEach((e) => document.removeEventListener(e, reset));
    };
  }, [reset]);

  return message;
}
