"use client";

import { EventData, extractSeed } from "@/lib/api";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

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
  onExtract,
  extractedId,
}: {
  event: EventData;
  isNew?: boolean;
  onExtract?: (eventId: string) => void;
  extractedId?: string | null;
}) {
  const isWorld = event.action_type === "world_event";
  const style = TYPE_STYLES[event.action_type] || "text-t-muted border-surface-3";
  const isExtracted = extractedId === event.id;

  return (
    <div
      className={`grid grid-cols-[56px_80px_1fr_auto_auto] gap-3 items-baseline px-4 py-3 border-b border-b-DEFAULT hover:bg-surface-1 transition-colors group ${
        isNew
          ? isWorld
            ? "animate-[event-flash-danger_1.2s_ease]"
            : "animate-[event-flash_1.2s_ease]"
          : ""
      }`}
    >
      <span className="text-micro text-t-dim tracking-wider tabular-nums">
        {String(event.tick).padStart(3, "0")}
      </span>
      <span
        className={`text-detail font-medium truncate ${
          isWorld ? "text-danger" : "text-primary"
        }`}
      >
        {event.agent_name || "System"}
      </span>
      <span className="text-detail text-t-secondary normal-case tracking-normal leading-normal">
        {event.result}
      </span>
      <span
        className={`text-micro tracking-wider px-2 py-[2px] border whitespace-nowrap ${style}`}
      >
        {event.action_type}
      </span>
      {onExtract && (
        <button
          onClick={() => onExtract(event.id)}
          className={`text-micro tracking-wider transition-colors ${
            isExtracted
              ? "text-primary"
              : "text-t-dim opacity-0 group-hover:opacity-100 hover:text-primary"
          }`}
          title="Extract as event seed"
        >
          {isExtracted ? "Saved" : "Seed"}
        </button>
      )}
    </div>
  );
});

function TickDivider({ tick }: { tick: number }) {
  return (
    <div className="px-4 py-2 border-b border-b-DEFAULT bg-surface-1 text-micro text-t-muted tracking-widest">
      Tick {String(tick).padStart(3, "0")}
    </div>
  );
}

export default function EventFeed({
  events,
  newEventIds,
  sessionId,
}: {
  events: EventData[];
  newEventIds?: Set<string>;
  sessionId?: string;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [extractedId, setExtractedId] = useState<string | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events.length]);

  const handleExtract = useCallback(
    async (eventId: string) => {
      if (!sessionId) return;
      try {
        await extractSeed("event", sessionId, eventId);
        setExtractedId(eventId);
        setTimeout(() => setExtractedId(null), 2000);
      } catch {
        // silent
      }
    },
    [sessionId]
  );

  const grouped = useMemo(() => {
    const result: { tick: number; events: EventData[] }[] = [];
    let currentTick = -1;

    for (const event of events) {
      if (event.tick !== currentTick) {
        currentTick = event.tick;
        result.push({ tick: currentTick, events: [] });
      }
      result[result.length - 1].events.push(event);
    }
    return result;
  }, [events]);

  return (
    <div className="flex flex-col" role="log" aria-label="Simulation events" aria-live="polite">
      {grouped.map((group) => (
        <div key={group.tick}>
          <TickDivider tick={group.tick} />
          {group.events.map((event) => (
            <EventItem
              key={event.id}
              event={event}
              isNew={newEventIds?.has(event.id)}
              onExtract={sessionId ? handleExtract : undefined}
              extractedId={extractedId}
            />
          ))}
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
