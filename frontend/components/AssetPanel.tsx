"use client";

import { useState, useMemo, useEffect } from "react";
import { AgentData, WorldState, SavedSeedData, generateSeed, fetchAssets } from "@/lib/api";
import { useLocale } from "@/lib/locale-context";
import { StatusDot, Badge } from "./ui";

type Tab = "agents" | "items" | "locations" | "world";

// ── Agent list item (expandable) ──
function AgentRow({
  agent,
  isActive,
  expanded,
  onToggle,
  onChat,
  onExtract,
}: {
  agent: AgentData;
  isActive: boolean;
  expanded: boolean;
  onToggle: () => void;
  onChat: () => void;
  onExtract: () => void;
}) {
  const { t } = useLocale();
  const isDead = agent.status === "dead";

  return (
    <div
      className={`border transition-colors ${
        isActive
          ? "border-primary shadow-[0_0_0_1px_var(--color-primary)]"
          : isDead
          ? "border-b-DEFAULT opacity-40"
          : "border-b-DEFAULT hover:border-b-hover"
      }`}
    >
      {/* Header - clickable */}
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className="w-full px-4 py-3 flex items-center gap-3 text-left bg-surface-1 hover:bg-surface-3 transition-colors"
      >
        <StatusDot status={agent.status} />
        <div className="flex-1 min-w-0">
          <div className="text-body font-semibold truncate">{agent.name}</div>
          <div className="text-micro text-t-dim tracking-wider mt-0.5 truncate">
            {agent.location || "\u2014"}
          </div>
        </div>
        <span className="text-micro text-t-dim tracking-wider shrink-0" aria-hidden="true">
          {expanded ? "\u25BE" : "\u25B8"}
        </span>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-b-DEFAULT bg-void animate-slide-down">
          {/* Description */}
          {agent.description && (
            <div className="px-4 py-2 border-b border-b-DEFAULT">
              <div className="text-micro text-t-muted tracking-widest mb-1">{t("description")}</div>
              <div className="text-detail text-t-secondary normal-case tracking-normal leading-relaxed">
                {agent.description}
              </div>
            </div>
          )}

          {/* Personality */}
          {agent.personality && (
            <div className="px-4 py-2 border-b border-b-DEFAULT">
              <div className="text-micro text-t-muted tracking-widest mb-1">{t("personality")}</div>
              <div className="text-detail text-t-secondary normal-case tracking-normal leading-relaxed">
                {agent.personality}
              </div>
            </div>
          )}

          {/* Goals */}
          {(agent.goals || []).length > 0 && (
            <div className="px-4 py-2 border-b border-b-DEFAULT">
              <div className="text-micro text-t-muted tracking-widest mb-1">{t("goals_label")}</div>
              <div className="flex flex-col gap-1">
                {(agent.goals || []).map((goal, i) => (
                  <div key={i} className="flex items-baseline gap-2">
                    <span className="text-micro text-t-dim tracking-wider shrink-0">{String(i + 1).padStart(2, "0")}</span>
                    <span className="text-detail text-t-secondary normal-case tracking-normal">{goal}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Inventory */}
          <div className="px-4 py-2 border-b border-b-DEFAULT">
            <div className="text-micro text-t-muted tracking-widest mb-1">{t("inventory_label")}</div>
            {(agent.inventory || []).length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {(agent.inventory || []).map((item, i) => (
                  <Badge key={i} variant="warning">{item}</Badge>
                ))}
              </div>
            ) : (
              <span className="text-detail text-t-dim">&mdash;</span>
            )}
          </div>

          {/* Memory */}
          {agent.memory && agent.memory.length > 0 && (
            <div className="px-4 py-2 border-b border-b-DEFAULT">
              <div className="text-micro text-t-muted tracking-widest mb-1">{t("memory")}</div>
              <div className="flex flex-col gap-1 max-h-32 overflow-y-auto">
                {agent.memory.map((mem, i) => (
                  <div key={i} className="text-detail text-t-dim normal-case tracking-normal leading-relaxed border-l-2 border-surface-3 pl-3">
                    {mem}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          {!isDead && (
            <div className="flex items-center gap-2 px-4 py-2">
              <button
                onClick={onChat}
                className="h-8 px-3 text-micro tracking-wider border border-b-DEFAULT text-t-muted hover:border-primary hover:text-primary transition-colors"
              >
                {t("chat")}
              </button>
              <button
                onClick={onExtract}
                className="h-8 px-3 text-micro tracking-wider border border-b-DEFAULT text-t-muted hover:border-info hover:text-info transition-colors"
              >
                {t("extract")}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Item row (expandable, with detail generation) ──
interface ItemInfo {
  name: string;
  holders: { agentId: string; agentName: string }[];
}

function ItemRow({
  item,
  expanded,
  onToggle,
  cachedDetail,
  onGenerate,
  generating,
  error,
}: {
  item: ItemInfo;
  expanded: boolean;
  onToggle: () => void;
  cachedDetail: SavedSeedData | null;
  onGenerate: () => void;
  generating: boolean;
  error?: boolean;
}) {
  const { t } = useLocale();
  const detail = cachedDetail?.data;
  const description = (detail?.description as string) || "";

  return (
    <div className="border border-b-DEFAULT hover:border-b-hover transition-colors">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className="w-full px-4 py-3 flex items-center gap-3 text-left bg-surface-1 hover:bg-surface-3 transition-colors"
      >
        <StatusDot status="warning" />
        <div className="flex-1 min-w-0">
          <div className="text-body font-semibold truncate">{item.name}</div>
          <div className="text-micro text-t-dim tracking-wider mt-0.5">
            {item.holders.length} {t("panel_holders")}
          </div>
        </div>
        <span className="text-micro text-t-dim tracking-wider shrink-0" aria-hidden="true">
          {expanded ? "\u25BE" : "\u25B8"}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-b-DEFAULT bg-void animate-slide-down">
          {/* Description (cached or empty) */}
          {description && (
            <div className="px-4 py-2 border-b border-b-DEFAULT">
              <div className="text-micro text-t-muted tracking-widest mb-1">{t("description")}</div>
              <div className="text-detail text-t-secondary normal-case tracking-normal leading-relaxed">{description}</div>
            </div>
          )}
          {/* Holders */}
          <div className="px-4 py-2 border-b border-b-DEFAULT">
            <div className="text-micro text-t-muted tracking-widest mb-1">{t("panel_held_by")}</div>
            <div className="flex flex-col gap-1">
              {item.holders.map((h) => (
                <div key={h.agentId} className="flex items-center gap-2 text-detail text-t-secondary">
                  <StatusDot status="idle" />
                  {h.agentName}
                </div>
              ))}
            </div>
          </div>
          {/* Generate / status */}
          <div className="px-4 py-2 flex items-center gap-3">
            {cachedDetail ? (
              <span className="text-micro text-primary tracking-wider">{t("saved_ok")}</span>
            ) : (
              <>
                <button
                  onClick={onGenerate}
                  disabled={generating}
                  className="text-micro tracking-wider text-t-muted hover:text-primary disabled:opacity-40 transition-colors"
                >
                  {generating ? t("generating") : error ? t("retry") : t("generate_details")}
                </button>
                {error && (
                  <span className="text-micro text-danger tracking-wider">{t("gen_item_gen_failed")}</span>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Location row (expandable) ──
function LocationRow({
  location,
  agentsHere,
  expanded,
  onToggle,
}: {
  location: { name: string; description: string };
  agentsHere: { id: string; name: string; status: string }[];
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="border border-b-DEFAULT hover:border-b-hover transition-colors">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className="w-full px-4 py-3 flex items-center gap-3 text-left bg-surface-1 hover:bg-surface-3 transition-colors"
      >
        <StatusDot status="secondary" />
        <div className="flex-1 min-w-0">
          <div className="text-body font-semibold truncate">{location.name}</div>
          <div className="text-micro text-t-dim tracking-wider mt-0.5 truncate">
            {agentsHere.length > 0
              ? agentsHere.map((a) => a.name).join(", ")
              : "\u2014"
            }
          </div>
        </div>
        <span className="text-micro text-t-dim tracking-wider shrink-0" aria-hidden="true">
          {expanded ? "\u25BE" : "\u25B8"}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-b-DEFAULT bg-void px-4 py-2 animate-slide-down">
          <div className="text-detail text-t-secondary normal-case tracking-normal leading-relaxed mb-2">
            {location.description}
          </div>
          {agentsHere.length > 0 && (
            <div className="flex flex-col gap-1 mt-2">
              {agentsHere.map((a) => (
                <div key={a.id} className="flex items-center gap-2 text-detail text-t-secondary">
                  <StatusDot status={a.status} />
                  {a.name}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Asset Panel ──
export default function AssetPanel({
  state,
  activeAgentId,
  sessionId,
  onChat,
  onExtractAgent,
  onExtractWorld,
}: {
  state: WorldState | null;
  activeAgentId: string | null;
  sessionId: string;
  onChat: (agentId: string, agentName: string) => void;
  onExtractAgent: (agentId: string) => void;
  onExtractWorld: () => void;
}) {
  const { t } = useLocale();
  const [tab, setTab] = useState<Tab>("agents");
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [expandedLocation, setExpandedLocation] = useState<string | null>(null);
  const [itemCache, setItemCache] = useState<Map<string, SavedSeedData>>(new Map());
  const [generatingItem, setGeneratingItem] = useState<string | null>(null);
  const [genError, setGenError] = useState<string | null>(null);

  // Load cached item assets on mount
  useEffect(() => {
    let mounted = true;
    fetchAssets("item").then((assets) => {
      if (!mounted || !Array.isArray(assets)) return;
      const map = new Map<string, SavedSeedData>();
      assets.forEach((a) => map.set(a.name, a));
      setItemCache(map);
    }).catch(() => {});
    return () => { mounted = false; };
  }, []);

  async function handleGenerateItemDetail(itemName: string) {
    if (generatingItem) return;
    setGeneratingItem(itemName);
    setGenError(null);
    try {
      const seed = await generateSeed("item", sessionId, itemName);
      setItemCache((prev) => {
        const next = new Map(prev);
        next.set(itemName, seed);
        return next;
      });
    } catch {
      setGenError(itemName);
    } finally {
      setGeneratingItem(null);
    }
  }

  const agents = state?.agents || {};
  const locations = state?.locations || [];

  // Aggregate items from all agents (memoized — only recomputes when state changes)
  const items = useMemo<ItemInfo[]>(() => {
    const map = new Map<string, ItemInfo>();
    Object.entries(agents).forEach(([agentId, agent]) => {
      (agent.inventory || []).forEach((itemName) => {
        if (!map.has(itemName)) {
          map.set(itemName, { name: itemName, holders: [] });
        }
        map.get(itemName)!.holders.push({ agentId, agentName: agent.name });
      });
    });
    return Array.from(map.values());
  }, [agents]);

  const TABS: { key: Tab; labelKey: "agents" | "item" | "locations" | "world_state"; count: number }[] = [
    { key: "agents", labelKey: "agents", count: Object.keys(agents).length },
    { key: "items", labelKey: "item", count: items.length },
    { key: "locations", labelKey: "locations", count: locations.length },
    { key: "world", labelKey: "world_state", count: 0 },
  ];

  return (
    <aside className="flex flex-col overflow-hidden h-full" aria-label="Asset management">
      {/* Tabs */}
      <div role="tablist" aria-label="Asset tabs" className="flex shrink-0 border-b border-b-DEFAULT bg-surface-1"
        onKeyDown={(e) => {
          const keys = TABS.map((t) => t.key);
          const idx = keys.indexOf(tab);
          if (e.key === "ArrowRight") { e.preventDefault(); setTab(keys[(idx + 1) % keys.length]); }
          if (e.key === "ArrowLeft") { e.preventDefault(); setTab(keys[(idx - 1 + keys.length) % keys.length]); }
        }}
      >
        {TABS.map((t_item) => (
          <button
            key={t_item.key}
            role="tab"
            tabIndex={tab === t_item.key ? 0 : -1}
            aria-selected={tab === t_item.key}
            aria-controls={`tabpanel-${t_item.key}`}
            onClick={() => setTab(t_item.key)}
            className={`flex-1 px-2 py-3 text-micro tracking-wider text-center transition-colors relative ${
              tab === t_item.key
                ? "text-primary"
                : "text-t-muted hover:text-t-DEFAULT"
            }`}
          >
            {t(t_item.labelKey)}
            {t_item.count > 0 && (
              <span className="ml-1 text-t-dim">{t_item.count}</span>
            )}
            {tab === t_item.key && (
              <span className="absolute bottom-0 left-0 right-0 h-px bg-primary" />
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div key={tab} className="flex-1 overflow-y-auto animate-[fade-in_100ms_ease]" role="tabpanel" id={`tabpanel-${tab}`}>
        {/* Agents tab */}
        {tab === "agents" && (
          <div className="p-3 flex flex-col gap-2">
            {Object.keys(agents).length === 0 ? (
              <div className="text-detail text-t-dim text-center py-8 normal-case tracking-normal">
                {t("panel_no_agents")}
              </div>
            ) : (
              Object.entries(agents).map(([id, agent]) => (
                <AgentRow
                  key={id}
                  agent={agent}
                  isActive={id === activeAgentId}
                  expanded={expandedAgent === id}
                  onToggle={() => setExpandedAgent(expandedAgent === id ? null : id)}
                  onChat={() => onChat(id, agent.name)}
                  onExtract={() => onExtractAgent(id)}
                />
              ))
            )}
          </div>
        )}

        {/* Items tab */}
        {tab === "items" && (
          <div className="p-3 flex flex-col gap-2">
            {items.length === 0 ? (
              <div className="text-detail text-t-dim text-center py-8 normal-case tracking-normal">
                {t("panel_no_items")}
              </div>
            ) : (
              items.map((item) => (
                <ItemRow
                  key={item.name}
                  item={item}
                  expanded={expandedItem === item.name}
                  onToggle={() => setExpandedItem(expandedItem === item.name ? null : item.name)}
                  cachedDetail={itemCache.get(item.name) || null}
                  onGenerate={() => handleGenerateItemDetail(item.name)}
                  generating={generatingItem === item.name}
                  error={genError === item.name}
                />
              ))
            )}
          </div>
        )}

        {/* Locations tab */}
        {tab === "locations" && (
          <div className="p-3 flex flex-col gap-2">
            {locations.length === 0 ? (
              <div className="text-detail text-t-dim text-center py-8 normal-case tracking-normal">
                {t("panel_no_locations")}
              </div>
            ) : (
              locations.map((loc) => {
                const agentsHere = Object.entries(agents)
                  .filter(([, a]) => a.location === loc.name)
                  .map(([id, a]) => ({ id, name: a.name, status: a.status }));
                return (
                  <LocationRow
                    key={loc.name}
                    location={loc}
                    agentsHere={agentsHere}
                    expanded={expandedLocation === loc.name}
                    onToggle={() => setExpandedLocation(expandedLocation === loc.name ? null : loc.name)}
                  />
                );
              })
            )}
          </div>
        )}

        {/* World tab */}
        {tab === "world" && (
          <div className="flex flex-col">
            {state ? (
              <>
                {/* World name & description */}
                <div className="px-4 py-3 border-b border-b-DEFAULT">
                  <div className="text-body font-semibold">{state.name}</div>
                  {state.description && (
                    <div className="text-detail text-t-muted normal-case tracking-normal leading-relaxed mt-1">
                      {state.description}
                    </div>
                  )}
                </div>

                {/* Stats grid */}
                <div className="grid grid-cols-3 gap-px bg-b-DEFAULT border-b border-b-DEFAULT">
                  <div className="bg-surface-1 p-3">
                    <div className="text-micro text-t-muted tracking-widest">{t("tick")}</div>
                    <div className="text-heading font-bold text-primary mt-1">{state.tick}</div>
                  </div>
                  <div className="bg-surface-1 p-3">
                    <div className="text-micro text-t-muted tracking-widest">{t("agents")}</div>
                    <div className="text-heading font-bold mt-1">{Object.keys(state.agents || {}).length}</div>
                  </div>
                  <div className="bg-surface-1 p-3">
                    <div className="text-micro text-t-muted tracking-widest">{t("locations")}</div>
                    <div className="text-heading font-bold mt-1">{(state.locations || []).length}</div>
                  </div>
                </div>

                {/* Rules */}
                <div className="px-4 py-3 border-b border-b-DEFAULT">
                  <div className="text-micro text-t-muted tracking-widest mb-2">{t("rules")}</div>
                  {(state.rules || []).length > 0 ? (
                    <div className="flex flex-col gap-1.5">
                      {(state.rules || []).map((rule, i) => (
                        <div key={i} className="flex items-baseline gap-2">
                          <span className="text-micro text-t-dim tracking-wider shrink-0">{String(i + 1).padStart(2, "0")}</span>
                          <span className="text-detail text-t-secondary normal-case tracking-normal">{rule}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-detail text-t-dim normal-case tracking-normal">{t("panel_no_rules")}</div>
                  )}
                </div>

                {/* Extract world button */}
                <div className="px-4 py-3">
                  <button
                    onClick={onExtractWorld}
                    className="w-full h-9 text-micro tracking-wider border border-b-DEFAULT text-t-muted hover:border-primary hover:text-primary active:scale-[0.97] transition-[colors,transform]"
                  >
                    {t("extract_world")}
                  </button>
                </div>
              </>
            ) : (
              <div className="p-4 text-detail text-t-dim normal-case tracking-normal">
                {t("panel_no_world")}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer — link to full assets page */}
      <a
        href="/assets"
        className="px-4 py-3 border-t border-b-DEFAULT bg-surface-1 text-micro text-t-muted tracking-wider hover:text-primary transition-colors text-center shrink-0"
      >
        {t("view_all_assets")}
      </a>
    </aside>
  );
}
