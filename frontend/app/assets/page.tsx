"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { fetchAssets, deleteAsset, saveAsset, SavedSeedData, SeedTypeValue } from "@/lib/api";
import { TransKey } from "@/lib/i18n";
import { useLocale } from "@/lib/locale-context";
import Nav from "@/components/Nav";
import Settings from "@/components/Settings";
import SeedCard from "@/components/SeedCard";
import SeedDetail from "@/components/SeedDetail";
import { ErrorBanner, EmptyState, SkeletonLine } from "@/components/ui";

const SEED_TYPES: { value: SeedTypeValue | "all"; labelKey: TransKey }[] = [
  { value: "all", labelKey: "all" },
  { value: "world", labelKey: "world" },
  { value: "agent", labelKey: "agent" },
  { value: "item", labelKey: "item" },
  { value: "location", labelKey: "location" },
  { value: "event", labelKey: "event" },
];

export default function AssetsPage() {
  const { t } = useLocale();
  const [seeds, setSeeds] = useState<SavedSeedData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<SeedTypeValue | "all">("all");
  const [selected, setSelected] = useState<SavedSeedData | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ seed: SavedSeedData; timer: ReturnType<typeof setTimeout> } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const mountedRef = useRef(true);

  const loadSeeds = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchAssets(filter === "all" ? undefined : filter);
      if (!mountedRef.current) return;
      setSeeds(Array.isArray(data) ? data : []);
      setError(null);
    } catch {
      if (!mountedRef.current) return;
      setError(t("failed_load"));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [filter, t]);

  useEffect(() => {
    mountedRef.current = true;
    loadSeeds();
    return () => { mountedRef.current = false; };
  }, [loadSeeds]);

  function handleDelete(id: string) {
    const seed = seeds.find((s) => s.id === id);
    if (!seed) return;
    // Optimistic remove from UI
    setSeeds((prev) => prev.filter((s) => s.id !== id));
    if (selected?.id === id) setSelected(null);
    // Cancel any previous pending delete
    if (pendingDelete) clearTimeout(pendingDelete.timer);
    // Schedule real delete after 5s
    const timer = setTimeout(async () => {
      try {
        await deleteAsset(id);
      } catch {
        // Restore on failure
        setSeeds((prev) => [seed, ...prev]);
        setError(t("delete_failed"));
      }
      setPendingDelete(null);
    }, 5000);
    setPendingDelete({ seed, timer });
  }

  function handleUndoDelete() {
    if (!pendingDelete) return;
    clearTimeout(pendingDelete.timer);
    setSeeds((prev) => [pendingDelete.seed, ...prev]);
    setPendingDelete(null);
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    if (file.size > 1_048_576) {
      setImportError(t("import_too_large"));
      return;
    }

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);

      const VALID_TYPES = ["world", "agent", "item", "location", "event"];
      if (!parsed.type || !VALID_TYPES.includes(parsed.type) ||
          !parsed.name || typeof parsed.name !== "string" ||
          !parsed.data || typeof parsed.data !== "object") {
        setImportError(t("import_invalid"));
        return;
      }

      await saveAsset({
        type: parsed.type,
        name: parsed.name,
        description: parsed.description || "",
        tags: parsed.tags || [],
        data: parsed.data,
      });

      setImportError(null);
      loadSeeds();
    } catch {
      setImportError(t("import_invalid"));
    }
  }

  const counts = seeds.reduce(
    (acc, s) => {
      acc[s.type] = (acc[s.type] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  return (
    <div className="min-h-screen flex flex-col bg-void">
      <Nav activePage="assets" showSettings={showSettings} onToggleSettings={() => setShowSettings(!showSettings)} />

      {showSettings && (
        <Settings onClose={() => setShowSettings(false)} onSave={() => setShowSettings(false)} />
      )}

      <main className="flex-1 flex flex-col px-6 py-8 max-w-5xl mx-auto w-full">
        <a href="/" className="text-micro text-t-muted tracking-wider hover:text-t-DEFAULT transition-colors mb-4 inline-block">
          {t("back")}
        </a>
        <h1 className="font-sans text-title font-bold tracking-tight mb-2">
          {t("assets_title")}
        </h1>
        <div className="flex items-center justify-between mb-8">
          <p className="text-detail text-t-muted normal-case tracking-normal">
            {t("assets_desc")}
          </p>
          <div className="flex items-center gap-3 shrink-0">
            {importError && (
              <span className="text-micro text-danger tracking-wider">{importError}</span>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,.babel.json"
              onChange={handleImport}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="h-9 px-4 text-micro font-medium tracking-wider border border-b-DEFAULT text-t-muted hover:border-primary hover:text-primary active:scale-[0.97] transition-[colors,transform]"
            >
              {t("import_seed")}
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <ErrorBanner message={error} onDismiss={() => setError(null)} className="mb-4">
            <button type="button" onClick={loadSeeds} className="ml-3 text-micro tracking-wider text-danger underline hover:text-t-DEFAULT transition-colors shrink-0">
              {t("retry")}
            </button>
          </ErrorBanner>
        )}

        {/* Type filter tabs */}
        <div className="flex items-center gap-px mb-6 bg-b-DEFAULT w-fit">
          {SEED_TYPES.map(({ value, labelKey }) => (
            <button
              type="button"
              key={value}
              onClick={() => setFilter(value)}
              className={`px-4 py-2 text-micro tracking-widest transition-colors ${
                filter === value
                  ? "bg-surface-2 text-primary"
                  : "bg-void text-t-muted hover:text-t-DEFAULT hover:bg-surface-1"
              }`}
            >
              {t(labelKey)}
              {value !== "all" && counts[value] ? (
                <span className="ml-1.5 text-t-dim">{counts[value]}</span>
              ) : null}
            </button>
          ))}
        </div>

        {/* Seed grid */}
        {loading ? (
          <div className="grid grid-cols-3 gap-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-surface-1 border border-b-DEFAULT p-4">
                <SkeletonLine className="h-4 w-32 mb-3" />
                <SkeletonLine className="h-3 w-full mb-2" />
                <SkeletonLine className="h-3 w-20" />
              </div>
            ))}
          </div>
        ) : seeds.length === 0 ? (
          <EmptyState label={t("archive_empty")} variant="scanning">
            <div className="text-body text-t-muted">{t("no_seeds_yet")}</div>
            <div className="text-detail text-t-dim normal-case tracking-normal text-center max-w-md">
              {t("no_seeds_desc")}
            </div>
            <a
              href="/"
              className="h-9 px-5 text-micro font-medium tracking-wider border border-b-DEFAULT text-t-muted hover:bg-surface-1/20 hover:border-primary hover:text-primary active:scale-[0.97] transition-[colors,transform] inline-flex items-center"
            >
              {t("home")}
            </a>
          </EmptyState>
        ) : (
          <div key={filter} className="grid grid-cols-3 gap-3 stagger-in">
            {seeds.map((seed) => (
              <SeedCard
                key={seed.id}
                seed={seed}
                onDelete={handleDelete}
                onSelect={setSelected}
              />
            ))}
          </div>
        )}
      </main>

      {/* Seed detail modal */}
      {selected && (
        <SeedDetail seed={selected} onClose={() => setSelected(null)} />
      )}

      {/* Undo delete toast */}
      {pendingDelete && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-toast flex items-center gap-4 px-5 py-3 bg-surface-1 border border-b-DEFAULT animate-slide-up">
          <span className="text-detail text-t-secondary normal-case tracking-normal">
            {t("seed_deleted")}
          </span>
          <button
            type="button"
            onClick={handleUndoDelete}
            className="text-micro font-medium tracking-wider text-primary hover:text-primary/80 transition-colors"
          >
            {t("undo")}
          </button>
        </div>
      )}
    </div>
  );
}
