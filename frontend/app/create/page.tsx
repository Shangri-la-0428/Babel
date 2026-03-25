"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createWorld, fetchAssets, SavedSeedData, SeedDetail } from "@/lib/api";
import { useLocale } from "@/lib/locale-context";
import Nav from "@/components/Nav";
import Settings from "@/components/Settings";
import { ErrorBanner } from "@/components/ui";
import WorldBootOverlay from "@/components/WorldBootOverlay";

interface AgentForm {
  id: string;
  name: string;
  description: string;
  personality: string;
  goals: string;
  inventory: string;
  location: string;
}

const emptyAgent = (): AgentForm => ({
  id: `agent_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
  name: "",
  description: "",
  personality: "",
  goals: "",
  inventory: "",
  location: "",
});

export default function CreatePage() {
  const router = useRouter();
  const { t } = useLocale();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [world, setWorld] = useState({
    name: "",
    description: "",
    rules: "",
    locations: "",
    initial_events: "",
  });

  const [agents, setAgents] = useState<AgentForm[]>([emptyAgent()]);
  const [savedAgents, setSavedAgents] = useState<SavedSeedData[]>([]);
  const [savedEvents, setSavedEvents] = useState<SavedSeedData[]>([]);
  const [showImport, setShowImport] = useState(false);
  const [bootOverlay, setBootOverlay] = useState<{ worldName: string; targetUrl: string } | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    let mounted = true;
    fetchAssets("agent").then((d) => { if (mounted) setSavedAgents(d); }).catch(() => { /* asset import is optional — proceed without */ });
    fetchAssets("event").then((d) => { if (mounted) setSavedEvents(d); }).catch(() => { /* asset import is optional — proceed without */ });

    // Load pre-filled data from world detail "Edit" button
    try {
      const raw = localStorage.getItem("babel_edit_seed");
      if (raw) {
        localStorage.removeItem("babel_edit_seed");
        const seed: SeedDetail = JSON.parse(raw);
        setWorld({
          name: seed.name || "",
          description: seed.description || "",
          rules: (seed.rules || []).join("\n"),
          locations: (seed.locations || []).map((l) => `${l.name}: ${l.description}`).join("\n"),
          initial_events: (seed.initial_events || []).join("\n"),
        });
        if ((seed.agents || []).length > 0) {
          setAgents(
            seed.agents.map((a) => ({
              id: a.id || `agent_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              name: a.name || "",
              description: a.description || "",
              personality: a.personality || "",
              goals: (a.goals || []).join("\n"),
              inventory: (a.inventory || []).join(", "),
              location: a.location || "",
            }))
          );
        }
      }
    } catch { /* ignore corrupt or inaccessible localStorage */ }
    return () => { mounted = false; };
  }, []);

  function importAgent(seed: SavedSeedData) {
    const d = seed.data;
    const a: AgentForm = {
      id: (d.id as string) || `agent_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: (d.name as string) || seed.name,
      description: (d.description as string) || "",
      personality: (d.personality as string) || "",
      goals: ((d.goals as string[]) || []).join("\n"),
      inventory: ((d.inventory as string[]) || []).join(", "),
      location: (d.location as string) || "",
    };
    setAgents((prev) => [...prev, a]);
  }

  function importEvent(seed: SavedSeedData) {
    const content = (seed.data.content as string) || seed.name;
    setWorld((prev) => ({
      ...prev,
      initial_events: prev.initial_events
        ? prev.initial_events + "\n" + content
        : content,
    }));
  }

  function addAgent() {
    setAgents([...agents, emptyAgent()]);
  }

  function updateAgent(index: number, field: keyof AgentForm, value: string) {
    const updated = [...agents];
    updated[index] = { ...updated[index], [field]: value };
    setAgents(updated);
  }

  function removeAgent(index: number) {
    setAgents(agents.filter((_, i) => i !== index));
  }

  async function handleSubmit() {
    if (!world.name.trim()) return;

    const hasNamedAgent = agents.some((a) => a.name.trim());
    if (!hasNamedAgent) {
      setError(t("validation_need_agent"));
      return;
    }

    const parsedLocations = world.locations
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [name, ...desc] = line.split(":");
        return { name: name.trim(), description: desc.join(":").trim() };
      })
      .filter((loc) => loc.name);

    if (parsedLocations.length === 0) {
      setError(t("validation_need_location"));
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const locations = parsedLocations;
      const firstLocation = locations[0]?.name || "";

      const data = {
        name: world.name,
        description: world.description,
        rules: world.rules.split("\n").filter(Boolean),
        locations,
        agents: agents
          .filter((a) => a.name.trim())
          .map((a) => ({
            id: a.id,
            name: a.name,
            description: a.description,
            personality: a.personality,
            goals: a.goals.split("\n").filter(Boolean),
            inventory: a.inventory.split(",").map((s) => s.trim()).filter(Boolean),
            location: a.location || firstLocation,
          })),
        initial_events: world.initial_events.split("\n").filter(Boolean),
      };

      const res = await createWorld(data);
      if (!res?.session_id) throw new Error("No session_id");
      setBootOverlay({ worldName: world.name || "WORLD", targetUrl: `/sim?id=${res.session_id}` });
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
        <Settings onClose={() => setShowSettings(false)} onSave={() => setShowSettings(false)} />
      )}

      <main id="main-content" className="flex-1 p-6 max-w-3xl mx-auto w-full animate-slide-up">
        <button onClick={() => router.push("/")} className="text-micro text-t-muted tracking-wider hover:text-t-DEFAULT transition-colors mb-4">
          {t("back")}
        </button>
        <h1 className="font-sans text-title font-bold tracking-tight mb-8">{t("create_world")}</h1>

        {/* Error banner */}
        {error && (
          <ErrorBanner message={error} onDismiss={() => setError(null)} className="mb-6" />
        )}

        {/* Import from Assets */}
        {(savedAgents.length > 0 || savedEvents.length > 0) && (
          <div className="mb-8">
            <button
              onClick={() => setShowImport(!showImport)}
              className="text-micro text-t-muted tracking-widest hover:text-primary transition-colors mb-3"
            >
              {showImport ? t("hide_assets") : t("import_from_assets")}
            </button>
            {showImport && (
              <div className="border border-b-DEFAULT p-4 flex flex-col gap-4 bg-surface-1 animate-[slide-up_200ms_ease]">
                {savedAgents.length > 0 && (
                  <div>
                    <div className="text-micro text-t-muted tracking-widest mb-2">
                      {t("agent_seeds")} ({savedAgents.length})
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {savedAgents.map((s) => (
                        <button
                          key={s.id}
                          onClick={() => importAgent(s)}
                          className="px-3 py-1.5 text-detail text-info border border-info hover:bg-info/10 transition-colors normal-case tracking-normal"
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
                          key={s.id}
                          onClick={() => importEvent(s)}
                          className="px-3 py-1.5 text-detail text-danger border border-danger hover:bg-danger/10 transition-colors normal-case tracking-normal truncate max-w-[200px]"
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
        <div className="text-micro text-t-dim tracking-widest mb-4">{"// WORLD_SEED"}</div>
        <div className="flex flex-col gap-6 mb-10">
          <div>
            <label htmlFor="world-name" className={labelClass}>{t("world_name")}</label>
            <input
              id="world-name"
              required
              aria-required="true"
              maxLength={200}
              className={inputClass}
              placeholder={t("ph_world_name")}
              value={world.name}
              onChange={(e) => setWorld({ ...world, name: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="world-desc" className={labelClass}>{t("description")}</label>
            <textarea
              id="world-desc"
              className={textareaClass}
              placeholder={t("ph_description")}
              value={world.description}
              onChange={(e) => setWorld({ ...world, description: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="world-rules" className={labelClass}>{t("rules")}</label>
            <textarea
              id="world-rules"
              className={textareaClass}
              placeholder={t("ph_rules")}
              value={world.rules}
              onChange={(e) => setWorld({ ...world, rules: e.target.value })}
            />
            <span className="text-micro text-t-dim tracking-wider mt-1 block">{t("hint_one_per_line")}</span>
          </div>
          <div>
            <label htmlFor="world-locations" className={labelClass}>{t("locations")}</label>
            <textarea
              id="world-locations"
              className={textareaClass}
              placeholder={t("ph_locations")}
              value={world.locations}
              onChange={(e) => setWorld({ ...world, locations: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="world-events" className={labelClass}>{t("initial_events")}</label>
            <textarea
              id="world-events"
              className={textareaClass}
              placeholder={t("ph_events")}
              value={world.initial_events}
              onChange={(e) => setWorld({ ...world, initial_events: e.target.value })}
            />
            <span className="text-micro text-t-dim tracking-wider mt-1 block">{t("hint_one_per_line")}</span>
          </div>
        </div>

        {/* Agents */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-sans text-heading font-semibold tracking-tight">{t("agents")}</h2>
          <button
            onClick={addAgent}
            className="h-9 px-4 text-micro tracking-wider border border-b-DEFAULT text-t-muted hover:border-primary hover:text-primary active:scale-[0.97] transition-[colors,transform]"
          >
            {t("add_agent")}
          </button>
        </div>

        <div className="flex flex-col gap-4 mb-10">
          {agents.map((agent, i) => (
            <div key={agent.id} className="bg-surface-1 border border-b-DEFAULT p-5 flex flex-col gap-3 animate-slide-up">
              <div className="flex justify-between items-center">
                <span className="text-micro text-t-muted tracking-widest">{t("agent_n", String(i + 1))}</span>
                {agents.length > 1 && (
                  <button
                    onClick={() => removeAgent(i)}
                    className="text-micro text-danger tracking-wider hover:text-danger/80 transition-colors"
                  >
                    {t("remove")}
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor={`agent-name-${agent.id}`} className={labelClass}>{t("name")}</label>
                  <input
                    id={`agent-name-${agent.id}`}
                    className={inputClass}
                    maxLength={200}
                    placeholder={t("ph_agent_name")}
                    value={agent.name}
                    onChange={(e) => updateAgent(i, "name", e.target.value)}
                  />
                </div>
                <div>
                  <label htmlFor={`agent-personality-${agent.id}`} className={labelClass}>{t("personality")}</label>
                  <input
                    id={`agent-personality-${agent.id}`}
                    className={inputClass}
                    placeholder={t("ph_personality")}
                    value={agent.personality}
                    onChange={(e) => updateAgent(i, "personality", e.target.value)}
                  />
                </div>
              </div>
              <div>
                <label htmlFor={`agent-desc-${agent.id}`} className={labelClass}>{t("description")}</label>
                <textarea
                  id={`agent-desc-${agent.id}`}
                  className={`${textareaClass} min-h-[60px]`}
                  placeholder={t("ph_agent_desc")}
                  value={agent.description}
                  onChange={(e) => updateAgent(i, "description", e.target.value)}
                />
              </div>
              <div>
                <label htmlFor={`agent-goals-${agent.id}`} className={labelClass}>{t("goals")}</label>
                <textarea
                  id={`agent-goals-${agent.id}`}
                  className={`${textareaClass} min-h-[60px]`}
                  placeholder={t("ph_goals")}
                  value={agent.goals}
                  onChange={(e) => updateAgent(i, "goals", e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor={`agent-inv-${agent.id}`} className={labelClass}>{t("inventory")}</label>
                  <input
                    id={`agent-inv-${agent.id}`}
                    className={inputClass}
                    placeholder={t("ph_inventory")}
                    value={agent.inventory}
                    onChange={(e) => updateAgent(i, "inventory", e.target.value)}
                  />
                </div>
                <div>
                  <label htmlFor={`agent-loc-${agent.id}`} className={labelClass}>{t("starting_location")}</label>
                  <input
                    id={`agent-loc-${agent.id}`}
                    className={inputClass}
                    placeholder={t("ph_location")}
                    value={agent.location}
                    onChange={(e) => updateAgent(i, "location", e.target.value)}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Submit */}
        <div className="text-micro text-t-dim tracking-widest mb-3">{"// LAUNCH"}</div>
        <div className="flex gap-3 pt-4 border-t border-b-DEFAULT">
          <button
            onClick={handleSubmit}
            disabled={loading || !world.name.trim()}
            className="h-9 px-6 text-micro font-medium tracking-wider bg-primary text-void border border-primary hover:bg-transparent hover:text-primary hover:shadow-[0_0_16px_var(--color-primary-glow-strong)] active:scale-[0.97] disabled:opacity-30 disabled:pointer-events-none transition-[colors,box-shadow,transform]"
          >
            {loading ? t("creating") : t("create_launch")}
          </button>
          <a
            href="/"
            className="h-9 px-4 text-micro font-medium tracking-wider border border-b-DEFAULT text-t-muted hover:border-primary hover:text-primary active:scale-[0.97] transition-[colors,transform] inline-flex items-center justify-center"
          >
            {t("cancel")}
          </a>
        </div>
      </main>
    </div>
  );
}
