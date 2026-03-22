"use client";

import { SavedSeedData, SeedTypeValue } from "@/lib/api";

const TYPE_LABELS: Record<SeedTypeValue, string> = {
  world: "World",
  agent: "Agent",
  item: "Item",
  location: "Location",
  event: "Event",
};

const TYPE_STYLES: Record<SeedTypeValue, string> = {
  world: "text-primary border-primary",
  agent: "text-info border-info",
  item: "text-warning border-warning",
  location: "text-t-secondary border-t-secondary",
  event: "text-danger border-danger",
};

export default function SeedCard({
  seed,
  onDelete,
  onSelect,
}: {
  seed: SavedSeedData;
  onDelete?: (id: string) => void;
  onSelect?: (seed: SavedSeedData) => void;
}) {
  return (
    <div
      className="bg-surface-1 border border-b-DEFAULT p-4 flex flex-col gap-3 hover:border-b-hover transition-colors group cursor-pointer"
      onClick={() => onSelect?.(seed)}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="text-body font-semibold truncate">{seed.name}</div>
        <span
          className={`text-micro tracking-wider px-2.5 py-[2px] border leading-none font-medium ${
            TYPE_STYLES[seed.type] || "text-t-muted border-b-DEFAULT"
          }`}
        >
          {TYPE_LABELS[seed.type] || seed.type}
        </span>
      </div>

      {/* Description */}
      {seed.description && (
        <div className="text-detail text-t-muted normal-case tracking-normal leading-relaxed line-clamp-2">
          {seed.description}
        </div>
      )}

      {/* Tags */}
      {seed.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {seed.tags.map((tag, i) => (
            <span
              key={i}
              className="text-micro text-t-dim tracking-wider px-2 py-[1px] border border-surface-3"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between">
        <span className="text-micro text-t-dim tracking-wider">
          {seed.source_world ? `from ${seed.source_world}` : "manual"}
        </span>
        {onDelete && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(seed.id);
            }}
            className="text-micro text-t-dim tracking-wider hover:text-danger transition-colors opacity-0 group-hover:opacity-100"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
