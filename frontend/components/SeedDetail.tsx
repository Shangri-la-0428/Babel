"use client";

import { SavedSeedData } from "@/lib/api";
import { useLocale } from "@/lib/locale-context";
import { TYPE_STYLES, renderSeedData } from "./SeedDataView";
import Modal from "./Modal";

export default function SeedDetail({
  seed,
  onClose,
}: {
  seed: SavedSeedData;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const style = TYPE_STYLES[seed.type] || "text-t-muted border-b-DEFAULT";

  return (
    <Modal onClose={onClose} ariaLabel={seed.name} width="w-[560px]">
      {/* Header */}
      <div className="px-6 py-4 border-b border-b-DEFAULT flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <span className={`text-micro tracking-wider px-2.5 py-0.5 border leading-none font-medium ${style}`}>
            {seed.type}
          </span>
          <span className="text-body font-semibold">{seed.name}</span>
        </div>
        <button
          onClick={onClose}
          className="text-micro text-t-muted tracking-wider hover:text-t-DEFAULT transition-colors"
        >
          {t("close")}
        </button>
      </div>

      {/* Description */}
      {seed.description && (
        <div className="px-6 py-3 border-b border-b-DEFAULT">
          <div className="text-detail text-t-muted normal-case tracking-normal leading-relaxed">
            {seed.description}
          </div>
        </div>
      )}

      {/* Data */}
      <div className="px-6 py-4 overflow-y-auto flex-1">
        {renderSeedData(seed.type, seed.data, t)}
      </div>

      {/* Footer */}
      <div className="px-6 py-3 border-t border-b-DEFAULT flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          {(seed.tags || []).length > 0 && (
            <div className="flex flex-wrap gap-1">
              {(seed.tags || []).map((tag, i) => (
                <span key={i} className="text-micro text-t-dim tracking-wider px-2 py-0.5 border border-surface-3">
                  {tag}
                </span>
              ))}
            </div>
          )}
          {seed.source_world && (
            <span className="text-micro text-t-dim tracking-wider">
              {t("source")}: {seed.source_world}
            </span>
          )}
        </div>
        <span className="text-micro text-t-dim tracking-wider tabular-nums">
          {seed.id}
        </span>
      </div>
    </Modal>
  );
}
