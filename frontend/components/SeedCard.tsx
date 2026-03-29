"use client";

import { memo, useRef, useEffect } from "react";
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
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(deleteTimerRef.current), []);

  return (
    <article className="group bg-surface-1 border border-b-DEFAULT hover:border-b-hover transition-colors">
      <button
        type="button"
        className="w-full p-4 flex flex-col gap-3 cursor-pointer text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-[-1px]"
        onClick={() => onSelect?.(seed)}
      >
        <div className="flex items-center justify-between gap-2 min-w-0">
          <div className="text-body font-semibold truncate min-w-0">{seed.name}</div>
          <span
            className={`text-micro tracking-wider px-2.5 py-0.5 border leading-none font-medium transition-shadow group-hover:shadow-[0_0_6px_currentColor] ${
              TYPE_STYLES[seed.type] || "text-t-muted border-b-DEFAULT"
            }`}
          >
            {seed.type}
          </span>
        </div>

        {seed.description && (
          <div className="text-detail text-t-muted normal-case tracking-normal leading-relaxed line-clamp-2">
            {seed.description}
          </div>
        )}

        {(seed.tags || []).length > 0 && (
          <div className="flex flex-wrap gap-1">
            {(seed.tags || []).map((tag, i) => (
              <span
                key={i}
                className="text-micro text-t-dim tracking-wider px-2 py-0.5 border border-surface-3 truncate max-w-[120px]"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </button>

      <div className="flex items-center justify-between min-w-0 gap-2 px-4 pb-4">
        <span className="text-micro text-t-dim tracking-wider truncate min-w-0" title={seed.source_world || undefined}>
          {seed.source_world ? `${t("source")}: ${seed.source_world}` : ""}
        </span>
        {onDelete && (
          <button
            type="button"
            onClick={(e) => {
              const card = e.currentTarget.closest("article");
              if (card && typeof card.animate === "function") {
                card.animate(
                  [
                    { filter: "none", opacity: 1 },
                    { filter: "contrast(1.4) saturate(1.1)", opacity: 0.85 },
                    { filter: "none", opacity: 1 },
                  ],
                  { duration: 180, easing: "ease-out" }
                );
              }
              deleteTimerRef.current = setTimeout(() => onDelete?.(seed.id), 180);
            }}
            className="text-micro text-t-dim tracking-wider hover:text-danger focus-visible:text-danger transition-[colors,opacity] opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
            aria-label={`${t("delete")} ${seed.name}`}
          >
            {t("delete")}
          </button>
        )}
      </div>
    </article>
  );
})
