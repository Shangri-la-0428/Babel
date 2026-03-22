"use client";

import { useEffect, useState, useCallback } from "react";
import { fetchAssets, deleteAsset, SavedSeedData, SeedTypeValue } from "@/lib/api";
import Nav from "@/components/Nav";
import SeedCard from "@/components/SeedCard";
import SeedDetail from "@/components/SeedDetail";

const SEED_TYPES: { value: SeedTypeValue | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "world", label: "World" },
  { value: "agent", label: "Agent" },
  { value: "item", label: "Item" },
  { value: "location", label: "Location" },
  { value: "event", label: "Event" },
];

export default function AssetsPage() {
  const [seeds, setSeeds] = useState<SavedSeedData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<SeedTypeValue | "all">("all");
  const [selected, setSelected] = useState<SavedSeedData | null>(null);

  const loadSeeds = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchAssets(filter === "all" ? undefined : filter);
      setSeeds(data);
      setError(null);
    } catch {
      setError("Failed to load assets");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    loadSeeds();
  }, [loadSeeds]);

  async function handleDelete(id: string) {
    try {
      await deleteAsset(id);
      setSeeds((prev) => prev.filter((s) => s.id !== id));
      if (selected?.id === id) setSelected(null);
    } catch {
      setError("Failed to delete seed");
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
      <Nav activePage="assets" />

      <main className="flex-1 flex flex-col px-6 py-8 max-w-5xl mx-auto w-full">
        <h1 className="font-sans text-heading font-bold tracking-tight mb-2">
          Assets
        </h1>
        <p className="text-detail text-t-muted normal-case tracking-normal mb-8">
          Reusable seeds extracted from simulations
        </p>

        {/* Error */}
        {error && (
          <div className="mb-4 px-4 py-3 border border-danger text-detail text-danger flex items-center justify-between" role="alert">
            <span className="normal-case tracking-normal">{error}</span>
            <button onClick={() => setError(null)} className="text-micro text-danger hover:text-white transition-colors ml-4">
              Dismiss
            </button>
          </div>
        )}

        {/* Type filter tabs */}
        <div className="flex items-center gap-px mb-6 bg-b-DEFAULT w-fit">
          {SEED_TYPES.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setFilter(value)}
              className={`px-4 py-2 text-micro tracking-widest transition-colors ${
                filter === value
                  ? "bg-surface-2 text-primary"
                  : "bg-void text-t-muted hover:text-white hover:bg-surface-1"
              }`}
            >
              {label}
              {value !== "all" && counts[value] ? (
                <span className="ml-1.5 text-t-dim">{counts[value]}</span>
              ) : null}
            </button>
          ))}
        </div>

        {/* Seed grid */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-b-DEFAULT">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-void p-6">
                <div className="h-4 w-32 mb-3 bg-gradient-to-r from-surface-2 via-surface-3 to-surface-2 bg-[length:200%_100%] animate-[shimmer_1.5s_ease_infinite]" />
                <div className="h-3 w-full mb-2 bg-gradient-to-r from-surface-2 via-surface-3 to-surface-2 bg-[length:200%_100%] animate-[shimmer_1.5s_ease_infinite]" />
                <div className="h-3 w-20 bg-gradient-to-r from-surface-2 via-surface-3 to-surface-2 bg-[length:200%_100%] animate-[shimmer_1.5s_ease_infinite]" />
              </div>
            ))}
          </div>
        ) : seeds.length === 0 ? (
          <div className="border border-b-DEFAULT p-12 text-center">
            <div className="text-body text-t-muted mb-2">No seeds yet</div>
            <div className="text-detail text-t-dim normal-case tracking-normal">
              Extract seeds from running simulations — agents, items, locations, and events can all become reusable seeds.
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
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
