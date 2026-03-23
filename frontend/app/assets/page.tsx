"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { fetchAssets, deleteAsset, SavedSeedData, SeedTypeValue } from "@/lib/api";
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

  async function handleDelete(id: string) {
    try {
      await deleteAsset(id);
      setSeeds((prev) => prev.filter((s) => s.id !== id));
      if (selected?.id === id) setSelected(null);
    } catch {
      setError(t("delete_failed"));
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
        <p className="text-detail text-t-muted normal-case tracking-normal mb-8">
          {t("assets_desc")}
        </p>

        {/* Error */}
        {error && (
          <ErrorBanner message={error} onDismiss={() => setError(null)} className="mb-4">
            <button onClick={loadSeeds} className="ml-3 text-micro tracking-wider text-danger underline hover:text-t-DEFAULT transition-colors shrink-0">
              {t("retry")}
            </button>
          </ErrorBanner>
        )}

        {/* Type filter tabs */}
        <div className="flex items-center gap-px mb-6 bg-b-DEFAULT w-fit">
          {SEED_TYPES.map(({ value, labelKey }) => (
            <button
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
          <EmptyState label="// EMPTY">
            <div className="text-body text-t-muted">{t("no_seeds_yet")}</div>
            <div className="text-detail text-t-dim normal-case tracking-normal text-center max-w-md">
              {t("no_seeds_desc")}
            </div>
            <a
              href="/"
              className="h-9 px-5 text-micro font-medium tracking-wider border border-b-DEFAULT text-t-muted hover:border-primary hover:text-primary active:scale-[0.97] transition-[colors,transform] inline-flex items-center"
            >
              {t("home")}
            </a>
          </EmptyState>
        ) : (
          <div className="grid grid-cols-3 gap-3 stagger-in">
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
    </div>
  );
}
