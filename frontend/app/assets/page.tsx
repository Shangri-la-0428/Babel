"use client";

import { Suspense, useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  deleteAsset,
  fetchAssets,
  fetchSeedDetail,
  getState,
  saveAsset,
  SavedSeedData,
  SeedDetail as WorldSeedDetail,
  SeedTypeValue,
  WorldState,
} from "@/lib/api";
import { TransKey } from "@/lib/i18n";
import { useLocale } from "@/lib/locale-context";
import Nav from "@/components/Nav";
import Settings from "@/components/Settings";
import SeedCard from "@/components/SeedCard";
import SeedDetail from "@/components/SeedDetail";
import { ErrorBanner, EmptyState, SkeletonLine } from "@/components/ui";
import { assetMatchesContext, buildAssetsHref, sanitizeInternalHref } from "@/lib/navigation";
import { buildItemHolders, mergeWorldItemsWithInventories, normalizeWorldItem } from "@/lib/world-items";

const SEED_TYPES: { value: SeedTypeValue | "all"; labelKey: TransKey }[] = [
  { value: "all", labelKey: "all" },
  { value: "world", labelKey: "world" },
  { value: "agent", labelKey: "agent" },
  { value: "item", labelKey: "item" },
  { value: "location", labelKey: "location" },
  { value: "event", labelKey: "event" },
];

const SEED_TYPE_ORDER: Record<SeedTypeValue, number> = {
  world: 0,
  agent: 1,
  item: 2,
  location: 3,
  event: 4,
};

function makeVirtualId(...parts: string[]): string {
  return ["virtual", ...parts.map((part) => encodeURIComponent(part))].join(":");
}

function createVirtualSeed({
  id,
  type,
  name,
  description = "",
  tags = [],
  data = {},
  sourceWorld = "",
  contextSessionId,
}: {
  id: string;
  type: SeedTypeValue;
  name: string;
  description?: string;
  tags?: string[];
  data?: Record<string, unknown>;
  sourceWorld?: string;
  contextSessionId?: string;
}): SavedSeedData {
  return {
    id,
    type,
    name,
    description,
    tags,
    data,
    source_world: sourceWorld,
    created_at: "",
    virtual: true,
    context_session_id: contextSessionId,
  };
}

function buildVirtualItemSeeds(
  items: Array<{ name: string; description: string; origin?: string; properties?: string[]; significance?: string }>,
  agents: Array<{ agentId: string; agentName: string; inventory: string[] }>,
  scopeId: string,
  sourceWorld: string,
  contextSessionId?: string,
): SavedSeedData[] {
  const mergedItems = mergeWorldItemsWithInventories(
    items.map((item) => normalizeWorldItem(item)),
    agents.map((agent) => ({
      id: agent.agentId,
      name: agent.agentName,
      inventory: agent.inventory,
    })),
  );
  const holdersByItem = buildItemHolders(
    agents.map((agent) => ({
      id: agent.agentId,
      name: agent.agentName,
      inventory: agent.inventory,
    })),
  );

  return mergedItems.map((item) =>
    createVirtualSeed({
      id: makeVirtualId(scopeId, "item", item.name),
      type: "item",
      name: item.name,
      description: item.description,
      data: {
        name: item.name,
        description: item.description,
        holders: holdersByItem.get(item.name) || [],
        origin: item.origin || "",
        properties: item.properties || [],
        significance: item.significance || "",
      },
      sourceWorld,
      contextSessionId,
    }),
  );
}

function buildVirtualAssetsFromState(state: WorldState): SavedSeedData[] {
  const scopeId = `session:${state.session_id}`;
  const sourceWorld = state.name;
  const agents = Object.entries(state.agents || {}).map(([agentId, agent]) =>
    createVirtualSeed({
      id: makeVirtualId(scopeId, "agent", agentId),
      type: "agent",
      name: agent.name || agentId,
      description: agent.description || "",
      data: {
        id: agentId,
        name: agent.name || agentId,
        description: agent.description || "",
        personality: agent.personality || "",
        goals: agent.goals || [],
        inventory: agent.inventory || [],
        location: agent.location || "",
      },
      sourceWorld,
      contextSessionId: state.session_id,
    }),
  );

  const items = buildVirtualItemSeeds(
    state.items || [],
    Object.entries(state.agents || {}).map(([agentId, agent]) => ({
      agentId,
      agentName: agent.name || agentId,
      inventory: agent.inventory || [],
    })),
    scopeId,
    sourceWorld,
    state.session_id,
  );

  const locations = (state.locations || []).map((location, index) =>
    createVirtualSeed({
      id: makeVirtualId(scopeId, "location", `${index}`, location.name),
      type: "location",
      name: location.name,
      description: location.description || "",
      data: {
        name: location.name,
        description: location.description || "",
      },
      sourceWorld,
      contextSessionId: state.session_id,
    }),
  );

  return [...agents, ...items, ...locations];
}

function buildVirtualAssetsFromSeedDetail(seed: WorldSeedDetail): SavedSeedData[] {
  const scopeId = `seed:${seed.file}`;
  const sourceWorld = seed.name;
  const agents = (seed.agents || []).map((agent, index) =>
    createVirtualSeed({
      id: makeVirtualId(scopeId, "agent", agent.id || `${index}`),
      type: "agent",
      name: agent.name || agent.id || `agent-${index + 1}`,
      description: agent.description || "",
      data: {
        id: agent.id,
        name: agent.name,
        description: agent.description || "",
        personality: agent.personality || "",
        goals: agent.goals || [],
        inventory: agent.inventory || [],
        location: agent.location || "",
      },
      sourceWorld,
    }),
  );

  const items = buildVirtualItemSeeds(
    seed.items || [],
    (seed.agents || []).map((agent, index) => ({
      agentId: agent.id || `${index}`,
      agentName: agent.name || agent.id || `agent-${index + 1}`,
      inventory: agent.inventory || [],
    })),
    scopeId,
    sourceWorld,
  );

  const locations = (seed.locations || []).map((location, index) =>
    createVirtualSeed({
      id: makeVirtualId(scopeId, "location", `${index}`, location.name),
      type: "location",
      name: location.name,
      description: location.description || "",
      data: {
        name: location.name,
        description: location.description || "",
      },
      sourceWorld,
    }),
  );

  return [...agents, ...items, ...locations];
}

function getSeedIdentity(seed: SavedSeedData): string {
  const normalizedName =
    typeof seed.data?.name === "string" && seed.data.name.trim()
      ? seed.data.name.trim()
      : seed.name.trim();
  const normalizedAgentId =
    typeof seed.data?.id === "string" && seed.data.id.trim()
      ? seed.data.id.trim()
      : normalizedName;
  const normalizedContent =
    typeof seed.data?.content === "string" && seed.data.content.trim()
      ? seed.data.content.trim()
      : normalizedName;

  switch (seed.type) {
    case "agent":
      return `agent:${normalizedAgentId.toLowerCase()}`;
    case "event":
      return `event:${normalizedContent.toLowerCase()}`;
    default:
      return `${seed.type}:${normalizedName.toLowerCase()}`;
  }
}

async function loadContextSeeds(sessionId: string, seedFile: string): Promise<SavedSeedData[]> {
  if (sessionId) {
    try {
      const state = await getState(sessionId);
      return buildVirtualAssetsFromState(state);
    } catch {
      // Fall back to seed detail when available.
    }
  }

  if (seedFile) {
    try {
      const detail = await fetchSeedDetail(seedFile);
      return buildVirtualAssetsFromSeedDetail(detail);
    } catch {
      return [];
    }
  }

  return [];
}

function AssetsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useLocale();
  const scopedSessionId = searchParams.get("session") || "";
  const scopedWorldName = searchParams.get("world") || "";
  const scopedSeedFile = searchParams.get("seed") || "";
  const backHref = sanitizeInternalHref(searchParams.get("back"), "/");
  const selectedAssetId = searchParams.get("asset");
  const isScopedToWorld = Boolean(scopedSessionId || scopedWorldName || scopedSeedFile);
  const [allSeeds, setAllSeeds] = useState<SavedSeedData[]>([]);
  const [virtualSeeds, setVirtualSeeds] = useState<SavedSeedData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<SeedTypeValue | "all">("all");
  const [selected, setSelected] = useState<SavedSeedData | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ seed: SavedSeedData; index: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const mountedRef = useRef(true);

  function restoreSeed(seed: SavedSeedData, index: number) {
    setAllSeeds((prev) => {
      const next = [...prev];
      next.splice(Math.max(0, Math.min(index, next.length)), 0, seed);
      return next;
    });
  }

  const finalizeDelete = useCallback(async (pending: { seed: SavedSeedData; index: number }) => {
    try {
      await deleteAsset(pending.seed.id);
    } catch {
      restoreSeed(pending.seed, pending.index);
      setError(t("delete_failed"));
    }
  }, [t]);

  const loadSeeds = useCallback(async () => {
    setLoading(true);
    const [savedResult, contextResult] = await Promise.allSettled([
      fetchAssets(),
      loadContextSeeds(scopedSessionId, scopedSeedFile),
    ]);

    if (!mountedRef.current) return;

    if (savedResult.status === "fulfilled") {
      setAllSeeds(Array.isArray(savedResult.value) ? savedResult.value : []);
      setError(null);
    } else {
      setAllSeeds([]);
      setError(t("failed_load"));
    }

    if (contextResult.status === "fulfilled") {
      setVirtualSeeds(contextResult.value);
    } else {
      setVirtualSeeds([]);
    }

    setLoading(false);
  }, [scopedSeedFile, scopedSessionId, t]);

  useEffect(() => {
    mountedRef.current = true;
    loadSeeds();
    return () => { mountedRef.current = false; };
  }, [loadSeeds]);

  const scopedContextWorldName = useMemo(
    () => scopedWorldName || virtualSeeds[0]?.source_world || "",
    [scopedWorldName, virtualSeeds],
  );

  const scopedSavedSeeds = useMemo(
    () => allSeeds.filter((seed) => assetMatchesContext(seed, { sessionId: scopedSessionId, worldName: scopedContextWorldName })),
    [allSeeds, scopedContextWorldName, scopedSessionId],
  );

  const scopedSeeds = useMemo(() => {
    if (!isScopedToWorld) {
      return [...allSeeds].sort((a, b) => {
        const typeRank = SEED_TYPE_ORDER[a.type] - SEED_TYPE_ORDER[b.type];
        return typeRank !== 0 ? typeRank : a.name.localeCompare(b.name);
      });
    }

    const merged = new Map<string, SavedSeedData>();
    virtualSeeds.forEach((seed) => {
      merged.set(getSeedIdentity(seed), seed);
    });
    scopedSavedSeeds.forEach((seed) => {
      merged.set(getSeedIdentity(seed), seed);
    });

    return Array.from(merged.values()).sort((a, b) => {
      const typeRank = SEED_TYPE_ORDER[a.type] - SEED_TYPE_ORDER[b.type];
      return typeRank !== 0 ? typeRank : a.name.localeCompare(b.name);
    });
  }, [allSeeds, isScopedToWorld, scopedSavedSeeds, virtualSeeds]);

  const visibleSeeds = filter === "all"
    ? scopedSeeds
    : scopedSeeds.filter((seed) => seed.type === filter);

  function handleDelete(id: string) {
    const index = allSeeds.findIndex((s) => s.id === id);
    const seed = index >= 0 ? allSeeds[index] : null;
    if (!seed) return;

    if (pendingDelete) {
      clearTimeout(pendingDelete.timer);
      void finalizeDelete({ seed: pendingDelete.seed, index: pendingDelete.index });
      setPendingDelete(null);
    }

    setAllSeeds((prev) => prev.filter((s) => s.id !== id));
    if (selected?.id === id) setSelected(null);
    if (selectedAssetId === id) {
      const href = buildAssetsHref({
        sessionId: scopedSessionId || undefined,
        worldName: scopedContextWorldName || undefined,
        seedFile: scopedSeedFile || undefined,
        backHref,
        assetId: null,
      });
      router.replace(href);
    }
    const timer = setTimeout(async () => {
      await finalizeDelete({ seed, index });
      setPendingDelete(null);
    }, 5000);
    setPendingDelete({ seed, index, timer });
  }

  function handleUndoDelete() {
    if (!pendingDelete) return;
    clearTimeout(pendingDelete.timer);
    restoreSeed(pendingDelete.seed, pendingDelete.index);
    setPendingDelete(null);
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    if (file.size > 1_048_576) {
      setImportError(t("import_too_large"));
      setImportSuccess(null);
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
        setImportSuccess(null);
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
      setImportSuccess(t("import_success"));
      setTimeout(() => setImportSuccess(null), 2400);
      loadSeeds();
    } catch {
      setImportError(t("import_invalid"));
      setImportSuccess(null);
    }
  }

  const counts = scopedSeeds.reduce(
    (acc, s) => {
      acc[s.type] = (acc[s.type] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  useEffect(() => {
    if (loading) return;
    if (!selectedAssetId) {
      setSelected(null);
      return;
    }
    const match = scopedSeeds.find((seed) => seed.id === selectedAssetId) || null;
    setSelected(match);
    if (!match) {
      router.replace(buildAssetsHref({
        sessionId: scopedSessionId || undefined,
        worldName: scopedContextWorldName || undefined,
        seedFile: scopedSeedFile || undefined,
        backHref,
        assetId: null,
      }));
    }
  }, [selectedAssetId, scopedSeeds, router, scopedSessionId, scopedContextWorldName, scopedSeedFile, backHref, loading]);

  function setSelectedAsset(seed: SavedSeedData | null, historyMode: "push" | "replace" = "push") {
    const href = buildAssetsHref({
      sessionId: scopedSessionId || undefined,
      worldName: scopedContextWorldName || undefined,
      seedFile: scopedSeedFile || undefined,
      backHref,
      assetId: seed?.id || null,
    });
    if (historyMode === "replace") {
      router.replace(href);
    } else {
      router.push(href);
    }
    setSelected(seed);
  }

  return (
    <div className="min-h-screen flex flex-col bg-void">
      <Nav activePage="assets" showSettings={showSettings} onToggleSettings={() => setShowSettings(!showSettings)} />

      {showSettings && (
        <Settings onClose={() => setShowSettings(false)} onSave={() => setShowSettings(false)} />
      )}

      <main className="flex-1 flex flex-col px-6 py-8 max-w-5xl mx-auto w-full">
        <a href={backHref} className="text-micro text-t-muted tracking-wider hover:text-t-DEFAULT transition-colors mb-4 inline-block">
          {isScopedToWorld ? t("back_to_world") : t("back")}
        </a>
        <h1 className="font-sans text-title font-bold tracking-tight mb-2">
          {t("assets_title")}
        </h1>
        <div className="flex flex-col gap-4 mb-8 lg:flex-row lg:items-start lg:justify-between">
          <p className="text-detail text-t-muted normal-case tracking-normal">
            {isScopedToWorld ? t("assets_scope_desc", scopedContextWorldName || scopedSessionId) : t("assets_desc")}
          </p>
          <div className="flex items-center gap-3 shrink-0">
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

        {importError && (
          <ErrorBanner message={importError} onDismiss={() => setImportError(null)} className="mb-4" />
        )}

        {importSuccess && !importError && (
          <div className="mb-4 border border-primary/30 bg-primary/[0.05] px-4 py-3 text-micro text-primary tracking-wider">
            {importSuccess}
          </div>
        )}

        {/* Error */}
        {error && (
          <ErrorBanner message={error} onDismiss={() => setError(null)} className="mb-4">
            <button type="button" onClick={loadSeeds} className="ml-3 text-micro tracking-wider text-danger underline hover:text-t-DEFAULT transition-colors shrink-0">
              {t("retry")}
            </button>
          </ErrorBanner>
        )}

        {/* Type filter tabs */}
        <div className="flex items-center gap-px mb-6 bg-b-DEFAULT w-fit max-w-full overflow-x-auto">
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
              {(value === "all" ? scopedSeeds.length : counts[value]) ? (
                <span className="ml-1.5 text-t-dim">{value === "all" ? scopedSeeds.length : counts[value]}</span>
              ) : null}
            </button>
          ))}
        </div>

        {/* Seed grid */}
        {loading ? (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-surface-1 border border-b-DEFAULT p-4">
                <SkeletonLine className="h-4 w-32 mb-3" />
                <SkeletonLine className="h-3 w-full mb-2" />
                <SkeletonLine className="h-3 w-20" />
              </div>
            ))}
          </div>
        ) : visibleSeeds.length === 0 ? (
          <EmptyState label={t("archive_empty")} variant="scanning">
            <div className="text-body text-t-muted">{scopedSeeds.length === 0 ? t("no_seeds_yet") : t("no_filtered_seeds")}</div>
            <div className="text-detail text-t-dim normal-case tracking-normal text-center max-w-md">
              {isScopedToWorld ? t("no_world_assets_desc") : t("no_seeds_desc")}
            </div>
            {scopedSeeds.length === 0 ? (
              <a
                href={isScopedToWorld ? backHref : "/"}
                className="h-9 px-5 text-micro font-medium tracking-wider border border-b-DEFAULT text-t-muted hover:bg-surface-1/20 hover:border-primary hover:text-primary active:scale-[0.97] transition-[colors,transform] inline-flex items-center"
              >
                {isScopedToWorld ? t("back_to_world") : t("home")}
              </a>
            ) : (
              <button
                type="button"
                onClick={() => setFilter("all")}
                className="h-9 px-5 text-micro font-medium tracking-wider border border-b-DEFAULT text-t-muted hover:bg-surface-1/20 hover:border-primary hover:text-primary active:scale-[0.97] transition-[colors,transform] inline-flex items-center"
              >
                {t("all")}
              </button>
            )}
          </EmptyState>
        ) : (
          <div key={filter} className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-3 stagger-in">
            {visibleSeeds.map((seed) => (
              <SeedCard
                key={seed.id}
                seed={seed}
                onDelete={seed.virtual ? undefined : handleDelete}
                onSelect={(nextSeed) => setSelectedAsset(nextSeed)}
              />
            ))}
          </div>
        )}
      </main>

      {/* Seed detail modal */}
      {selected && (
        <SeedDetail
          seed={selected}
          onClose={() => setSelectedAsset(null, "replace")}
          onChange={(updatedSeed) => {
            setAllSeeds((prev) => prev.map((seed) => (seed.id === updatedSeed.id ? updatedSeed : seed)));
            setSelected(updatedSeed);
          }}
        />
      )}

      {/* Undo delete toast */}
      {pendingDelete && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-toast flex items-center gap-4 px-5 py-3 bg-surface-1 border border-b-DEFAULT animate-slide-up">
          <span className="text-detail text-t-secondary normal-case tracking-normal">
            {t("seed_deleted")} {pendingDelete.seed.name}
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

export default function AssetsPage() {
  return (
    <Suspense fallback={null}>
      <AssetsContent />
    </Suspense>
  );
}
