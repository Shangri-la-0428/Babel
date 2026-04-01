"use client";

import { Suspense, useEffect, useState, useMemo, useRef, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { fetchSeeds, fetchSeedDetail, createFromSeed, createWorld, deleteWorldSeed, getSessions, fetchAssets, saveAsset, updateAsset, updateWorldSeed, SavedSeedData, SeedInfo, SeedDetail, WorldItemData, enrichEntity } from "@/lib/api";
import { collapseSessionHistory } from "@/lib/session-history";
import { buildAssetsHref, buildSimHref, buildWorldHref } from "@/lib/navigation";
import { useLocale } from "@/lib/locale-context";
import Nav from "@/components/Nav";
import Settings from "@/components/Settings";
import Timeline from "@/components/Timeline";
import { AutoTextarea, StatusDot, ErrorBanner, EmptyState, SkeletonLine, GlitchReveal, DecodeText, ExpandableInput, StringListEditor } from "@/components/ui";
import WorldBootOverlay from "@/components/WorldBootOverlay";
import dynamic from "next/dynamic";
import { buildItemHolders, mergeWorldItemsWithInventories, normalizeWorldItem } from "@/lib/world-items";

const AmbientGrid = dynamic(() => import("@/components/AmbientGrid"), { ssr: false });

interface SessionRecord {
  id: string;
  world_seed: string;
  tick: number;
  status: string;
  created_at: string;
}

type AssetTab = "agents" | "items" | "locations" | "rules" | "events";

function sanitizeList(values: string[]): string[] {
  return values.map((value) => value.trim()).filter(Boolean);
}

function HomeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { locale, toggle, t } = useLocale();
  const tRef = useRef(t);
  tRef.current = t;
  const selectedSeedFile = searchParams.get("seed") || "";
  const [seeds, setSeeds] = useState<SeedInfo[]>([]);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [oracleGreetIdx] = useState(() => Math.floor(Math.random() * 4));
  const [loading, setLoading] = useState(false);
  const [deletingSeedFile, setDeletingSeedFile] = useState<string | null>(null);
  const [seedsLoading, setSeedsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [assetTab, setAssetTab] = useState<AssetTab>("agents");
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [expandedLocation, setExpandedLocation] = useState<number | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [itemDrafts, setItemDrafts] = useState<Record<string, string>>({});
  const [exportedItemMap, setExportedItemMap] = useState<Map<string, SavedSeedData>>(new Map());
  const [generatingItem, setGeneratingItem] = useState<string | null>(null);
  const [exportingItem, setExportingItem] = useState<string | null>(null);
  const [editDetail, setEditDetail] = useState<SeedDetail | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [editing, setEditing] = useState(false);
  const [bootOverlay, setBootOverlay] = useState<{ worldName: string; targetUrl: string } | null>(null);
  const [booting, setBooting] = useState(false);
  const assetTabIndicatorRef = useRef<HTMLSpanElement>(null);
  // Settings saved to localStorage by Settings component; home page only shows/hides the panel
  const noop = () => {};

  const selectedSeed = useMemo(
    () => seeds.find((seed) => seed.file === selectedSeedFile) || null,
    [seeds, selectedSeedFile],
  );

  const selectedSeedMeta = useMemo<SeedInfo | null>(() => {
    if (selectedSeed) return selectedSeed;
    if (selectedSeedFile && editDetail?.file === selectedSeedFile) {
      return {
        file: editDetail.file,
        name: editDetail.name,
        description: editDetail.description,
        agent_count: editDetail.agents.length,
        location_count: editDetail.locations.length,
      };
    }
    return null;
  }, [selectedSeed, selectedSeedFile, editDetail]);

  function markSaved(id: string) {
    setSavedIds((prev) => new Set(prev).add(id));
  }

  async function handleSaveAgentSeed(agent: SeedDetail["agents"][number]) {
    try {
      await saveAsset({
        type: "agent",
        name: agent.name,
        description: agent.description,
        tags: [],
        data: {
          id: agent.id,
          name: agent.name,
          description: agent.description,
          personality: agent.personality,
          goals: agent.goals,
          inventory: agent.inventory,
          location: agent.location,
        },
        source_world: selectedSeedMeta?.name,
      });
      markSaved(agent.id);
    } catch { /* ignore */ }
  }

  async function handleSaveLocationSeed(loc: SeedDetail["locations"][number]) {
    try {
      await saveAsset({
        type: "location",
        name: loc.name,
        description: loc.description,
        tags: [],
        data: { name: loc.name, description: loc.description },
        source_world: selectedSeedMeta?.name,
      });
      markSaved(`loc_${loc.name}`);
    } catch { /* ignore */ }
  }

  const getItemSeedKey = useCallback((seed: SavedSeedData): string => {
    const seedName = typeof seed.data?.name === "string" ? seed.data.name.trim() : "";
    return seedName || seed.name;
  }, []);

  const getItemSeedKeys = useCallback((seed: SavedSeedData): string[] => {
    const previousNames = Array.isArray(seed.data?.previous_names)
      ? seed.data.previous_names.map((value) => String(value).trim()).filter(Boolean)
      : [];
    return Array.from(new Set([getItemSeedKey(seed), seed.name.trim(), ...previousNames].filter(Boolean)));
  }, [getItemSeedKey]);

  const syncSeedDetailItems = useCallback((detail: SeedDetail): SeedDetail => {
    return {
      ...detail,
      items: mergeWorldItemsWithInventories(detail.items || [], detail.agents || []),
    };
  }, []);

  function updateWorldItem(oldName: string, patch: Partial<WorldItemData>) {
    setEditDetail((prev) => {
      if (!prev) return prev;
      const mergedItems = mergeWorldItemsWithInventories(prev.items || [], prev.agents || []);
      const existingIndex = mergedItems.findIndex((item) => item.name === oldName);
      if (existingIndex < 0) {
        const nextName = typeof patch.name === "string" ? patch.name.trim() : oldName.trim();
        if (!nextName) return prev;
        return {
          ...prev,
          items: [...mergedItems, normalizeWorldItem({ name: nextName, ...patch })],
        };
      }

      const nextItems = [...mergedItems];
      nextItems[existingIndex] = normalizeWorldItem({
        ...nextItems[existingIndex],
        ...patch,
      });
      return {
        ...prev,
        items: nextItems.filter((item) => item.name),
      };
    });
  }

  async function handleCommitItemRename(oldName: string) {
    const nextName = (itemDrafts[oldName] || "").trim();
    if (!editDetail || !nextName || nextName === oldName) return;

    setEditDetail((prev) => {
      if (!prev) return prev;
      const mergedItems = mergeWorldItemsWithInventories(prev.items || [], prev.agents || []);
      const existingItem =
        mergedItems.find((item) => item.name === oldName) || normalizeWorldItem({ name: oldName });
      const renamedItems = mergedItems
        .filter((item) => item.name !== oldName)
        .filter((item) => item.name !== nextName);
      renamedItems.push(normalizeWorldItem({ ...existingItem, name: nextName }));
      return {
        ...prev,
        items: renamedItems,
        agents: prev.agents.map((agent) => ({
          ...agent,
          inventory: (agent.inventory || []).map((item) => (item === oldName ? nextName : item)),
        })),
      };
    });

    setItemDrafts((prev) => {
      const next = { ...prev };
      delete next[oldName];
      next[nextName] = nextName;
      return next;
    });
    setExpandedItem(nextName);
  }

  function buildSeedPayload() {
    if (!editDetail) return null;
    return {
      name: editDetail.name,
      description: editDetail.description,
      rules: sanitizeList(editDetail.rules),
      locations: editDetail.locations,
      items: mergeWorldItemsWithInventories(editDetail.items || [], editDetail.agents || [])
        .map((item) => normalizeWorldItem(item))
        .filter((item) => item.name),
      agents: editDetail.agents.map((a) => ({
        id: a.id,
        name: a.name,
        description: a.description,
        personality: a.personality,
        goals: sanitizeList(a.goals),
        inventory: sanitizeList(a.inventory),
        location: a.location,
      })),
      initial_events: sanitizeList(editDetail.initial_events),
    };
  }

  async function handleSaveOnly() {
    if (!editDetail || !selectedSeedMeta) return;
    const data = buildSeedPayload();
    if (!data) return;
    setLoading(true);
    setError(null);
    try {
      if (selectedSeedMeta.file.startsWith("saved:")) {
        await updateWorldSeed(selectedSeedMeta.file, data);
      } else {
        // For built-in seeds, create as a new saved seed
        await createWorld(data);
      }
      setSeeds((prev) =>
        prev.map((seed) =>
          seed.file === selectedSeedMeta.file
            ? { ...seed, name: data.name, description: data.description, agent_count: data.agents.length, location_count: data.locations.length }
            : seed,
        ),
      );
      setEditing(false);
    } catch {
      setError(t("failed_create"));
    } finally {
      setLoading(false);
    }
  }

  function updateEdit(patch: Partial<SeedDetail>) {
    setEditDetail((prev) => prev ? { ...prev, ...patch } : prev);
  }

  function updateAgent(idx: number, patch: Partial<SeedDetail["agents"][number]>) {
    setEditDetail((prev) => {
      if (!prev) return prev;
      const agents = [...prev.agents];
      agents[idx] = { ...agents[idx], ...patch };
      return { ...prev, agents };
    });
  }

  function removeAgent(idx: number) {
    setEditDetail((prev) => {
      if (!prev) return prev;
      return { ...prev, agents: prev.agents.filter((_, i) => i !== idx) };
    });
  }

  function addAgent() {
    setEditDetail((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        agents: [...prev.agents, {
          id: `agent_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          name: "", description: "", personality: "", goals: [], inventory: [], location: "",
        }],
      };
    });
  }

  function updateLocation(idx: number, patch: Partial<SeedDetail["locations"][number]>) {
    setEditDetail((prev) => {
      if (!prev) return prev;
      const locations = [...prev.locations];
      locations[idx] = { ...locations[idx], ...patch };
      return { ...prev, locations };
    });
  }

  function removeLocation(idx: number) {
    setEditDetail((prev) => {
      if (!prev) return prev;
      return { ...prev, locations: prev.locations.filter((_, i) => i !== idx) };
    });
  }

  function addLocation() {
    setEditDetail((prev) => {
      if (!prev) return prev;
      return { ...prev, locations: [...prev.locations, { name: "", description: "" }] };
    });
  }

  useEffect(() => {
    fetchSeeds()
      .then((data) => setSeeds(Array.isArray(data) ? data : []))
      .catch(() => setError(tRef.current("failed_load")))
      .finally(() => setSeedsLoading(false));
    getSessions()
      .then((data) => setSessions(Array.isArray(data) ? data : []))
      .catch(() => { /* session list is supplementary — seed list still works */ });
  }, []);

  // ── First-visit boot sequence ──
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const visited = localStorage.getItem("babel_visited");
    if (!visited) {
      setBooting(true);
      localStorage.setItem("babel_visited", "1");
      const timer = setTimeout(() => setBooting(false), 2000);
      return () => clearTimeout(timer);
    }
  }, []);

  // ── Console easter egg ──
  useEffect(() => {
    if (seeds.length > 0) {
      console.log(
        "%c// PORTAL ACTIVE%c — MONITORING " + seeds.length + " WORLDS",
        "color:#C0FE04;font-family:monospace;font-size:11px",
        "color:#757575;font-family:monospace;font-size:11px"
      );
    }
  }, [seeds.length]);

  useEffect(() => {
    if (!selectedSeedFile) {
      setEditDetail(null);
      setEditing(false);
      setDetailLoading(false);
      setAssetTab("agents");
      setExpandedAgent(null);
      setExpandedItem(null);
      setExpandedLocation(null);
      setItemDrafts({});
      setExportedItemMap(new Map());
      return;
    }

    let cancelled = false;
    setEditDetail(null);
    setEditing(false);
    setDetailLoading(true);
    setAssetTab("agents");
    setExpandedAgent(null);
    setExpandedItem(null);
    setExpandedLocation(null);
    setItemDrafts({});
    setExportedItemMap(new Map());
    (async () => {
      try {
        const detail = await fetchSeedDetail(selectedSeedFile);
        if (!cancelled) {
          const cloned = JSON.parse(JSON.stringify(detail)) as SeedDetail;
          setEditDetail(syncSeedDetailItems(cloned));
        }
      } catch {
        if (!cancelled) {
          setError(tRef.current("failed_load_detail"));
          router.replace(buildWorldHref(null));
        }
      } finally {
        if (!cancelled) {
          setDetailLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedSeedFile, router, syncSeedDetailItems]);

  useEffect(() => {
    if (!selectedSeedMeta?.name) {
      setExportedItemMap(new Map());
      return;
    }

    let cancelled = false;
    fetchAssets("item")
      .then((assets) => {
        if (cancelled || !Array.isArray(assets)) return;
        const next = new Map<string, SavedSeedData>();
        assets
          .filter((asset) => asset.source_world === selectedSeedMeta.name)
          .forEach((asset) => {
            getItemSeedKeys(asset).forEach((key) => next.set(key, asset));
          });
        setExportedItemMap(next);
      })
      .catch(() => {
        if (!cancelled) setExportedItemMap(new Map());
      });

    return () => {
      cancelled = true;
    };
  }, [selectedSeedMeta?.name, getItemSeedKeys]);

  function handleSelectSeed(seed: SeedInfo) {
    router.push(buildWorldHref(seed.file));
  }

  async function handleDeleteWorldSeed(seed: SeedInfo) {
    if (deletingSeedFile) return;
    if (typeof window !== "undefined" && !window.confirm(t("world_delete_confirm"))) {
      return;
    }
    setDeletingSeedFile(seed.file);
    setError(null);
    try {
      await deleteWorldSeed(seed.file);
      setSeeds((prev) => prev.filter((item) => item.file !== seed.file));
      setEditDetail(null);
      if (selectedSeedFile === seed.file) {
        router.replace(buildWorldHref(null));
      }
    } catch {
      setError(t("delete_failed"));
    } finally {
      setDeletingSeedFile(null);
    }
  }

  const creatingRef = useRef(false);
  async function handleStartNew(filename: string) {
    if (creatingRef.current) return; // prevent double-fire
    creatingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const res = await createFromSeed(filename);
      if (!res?.session_id) throw new Error("No session_id");
      const seedName = seeds.find((s) => s.file === filename)?.name || "WORLD";
      setBootOverlay({
        worldName: seedName,
        targetUrl: buildSimHref({
          sessionId: res.session_id,
          seedFile: res.seed_file || filename,
        }),
      });
    } catch {
      setError(t("failed_create"));
      setLoading(false);
    } finally {
      creatingRef.current = false;
    }
  }

  // Pre-parse session world names once, not on every render/call
  const sessionsByWorld = useMemo(() => {
    const map = new Map<string, (SessionRecord & { world_name: string })[]>();
    for (const s of sessions) {
      let world_name = "Unknown";
      try { world_name = JSON.parse(s.world_seed)?.name || world_name; } catch { /* keep world_name as "Unknown" */ }
      const list = map.get(world_name) || [];
      list.push({ ...s, world_name });
      map.set(world_name, list);
    }
    return map;
  }, [sessions]);

  const visibleSessionsByWorld = useMemo(() => {
    const map = new Map<string, { sessions: (SessionRecord & { world_name: string })[]; hiddenDraftCount: number }>();
    for (const [worldName, worldSessions] of Array.from(sessionsByWorld.entries())) {
      map.set(worldName, collapseSessionHistory(worldSessions));
    }
    return map;
  }, [sessionsByWorld]);

  function getWorldSessions(seedName: string) {
    return visibleSessionsByWorld.get(seedName) || { sessions: [], hiddenDraftCount: 0 };
  }

  // ── Boot overlay (world entry transition) ──
  const bootEl = bootOverlay && (
    <WorldBootOverlay
      worldName={bootOverlay.worldName}
      onComplete={() => router.push(bootOverlay.targetUrl)}
    />
  );

  // ── World detail view ──
  if (selectedSeedFile && selectedSeedMeta) {
    const worldSessionGroup = getWorldSessions(selectedSeedMeta.name);
    const worldSessions = worldSessionGroup.sessions;
    const latestWorldSessionId = worldSessions[0]?.id || "";

    const ed = editDetail;
    const assetsHref = buildAssetsHref({
      worldName: selectedSeedMeta.name,
      seedFile: selectedSeedMeta.file,
      backHref: buildWorldHref(selectedSeedMeta.file),
    });

    // Aggregate world-local item details with current holders.
    let allItems: Array<WorldItemData & { holders: string[] }> = [];
    if (ed) {
      const holdersByItem = buildItemHolders(ed.agents);
      allItems = mergeWorldItemsWithInventories(ed.items || [], ed.agents || []).map((item) => ({
        ...item,
        holders: holdersByItem.get(item.name) || [],
      }));
    }

    const ASSET_TABS: { key: AssetTab; label: string; count: number }[] = [
      { key: "agents", label: t("agents"), count: ed?.agents?.length ?? 0 },
      { key: "items", label: t("item"), count: allItems.length },
      { key: "locations", label: t("locations"), count: ed?.locations?.length ?? 0 },
      { key: "rules", label: t("rules"), count: ed?.rules?.length ?? 0 },
      { key: "events", label: t("event"), count: ed?.initial_events?.length ?? 0 },
    ];

    const inputCls = "w-full h-9 px-3 bg-void border border-b-DEFAULT text-detail text-t-DEFAULT normal-case tracking-normal focus:border-primary focus:outline-none hover:border-b-hover transition-colors";
    const textareaCls = "w-full min-h-[36px] px-3 py-2 bg-void border border-b-DEFAULT text-detail text-t-DEFAULT normal-case tracking-normal leading-relaxed resize-none focus:border-primary focus:outline-none hover:border-b-hover transition-colors";
    const fieldLabel = "text-micro text-t-muted tracking-widest mb-1.5 block";

    const handleGenerateWorldItem = async (item: WorldItemData & { holders: string[] }) => {
      if (!latestWorldSessionId || generatingItem) return;
      setGeneratingItem(item.name);
      setError(null);
      try {
        const details = await enrichEntity(latestWorldSessionId, "item", item.name, { language: locale });
        updateWorldItem(item.name, {
          description: typeof details.description === "string" ? details.description : item.description,
          origin: typeof details.origin === "string" ? details.origin : item.origin,
          properties: Array.isArray(details.properties) ? details.properties.map(String) : item.properties,
          significance: typeof details.significance === "string" ? details.significance : item.significance,
        });
      } catch {
        setError(t("gen_item_failed"));
      } finally {
        setGeneratingItem(null);
      }
    };

    const handleExportWorldItem = async (item: WorldItemData & { holders: string[] }) => {
      if (exportingItem) return;
      setExportingItem(item.name);
      setError(null);
      const payload = {
        type: "item" as const,
        name: item.name,
        description: item.description,
        tags: [],
        data: {
          name: item.name,
          description: item.description,
          origin: item.origin,
          properties: item.properties,
          significance: item.significance,
          holders: item.holders,
        },
        source_world: selectedSeedMeta.name,
      };
      try {
        const existing = exportedItemMap.get(item.name) || null;
        let updatedSeed: SavedSeedData;
        if (existing) {
          updatedSeed = await updateAsset(existing.id, payload);
        } else {
          const saved = await saveAsset(payload);
          updatedSeed = {
            id: saved.id,
            type: "item",
            name: item.name,
            description: item.description,
            tags: [],
            data: payload.data,
            source_world: selectedSeedMeta.name,
            created_at: "",
          };
        }
        setExportedItemMap((prev) => {
          const next = new Map(prev);
          getItemSeedKeys(updatedSeed).forEach((key) => next.set(key, updatedSeed));
          return next;
        });
      } catch {
        setError(t("save_failed"));
      } finally {
        setExportingItem(null);
      }
    };

    return (
      <div className="h-screen flex flex-col bg-void">
        {bootEl}
        {booting && (
          <div className="fixed inset-0 z-boot-screen bg-void flex flex-col items-center justify-center scanlines cursor-pointer" onClick={() => setBooting(false)}>
            <div className="text-micro text-t-dim tracking-widest mb-4 animate-[fade-in_200ms_ease_both]">
              <GlitchReveal text="// BABEL WORLD STATE MACHINE" duration={600} />
            </div>
            <div className="text-micro text-primary tracking-widest opacity-0 animate-[fade-in_300ms_ease_800ms_both]">
              <GlitchReveal text="// INITIALIZING PORTAL" duration={500} className="text-micro text-primary tracking-widest" />
            </div>
            <div className="mt-6 w-48 h-px overflow-hidden opacity-0 animate-[fade-in_200ms_ease_1200ms_both]">
              <div className="h-full bg-primary shadow-[0_0_16px_var(--color-primary-glow-strong)] animate-[boot-line-expand_600ms_cubic-bezier(0.16,1,0.3,1)_1400ms_both]" />
            </div>
          </div>
        )}
        {/* Nav — world context */}
        <nav aria-label="Main navigation" className="flex items-center justify-between h-14 px-6 border-b border-b-DEFAULT shrink-0">
          <div className="flex items-center gap-4">
              <button
              type="button"
              onClick={() => router.push(buildWorldHref(null))}
              className="text-micro text-t-muted tracking-wider hover:text-primary transition-colors"
            >
              {t("back")}
            </button>
            <span className="text-t-dim">|</span>
            <a href="/" className="font-sans text-subheading font-bold tracking-widest text-primary hover:drop-shadow-[0_0_8px_var(--color-primary-glow-strong)] hover:animate-[logo-glitch_300ms_ease] transition-[filter]">BABEL</a>
            <span className="text-t-dim">/</span>
            <span className="text-body font-semibold text-primary truncate max-w-[300px] drop-shadow-[0_0_8px_var(--color-primary-glow)]">{selectedSeedMeta.name}</span>
          </div>
          <div className="flex items-center gap-6">
            <a href="/create" className="text-micro text-t-muted tracking-widest hover:text-t-DEFAULT transition-colors">
              {t("create")}
            </a>
            <a href={assetsHref} className="text-micro text-t-muted tracking-widest hover:text-t-DEFAULT transition-colors">
              {t("assets")}
            </a>
            <button
              type="button"
              onClick={() => setShowSettings(!showSettings)}
              aria-expanded={showSettings}
              className={`text-micro tracking-widest transition-colors ${
                showSettings ? "text-primary" : "text-t-muted hover:text-t-DEFAULT"
              }`}
            >
              {t("settings")}
            </button>
            <button
              type="button"
              onClick={toggle}
              className="text-micro text-t-dim tracking-wider border border-surface-3 px-3 py-1 hover:text-t-DEFAULT hover:border-b-hover active:scale-[0.97] transition-[colors,transform]"
              aria-label={t("lang_switch")}
            >
              {locale === "cn" ? "EN" : "\u4e2d"}
            </button>
          </div>
        </nav>

        {/* Settings panel */}
        {showSettings && (
          <Settings
            onClose={() => setShowSettings(false)}
            onSave={noop}
          />
        )}

        {/* Error banner */}
        {error && (
          <ErrorBanner variant="header" message={error} onDismiss={() => setError(null)} />
        )}

        {/* Main content — single column */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden animate-[seed-detail-enter_300ms_cubic-bezier(0.16,1,0.3,1)_both]">
          {/* World header — compact */}
          <div className="px-6 py-4 border-b border-b-DEFAULT">
            <div className="max-w-5xl flex flex-col gap-3">
              {/* Title + description */}
              <div className="flex-1 min-w-0">
                {editing && ed ? (
                  <div className="flex flex-col gap-2">
                    <label htmlFor="world-name" className="sr-only">{t("world_name")}</label>
                    <ExpandableInput
                      id="world-name"
                      required
                      aria-required="true"
                      className="font-sans font-bold text-heading leading-none tracking-tight bg-transparent border-b border-transparent hover:border-b-hover focus:border-primary focus:outline-none transition-colors w-full"
                      value={ed.name}
                      onValueChange={(value) => updateEdit({ name: value })}
                    />
                    <label htmlFor="world-desc" className="sr-only">{t("description")}</label>
                    <AutoTextarea
                      id="world-desc"
                      rows={2}
                      className="text-detail text-t-muted normal-case tracking-normal leading-relaxed bg-transparent border border-transparent hover:border-b-hover focus:border-primary focus:outline-none transition-colors resize-none overflow-hidden w-full"
                      value={ed.description}
                      onChange={(e) => updateEdit({ description: e.target.value })}
                    />
                  </div>
                ) : (
                  <>
                    <h1 className="font-sans font-bold text-heading leading-none tracking-tight">{ed?.name || selectedSeedMeta.name}</h1>
                    <p className="mt-1.5 text-detail text-t-muted normal-case tracking-normal leading-relaxed">{ed?.description || selectedSeedMeta.description}</p>
                  </>
                )}
              </div>
              {/* Actions: start new (full width) then edit/save + delete */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleStartNew(selectedSeedMeta.file)}
                  disabled={loading || deletingSeedFile === selectedSeedMeta.file}
                  className="h-9 px-5 text-micro font-medium tracking-wider bg-primary text-void border border-primary hover:bg-transparent hover:text-primary hover:shadow-[0_0_16px_var(--color-primary-glow-strong)] active:scale-[0.97] disabled:opacity-30 disabled:cursor-not-allowed transition-[colors,box-shadow,transform]"
                >
                  {loading ? t("creating") : t("world_start_new")}
                </button>
                <span className="flex-1" />
                {editing ? (
                  <button
                    type="button"
                    onClick={handleSaveOnly}
                    disabled={loading || !ed || deletingSeedFile === selectedSeedMeta.file}
                    className="h-9 px-4 text-micro font-medium tracking-wider bg-primary text-void border border-primary hover:bg-transparent hover:text-primary hover:shadow-[0_0_16px_var(--color-primary-glow-strong)] active:scale-[0.97] disabled:opacity-30 disabled:cursor-not-allowed transition-[colors,box-shadow,transform]"
                  >
                    {loading ? t("saving") : t("save_only")}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    disabled={!ed || deletingSeedFile === selectedSeedMeta.file}
                    className="h-9 px-4 text-micro font-medium tracking-wider border border-b-DEFAULT text-t-muted hover:bg-surface-1/20 hover:border-primary hover:text-primary active:scale-[0.97] disabled:opacity-30 disabled:cursor-not-allowed transition-[colors,transform]"
                  >
                    {t("edit_world")}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void handleDeleteWorldSeed(selectedSeedMeta)}
                  disabled={deletingSeedFile === selectedSeedMeta.file}
                  className="h-9 px-4 text-micro font-medium tracking-wider border border-danger text-danger hover:bg-danger/10 active:scale-[0.97] disabled:opacity-30 disabled:cursor-not-allowed transition-[colors,transform]"
                >
                  {deletingSeedFile === selectedSeedMeta.file ? t("loading") : t("delete")}
                </button>
              </div>
            </div>
          </div>

          {worldSessionGroup.hiddenDraftCount > 0 && (
            <div className="px-6 py-2 border-b border-b-DEFAULT text-micro text-warning tracking-wider">
              {t("timeline_hidden_duplicates", String(worldSessionGroup.hiddenDraftCount))}
            </div>
          )}

          {/* Timeline — branching visualization */}
          <Timeline
            branches={worldSessions.map((s) => ({
              id: s.id,
              tick: s.tick,
              status: s.status,
              created_at: s.created_at,
            }))}
            onSelect={(id) => router.push(`/sim?id=${id}`)}
            onNew={() => handleStartNew(selectedSeedMeta.file)}
            onDeleted={(id) => setSessions((prev) => prev.filter((s) => s.id !== id))}
          />

          {/* Asset tabs */}
          <div role="tablist" aria-label="World assets" className="flex border-b border-b-DEFAULT bg-surface-1 relative"
            onKeyDown={(e) => {
              const keys = ASSET_TABS.map((t) => t.key);
              const idx = keys.indexOf(assetTab);
              if (e.key === "ArrowRight") { e.preventDefault(); setAssetTab(keys[(idx + 1) % keys.length] as AssetTab); }
              if (e.key === "ArrowLeft") { e.preventDefault(); setAssetTab(keys[(idx - 1 + keys.length) % keys.length] as AssetTab); }
            }}
          >
            {ASSET_TABS.map((tab) => (
              <button
                type="button"
                key={tab.key}
                role="tab"
                tabIndex={assetTab === tab.key ? 0 : -1}
                aria-selected={assetTab === tab.key}
                aria-controls={`tabpanel-${tab.key}`}
                onClick={() => setAssetTab(tab.key)}
                className={`px-5 py-3 text-micro tracking-wider transition-colors ${
                  assetTab === tab.key ? "text-primary" : "text-t-muted hover:text-t-DEFAULT"
                }`}
                ref={(el) => {
                  if (el && tab.key === assetTab && assetTabIndicatorRef.current) {
                    assetTabIndicatorRef.current.style.left = `${el.offsetLeft}px`;
                    assetTabIndicatorRef.current.style.width = `${el.offsetWidth}px`;
                  }
                }}
              >
                {tab.label}
                {tab.count > 0 && <span className="ml-1 text-t-dim">{tab.count}</span>}
              </button>
            ))}
            {/* Sliding indicator */}
            <span
              ref={assetTabIndicatorRef}
              className="absolute bottom-0 h-px bg-primary pointer-events-none"
              style={{
                transition: "left 150ms cubic-bezier(0.16, 1, 0.3, 1), width 150ms cubic-bezier(0.16, 1, 0.3, 1)",
              }}
            />
          </div>

          {/* Asset content */}
          <div className="max-w-5xl mx-auto w-full" role="tabpanel" id={`tabpanel-${assetTab}`}>
              {detailLoading ? (
                <div className="p-3 flex flex-col gap-2">
                  {[1, 2, 3].map((i) => (
                    <SkeletonLine key={i} className="h-14 border border-b-DEFAULT" />
                  ))}
                </div>
              ) : !ed ? (
                <div className="p-6 text-detail text-t-dim">{t("failed_load")}</div>
              ) : (
                <div key={assetTab} className="animate-[fade-in_100ms_ease]">
                  {/* Agents tab — editable */}
                  {assetTab === "agents" && ed && (
                    <div className="p-3 flex flex-col gap-2">
                      {ed.agents.map((agent, ai) => (
                        <div key={agent.id} className="border border-b-DEFAULT hover:border-b-hover transition-colors">
                          <button
                            type="button"
                            aria-expanded={expandedAgent === agent.id}
                            onClick={() => setExpandedAgent(expandedAgent === agent.id ? null : agent.id)}
                            className="w-full px-4 py-3 flex items-center gap-3 text-left bg-surface-1 hover:bg-surface-3 transition-colors"
                          >
                            <StatusDot status="info" />
                            <div className="flex-1 min-w-0">
                              <div className="text-body font-semibold truncate">{agent.name || t("ph_agent_name")}</div>
                              <div className="text-micro text-t-dim tracking-wider mt-0.5 truncate">{agent.location || "\u2014"}</div>
                            </div>
                            <span className="text-micro text-t-dim tracking-wider shrink-0">
                              {expandedAgent === agent.id ? "\u25BE" : "\u25B8"}
                            </span>
                          </button>
                          {expandedAgent === agent.id && (
                            <fieldset disabled={!editing} className="border-t border-b-DEFAULT bg-void px-4 py-3 animate-slide-down flex flex-col gap-3 disabled:opacity-60">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div>
                                  <label htmlFor={`ed-agent-name-${ai}`} className={fieldLabel}>{t("name")}</label>
                                  <ExpandableInput id={`ed-agent-name-${ai}`} className={inputCls} value={agent.name} onValueChange={(value) => updateAgent(ai, { name: value })} />
                                </div>
                                <div>
                                  <label htmlFor={`ed-agent-personality-${ai}`} className={fieldLabel}>{t("personality")}</label>
                                  <ExpandableInput id={`ed-agent-personality-${ai}`} className={inputCls} value={agent.personality} onValueChange={(value) => updateAgent(ai, { personality: value })} />
                                </div>
                              </div>
                              <div>
                                <label htmlFor={`ed-agent-desc-${ai}`} className={fieldLabel}>{t("description")}</label>
                                <AutoTextarea id={`ed-agent-desc-${ai}`} rows={3} className={textareaCls} value={agent.description} onChange={(e) => updateAgent(ai, { description: e.target.value })} />
                              </div>
                              <div>
                                <label htmlFor={`ed-agent-goals-${ai}`} className={fieldLabel}>{t("goals")}</label>
                                <StringListEditor
                                  idBase={`ed-agent-goals-${ai}`}
                                  values={agent.goals || []}
                                  addLabel={t("add_goal")}
                                  itemPlaceholder={t("ph_goals")}
                                  addPlaceholder={t("ph_goals")}
                                  onChange={(value) => updateAgent(ai, { goals: value })}
                                />
                              </div>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div>
                                  <label htmlFor={`ed-agent-inv-${ai}`} className={fieldLabel}>{t("inventory")}</label>
                                  <StringListEditor
                                    idBase={`ed-agent-inv-${ai}`}
                                    values={agent.inventory || []}
                                    addLabel={t("add_inventory_item")}
                                    itemPlaceholder={t("ph_inventory")}
                                    addPlaceholder={t("ph_inventory")}
                                    onChange={(value) => updateAgent(ai, { inventory: value })}
                                  />
                                </div>
                                <div>
                                  <label htmlFor={`ed-agent-loc-${ai}`} className={fieldLabel}>{t("starting_location")}</label>
                                  <select
                                    id={`ed-agent-loc-${ai}`}
                                    className={inputCls}
                                    value={agent.location}
                                    onChange={(e) => updateAgent(ai, { location: e.target.value })}
                                  >
                                    <option value="">—</option>
                                    {(ed?.locations || []).map((loc) => (
                                      <option key={loc.name} value={loc.name}>{loc.name}</option>
                                    ))}
                                  </select>
                                </div>
                              </div>
                              <div className="flex items-center gap-3 pt-1">
                                <button
                                  type="button"
                                  onClick={() => handleSaveAgentSeed(agent)}
                                  disabled={savedIds.has(agent.id)}
                                  className={`text-micro tracking-wider transition-colors ${savedIds.has(agent.id) ? "text-primary" : "text-t-muted hover:text-primary"}`}
                                >
                                  {savedIds.has(agent.id) ? t("saved_ok") : t("save_agent_seed")}
                                </button>
                                {ed.agents.length > 1 && (
                                  <button type="button" onClick={() => removeAgent(ai)} className="text-micro tracking-wider text-danger hover:text-danger/80 transition-colors">
                                    {t("remove")}
                                  </button>
                                )}
                              </div>
                            </fieldset>
                          )}
                        </div>
                      ))}
                      {editing && (
                        <button type="button" onClick={addAgent} className="h-9 text-micro tracking-wider border border-b-DEFAULT text-t-muted hover:bg-surface-1/20 hover:border-primary hover:text-primary active:scale-[0.97] transition-[colors,transform]">
                          {t("add_agent")}
                        </button>
                      )}
                    </div>
                  )}

                  {/* Items tab — aggregated from agent inventories */}
                  {assetTab === "items" && ed && (
                    <div className="p-3 flex flex-col gap-2">
                      {allItems.length === 0 ? (
                        <div className="p-6 text-detail text-t-dim text-center normal-case tracking-normal">
                          {t("panel_no_items")}
                        </div>
                      ) : (
                        allItems.map((item, itemIndex) => {
                          const exportedSeed = exportedItemMap.get(item.name) || null;
                          const itemDraft = itemDrafts[item.name] ?? item.name;
                          const hasNarrative = Boolean(
                            item.description.trim() ||
                            item.origin.trim() ||
                            item.properties.length > 0 ||
                            item.significance.trim(),
                          );

                          return (
                            <div key={item.name} className="border border-b-DEFAULT hover:border-b-hover transition-colors">
                              <button
                                type="button"
                                aria-expanded={expandedItem === item.name}
                                onClick={() => {
                                  setExpandedItem(expandedItem === item.name ? null : item.name);
                                  setItemDrafts((prev) => ({
                                    ...prev,
                                    [item.name]: prev[item.name] ?? item.name,
                                  }));
                                }}
                                className="w-full px-4 py-3 flex items-center gap-3 text-left bg-surface-1 hover:bg-surface-3 transition-colors"
                              >
                                <StatusDot status="warning" />
                                <div className="flex-1 min-w-0">
                                  <div className="text-body font-semibold truncate">{item.name}</div>
                                  <div className="text-micro text-t-dim tracking-wider mt-0.5 truncate">
                                    {t("panel_held_by")}: {item.holders.join(" / ")}
                                  </div>
                                </div>
                                <span className="text-micro text-t-dim tracking-wider shrink-0">
                                  {expandedItem === item.name ? "\u25BE" : "\u25B8"}
                                </span>
                              </button>
                              {expandedItem === item.name && (
                                <div className="border-t border-b-DEFAULT bg-void px-4 py-3 animate-slide-down flex flex-col gap-3">
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    <div>
                                      <label htmlFor={`ed-item-name-${itemIndex}`} className={fieldLabel}>{t("name")}</label>
                                      <ExpandableInput
                                        id={`ed-item-name-${itemIndex}`}
                                        className={inputCls}
                                        value={itemDraft}
                                        onValueChange={(value) =>
                                          setItemDrafts((prev) => ({
                                            ...prev,
                                            [item.name]: value,
                                          }))
                                        }
                                      />
                                    </div>
                                    <div>
                                      <div className={fieldLabel}>{t("panel_held_by")}</div>
                                      {item.holders.length > 0 ? (
                                        <div className="flex flex-wrap gap-1.5">
                                          {item.holders.map((holder) => (
                                            <span key={holder} className="text-micro text-info tracking-wider px-2 py-0.5 border border-info/40">
                                              {holder}
                                            </span>
                                          ))}
                                        </div>
                                      ) : (
                                        <div className="text-detail text-t-dim normal-case tracking-normal">
                                          {t("world_item_unassigned")}
                                        </div>
                                      )}
                                    </div>
                                  </div>

                                  <div>
                                    <label htmlFor={`ed-item-desc-${itemIndex}`} className={fieldLabel}>{t("description")}</label>
                                    <AutoTextarea
                                      id={`ed-item-desc-${itemIndex}`}
                                      rows={3}
                                      className={textareaCls}
                                      value={item.description}
                                      onChange={(e) => updateWorldItem(item.name, { description: e.target.value })}
                                    />
                                  </div>
                                  <div>
                                    <label htmlFor={`ed-item-origin-${itemIndex}`} className={fieldLabel}>{t("origin")}</label>
                                    <AutoTextarea
                                      id={`ed-item-origin-${itemIndex}`}
                                      rows={3}
                                      className={textareaCls}
                                      value={item.origin}
                                      onChange={(e) => updateWorldItem(item.name, { origin: e.target.value })}
                                    />
                                  </div>
                                  <div>
                                    <label className={fieldLabel}>{t("properties")}</label>
                                    <StringListEditor
                                      idBase={`ed-item-properties-${itemIndex}`}
                                      values={item.properties}
                                      addLabel={t("add_property")}
                                      itemPlaceholder={t("ph_item_property")}
                                      addPlaceholder={t("ph_item_property")}
                                      onChange={(value) => updateWorldItem(item.name, { properties: value })}
                                    />
                                  </div>
                                  <div>
                                    <label htmlFor={`ed-item-significance-${itemIndex}`} className={fieldLabel}>{t("significance")}</label>
                                    <AutoTextarea
                                      id={`ed-item-significance-${itemIndex}`}
                                      rows={3}
                                      className={textareaCls}
                                      value={item.significance}
                                      onChange={(e) => updateWorldItem(item.name, { significance: e.target.value })}
                                    />
                                  </div>

                                  {!hasNarrative && (
                                    <div className="text-detail text-t-dim normal-case tracking-normal">
                                      {t("world_item_empty")}
                                    </div>
                                  )}

                                  {exportedSeed && (
                                    <div className="text-micro text-primary tracking-wider">
                                      {t("world_item_exported")}
                                    </div>
                                  )}

                                  <div className="flex items-center gap-3 pt-1">
                                    <button
                                      type="button"
                                      onClick={() => void handleCommitItemRename(item.name)}
                                      disabled={!itemDraft.trim() || itemDraft.trim() === item.name}
                                      className="text-micro tracking-wider text-t-muted hover:text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                    >
                                      {t("save")}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => void handleGenerateWorldItem(item)}
                                      disabled={!latestWorldSessionId || generatingItem === item.name}
                                      className="text-micro tracking-wider text-t-muted hover:text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                    >
                                      {generatingItem === item.name
                                        ? t("generating")
                                        : hasNarrative
                                        ? t("optimize_item")
                                        : t("generate_details")}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => void handleExportWorldItem(item)}
                                      disabled={!item.name.trim() || exportingItem === item.name}
                                      className="text-micro tracking-wider text-t-muted hover:text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                    >
                                      {exportingItem === item.name
                                        ? t("saving")
                                        : exportedSeed
                                        ? t("export_seed_update")
                                        : t("export_to_seed_library")}
                                    </button>
                                  </div>
                                  {!latestWorldSessionId && (
                                    <div className="text-micro text-t-dim tracking-wider normal-case">
                                      {t("world_item_generate_requires_timeline")}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}

                  {/* Locations tab — editable */}
                  {assetTab === "locations" && ed && (
                    <div className="p-3 flex flex-col gap-2">
                      {ed.locations.map((loc, li) => (
                        <div key={li} className="border border-b-DEFAULT hover:border-b-hover transition-colors">
                          <button
                            type="button"
                            aria-expanded={expandedLocation === li}
                            onClick={() => setExpandedLocation(expandedLocation === li ? null : li)}
                            className="w-full px-4 py-3 flex items-center gap-3 text-left bg-surface-1 hover:bg-surface-3 transition-colors"
                          >
                            <StatusDot status="secondary" />
                            <div className="flex-1 min-w-0">
                              <div className="text-body font-semibold truncate">{loc.name || t("ph_location")}</div>
                            </div>
                            <span className="text-micro text-t-dim tracking-wider shrink-0">
                              {expandedLocation === li ? "\u25BE" : "\u25B8"}
                            </span>
                          </button>
                          {expandedLocation === li && (
                            <div className="border-t border-b-DEFAULT bg-void px-4 py-3 animate-slide-down flex flex-col gap-3">
                              <div>
                                <label htmlFor={`ed-loc-name-${li}`} className={fieldLabel}>{t("name")}</label>
                                <ExpandableInput id={`ed-loc-name-${li}`} className={inputCls} value={loc.name} onValueChange={(value) => updateLocation(li, { name: value })} />
                              </div>
                              <div>
                                <label htmlFor={`ed-loc-desc-${li}`} className={fieldLabel}>{t("description")}</label>
                                <AutoTextarea id={`ed-loc-desc-${li}`} rows={3} className={textareaCls} value={loc.description} onChange={(e) => updateLocation(li, { description: e.target.value })} />
                              </div>
                              {/* Agents here */}
                              {(() => {
                                const here = ed.agents.filter((a) => a.location === loc.name);
                                if (here.length === 0) return null;
                                return (
                                  <div className="flex items-center gap-2">
                                    <span className="text-micro text-t-muted tracking-widest">{t("agents")}:</span>
                                    {here.map((a) => (
                                      <span key={a.id} className="text-micro text-info tracking-wider truncate max-w-[120px]">{a.name}</span>
                                    ))}
                                  </div>
                                );
                              })()}
                              <div className="flex items-center gap-3 pt-1">
                                <button
                                  type="button"
                                  onClick={() => handleSaveLocationSeed(loc)}
                                  disabled={savedIds.has(`loc_${loc.name}`)}
                                  className={`text-micro tracking-wider transition-colors ${savedIds.has(`loc_${loc.name}`) ? "text-primary" : "text-t-muted hover:text-primary"}`}
                                >
                                  {savedIds.has(`loc_${loc.name}`) ? t("saved_ok") : t("save_location_seed")}
                                </button>
                                <button type="button" onClick={() => removeLocation(li)} className="text-micro tracking-wider text-danger hover:text-danger/80 transition-colors">
                                  {t("remove")}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                      <button type="button" onClick={addLocation} className="h-9 text-micro tracking-wider border border-b-DEFAULT text-t-muted hover:bg-surface-1/20 hover:border-primary hover:text-primary active:scale-[0.97] transition-[colors,transform]">
                        {t("add_location")}
                      </button>
                    </div>
                  )}

                  {/* Rules tab — editable */}
                  {assetTab === "rules" && ed && (
                    <div className="p-3">
                      <label htmlFor="ed-rules-draft" className="sr-only">{t("rules")}</label>
                      <StringListEditor
                        idBase="ed-rules"
                        values={ed.rules || []}
                        addLabel={t("add_rule")}
                        itemPlaceholder={t("ph_rules")}
                        addPlaceholder={t("ph_rules")}
                        onChange={(value) => updateEdit({ rules: value })}
                      />
                    </div>
                  )}

                  {/* Events tab — editable */}
                  {assetTab === "events" && ed && (
                    <div className="p-3">
                      <label htmlFor="ed-events-draft" className="sr-only">{t("initial_events")}</label>
                      <StringListEditor
                        idBase="ed-events"
                        values={ed.initial_events || []}
                        addLabel={t("add_event")}
                        itemPlaceholder={t("ph_events")}
                        addPlaceholder={t("ph_events")}
                        onChange={(value) => updateEdit({ initial_events: value })}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
        </div>

      </div>
    );
  }

  // ── World list view (default) ──
  return (
    <div className="min-h-screen flex flex-col bg-void">
      {bootEl}
      {booting && (
        <div className="fixed inset-0 z-boot-screen bg-void flex flex-col items-center justify-center scanlines cursor-pointer" onClick={() => setBooting(false)}>
          <AmbientGrid density="dense" className="z-0 opacity-60" />
          <div className="relative z-10 flex flex-col items-center">
            <div className="text-micro text-t-dim tracking-widest mb-4 animate-[fade-in_200ms_ease_both]">
              <GlitchReveal text="// BABEL WORLD STATE MACHINE" duration={600} />
            </div>
            <div className="text-micro text-primary tracking-widest opacity-0 animate-[fade-in_300ms_ease_800ms_both]">
              <GlitchReveal text="// INITIALIZING PORTAL" duration={500} className="text-micro text-primary tracking-widest" />
            </div>
            <div className="mt-6 w-48 h-px overflow-hidden opacity-0 animate-[fade-in_200ms_ease_1200ms_both]">
              <div className="h-full bg-primary shadow-[0_0_16px_var(--color-primary-glow-strong)] animate-[boot-line-expand_600ms_cubic-bezier(0.16,1,0.3,1)_1400ms_both]" />
            </div>
          </div>
        </div>
      )}
      <Nav activePage="home" showSettings={showSettings} onToggleSettings={() => setShowSettings(!showSettings)} />

      {/* Global settings panel */}
      {showSettings && (
        <Settings
          onClose={() => setShowSettings(false)}
          onSave={noop}
        />
      )}

      <main id="main-content" className="flex-1 flex flex-col animate-fade-in">
        {/* ── Hero ── */}
        <div className="px-6 pt-8 pb-5 border-b border-b-DEFAULT">
          <div className="max-w-5xl mx-auto w-full flex items-end justify-between gap-6">
            <div>
              <h1 className="font-sans font-bold text-[clamp(2.5rem,5vw,4rem)] tracking-tight leading-[0.9] text-primary drop-shadow-[0_0_24px_var(--color-primary-glow-strong)]">
                <GlitchReveal text="BABEL" duration={700} />
              </h1>
              <p className="mt-3 text-body text-t-muted normal-case tracking-normal">
                {t("tagline")}
              </p>
              <p className="mt-2 text-micro text-info/70 tracking-wider hover:text-info transition-colors">
                {"// ORACLE: "}<DecodeText text={t(
                  (["oracle_greet_0", "oracle_greet_1", "oracle_greet_2", "oracle_greet_3"] as const)[oracleGreetIdx]
                )} duration={1200} />
              </p>
            </div>
            <div className="flex items-center gap-4 shrink-0 pb-0.5">
              {!seedsLoading && seeds.length > 0 && (
                <span className="text-micro text-primary tracking-widest opacity-0 animate-[fade-in_300ms_ease_400ms_both]">
                  {t("world_count", String(seeds.length))}
                </span>
              )}
              <a
                href="/create"
                className="h-9 px-5 text-micro font-medium tracking-wider bg-primary text-void border border-primary hover:bg-transparent hover:text-primary hover:shadow-[0_0_16px_var(--color-primary-glow-strong)] active:scale-[0.97] transition-[colors,box-shadow,transform] inline-flex items-center opacity-0 animate-[fade-in_300ms_ease_500ms_both]"
              >
                {t("create_custom")}
              </a>
            </div>
          </div>
        </div>

        {/* ── World list ── */}
        <div className="flex-1 px-6 py-4">
          <div className="max-w-5xl mx-auto w-full">
            {!seedsLoading && seeds.length > 0 && (
              <div className="text-micro text-t-dim tracking-widest mb-4">
                {t("select_world")}
              </div>
            )}

            {error && (
              <ErrorBanner message={error} onDismiss={() => setError(null)} className="mb-4" />
            )}

            {seedsLoading ? (
              <div className="flex flex-col gap-px bg-b-DEFAULT">
                {[1, 2].map((i) => (
                  <div key={i} className="bg-void p-6">
                    <SkeletonLine className="h-4 w-48 mb-3" />
                    <SkeletonLine className="h-3 w-full mb-2" />
                    <SkeletonLine className="h-3 w-24" />
                  </div>
                ))}
              </div>
            ) : seeds.length === 0 && !error ? (
              <EmptyState label="// EMPTY">
                <div className="text-detail text-t-muted normal-case tracking-normal text-center max-w-md">
                  {t("no_seeds")}
                </div>
                <a
                  href="/create"
                  className="h-9 px-5 text-micro font-medium tracking-wider border border-primary text-primary hover:bg-primary hover:text-void hover:shadow-[0_0_16px_var(--color-primary-glow-strong)] active:scale-[0.97] transition-[colors,box-shadow,transform] inline-flex items-center"
                >
                  {t("create_custom")}
                </a>
              </EmptyState>
            ) : (
              <div className={`flex flex-col gap-px bg-b-DEFAULT stagger-in relative overflow-hidden transition-opacity duration-slow ${detailLoading ? "opacity-40 pointer-events-none" : ""}`}>
                <span className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/8 to-transparent bg-[length:200%_100%] animate-[boot-sweep_700ms_cubic-bezier(0.16,1,0.3,1)_both] pointer-events-none z-10" aria-hidden="true" />
                {seeds.map((seed) => {
                  const saveCount = getWorldSessions(seed.name).sessions.length;
                  return (
                    <button
                      type="button"
                      key={seed.file}
                      onClick={() => handleSelectSeed(seed)}
                      className="bg-void px-5 py-4 text-left hover:bg-surface-1 transition-[colors,box-shadow] group border-l-2 border-l-transparent hover:border-l-primary hover:shadow-[inset_0_0_24px_var(--color-primary-glow)] relative overflow-hidden"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-body font-bold group-hover:text-primary transition-colors">
                          {seed.name}
                        </span>
                        <span className="text-detail text-primary tracking-wider opacity-0 group-hover:opacity-100 transition-opacity">
                          &rarr;
                        </span>
                      </div>
                      <p className="text-detail text-t-muted normal-case tracking-normal leading-relaxed mb-3">
                        {seed.description}
                      </p>
                      <div className="flex gap-px">
                        <span className="text-micro text-t-dim tracking-wider bg-surface-1 px-2.5 py-1">{seed.agent_count} {t("agents")}</span>
                        <span className="text-micro text-t-dim tracking-wider bg-surface-1 px-2.5 py-1">{seed.location_count} {t("locations")}</span>
                        {saveCount > 0 && (
                          <span className="text-micro text-primary tracking-wider bg-surface-1 px-2.5 py-1">{saveCount} {t("world_saves_count")}</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={null}>
      <HomeContent />
    </Suspense>
  );
}
