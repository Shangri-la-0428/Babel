"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { fetchSeeds, fetchSeedDetail, createFromSeed, createWorld, getSessions, saveAsset, SeedInfo, SeedDetail } from "@/lib/api";
import { useLocale } from "@/lib/locale-context";
import Nav from "@/components/Nav";
import Settings from "@/components/Settings";
import Timeline from "@/components/Timeline";
import { StatusDot, ErrorBanner, EmptyState, SkeletonLine, GlitchReveal } from "@/components/ui";
import WorldBootOverlay from "@/components/WorldBootOverlay";

interface SessionRecord {
  id: string;
  world_seed: string;
  tick: number;
  status: string;
  created_at: string;
}

type AssetTab = "agents" | "items" | "locations" | "rules" | "events";

/** Auto-resize a textarea to fit its content (batched via rAF) */
function autoResize(el: HTMLTextAreaElement | null) {
  if (!el) return;
  requestAnimationFrame(() => {
    el.style.height = "0";
    el.style.height = el.scrollHeight + "px";
  });
}

/** Textarea that grows/shrinks with content */
function AutoTextarea({ className, value, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { autoResize(ref.current); }, [value]);
  return (
    <textarea
      ref={ref}
      className={className}
      value={value}
      onInput={(e) => autoResize(e.currentTarget)}
      {...props}
    />
  );
}

export default function Home() {
  const router = useRouter();
  const { locale, toggle, t } = useLocale();
  const [seeds, setSeeds] = useState<SeedInfo[]>([]);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [oracleGreetIdx] = useState(() => Math.floor(Math.random() * 4));
  const [loading, setLoading] = useState(false);
  const [seedsLoading, setSeedsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSeed, setSelectedSeed] = useState<SeedInfo | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [assetTab, setAssetTab] = useState<AssetTab>("agents");
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const [expandedLocation, setExpandedLocation] = useState<number | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [editDetail, setEditDetail] = useState<SeedDetail | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [bootOverlay, setBootOverlay] = useState<{ worldName: string; targetUrl: string } | null>(null);
  const assetTabIndicatorRef = useRef<HTMLSpanElement>(null);
  // Settings saved to localStorage by Settings component; home page only shows/hides the panel
  const noop = () => {};

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
        source_world: selectedSeed?.name,
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
        source_world: selectedSeed?.name,
      });
      markSaved(`loc_${loc.name}`);
    } catch { /* ignore */ }
  }

  function handleEditWorld() {
    if (!editDetail) return;
    try {
      localStorage.setItem("babel_edit_seed", JSON.stringify(editDetail));
    } catch { /* quota exceeded — navigate anyway */ }
    router.push("/create");
  }

  async function handleSaveLaunch() {
    if (!editDetail) return;
    setLoading(true);
    setError(null);
    try {
      const data = {
        name: editDetail.name,
        description: editDetail.description,
        rules: editDetail.rules,
        locations: editDetail.locations,
        agents: editDetail.agents.map((a) => ({
          id: a.id,
          name: a.name,
          description: a.description,
          personality: a.personality,
          goals: a.goals,
          inventory: a.inventory,
          location: a.location,
        })),
        initial_events: editDetail.initial_events,
      };
      const res = await createWorld(data);
      if (!res?.session_id) throw new Error("No session_id");
      setBootOverlay({ worldName: editDetail.name, targetUrl: `/sim?id=${res.session_id}` });
    } catch {
      setError(t("failed_create"));
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
      .catch(() => setError(t("failed_load")))
      .finally(() => setSeedsLoading(false));
    getSessions()
      .then((data) => setSessions(Array.isArray(data) ? data : []))
      .catch(() => { /* session list is supplementary — seed list still works */ });
  }, []);

  async function handleSelectSeed(seed: SeedInfo) {
    setSelectedSeed(seed);
    setEditDetail(null);
    setDetailLoading(true);
    setAssetTab("agents");
    setExpandedAgent(null);
    setExpandedLocation(null);
    try {
      const detail = await fetchSeedDetail(seed.file);
      setEditDetail(JSON.parse(JSON.stringify(detail)));
    } catch {
      setError(t("failed_load_detail"));
    } finally {
      setDetailLoading(false);
    }
  }

  async function handleStartNew(filename: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await createFromSeed(filename);
      if (!res?.session_id) throw new Error("No session_id");
      const seedName = seeds.find((s) => s.file === filename)?.name || "WORLD";
      setBootOverlay({ worldName: seedName, targetUrl: `/sim?id=${res.session_id}` });
    } catch {
      setError(t("failed_create"));
      setLoading(false);
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

  function getWorldSessions(seedName: string) {
    return sessionsByWorld.get(seedName) || [];
  }

  // ── Boot overlay (world entry transition) ──
  const bootEl = bootOverlay && (
    <WorldBootOverlay
      worldName={bootOverlay.worldName}
      onComplete={() => router.push(bootOverlay.targetUrl)}
    />
  );

  // ── World detail view ──
  if (selectedSeed) {
    const worldSessions = getWorldSessions(selectedSeed.name);

    const ed = editDetail;

    // Aggregate all items from all agents' inventories
    let allItems: { name: string; holders: string[] }[] = [];
    if (ed) {
      const itemMap = new Map<string, string[]>();
      for (const agent of ed.agents) {
        for (const item of (agent.inventory || [])) {
          if (!item) continue;
          const holders = itemMap.get(item) || [];
          holders.push(agent.name || agent.id);
          itemMap.set(item, holders);
        }
      }
      allItems = Array.from(itemMap.entries()).map(([name, holders]) => ({ name, holders }));
    }

    const ASSET_TABS: { key: AssetTab; label: string; count: number }[] = [
      { key: "agents", label: t("agents"), count: ed?.agents?.length ?? 0 },
      { key: "items", label: t("item"), count: allItems.length },
      { key: "locations", label: t("locations"), count: ed?.locations?.length ?? 0 },
      { key: "rules", label: t("rules"), count: ed?.rules?.length ?? 0 },
      { key: "events", label: t("event"), count: ed?.initial_events?.length ?? 0 },
    ];

    const inputCls = "w-full h-9 px-3 bg-void border border-b-DEFAULT text-detail text-t-DEFAULT normal-case tracking-normal focus:border-primary focus:outline-none hover:border-b-hover transition-colors";
    const textareaCls = "w-full min-h-[36px] px-3 py-2 bg-void border border-b-DEFAULT text-detail text-t-DEFAULT normal-case tracking-normal leading-relaxed resize-none overflow-hidden focus:border-primary focus:outline-none hover:border-b-hover transition-colors";
    const fieldLabel = "text-micro text-t-muted tracking-widest mb-1.5 block";

    return (
      <div className="h-screen flex flex-col bg-void">
        {bootEl}
        {/* Nav — world context */}
        <nav aria-label="Main navigation" className="flex items-center justify-between h-14 px-6 border-b border-b-DEFAULT shrink-0">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setSelectedSeed(null)}
              className="text-micro text-t-muted tracking-wider hover:text-primary transition-colors"
            >
              {t("back")}
            </button>
            <span className="text-t-dim">|</span>
            <a href="/" className="font-sans text-subheading font-bold tracking-widest text-primary hover:drop-shadow-[0_0_8px_var(--color-primary-glow-strong)] hover:animate-[logo-glitch_300ms_ease] transition-[filter]">BABEL</a>
            <span className="text-t-dim">/</span>
            <span className="text-body font-semibold text-primary truncate max-w-[300px] drop-shadow-[0_0_8px_var(--color-primary-glow)]">{selectedSeed.name}</span>
          </div>
          <div className="flex items-center gap-6">
            <a href="/create" className="text-micro text-t-muted tracking-widest hover:text-t-DEFAULT transition-colors">
              {t("create")}
            </a>
            <a href="/assets" className="text-micro text-t-muted tracking-widest hover:text-t-DEFAULT transition-colors">
              {t("assets")}
            </a>
            <button
              onClick={() => setShowSettings(!showSettings)}
              aria-expanded={showSettings}
              className={`text-micro tracking-widest transition-colors ${
                showSettings ? "text-primary" : "text-t-muted hover:text-t-DEFAULT"
              }`}
            >
              {t("settings")}
            </button>
            <button
              onClick={toggle}
              className="text-micro text-t-dim tracking-wider border border-surface-3 px-3 py-1 hover:text-t-DEFAULT hover:border-b-hover transition-colors"
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
        <div className="flex-1 overflow-y-auto overflow-x-hidden animate-[fade-in_0.3s_ease]">
          {/* World header — compact */}
          <div className="px-6 py-3 border-b border-b-DEFAULT">
            <div className="flex items-start justify-between gap-4 max-w-5xl">
              <div className="flex-1 min-w-0">
                {ed ? (
                  <div className="flex flex-col gap-2">
                    <label htmlFor="world-name" className="sr-only">{t("world_name")}</label>
                    <input
                      id="world-name"
                      required
                      aria-required="true"
                      className="font-sans font-bold text-heading leading-none tracking-tight bg-transparent border-b border-transparent hover:border-b-hover focus:border-primary focus:outline-none transition-colors w-full"
                      value={ed.name}
                      onChange={(e) => updateEdit({ name: e.target.value })}
                    />
                    <label htmlFor="world-desc" className="sr-only">{t("description")}</label>
                    <AutoTextarea
                      id="world-desc"
                      className="text-detail text-t-muted normal-case tracking-normal leading-relaxed bg-transparent border border-transparent hover:border-b-hover focus:border-primary focus:outline-none transition-colors resize-none overflow-hidden w-full"
                      value={ed.description}
                      onChange={(e) => updateEdit({ description: e.target.value })}
                    />
                  </div>
                ) : (
                  <>
                    <h1 className="font-sans font-bold text-heading leading-none tracking-tight">{selectedSeed.name}</h1>
                    <p className="mt-1.5 text-detail text-t-muted normal-case tracking-normal leading-relaxed">{selectedSeed.description}</p>
                  </>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0 pt-1">
                <button
                  onClick={() => handleStartNew(selectedSeed.file)}
                  disabled={loading}
                  className="h-9 px-4 text-micro font-medium tracking-wider border border-b-DEFAULT text-t-muted hover:border-primary hover:text-primary active:scale-[0.97] disabled:opacity-30 transition-[colors,transform]"
                >
                  {loading ? t("creating") : t("world_start_new")}
                </button>
                <button
                  onClick={handleSaveLaunch}
                  disabled={loading || !ed}
                  className="h-9 px-4 text-micro font-medium tracking-wider bg-primary text-void border border-primary hover:bg-transparent hover:text-primary hover:shadow-[0_0_16px_var(--color-primary-glow-strong)] active:scale-[0.97] disabled:opacity-30 transition-[colors,box-shadow,transform]"
                >
                  {loading ? t("creating") : t("save_launch")}
                </button>
                <button
                  onClick={handleEditWorld}
                  disabled={!ed}
                  className="h-9 px-4 text-micro font-medium tracking-wider border border-b-DEFAULT text-t-muted hover:border-primary hover:text-primary active:scale-[0.97] disabled:opacity-30 transition-[colors,transform]"
                >
                  {t("edit_world")}
                </button>
              </div>
            </div>
          </div>

          {/* Timeline — branching visualization */}
          <Timeline
            branches={worldSessions.map((s) => ({
              id: s.id,
              tick: s.tick,
              status: s.status,
              created_at: s.created_at,
            }))}
            onSelect={(id) => router.push(`/sim?id=${id}`)}
            onNew={() => handleStartNew(selectedSeed.file)}
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
                            <div className="border-t border-b-DEFAULT bg-void px-4 py-3 animate-slide-down flex flex-col gap-3">
                              <div className="grid grid-cols-2 gap-3">
                                <div>
                                  <label htmlFor={`ed-agent-name-${ai}`} className={fieldLabel}>{t("name")}</label>
                                  <input id={`ed-agent-name-${ai}`} className={inputCls} value={agent.name} onChange={(e) => updateAgent(ai, { name: e.target.value })} />
                                </div>
                                <div>
                                  <label htmlFor={`ed-agent-personality-${ai}`} className={fieldLabel}>{t("personality")}</label>
                                  <input id={`ed-agent-personality-${ai}`} className={inputCls} value={agent.personality} onChange={(e) => updateAgent(ai, { personality: e.target.value })} />
                                </div>
                              </div>
                              <div>
                                <label htmlFor={`ed-agent-desc-${ai}`} className={fieldLabel}>{t("description")}</label>
                                <AutoTextarea id={`ed-agent-desc-${ai}`} className={textareaCls} value={agent.description} onChange={(e) => updateAgent(ai, { description: e.target.value })} />
                              </div>
                              <div>
                                <label htmlFor={`ed-agent-goals-${ai}`} className={fieldLabel}>{t("goals")}</label>
                                <AutoTextarea
                                  id={`ed-agent-goals-${ai}`}
                                  className={textareaCls}
                                  value={(agent.goals || []).join("\n")}
                                  placeholder={t("ph_goals")}
                                  onChange={(e) => updateAgent(ai, { goals: e.target.value.split("\n").filter(Boolean) })}
                                />
                              </div>
                              <div className="grid grid-cols-2 gap-3">
                                <div>
                                  <label htmlFor={`ed-agent-inv-${ai}`} className={fieldLabel}>{t("inventory")}</label>
                                  <input
                                    id={`ed-agent-inv-${ai}`}
                                    className={inputCls}
                                    value={(agent.inventory || []).join(", ")}
                                    placeholder={t("ph_inventory")}
                                    onChange={(e) => updateAgent(ai, { inventory: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
                                  />
                                </div>
                                <div>
                                  <label htmlFor={`ed-agent-loc-${ai}`} className={fieldLabel}>{t("starting_location")}</label>
                                  <input id={`ed-agent-loc-${ai}`} className={inputCls} value={agent.location} onChange={(e) => updateAgent(ai, { location: e.target.value })} />
                                </div>
                              </div>
                              <div className="flex items-center gap-3 pt-1">
                                <button
                                  onClick={() => handleSaveAgentSeed(agent)}
                                  disabled={savedIds.has(agent.id)}
                                  className={`text-micro tracking-wider transition-colors ${savedIds.has(agent.id) ? "text-primary" : "text-t-muted hover:text-primary"}`}
                                >
                                  {savedIds.has(agent.id) ? t("saved_ok") : t("save_agent_seed")}
                                </button>
                                {ed.agents.length > 1 && (
                                  <button onClick={() => removeAgent(ai)} className="text-micro tracking-wider text-danger hover:text-danger/80 transition-colors">
                                    {t("remove")}
                                  </button>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                      <button onClick={addAgent} className="h-9 text-micro tracking-wider border border-b-DEFAULT text-t-muted hover:border-primary hover:text-primary active:scale-[0.97] transition-[colors,transform]">
                        {t("add_agent")}
                      </button>
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
                        allItems.map((item) => (
                          <div key={item.name} className="border border-b-DEFAULT bg-surface-1 px-4 py-3 hover:border-b-hover transition-colors">
                            <div className="flex items-center justify-between">
                              <span className="text-body font-semibold">{item.name}</span>
                            </div>
                            <div className="mt-1 flex items-center gap-2">
                              <span className="text-micro text-t-dim tracking-widest">{t("panel_held_by")}:</span>
                              {item.holders.map((h) => (
                                <span key={h} className="text-micro text-info tracking-wider">{h}</span>
                              ))}
                            </div>
                          </div>
                        ))
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
                              <div className="text-body font-semibold">{loc.name || t("ph_location")}</div>
                            </div>
                            <span className="text-micro text-t-dim tracking-wider shrink-0">
                              {expandedLocation === li ? "\u25BE" : "\u25B8"}
                            </span>
                          </button>
                          {expandedLocation === li && (
                            <div className="border-t border-b-DEFAULT bg-void px-4 py-3 animate-slide-down flex flex-col gap-3">
                              <div>
                                <label htmlFor={`ed-loc-name-${li}`} className={fieldLabel}>{t("name")}</label>
                                <input id={`ed-loc-name-${li}`} className={inputCls} value={loc.name} onChange={(e) => updateLocation(li, { name: e.target.value })} />
                              </div>
                              <div>
                                <label htmlFor={`ed-loc-desc-${li}`} className={fieldLabel}>{t("description")}</label>
                                <AutoTextarea id={`ed-loc-desc-${li}`} className={textareaCls} value={loc.description} onChange={(e) => updateLocation(li, { description: e.target.value })} />
                              </div>
                              {/* Agents here */}
                              {(() => {
                                const here = ed.agents.filter((a) => a.location === loc.name);
                                if (here.length === 0) return null;
                                return (
                                  <div className="flex items-center gap-2">
                                    <span className="text-micro text-t-muted tracking-widest">{t("agents")}:</span>
                                    {here.map((a) => (
                                      <span key={a.id} className="text-micro text-info tracking-wider">{a.name}</span>
                                    ))}
                                  </div>
                                );
                              })()}
                              <div className="flex items-center gap-3 pt-1">
                                <button
                                  onClick={() => handleSaveLocationSeed(loc)}
                                  disabled={savedIds.has(`loc_${loc.name}`)}
                                  className={`text-micro tracking-wider transition-colors ${savedIds.has(`loc_${loc.name}`) ? "text-primary" : "text-t-muted hover:text-primary"}`}
                                >
                                  {savedIds.has(`loc_${loc.name}`) ? t("saved_ok") : t("save_location_seed")}
                                </button>
                                <button onClick={() => removeLocation(li)} className="text-micro tracking-wider text-danger hover:text-danger/80 transition-colors">
                                  {t("remove")}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                      <button onClick={addLocation} className="h-9 text-micro tracking-wider border border-b-DEFAULT text-t-muted hover:border-primary hover:text-primary active:scale-[0.97] transition-[colors,transform]">
                        {t("add_location")}
                      </button>
                    </div>
                  )}

                  {/* Rules tab — editable (one rule per line) */}
                  {assetTab === "rules" && ed && (
                    <div className="p-3">
                      <label htmlFor="ed-rules" className="sr-only">{t("rules")}</label>
                      <AutoTextarea
                        id="ed-rules"
                        className={textareaCls}
                        value={(ed.rules || []).join("\n")}
                        placeholder={t("ph_rules")}
                        onChange={(e) => updateEdit({ rules: e.target.value.split("\n").filter(Boolean) })}
                      />
                      <div className="mt-1.5 text-micro text-t-dim tracking-wider normal-case">
                        {t("one_per_line")}
                      </div>
                    </div>
                  )}

                  {/* Events tab — editable (one event per line) */}
                  {assetTab === "events" && ed && (
                    <div className="p-3">
                      <label htmlFor="ed-events" className="sr-only">{t("initial_events")}</label>
                      <AutoTextarea
                        id="ed-events"
                        className={textareaCls}
                        value={(ed.initial_events || []).join("\n")}
                        placeholder={t("ph_events")}
                        onChange={(e) => updateEdit({ initial_events: e.target.value.split("\n").filter(Boolean) })}
                      />
                      <div className="mt-1.5 text-micro text-t-dim tracking-wider normal-case">
                        {t("one_per_line")}
                      </div>
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
                {"// ORACLE: "}{t(
                  (["oracle_greet_0", "oracle_greet_1", "oracle_greet_2", "oracle_greet_3"] as const)[oracleGreetIdx]
                )}
              </p>
            </div>
            <div className="flex items-center gap-4 shrink-0 pb-0.5">
              {!seedsLoading && seeds.length > 0 && (
                <span className="text-micro text-primary tracking-widest">
                  {t("world_count", String(seeds.length))}
                </span>
              )}
              <a
                href="/create"
                className="h-9 px-5 text-micro font-medium tracking-wider bg-primary text-void border border-primary hover:bg-transparent hover:text-primary hover:shadow-[0_0_16px_var(--color-primary-glow-strong)] active:scale-[0.97] transition-[colors,box-shadow,transform] inline-flex items-center"
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
              <div className={`flex flex-col gap-px bg-b-DEFAULT stagger-in transition-opacity duration-slow ${detailLoading ? "opacity-40 pointer-events-none" : ""}`}>
                {seeds.map((seed) => {
                  const saveCount = getWorldSessions(seed.name).length;
                  return (
                    <button
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
