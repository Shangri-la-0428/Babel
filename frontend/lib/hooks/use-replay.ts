"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { WorldState, EventData, reconstructAtTick, getTimeline } from "@/lib/api";

export interface UseReplayReturn {
  replayTick: number | null;
  replayState: WorldState | null;
  replayEvents: EventData[];
  isReplay: boolean;
  seeking: boolean;
  seekTo: (tick: number) => void;
  exitReplay: () => void;
  maxTick: number;
  replayActiveRef: React.MutableRefObject<boolean>;
}

export function useReplay(sessionId: string, liveTick: number): UseReplayReturn {
  const [replayTick, setReplayTick] = useState<number | null>(null);
  const [replayState, setReplayState] = useState<WorldState | null>(null);
  const [replayEvents, setReplayEvents] = useState<EventData[]>([]);
  const [seeking, setSeeking] = useState(false);
  const [maxTick, setMaxTick] = useState(0);
  const replayActiveRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Keep maxTick in sync with live tick
  useEffect(() => {
    if (liveTick > maxTick) setMaxTick(liveTick);
  }, [liveTick, maxTick]);

  // Fetch timeline on mount to determine maxTick
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    getTimeline(sessionId).then((res) => {
      if (cancelled) return;
      const lastNode = res.nodes[res.nodes.length - 1];
      if (lastNode && lastNode.tick > 0) setMaxTick((prev) => Math.max(prev, lastNode.tick));
    }).catch(() => { /* timeline fetch is best-effort */ });
    return () => { cancelled = true; };
  }, [sessionId]);

  const seekTo = useCallback((tick: number) => {
    // If seeking to live tick, exit replay
    if (tick >= liveTick) {
      setReplayTick(null);
      setReplayState(null);
      setReplayEvents([]);
      replayActiveRef.current = false;
      setSeeking(false);
      return;
    }

    setReplayTick(tick);
    replayActiveRef.current = true;
    setSeeking(true);

    // Debounce rapid scrubbing
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      // Abort previous in-flight request
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const result = await reconstructAtTick(sessionId, tick, controller.signal);

        if (controller.signal.aborted) return;

        // Map to WorldState shape
        const agents: Record<string, unknown> = result.agent_states || {};
        const ws: WorldState = {
          session_id: sessionId,
          name: "",
          description: "",
          tick: result.tick,
          status: "paused",
          locations: [],
          rules: [],
          agents: agents as WorldState["agents"],
          recent_events: result.events_since_snapshot || [],
        };
        setReplayState(ws);
        setReplayEvents(result.events_since_snapshot || []);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        // Reconstruction failed — stay in replay but clear state
        setReplayState(null);
        setReplayEvents([]);
      } finally {
        if (!controller.signal.aborted) setSeeking(false);
      }
    }, 200);
  }, [sessionId, liveTick]);

  const exitReplay = useCallback(() => {
    clearTimeout(debounceRef.current);
    abortRef.current?.abort();
    setReplayTick(null);
    setReplayState(null);
    setReplayEvents([]);
    replayActiveRef.current = false;
    setSeeking(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearTimeout(debounceRef.current);
      abortRef.current?.abort();
    };
  }, []);

  return {
    replayTick,
    replayState,
    replayEvents,
    isReplay: replayTick !== null,
    seeking,
    seekTo,
    exitReplay,
    maxTick,
    replayActiveRef,
  };
}
