"use client";

import { useState, useRef, useEffect } from "react";
import { SavedSeedData, saveAsset } from "@/lib/api";
import { useLocale } from "@/lib/locale-context";
import { TYPE_STYLES, renderSeedData } from "./SeedDataView";
import Modal from "./Modal";

export default function SeedPreview({
  seed,
  onClose,
  onSaved,
}: {
  seed: SavedSeedData;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const { t } = useLocale();
  const [name, setName] = useState(seed.name || "");
  const [description, setDescription] = useState(seed.description || "");
  const [tagsInput, setTagsInput] = useState((seed.tags || []).join(", "));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const style = TYPE_STYLES[seed.type] || "text-t-muted border-b-DEFAULT";

  const [saveError, setSaveError] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(closeTimerRef.current), []);

  async function handleSave() {
    if (saving || saved) return;
    setSaving(true);
    setSaveError(false);
    try {
      const tags = tagsInput
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      await saveAsset({
        type: seed.type,
        name: name.trim() || seed.name,
        description: description.trim(),
        tags,
        data: seed.data,
        source_world: seed.source_world,
      });
      setSaved(true);
      onSaved?.();
      closeTimerRef.current = setTimeout(() => onClose(), 800);
    } catch {
      setSaving(false);
      setSaveError(true);
    }
  }

  return (
    <Modal onClose={onClose} ariaLabel={t("seed_preview")} width="w-[560px]">
      {/* Header */}
      <div className="px-5 py-3 border-b border-b-DEFAULT bg-surface-1 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <span className={`text-micro tracking-wider px-2.5 py-0.5 border leading-none font-medium ${style}`}>
            {seed.type}
          </span>
          <span className="text-body font-semibold">{t("seed_preview")}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-micro text-t-muted tracking-wider hover:text-t-DEFAULT transition-colors"
        >
          {t("close")}
        </button>
      </div>

      {/* Editable fields */}
      <div className="px-5 py-4 border-b border-b-DEFAULT flex flex-col gap-3 shrink-0">
        <div>
          <label htmlFor="seed-name" className="text-micro text-t-muted tracking-widest block mb-1.5">{t("seed_name")}</label>
          <input
            id="seed-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full h-9 px-3 bg-void border border-b-DEFAULT text-detail text-t-DEFAULT normal-case tracking-normal focus:border-primary focus:outline-none hover:border-b-hover transition-colors"
          />
        </div>
        <div>
          <label htmlFor="seed-desc" className="text-micro text-t-muted tracking-widest block mb-1.5">{t("seed_desc")}</label>
          <textarea
            id="seed-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 bg-void border border-b-DEFAULT text-detail text-t-DEFAULT normal-case tracking-normal leading-relaxed focus:border-primary focus:outline-none hover:border-b-hover transition-colors resize-none"
          />
        </div>
        <div>
          <label htmlFor="seed-tags" className="text-micro text-t-muted tracking-widest block mb-1.5">{t("seed_tags")}</label>
          <input
            id="seed-tags"
            type="text"
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            className="w-full h-9 px-3 bg-void border border-b-DEFAULT text-detail text-t-DEFAULT normal-case tracking-normal focus:border-primary focus:outline-none hover:border-b-hover transition-colors"
          />
        </div>
        {seed.source_world && (
          <div className="text-micro text-t-dim tracking-wider">
            {t("source")}: {seed.source_world}
          </div>
        )}
      </div>

      {/* Data preview */}
      <div className="px-5 py-4 overflow-y-auto flex-1" aria-label={t("content_label")}>
        {renderSeedData(seed.type, seed.data, t)}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-b-DEFAULT bg-surface-1 shrink-0">
        {saveError && (
          <span className="text-micro text-danger tracking-wider mr-auto">{t("delete_failed")}</span>
        )}
        <button
          type="button"
          onClick={onClose}
          className="h-8 px-4 text-micro tracking-wider text-t-dim hover:text-t-DEFAULT transition-colors"
        >
          {t("cancel")}
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || saved}
          className={`h-8 px-5 text-micro font-medium tracking-wider border active:scale-[0.97] transition-[colors,transform] ${
            saved
              ? "border-primary text-primary"
              : saveError
              ? "border-danger text-danger hover:border-danger/80 hover:text-danger/80"
              : "border-b-DEFAULT text-t-muted hover:border-primary hover:text-primary disabled:opacity-30 disabled:pointer-events-none"
          }`}
        >
          {saved ? t("saved") : saving ? t("saving") : saveError ? t("retry") : t("save_to_assets")}
        </button>
      </div>
    </Modal>
  );
}
