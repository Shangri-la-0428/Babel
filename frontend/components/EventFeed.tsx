"use client";

import { EventData } from "@/lib/api";
import { memo, useEffect, useMemo, useRef, useCallback } from "react";
import { useLocale } from "@/lib/locale-context";

/* ── Decode Transmission Effect (optimized: DOM-direct, no setState per frame) ── */
const GLITCH_CHARS = "█▓▒░▀▄│─╬";

const DecodeText = memo(function DecodeText({ text }: { text: string }) {
  const spanRef = useRef<HTMLSpanElement>(null);
  const glitchRef = useRef<HTMLSpanElement>(null);
  const frameRef = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      if (spanRef.current) spanRef.current.textContent = text;
      if (glitchRef.current) glitchRef.current.textContent = "";
      return;
    }

    const start = performance.now();
    function tick(now: number) {
      const p = Math.min((now - start) / 800, 1);
      const count = Math.floor(text.length * p);

      if (spanRef.current) spanRef.current.textContent = text.slice(0, count);

      if (p >= 1) {
        if (glitchRef.current) glitchRef.current.textContent = "";
        return;
      }

      if (glitchRef.current) {
        const remaining = text.slice(count);
        let glitched = "";
        for (let i = 0; i < remaining.length; i++) {
          glitched += remaining[i] === " " ? " " : GLITCH_CHARS[((now / 50 + i * 7) | 0) % GLITCH_CHARS.length];
        }
        glitchRef.current.textContent = glitched;
      }

      frameRef.current = requestAnimationFrame(tick);
    }
    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [text]);

  return (
    <>
      <span ref={spanRef} />
      <span ref={glitchRef} className="text-t-dim" />
    </>
  );
});

const TYPE_STYLES: Record<string, string> = {
  speak:       "text-info border-info",
  move:        "text-t-secondary border-surface-3",
  use_item:    "text-primary border-primary",
  trade:       "text-warning border-warning",
  observe:     "text-t-muted border-surface-3",
  wait:        "text-t-dim border-surface-3",
  world_event: "text-danger border-danger",
};

const EventItem = memo(function EventItem({
  event,
  isNew,
  onSeed,
}: {
  event: EventData;
  isNew?: boolean;
  onSeed?: (eventId: string) => void;
}) {
  const { t } = useLocale();
  const isWorld = event.action_type === "world_event";
  const style = TYPE_STYLES[event.action_type] || "text-t-muted border-surface-3";

  return (
    <div
      className={`grid grid-cols-[56px_80px_1fr_auto_auto] gap-3 items-baseline px-4 py-3 border-b border-b-DEFAULT hover:bg-surface-1 transition-colors group min-w-0 ${
        isNew
          ? isWorld
            ? "animate-[event-flash-danger_1.2s_ease]"
            : "animate-[event-flash_1.2s_ease]"
          : ""
      }`}
    >
      <span className="text-micro text-t-dim tracking-wider tabular-nums" aria-label={`Tick ${event.tick}`}>
        {String(event.tick).padStart(3, "0")}
      </span>
      <span
        className={`text-detail font-medium truncate ${
          isWorld ? "text-danger" : "text-primary"
        }`}
      >
        {event.agent_name || t("system")}
      </span>
      <span className="text-detail text-t-secondary normal-case tracking-normal leading-normal break-words min-w-0">
        {isNew ? <DecodeText text={event.result} /> : event.result}
      </span>
      <span
        className={`text-micro tracking-wider px-2 py-0.5 border whitespace-nowrap ${style}`}
        aria-label={event.action_type.replace(/_/g, " ")}
      >
        {event.action_type}
      </span>
      {onSeed && (
        <button
          onClick={() => onSeed(event.id)}
          className="text-micro tracking-wider transition-[colors,opacity] text-t-dim opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-primary"
          title={t("extract_seed")}
          aria-label={t("extract_seed")}
        >
          {t("seed")}
        </button>
      )}
    </div>
  );
});

function TickDivider({ tick: tickNum }: { tick: number }) {
  const { t } = useLocale();
  return (
    <div className="px-4 py-2 border-b border-b-DEFAULT bg-surface-1 text-micro text-t-muted tracking-widest">
      {t("tick")} {String(tickNum).padStart(3, "0")}
    </div>
  );
}

/** Only render the last RENDER_WINDOW events for performance */
const RENDER_WINDOW = 200;

export default function EventFeed({
  events,
  newEventIds,
  onSeed,
}: {
  events: EventData[];
  newEventIds?: Set<string>;
  onSeed?: (eventId: string) => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const { t } = useLocale();

  const safeEvents = useMemo(() => events || [], [events]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [safeEvents.length]);

  // Stable reference check for newEventIds
  const newIdsRef = useRef(newEventIds);
  newIdsRef.current = newEventIds;

  const isNew = useCallback((id: string) => newIdsRef.current?.has(id) ?? false, []);

  const grouped = useMemo(() => {
    // Window: only render the last RENDER_WINDOW events
    const windowed = safeEvents.length > RENDER_WINDOW
      ? safeEvents.slice(-RENDER_WINDOW)
      : safeEvents;

    const result: { tick: number; events: EventData[] }[] = [];
    let currentTick = -1;

    for (const event of windowed) {
      if (event.tick !== currentTick) {
        currentTick = event.tick;
        result.push({ tick: currentTick, events: [] });
      }
      result[result.length - 1].events.push(event);
    }
    return result;
  }, [safeEvents]);

  const trimmed = safeEvents.length > RENDER_WINDOW;

  return (
    <div className="flex flex-col" role="log" aria-label="Simulation events" aria-live="polite">
      {trimmed && (
        <div className="px-4 py-2 border-b border-b-DEFAULT bg-surface-1 text-micro text-t-dim tracking-wider text-center">
          {safeEvents.length - RENDER_WINDOW} {t("events_count")} {t("total")} &middot; {RENDER_WINDOW} {t("events_count")}
        </div>
      )}
      {grouped.map((group) => (
        <div key={group.tick}>
          <TickDivider tick={group.tick} />
          {group.events.map((event) => (
            <EventItem
              key={event.id}
              event={event}
              isNew={isNew(event.id)}
              onSeed={onSeed}
            />
          ))}
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
