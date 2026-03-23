"use client";

import { EventData } from "@/lib/api";
import { memo, useEffect, useMemo, useRef, useCallback } from "react";
import { useLocale } from "@/lib/locale-context";
import { DecodeText } from "./ui";

const TYPE_STYLES: Record<string, string> = {
  speak:       "text-info border-info",
  move:        "text-t-secondary border-surface-3",
  use_item:    "text-primary border-primary",
  trade:       "text-warning border-warning",
  observe:     "text-t-muted border-surface-3",
  wait:        "text-t-dim border-surface-3",
  world_event: "text-danger border-danger",
};

// Left-edge accent per action type — subtle signal stripe
const ACCENT_BORDER: Record<string, string> = {
  speak:       "border-l-info/40",
  move:        "border-l-surface-4",
  use_item:    "border-l-primary/40",
  trade:       "border-l-warning/40",
  observe:     "border-l-transparent",
  wait:        "border-l-transparent",
  world_event: "border-l-danger/60",
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
  const isSupporting = event.agent_role === "supporting";
  const style = TYPE_STYLES[event.action_type] || "text-t-muted border-surface-3";
  const accent = ACCENT_BORDER[event.action_type] || "border-l-transparent";

  return (
    <div
      className={`grid grid-cols-[56px_80px_1fr_auto_auto] gap-3 items-baseline px-4 py-3 border-b border-b-DEFAULT border-l-2 ${accent} hover:bg-surface-1 transition-colors group min-w-0 ${
        isSupporting ? "opacity-70" : ""
      } ${
        isNew
          ? isWorld
            ? ""
            : "animate-[event-flash_1.2s_ease]"
          : ""
      }`}
      style={isNew && isWorld ? { animation: "event-flash-danger 1.2s ease, crt-glitch 600ms ease both" } : undefined}
    >
      <span className="text-micro text-t-dim tracking-wider tabular-nums" aria-label={`Tick ${event.tick}`}>
        {String(event.tick).padStart(3, "0")}
      </span>
      <span
        className={`text-detail font-medium truncate ${
          isWorld ? "text-danger" : "text-primary"
        }`}
        title={event.agent_name || undefined}
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

function TickDivider({ tick: tickNum, worldTimeDisplay, isLatest }: { tick: number; worldTimeDisplay?: string; isLatest?: boolean }) {
  const { t } = useLocale();
  return (
    <div className="px-4 py-2 border-b border-b-DEFAULT bg-surface-1 text-micro text-t-muted tracking-widest flex items-center gap-3 relative overflow-hidden">
      <span>{t("tick")} {String(tickNum).padStart(3, "0")}</span>
      {worldTimeDisplay && !worldTimeDisplay.startsWith("Tick") && (
        <span className="text-t-dim">{worldTimeDisplay}</span>
      )}
      {isLatest && (
        <span
          key={`sweep-${tickNum}`}
          className="absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-primary/10 to-transparent pointer-events-none animate-[tick-sweep_800ms_cubic-bezier(0.16,1,0.3,1)_both]"
          aria-hidden="true"
        />
      )}
    </div>
  );
}

/** Only render the last RENDER_WINDOW events for performance */
const RENDER_WINDOW = 200;

export default function EventFeed({
  events,
  newEventIds,
  onSeed,
  worldTimeDisplay,
}: {
  events: EventData[];
  newEventIds?: Set<string>;
  onSeed?: (eventId: string) => void;
  worldTimeDisplay?: string;
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
      {grouped.map((group, gi) => (
        <div key={group.tick}>
          <TickDivider tick={group.tick} worldTimeDisplay={gi === grouped.length - 1 ? worldTimeDisplay : undefined} isLatest={gi === grouped.length - 1} />
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
