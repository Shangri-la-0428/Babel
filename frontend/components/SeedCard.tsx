"use client";

import { memo } from "react";
import { SavedSeedData } from "@/lib/api";
import { useLocale } from "@/lib/locale-context";
import { TYPE_STYLES } from "./SeedDataView";

export default memo(function SeedCard({
  seed,
  onDelete,
  onSelect,
}: {
  seed: SavedSeedData;
  onDelete?: (id: string) => void;
  onSelect?: (seed: SavedSeedData) => void;
}) {
  const { t } = useLocale();
  return (
    <button
      type="button"
      className="bg-surface-1 border border-b-DEFAULT p-4 flex flex-col gap-3 hover:border-b-hover transition-colors group cursor-pointer text-left w-full"
      onClick={() => onSelect?.(seed)}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="text-body font-semibold truncate">{seed.name}</div>
        <span
          className={`text-micro tracking-wider px-2.5 py-0.5 border leading-none font-medium transition-shadow group-hover:shadow-[0_0_6px_currentColor] ${
            TYPE_STYLES[seed.type] || "text-t-muted border-b-DEFAULT"
          }`}
        >
          {seed.type}
        </span>
      </div>

      {/* Description */}
      {seed.description && (
        <div className="text-detail text-t-muted normal-case tracking-normal leading-relaxed line-clamp-2">
          {seed.description}
        </div>
      )}

      {/* Tags */}
      {(seed.tags || []).length > 0 && (
        <div className="flex flex-wrap gap-1">
          {(seed.tags || []).map((tag, i) => (
            <span
              key={i}
              className="text-micro text-t-dim tracking-wider px-2 py-0.5 border border-surface-3"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between min-w-0 gap-2">
        <span className="text-micro text-t-dim tracking-wider truncate min-w-0">
          {seed.source_world ? `${t("source")}: ${seed.source_world}` : ""}
        </span>
        {onDelete && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              const card = e.currentTarget.closest('button');
              if (card) {
                card.style.animation = 'crt-glitch 200ms ease both';
                setTimeout(() => onDelete?.(seed.id), 200);
              }
            }}
            className="text-micro text-t-dim tracking-wider hover:text-danger transition-[colors,opacity] opacity-0 group-hover:opacity-100"
          >
            {t("delete")}
          </button>
        )}
      </div>
    </button>
  );
})
