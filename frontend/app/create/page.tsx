"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createWorld, fetchAssets, SavedSeedData } from "@/lib/api";
import Nav from "@/components/Nav";

interface AgentForm {
  id: string;
  name: string;
  description: string;
  personality: string;
  goals: string;
  inventory: string;
  location: string;
}

let agentCounter = 0;
const emptyAgent = (): AgentForm => ({
  id: `agent_${Date.now()}_${++agentCounter}`,
  name: "",
  description: "",
  personality: "",
  goals: "",
  inventory: "",
  location: "",
});

export default function CreatePage() {
  const router = useRouter();
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

  useEffect(() => {
    fetchAssets("agent").then(setSavedAgents).catch(() => {});
    fetchAssets("event").then(setSavedEvents).catch(() => {});
  }, []);

  function importAgent(seed: SavedSeedData) {
    const d = seed.data;
    const a: AgentForm = {
      id: (d.id as string) || `agent_${Date.now()}_${++agentCounter}`,
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
    setLoading(true);
    setError(null);

    try {
      const locations = world.locations
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [name, ...desc] = line.split(":");
          return { name: name.trim(), description: desc.join(":").trim() };
        });

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

      const { session_id } = await createWorld(data);
      router.push(`/sim?id=${session_id}`);
    } catch {
      setError("Failed to create world. Check backend connection.");
      setLoading(false);
    }
  }

  const inputClass =
    "w-full h-12 px-4 bg-surface-1 border border-b-DEFAULT text-white text-body focus:border-primary focus:outline-none hover:border-b-hover transition-colors";
  const textareaClass =
    "w-full min-h-[100px] p-3 px-4 bg-surface-1 border border-b-DEFAULT text-white text-body normal-case tracking-normal leading-normal resize-y focus:border-primary focus:outline-none hover:border-b-hover transition-colors";
  const labelClass = "text-micro text-t-muted tracking-widest mb-2 block";

  return (
    <div className="min-h-screen flex flex-col bg-void">
      <Nav activePage="create" />

      <main className="flex-1 p-6 max-w-3xl mx-auto w-full animate-[slide-up_0.4s_ease]">
        <h1 className="font-sans text-title font-bold tracking-tight mb-8">Create World</h1>

        {/* Error banner */}
        {error && (
          <div className="mb-6 px-4 py-3 border border-danger text-detail text-danger flex items-center justify-between" role="alert">
            <span className="normal-case tracking-normal">{error}</span>
            <button onClick={() => setError(null)} className="text-micro text-danger hover:text-white transition-colors ml-4" aria-label="Dismiss error">
              Dismiss
            </button>
          </div>
        )}

        {/* Import from Assets */}
        {(savedAgents.length > 0 || savedEvents.length > 0) && (
          <div className="mb-8">
            <button
              onClick={() => setShowImport(!showImport)}
              className="text-micro text-t-muted tracking-widest hover:text-primary transition-colors mb-3"
            >
              {showImport ? "- Hide Assets" : "+ Import from Assets"}
            </button>
            {showImport && (
              <div className="border border-b-DEFAULT p-4 flex flex-col gap-4 bg-surface-1 animate-[slide-up_200ms_ease]">
                {savedAgents.length > 0 && (
                  <div>
                    <div className="text-micro text-t-muted tracking-widest mb-2">
                      Agent Seeds ({savedAgents.length})
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
                      Event Seeds ({savedEvents.length})
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
        <div className="flex flex-col gap-6 mb-10">
          <div>
            <label htmlFor="world-name" className={labelClass}>World Name</label>
            <input
              id="world-name"
              className={inputClass}
              placeholder="Enter world name"
              value={world.name}
              onChange={(e) => setWorld({ ...world, name: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="world-desc" className={labelClass}>Description</label>
            <textarea
              id="world-desc"
              className={textareaClass}
              placeholder="Describe the world setting..."
              value={world.description}
              onChange={(e) => setWorld({ ...world, description: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="world-rules" className={labelClass}>Rules (one per line)</label>
            <textarea
              id="world-rules"
              className={textareaClass}
              placeholder="Each line is a rule..."
              value={world.rules}
              onChange={(e) => setWorld({ ...world, rules: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="world-locations" className={labelClass}>Locations (name: description, one per line)</label>
            <textarea
              id="world-locations"
              className={textareaClass}
              placeholder="Bar Counter: The main area&#10;VIP Room: Private area"
              value={world.locations}
              onChange={(e) => setWorld({ ...world, locations: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="world-events" className={labelClass}>Initial Events (one per line)</label>
            <textarea
              id="world-events"
              className={textareaClass}
              placeholder="What has just happened before the simulation starts..."
              value={world.initial_events}
              onChange={(e) => setWorld({ ...world, initial_events: e.target.value })}
            />
          </div>
        </div>

        {/* Agents */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-sans text-heading font-semibold tracking-tight">Agents</h2>
          <button
            onClick={addAgent}
            className="h-9 px-4 text-micro tracking-wider border border-b-DEFAULT text-t-muted hover:border-primary hover:text-primary transition-colors"
          >
            + Add Agent
          </button>
        </div>

        <div className="flex flex-col gap-4 mb-10">
          {agents.map((agent, i) => (
            <div key={agent.id} className="bg-surface-1 border border-b-DEFAULT p-6 flex flex-col gap-4">
              <div className="flex justify-between items-center">
                <span className="text-micro text-t-muted tracking-widest">Agent {i + 1}</span>
                {agents.length > 1 && (
                  <button
                    onClick={() => removeAgent(i)}
                    className="text-micro text-danger tracking-wider hover:text-danger/80"
                  >
                    Remove
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor={`agent-name-${agent.id}`} className={labelClass}>Name</label>
                  <input
                    id={`agent-name-${agent.id}`}
                    className={inputClass}
                    placeholder="Agent name"
                    value={agent.name}
                    onChange={(e) => updateAgent(i, "name", e.target.value)}
                  />
                </div>
                <div>
                  <label htmlFor={`agent-personality-${agent.id}`} className={labelClass}>Personality</label>
                  <input
                    id={`agent-personality-${agent.id}`}
                    className={inputClass}
                    placeholder="Traits..."
                    value={agent.personality}
                    onChange={(e) => updateAgent(i, "personality", e.target.value)}
                  />
                </div>
              </div>
              <div>
                <label htmlFor={`agent-desc-${agent.id}`} className={labelClass}>Description</label>
                <textarea
                  id={`agent-desc-${agent.id}`}
                  className={`${textareaClass} min-h-[60px]`}
                  placeholder="Who is this agent?"
                  value={agent.description}
                  onChange={(e) => updateAgent(i, "description", e.target.value)}
                />
              </div>
              <div>
                <label htmlFor={`agent-goals-${agent.id}`} className={labelClass}>Goals (one per line)</label>
                <textarea
                  id={`agent-goals-${agent.id}`}
                  className={`${textareaClass} min-h-[60px]`}
                  placeholder="What does this agent want?"
                  value={agent.goals}
                  onChange={(e) => updateAgent(i, "goals", e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor={`agent-inv-${agent.id}`} className={labelClass}>Inventory (comma separated)</label>
                  <input
                    id={`agent-inv-${agent.id}`}
                    className={inputClass}
                    placeholder="item1, item2"
                    value={agent.inventory}
                    onChange={(e) => updateAgent(i, "inventory", e.target.value)}
                  />
                </div>
                <div>
                  <label htmlFor={`agent-loc-${agent.id}`} className={labelClass}>Starting Location</label>
                  <input
                    id={`agent-loc-${agent.id}`}
                    className={inputClass}
                    placeholder="Location name"
                    value={agent.location}
                    onChange={(e) => updateAgent(i, "location", e.target.value)}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Submit */}
        <div className="flex gap-3 pt-4 border-t border-b-DEFAULT">
          <button
            onClick={handleSubmit}
            disabled={loading || !world.name.trim()}
            className="h-12 min-w-[200px] px-8 text-detail font-medium tracking-wider bg-primary text-void border border-primary hover:bg-transparent hover:text-primary active:bg-primary-dim active:border-primary-dim active:text-void disabled:opacity-30 disabled:pointer-events-none transition-colors"
          >
            {loading ? "Creating..." : "Create & Launch"}
          </button>
          <a
            href="/"
            className="h-12 min-w-[120px] px-6 text-detail font-medium tracking-wider border border-b-DEFAULT text-t-muted hover:text-white hover:border-white transition-colors inline-flex items-center justify-center"
          >
            Cancel
          </a>
        </div>
      </main>
    </div>
  );
}
