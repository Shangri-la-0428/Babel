"use client";

import { Suspense, lazy, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  BabelSettings,
  createOracleDraftSession,
  createWorld,
  fetchAssets,
  fetchSeedDetail,
  loadSettings,
  SavedSeedData,
  SeedDetail,
  WorldItemData,
} from "@/lib/api";
import { buildSimHref, buildWorldHref, sanitizeInternalHref } from "@/lib/navigation";
import { useLocale } from "@/lib/locale-context";
import Nav from "@/components/Nav";
import Settings from "@/components/Settings";
import { AutoTextarea, ErrorBanner, ExpandableInput, GlitchReveal, StringListEditor } from "@/components/ui";
import WorldBootOverlay from "@/components/WorldBootOverlay";
import { mergeWorldItemsWithInventories, normalizeWorldItem } from "@/lib/world-items";

const OracleDrawer = lazy(() => import("@/components/OracleDrawer"));

interface AgentForm {
  id: string;
  name: string;
  description: string;
  personality: string;
  goals: string[];
  inventory: string[];
  location: string;
}

interface LocationForm {
  id: string;
  name: string;
  description: string;
}

interface ItemForm extends WorldItemData {
  id: string;
}

const emptyAgent = (): AgentForm => ({
  id: `agent_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
  name: "",
  description: "",
  personality: "",
  goals: [],
  inventory: [],
  location: "",
});

const emptyLocation = (): LocationForm => ({
  id: `location_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
  name: "",
  description: "",
});

const emptyItem = (): ItemForm => ({
  id: `item_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
  name: "",
  description: "",
  origin: "",
  properties: [],
  significance: "",
});

function sanitizeList(values: string[]): string[] {
  return values.map((value) => value.trim()).filter(Boolean);
}

function CreateContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useLocale();
  const seedFile = searchParams.get("seed") || "";
  const backHref = sanitizeInternalHref(
    searchParams.get("back"),
    seedFile ? buildWorldHref(seedFile) : "/",
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [world, setWorld] = useState({
    name: "",
    description: "",
    rules: [] as string[],
    initial_events: [] as string[],
  });

  const [agents, setAgents] = useState<AgentForm[]>([emptyAgent()]);
  const [locations, setLocations] = useState<LocationForm[]>([emptyLocation()]);
  const [items, setItems] = useState<ItemForm[]>([]);
  const [savedAgents, setSavedAgents] = useState<SavedSeedData[]>([]);
  const [savedItems, setSavedItems] = useState<SavedSeedData[]>([]);
  const [savedLocations, setSavedLocations] = useState<SavedSeedData[]>([]);
  const [savedEvents, setSavedEvents] = useState<SavedSeedData[]>([]);
  const [showImport, setShowImport] = useState(false);
  const [bootOverlay, setBootOverlay] = useState<{ worldName: string; targetUrl: string } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [agentAdded, setAgentAdded] = useState(false);
  const [settings, setSettings] = useState<BabelSettings>(loadSettings);
  const [oracleOpen, setOracleOpen] = useState(false);
  const [oracleEverOpened, setOracleEverOpened] = useState(false);
  const [oracleSessionId, setOracleSessionId] = useState("");
  const [oracleBooting, setOracleBooting] = useState(false);

  useEffect(() => {
    let mounted = true;
    fetchAssets("agent").then((d) => { if (mounted) setSavedAgents(d); }).catch(() => { /* asset import is optional — proceed without */ });
    fetchAssets("item").then((d) => { if (mounted) setSavedItems(d); }).catch(() => { /* asset import is optional — proceed without */ });
    fetchAssets("location").then((d) => { if (mounted) setSavedLocations(d); }).catch(() => { /* asset import is optional — proceed without */ });
    fetchAssets("event").then((d) => { if (mounted) setSavedEvents(d); }).catch(() => { /* asset import is optional — proceed without */ });
    return () => { mounted = false; };
  }, []);

  function applyDetailToForm(seed: SeedDetail) {
    const mergedItems = mergeWorldItemsWithInventories(seed.items || [], seed.agents || []);
    setWorld({
      name: seed.name || "",
      description: seed.description || "",
      rules: sanitizeList(seed.rules || []),
      initial_events: sanitizeList(seed.initial_events || []),
    });
    setLocations(
      (seed.locations || []).length > 0
        ? seed.locations.map((l, index) => ({
            id: `location_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 6)}`,
            name: l.name || "",
            description: l.description || "",
          }))
        : [emptyLocation()],
    );
    setAgents(
      (seed.agents || []).length > 0
        ? seed.agents.map((a) => ({
            id: a.id || `agent_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            name: a.name || "",
            description: a.description || "",
            personality: a.personality || "",
            goals: sanitizeList(a.goals || []),
            inventory: sanitizeList(a.inventory || []),
            location: a.location || "",
          }))
        : [emptyAgent()],
    );
    setItems(
      mergedItems.map((item, index) => ({
        id: `item_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 6)}`,
        ...normalizeWorldItem(item),
      })),
    );
  }

  useEffect(() => {
    let cancelled = false;

    async function loadEditSeed() {
      if (!seedFile) return;

      try {
        const raw = localStorage.getItem("babel_edit_seed");
        if (raw) {
          localStorage.removeItem("babel_edit_seed");
          const storedSeed: SeedDetail = JSON.parse(raw);
          if (!cancelled) {
            applyDetailToForm(storedSeed);
          }
          return;
        }
      } catch {
        // Ignore corrupt draft storage and fall back to source seed.
      }

      try {
        const seed = await fetchSeedDetail(seedFile);
        if (!cancelled) {
          applyDetailToForm(seed);
        }
      } catch {
        if (!cancelled) {
          setError(t("failed_load_detail"));
        }
      }
    }

    void loadEditSeed();
    return () => {
      cancelled = true;
    };
  }, [seedFile, t]);

  function importAgent(seed: SavedSeedData) {
    const d = seed.data;
    const a: AgentForm = {
      id: (d.id as string) || `agent_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: (d.name as string) || seed.name,
      description: (d.description as string) || "",
      personality: (d.personality as string) || "",
      goals: sanitizeList((d.goals as string[]) || []),
      inventory: sanitizeList((d.inventory as string[]) || []),
      location: (d.location as string) || "",
    };
    setAgents((prev) => [...prev, a]);
  }

  function importEvent(seed: SavedSeedData) {
    const content = (seed.data.content as string) || seed.name;
    setWorld((prev) => ({
      ...prev,
      initial_events: sanitizeList([...prev.initial_events, content]),
    }));
  }

  function importItem(seed: SavedSeedData) {
    const imported = normalizeWorldItem({
      name: (seed.data.name as string) || seed.name,
      description: (seed.data.description as string) || seed.description || "",
      origin: (seed.data.origin as string) || "",
      properties: Array.isArray(seed.data.properties) ? seed.data.properties.map(String) : [],
      significance: (seed.data.significance as string) || "",
    });
    if (!imported.name) return;
    setItems((prev) => {
      const existingIndex = prev.findIndex((item) => item.name === imported.name);
      if (existingIndex < 0) {
        return [...prev, { id: emptyItem().id, ...imported }];
      }
      const next = [...prev];
      next[existingIndex] = { ...next[existingIndex], ...imported };
      return next;
    });
  }

  function importLocation(seed: SavedSeedData) {
    const d = seed.data;
    const nextLocation: LocationForm = {
      id: `location_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: (d.name as string) || seed.name,
      description: (d.description as string) || seed.description || "",
    };
    setLocations((prev) => [...prev, nextLocation]);
  }

  function addAgent() {
    setAgents([...agents, emptyAgent()]);
    setAgentAdded(true);
    setTimeout(() => setAgentAdded(false), 500);
  }

  function updateAgent<K extends keyof AgentForm>(index: number, field: K, value: AgentForm[K]) {
    const updated = [...agents];
    updated[index] = { ...updated[index], [field]: value };
    setAgents(updated);
  }

  function removeAgent(index: number) {
    setAgents(agents.filter((_, i) => i !== index));
  }

  function updateLocation(index: number, field: keyof LocationForm, value: string) {
    const updated = [...locations];
    updated[index] = { ...updated[index], [field]: value };
    setLocations(updated);
  }

  function updateItem(index: number, patch: Partial<ItemForm>) {
    setItems((prev) => {
      const next = [...prev];
      const current = next[index];
      if (!current) return prev;
      next[index] = { ...current, ...patch };
      return next;
    });
  }

  function addLocation() {
    setLocations((prev) => [...prev, emptyLocation()]);
  }

  function removeLocation(index: number) {
    setLocations((prev) => prev.filter((_, i) => i !== index));
  }

  function addItem() {
    setItems((prev) => [...prev, emptyItem()]);
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  function applySeedToForm(seed: Record<string, unknown>) {
    const nextLocations = Array.isArray(seed.locations)
      ? seed.locations
          .map((loc, index) => {
            if (!loc || typeof loc !== "object") return null;
            const item = loc as { name?: unknown; description?: unknown };
            const name = typeof item.name === "string" ? item.name.trim() : "";
            if (!name) return null;
            const description = typeof item.description === "string" ? item.description : "";
            return {
              id: `location_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 6)}`,
              name,
              description,
            };
          })
          .filter((entry): entry is LocationForm => Boolean(entry))
      : [];

    const nextAgents = Array.isArray(seed.agents)
      ? seed.agents
          .map((agent, index) => {
            if (!agent || typeof agent !== "object") return null;
            const item = agent as {
              id?: unknown;
              name?: unknown;
              description?: unknown;
              personality?: unknown;
              goals?: unknown;
              inventory?: unknown;
              location?: unknown;
            };
            const name = typeof item.name === "string" ? item.name.trim() : "";
            if (!name) return null;
            return {
              id:
                typeof item.id === "string" && item.id.trim()
                  ? item.id
                  : `agent_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 6)}`,
              name,
              description: typeof item.description === "string" ? item.description : "",
              personality: typeof item.personality === "string" ? item.personality : "",
              goals: Array.isArray(item.goals)
                ? sanitizeList(item.goals.filter((goal): goal is string => typeof goal === "string"))
                : [],
              inventory: Array.isArray(item.inventory)
                ? sanitizeList(item.inventory.filter((entry): entry is string => typeof entry === "string"))
                : [],
              location: typeof item.location === "string" ? item.location : "",
            };
          })
          .filter((agent): agent is AgentForm => Boolean(agent))
      : [];
    const nextItems = mergeWorldItemsWithInventories(
      Array.isArray(seed.items)
        ? seed.items
            .map((item) => {
              if (!item || typeof item !== "object") return null;
              const normalized = normalizeWorldItem(item as Partial<WorldItemData>);
              return normalized.name ? normalized : null;
            })
            .filter((item): item is WorldItemData => Boolean(item))
        : [],
      nextAgents,
    );

    setWorld({
      name: typeof seed.name === "string" ? seed.name : "",
      description: typeof seed.description === "string" ? seed.description : "",
      rules: Array.isArray(seed.rules)
        ? sanitizeList(seed.rules.filter((rule): rule is string => typeof rule === "string"))
        : [],
      initial_events: Array.isArray(seed.initial_events)
        ? sanitizeList(seed.initial_events.filter((entry): entry is string => typeof entry === "string"))
        : [],
    });
    setLocations(nextLocations.length > 0 ? nextLocations : [emptyLocation()]);
    setAgents(nextAgents.length > 0 ? nextAgents : [emptyAgent()]);
    setItems(
      nextItems.map((item, index) => ({
        id: `item_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 6)}`,
        ...item,
      })),
    );
    setError(null);
    setOracleOpen(false);
  }

  async function handleOpenOracle() {
    if (oracleBooting) return;
    setOracleEverOpened(true);
    if (oracleSessionId) {
      setOracleOpen(true);
      return;
    }
    setOracleBooting(true);
    try {
      const draft = await createOracleDraftSession();
      setOracleSessionId(draft.session_id);
      setOracleOpen(true);
    } catch {
      setError(t("failed_create"));
    } finally {
      setOracleBooting(false);
    }
  }

  async function handleSubmit() {
    if (!world.name.trim()) return;

    const hasNamedAgent = agents.some((a) => a.name.trim());
    if (!hasNamedAgent) {
      setError(t("validation_need_agent"));
      return;
    }

    const parsedLocations = locations
      .map((location) => ({
        name: location.name.trim(),
        description: location.description.trim(),
      }))
      .filter((location) => location.name);

    if (parsedLocations.length === 0) {
      setError(t("validation_need_location"));
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const locations = parsedLocations;
      const firstLocation = locations[0]?.name || "";
      const rules = sanitizeList(world.rules);
      const initialEvents = sanitizeList(world.initial_events);

      const data = {
        name: world.name,
        description: world.description,
        rules,
        locations,
        items: items
          .map((item) => normalizeWorldItem(item))
          .filter((item) => item.name),
        agents: agents
          .filter((a) => a.name.trim())
          .map((a) => ({
            id: a.id,
            name: a.name,
            description: a.description,
            personality: a.personality,
            goals: sanitizeList(a.goals),
            inventory: sanitizeList(a.inventory),
            location: a.location || firstLocation,
          })),
        initial_events: initialEvents,
      };

      const res = await createWorld(data);
      if (!res?.session_id) throw new Error("No session_id");
      setBootOverlay({
        worldName: world.name || "WORLD",
        targetUrl: buildSimHref({
          sessionId: res.session_id,
          seedFile: res.seed_file || undefined,
        }),
      });
    } catch {
      setError(t("failed_create"));
      setLoading(false);
    }
  }

  const inputClass =
    "w-full h-9 px-3 bg-void border border-b-DEFAULT text-detail text-t-DEFAULT normal-case tracking-normal focus:border-primary focus:outline-none hover:border-b-hover transition-colors";
  const textareaClass =
    "w-full min-h-[100px] px-3 py-2 bg-void border border-b-DEFAULT text-detail text-t-DEFAULT normal-case tracking-normal leading-relaxed resize-y focus:border-primary focus:outline-none hover:border-b-hover transition-colors";
  const labelClass = "text-micro text-t-muted tracking-widest mb-1.5 block";

  return (
    <div className="min-h-screen flex flex-col bg-void">
      {bootOverlay && (
        <WorldBootOverlay
          worldName={bootOverlay.worldName}
          onComplete={() => router.push(bootOverlay.targetUrl)}
        />
      )}
      <Nav activePage="create" showSettings={showSettings} onToggleSettings={() => setShowSettings(!showSettings)} />

      {showSettings && (
        <Settings
          onClose={() => setShowSettings(false)}
          onSave={() => {
            setSettings(loadSettings());
            setShowSettings(false);
          }}
        />
      )}

      {oracleEverOpened && oracleSessionId && (
        <Suspense fallback={null}>
          <OracleDrawer
            sessionId={oracleSessionId}
            settings={settings}
            open={oracleOpen}
            onClose={() => setOracleOpen(false)}
            tick={0}
            initialMode="create"
            onApplySeed={applySeedToForm}
            applySeedLabel={t("oracle_apply_seed")}
          />
        </Suspense>
      )}

      <main id="main-content" className="flex-1 p-6 max-w-3xl mx-auto w-full animate-slide-up">
        <button type="button" onClick={() => router.push(backHref)} className="text-micro text-t-muted tracking-wider hover:text-t-DEFAULT transition-colors mb-4">
          {t("back")}
        </button>
        <div className="text-micro text-t-dim tracking-widest mb-2">{t("world_forge")}</div>
        <h1 className="font-sans text-title font-bold tracking-tight mb-8">{t("create_world")}</h1>

        <div className="mb-8 border border-info/20 bg-info/[0.04] px-4 py-4 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <div className="text-micro text-info tracking-widest mb-1">{t("oracle_label")}</div>
            <p className="text-detail text-t-secondary normal-case tracking-normal leading-relaxed max-w-[42rem]">
              {t("oracle_create_assist")}
            </p>
          </div>
          <button
            type="button"
            onClick={handleOpenOracle}
            disabled={oracleBooting}
            aria-expanded={oracleOpen}
            className="shrink-0 h-9 px-4 text-micro font-medium tracking-wider border border-info bg-info text-void hover:bg-transparent hover:text-info hover:shadow-[0_0_16px_rgba(14,165,233,0.3)] active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed transition-[colors,box-shadow,transform]"
          >
            {oracleBooting ? t("oracle_loading") : t("oracle_open_create")}
          </button>
        </div>

        {/* Error banner */}
        {error && (
          <ErrorBanner message={error} onDismiss={() => setError(null)} className="mb-6" />
        )}

        {/* Import from Assets */}
        {(savedAgents.length > 0 || savedItems.length > 0 || savedLocations.length > 0 || savedEvents.length > 0) && (
          <div className="mb-8">
            <button
              type="button"
              onClick={() => setShowImport(!showImport)}
              className="text-micro text-t-muted tracking-widest hover:text-primary transition-colors mb-3"
            >
              {showImport ? t("hide_assets") : t("import_from_assets")}
            </button>
            {showImport && (
              <div className="border border-b-DEFAULT p-4 flex flex-col gap-4 bg-surface-1 animate-[slide-up_200ms_ease] stagger-in">
                {savedAgents.length > 0 && (
                  <div>
                    <div className="text-micro text-t-muted tracking-widest mb-2">
                      {t("agent_seeds")} ({savedAgents.length})
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {savedAgents.map((s) => (
                        <button
                          type="button"
                          key={s.id}
                          onClick={() => importAgent(s)}
                          className="px-3 py-1.5 text-detail text-info border border-info hover:bg-info/10 active:scale-[0.97] transition-[colors,transform] normal-case tracking-normal"
                        >
                          {s.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {savedItems.length > 0 && (
                  <div>
                    <div className="text-micro text-t-muted tracking-widest mb-2">
                      {t("item_seeds")} ({savedItems.length})
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {savedItems.map((s) => (
                        <button
                          type="button"
                          key={s.id}
                          onClick={() => importItem(s)}
                          className="px-3 py-1.5 text-detail text-warning border border-warning hover:bg-warning/10 active:scale-[0.97] transition-[colors,transform] normal-case tracking-normal"
                        >
                          {s.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {savedLocations.length > 0 && (
                  <div>
                    <div className="text-micro text-t-muted tracking-widest mb-2">
                      {t("locations")} ({savedLocations.length})
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {savedLocations.map((s) => (
                        <button
                          type="button"
                          key={s.id}
                          onClick={() => importLocation(s)}
                          className="px-3 py-1.5 text-detail text-t-secondary border border-t-secondary hover:bg-surface-2 active:scale-[0.97] transition-[colors,transform] normal-case tracking-normal"
                        >
                          {s.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {savedEvents.length > 0 && (
                  <div>
                    <div className="text-micro text-t-muted tracking-widest mb-2">
                      {t("event_seeds")} ({savedEvents.length})
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {savedEvents.map((s) => (
                        <button
                          type="button"
                          key={s.id}
                          onClick={() => importEvent(s)}
                          className="px-3 py-1.5 text-detail text-danger border border-danger hover:bg-danger/10 active:scale-[0.97] transition-[colors,transform] normal-case tracking-normal truncate max-w-[200px]"
                        >
                          {s.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* World form */}
        <div className="text-micro text-t-dim tracking-widest mb-4"><GlitchReveal text="// WORLD_SEED" duration={400} /></div>
        <div className="flex flex-col gap-6 mb-10 stagger-in">
          <div>
            <label htmlFor="world-name" className={labelClass}>{t("world_name")}</label>
            <ExpandableInput
              id="world-name"
              required
              aria-required="true"
              maxLength={200}
              className={inputClass}
              placeholder={t("ph_world_name")}
              value={world.name}
              onValueChange={(value) => setWorld({ ...world, name: value })}
            />
          </div>
          <div>
            <label htmlFor="world-desc" className={labelClass}>{t("description")}</label>
            <AutoTextarea
              id="world-desc"
              rows={4}
              className={textareaClass}
              placeholder={t("ph_description")}
              value={world.description}
              onChange={(e) => setWorld({ ...world, description: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="world-rules" className={labelClass}>{t("rules")}</label>
            <StringListEditor
              idBase="world-rule"
              values={world.rules}
              onChange={(value) => setWorld({ ...world, rules: value })}
              addLabel={t("add_rule")}
              itemPlaceholder={t("ph_rules")}
              addPlaceholder={t("ph_rules")}
            />
            <div className="mt-2 text-micro text-t-dim tracking-wider normal-case">
              {t("hint_one_per_line")}
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between gap-3 mb-1.5">
              <span className="text-micro text-t-muted tracking-widest">{t("locations")}</span>
              <button
                type="button"
                onClick={addLocation}
                className="h-8 px-3 text-micro tracking-wider border border-b-DEFAULT text-t-muted hover:bg-surface-1/20 hover:border-primary hover:text-primary active:scale-[0.97] transition-[colors,transform]"
              >
                {t("add_location")}
              </button>
            </div>
            <div className="flex flex-col gap-3">
              {locations.map((location, index) => (
                <div key={location.id} className="border border-b-DEFAULT bg-surface-1 p-4 flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-micro text-t-muted tracking-widest">
                      {t("location_n", String(index + 1).padStart(2, "0"))}
                    </span>
                    {locations.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeLocation(index)}
                        className="text-micro text-danger tracking-wider hover:text-danger/80 transition-colors"
                      >
                        {t("remove")}
                      </button>
                    )}
                  </div>
                  <div>
                    <label htmlFor={`location-name-${location.id}`} className={labelClass}>{t("name")}</label>
                    <ExpandableInput
                      id={`location-name-${location.id}`}
                      className={inputClass}
                      placeholder={t("ph_location")}
                      value={location.name}
                      onValueChange={(value) => updateLocation(index, "name", value)}
                    />
                  </div>
                  <div>
                    <label htmlFor={`location-desc-${location.id}`} className={labelClass}>{t("description")}</label>
                    <AutoTextarea
                      id={`location-desc-${location.id}`}
                      rows={3}
                      className={`${textareaClass} min-h-[72px]`}
                      placeholder={t("ph_description")}
                      value={location.description}
                      onChange={(e) => updateLocation(index, "description", e.target.value)}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between gap-3 mb-1.5">
              <span className="text-micro text-t-muted tracking-widest">{t("world_items")}</span>
              <button
                type="button"
                onClick={addItem}
                className="h-8 px-3 text-micro tracking-wider border border-b-DEFAULT text-t-muted hover:bg-surface-1/20 hover:border-primary hover:text-primary active:scale-[0.97] transition-[colors,transform]"
              >
                {t("add_item_detail")}
              </button>
            </div>
            {items.length === 0 ? (
              <div className="border border-b-DEFAULT bg-surface-1 px-4 py-4 text-detail text-t-dim normal-case tracking-normal">
                {t("world_items_empty")}
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {items.map((item, index) => (
                  <div key={item.id} className="border border-b-DEFAULT bg-surface-1 p-4 flex flex-col gap-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-micro text-t-muted tracking-widest">
                        {t("item_n", String(index + 1).padStart(2, "0"))}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeItem(index)}
                        className="text-micro text-danger tracking-wider hover:text-danger/80 transition-colors"
                      >
                        {t("remove")}
                      </button>
                    </div>
                    <div>
                      <label htmlFor={`item-name-${item.id}`} className={labelClass}>{t("name")}</label>
                      <ExpandableInput
                        id={`item-name-${item.id}`}
                        className={inputClass}
                        placeholder={t("ph_item_name")}
                        value={item.name}
                        onValueChange={(value) => updateItem(index, { name: value })}
                      />
                    </div>
                    <div>
                      <label htmlFor={`item-desc-${item.id}`} className={labelClass}>{t("description")}</label>
                      <AutoTextarea
                        id={`item-desc-${item.id}`}
                        rows={3}
                        className={`${textareaClass} min-h-[72px]`}
                        placeholder={t("ph_item_desc")}
                        value={item.description}
                        onChange={(e) => updateItem(index, { description: e.target.value })}
                      />
                    </div>
                    <div>
                      <label htmlFor={`item-origin-${item.id}`} className={labelClass}>{t("origin")}</label>
                      <AutoTextarea
                        id={`item-origin-${item.id}`}
                        rows={3}
                        className={`${textareaClass} min-h-[72px]`}
                        placeholder={t("ph_item_origin")}
                        value={item.origin}
                        onChange={(e) => updateItem(index, { origin: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>{t("properties")}</label>
                      <StringListEditor
                        idBase={`item-properties-${item.id}`}
                        values={item.properties}
                        addLabel={t("add_property")}
                        itemPlaceholder={t("ph_item_property")}
                        addPlaceholder={t("ph_item_property")}
                        onChange={(value) => updateItem(index, { properties: value })}
                      />
                    </div>
                    <div>
                      <label htmlFor={`item-significance-${item.id}`} className={labelClass}>{t("significance")}</label>
                      <AutoTextarea
                        id={`item-significance-${item.id}`}
                        rows={3}
                        className={`${textareaClass} min-h-[72px]`}
                        placeholder={t("ph_item_significance")}
                        value={item.significance}
                        onChange={(e) => updateItem(index, { significance: e.target.value })}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div>
            <label htmlFor="world-events" className={labelClass}>{t("initial_events")}</label>
            <StringListEditor
              idBase="world-event"
              values={world.initial_events}
              onChange={(value) => setWorld({ ...world, initial_events: value })}
              addLabel={t("add_event")}
              itemPlaceholder={t("ph_events")}
              addPlaceholder={t("ph_events")}
            />
            <div className="mt-2 text-micro text-t-dim tracking-wider normal-case">
              {t("hint_one_per_line")}
            </div>
          </div>
        </div>

        {/* Agents */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-sans text-heading font-semibold tracking-tight">{t("agents")}</h2>
          <button
            type="button"
            onClick={addAgent}
            className={`h-9 px-4 text-micro tracking-wider border border-b-DEFAULT text-t-muted hover:bg-surface-1/20 hover:border-primary hover:text-primary active:scale-[0.97] transition-[colors,transform] ${agentAdded ? "relative overflow-hidden" : ""}`}
          >
            {t("add_agent")}
            {agentAdded && (
              <span className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/20 to-transparent bg-[length:200%_100%] animate-transmission-sweep pointer-events-none" aria-hidden="true" />
            )}
          </button>
        </div>

        <div className="flex flex-col gap-4 mb-10">
          {agents.map((agent, i) => (
            <div key={agent.id} data-agent-card className="bg-surface-1 border border-b-DEFAULT p-5 flex flex-col gap-3 animate-slide-up">
              <div className="flex justify-between items-center">
                <span className="text-micro text-t-muted tracking-widest">{t("agent_n", String(i + 1))}</span>
                {agents.length > 1 && (
                  <button
                    type="button"
                    onClick={(e) => {
                      const card = (e.target as HTMLElement).closest('[data-agent-card]');
                      if (card) {
                        (card as HTMLElement).style.animation = 'fade-out 150ms ease both';
                        (card as HTMLElement).style.transform = 'scale(0.98)';
                        setTimeout(() => removeAgent(i), 150);
                      } else {
                        removeAgent(i);
                      }
                    }}
                    className="text-micro text-danger tracking-wider hover:text-danger/80 transition-colors"
                  >
                    {t("remove")}
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor={`agent-name-${agent.id}`} className={labelClass}>{t("name")}</label>
                  <ExpandableInput
                    id={`agent-name-${agent.id}`}
                    className={inputClass}
                    maxLength={200}
                    placeholder={t("ph_agent_name")}
                    value={agent.name}
                    onValueChange={(value) => updateAgent(i, "name", value)}
                  />
                </div>
                <div>
                  <label htmlFor={`agent-personality-${agent.id}`} className={labelClass}>{t("personality")}</label>
                  <ExpandableInput
                    id={`agent-personality-${agent.id}`}
                    className={inputClass}
                    placeholder={t("ph_personality")}
                    value={agent.personality}
                    onValueChange={(value) => updateAgent(i, "personality", value)}
                  />
                </div>
              </div>
              <div>
                <label htmlFor={`agent-desc-${agent.id}`} className={labelClass}>{t("description")}</label>
                <AutoTextarea
                  id={`agent-desc-${agent.id}`}
                  rows={3}
                  className={`${textareaClass} min-h-[60px]`}
                  placeholder={t("ph_agent_desc")}
                  value={agent.description}
                  onChange={(e) => updateAgent(i, "description", e.target.value)}
                />
              </div>
              <div>
                <label htmlFor={`agent-goals-${agent.id}`} className={labelClass}>{t("goals")}</label>
                <StringListEditor
                  idBase={`agent-goals-${agent.id}`}
                  values={agent.goals}
                  onChange={(value) => updateAgent(i, "goals", value)}
                  addLabel={t("add_goal")}
                  itemPlaceholder={t("ph_goals")}
                  addPlaceholder={t("ph_goals")}
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor={`agent-inv-${agent.id}`} className={labelClass}>{t("inventory")}</label>
                  <StringListEditor
                    idBase={`agent-inv-${agent.id}`}
                    values={agent.inventory}
                    onChange={(value) => updateAgent(i, "inventory", value)}
                    addLabel={t("add_inventory_item")}
                    itemPlaceholder={t("ph_inventory")}
                    addPlaceholder={t("ph_inventory")}
                  />
                </div>
                <div>
                  <label htmlFor={`agent-loc-${agent.id}`} className={labelClass}>{t("starting_location")}</label>
                  <ExpandableInput
                    id={`agent-loc-${agent.id}`}
                    className={inputClass}
                    placeholder={t("ph_location")}
                    value={agent.location}
                    onValueChange={(value) => updateAgent(i, "location", value)}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Submit */}
        <div className="text-micro text-t-dim tracking-widest mb-3"><GlitchReveal text="// LAUNCH" duration={400} /></div>
        <div className="flex gap-3 pt-4 border-t border-b-DEFAULT">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={loading || !world.name.trim()}
            className={`h-9 px-6 text-micro font-medium tracking-wider bg-primary text-void border border-primary hover:bg-transparent hover:text-primary hover:shadow-[0_0_16px_var(--color-primary-glow-strong)] active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none transition-[colors,box-shadow,transform] ${loading ? "relative overflow-hidden" : ""}`}
          >
            {loading ? t("creating") : t("ignite_world")}
            {loading && (
              <span className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/20 to-transparent bg-[length:200%_100%] animate-[boot-sweep_700ms_cubic-bezier(0.16,1,0.3,1)_infinite] pointer-events-none" aria-hidden="true" />
            )}
          </button>
          <a
            href={backHref}
            className="h-9 px-4 text-micro font-medium tracking-wider border border-b-DEFAULT text-t-muted hover:bg-surface-1/20 hover:border-primary hover:text-primary active:scale-[0.97] transition-[colors,transform] inline-flex items-center justify-center"
          >
            {t("cancel")}
          </a>
        </div>
      </main>
    </div>
  );
}

export default function CreatePage() {
  return (
    <Suspense fallback={null}>
      <CreateContent />
    </Suspense>
  );
}
