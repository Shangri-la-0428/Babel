"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { AgentData, WorldState, SavedSeedData, RelationData, generateSeed, fetchAssets, enrichEntity } from "@/lib/api";
import { useLocale } from "@/lib/locale-context";
import { StatusDot } from "./ui";

type Tab = "agents" | "items" | "locations" | "world";

// ── Agent list item (expandable) ──
const RELATION_COLORS: Record<string, string> = {
  ally: "text-primary border-primary",
  trust: "text-info border-info",
  neutral: "text-t-muted border-surface-3",
  rival: "text-warning border-warning",
  hostile: "text-danger border-danger",
};

const GOAL_STATUS_COLORS: Record<string, string> = {
  active: "text-primary border-primary",
  completed: "text-info border-info",
  stalled: "text-warning border-warning",
  failed: "text-danger border-danger",
};

function AgentRow({
  agent,
  agentId,
  isActive,
  expanded,
  onToggle,
  onChat,
  onExtract,
  onItemClick,
  enrichedDetails,
  enriching,
  enrichError,
  onEnrich,
  relations,
  agentNames,
  isHumanControlled,
  onTakeControl,
  onReleaseControl,
}: {
  agent: AgentData;
  agentId: string;
  isActive: boolean;
  expanded: boolean;
  onToggle: () => void;
  onChat: () => void;
  onExtract: () => void;
  onItemClick: (itemName: string) => void;
  enrichedDetails: Record<string, unknown> | null;
  enriching: boolean;
  enrichError: boolean;
  onEnrich: () => void;
  relations: RelationData[];
  agentNames: Record<string, string>;
  isHumanControlled?: boolean;
  onTakeControl?: () => void;
  onReleaseControl?: () => void;
}) {
  const { t } = useLocale();
  const isDead = agent.status === "dead";
  const isSupporting = agent.role === "supporting";

  // Auto-enrich when expanded and no enrichment exists
  const autoEnrichRef = useRef(false);
  useEffect(() => {
    if (expanded && !enrichedDetails && !enriching && !enrichError && !autoEnrichRef.current) {
      autoEnrichRef.current = true;
      onEnrich();
    }
    if (!expanded) {
      autoEnrichRef.current = false;
    }
  }, [expanded, enrichedDetails, enriching, enrichError, onEnrich]);

  return (
    <div
      className={`border transition-colors ${
        isSupporting ? "border-dashed opacity-80" : ""
      } ${
        isActive && !isDead
          ? "border-primary shadow-[0_0_0_1px_var(--color-primary)] animate-[event-flash_1.2s_ease]"
          : isDead
          ? "border-b-DEFAULT opacity-40"
          : "border-b-DEFAULT hover:border-b-hover"
      }`}
      style={isDead ? { animation: 'crt-glitch 300ms ease both' } : undefined}
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
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-body font-semibold truncate">{agent.name}</span>
            {isHumanControlled && (
              <span className="text-micro tracking-wider px-2.5 py-0.5 border leading-none font-medium border-primary text-primary shrink-0">
                {t("human_controlled")}
              </span>
            )}
            {isSupporting && (
              <span className="text-micro tracking-wider px-2.5 py-0.5 border leading-none font-medium border-t-dim text-t-dim shrink-0">
                {t("supporting_character")}
              </span>
            )}
          </div>
          <div className="text-micro text-t-dim tracking-wider mt-0.5 truncate">
            {agent.location || "\u2014"}
          </div>
        </div>
        <span className="text-micro text-t-dim tracking-wider shrink-0" aria-hidden="true">
          {expanded ? "\u25BE" : "\u25B8"}
        </span>
      </button>

      {/* Expanded content — accordion transition */}
      <div className="accordion-grid border-t border-b-DEFAULT" data-open={expanded}>
        <div className="accordion-inner bg-void">
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

          {/* Psyche Emotional State */}
          {agent.psyche && (
            <div className="px-4 py-2 border-b border-b-DEFAULT">
              <div className="text-micro text-t-muted tracking-widest mb-1.5">{t("psyche_emotion")}</div>
              {/* Dominant emotion */}
              <div className="flex items-center gap-2 mb-2">
                <span className="text-detail text-t-DEFAULT normal-case tracking-normal capitalize">
                  {agent.psyche.emotion || "\u2014"}
                </span>
                <span className={`text-micro tracking-wider px-2 py-0.5 border leading-none font-medium ${
                  agent.psyche.autonomic === "ventral_vagal"
                    ? "text-primary border-primary"
                    : agent.psyche.autonomic === "sympathetic"
                    ? "text-warning border-warning"
                    : "text-danger border-danger"
                }`}>
                  {t(`psyche_${agent.psyche.autonomic}` as Parameters<typeof t>[0])}
                </span>
              </div>
              {/* Chemical bars */}
              <div className="text-micro text-t-dim tracking-widest mb-1">{t("psyche_chemicals")}</div>
              <div className="flex flex-col gap-1 mb-2">
                {(["DA", "HT", "CORT", "OT", "NE", "END"] as const).map((key) => {
                  const labelKey = {
                    DA: "psyche_dopamine", HT: "psyche_serotonin", CORT: "psyche_cortisol",
                    OT: "psyche_oxytocin", NE: "psyche_norepinephrine", END: "psyche_endorphins",
                  }[key] as Parameters<typeof t>[0];
                  const val = agent.psyche!.chemicals[key];
                  return (
                    <div key={key} className="flex items-center gap-2">
                      <span className="text-micro text-t-dim tracking-wider w-8 shrink-0 tabular-nums">{key}</span>
                      <div className="flex-1 h-1 bg-surface-3 overflow-hidden" title={t(labelKey)}>
                        <div
                          className={`h-full transition-all duration-300 ${
                            val > 70 ? "bg-primary shadow-[0_0_6px_var(--color-primary-glow)]" : val < 30 ? "bg-danger shadow-[0_0_6px_var(--color-danger-glow)]" : "bg-t-dim"
                          }`}
                          style={{ width: `${val}%` }}
                        />
                      </div>
                      <span className="text-micro text-t-dim tabular-nums shrink-0 w-6 text-right">{Math.round(val)}</span>
                    </div>
                  );
                })}
              </div>
              {/* Drives */}
              {Object.keys(agent.psyche.drives).length > 0 && (
                <>
                  <div className="text-micro text-t-dim tracking-widest mb-1">{t("psyche_drives")}</div>
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(agent.psyche.drives).map(([drive, val]) => (
                      <span
                        key={drive}
                        className={`text-micro tracking-wider px-2 py-0.5 border leading-none font-medium normal-case ${
                          val > 70 ? "text-primary border-primary" : val < 30 ? "text-danger border-danger" : "text-t-muted border-surface-3"
                        }`}
                      >
                        {drive} {Math.round(val)}
                      </span>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Active Goal */}
          {agent.active_goal && (
            <div className="px-4 py-2 border-b border-b-DEFAULT">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-micro text-t-muted tracking-widest">{t("active_goal")}</span>
                <span className={`text-micro tracking-wider px-2 py-0.5 border leading-none font-medium ${GOAL_STATUS_COLORS[agent.active_goal.status] || GOAL_STATUS_COLORS.active}`}>
                  {t(`goal_status_${agent.active_goal.status}` as Parameters<typeof t>[0])}
                </span>
              </div>
              <div className="text-detail text-t-DEFAULT normal-case tracking-normal leading-relaxed mb-2">
                {agent.active_goal.text}
              </div>
              {/* Progress bar */}
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1 bg-surface-3 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 ${
                      agent.active_goal.status === "stalled" ? "bg-warning" : "bg-primary"
                    }`}
                    style={{ width: `${Math.round(agent.active_goal.progress * 100)}%` }}
                  />
                </div>
                <span className="text-micro text-t-dim tracking-wider tabular-nums shrink-0">
                  {Math.round(agent.active_goal.progress * 100)}%
                </span>
              </div>
              {agent.active_goal.stall_count > 0 && (
                <div className="text-micro text-warning tracking-wider mt-1">
                  {t("goal_stalled_ticks", String(agent.active_goal.stall_count))}
                </div>
              )}
            </div>
          )}

          {/* Core Goals */}
          {(agent.goals || []).length > 0 && (
            <div className="px-4 py-2 border-b border-b-DEFAULT">
              <div className="text-micro text-t-muted tracking-widest mb-1">
                {agent.active_goal ? t("core_goals") : t("goals_label")}
              </div>
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

          {/* Dynamic Relations */}
          {relations.length > 0 && (
            <div className="px-4 py-2 border-b border-b-DEFAULT">
              <div className="text-micro text-t-muted tracking-widest mb-1">{t("relations_dynamic")}</div>
              <div className="flex flex-col gap-1">
                {relations.map((rel, i) => {
                  const otherId = rel.source === agentId ? rel.target : rel.source;
                  const otherName = agentNames[otherId] || otherId;
                  const colors = RELATION_COLORS[rel.type] || RELATION_COLORS.neutral;
                  return (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-detail text-t-DEFAULT normal-case tracking-normal">{otherName}</span>
                      <span className={`text-micro tracking-wider px-2 py-0.5 border leading-none font-medium ${colors}`}>
                        {t(`relation_${rel.type}` as Parameters<typeof t>[0])}
                      </span>
                      <div className="flex-1 h-0.5 bg-surface-3 overflow-hidden min-w-[40px]">
                        <div
                          className={`h-full ${rel.type === "hostile" ? "bg-danger" : rel.type === "rival" ? "bg-warning" : "bg-primary"}`}
                          style={{ width: `${Math.round(rel.strength * 100)}%` }}
                        />
                      </div>
                      <span className="text-micro text-t-dim tabular-nums shrink-0">{Math.round(rel.strength * 100)}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Inventory */}
          <div className="px-4 py-2 border-b border-b-DEFAULT">
            <div className="text-micro text-t-muted tracking-widest mb-1">{t("inventory_label")}</div>
            {(agent.inventory || []).length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {(agent.inventory || []).map((item, i) => (
                  <button
                    type="button"
                    key={i}
                    onClick={() => onItemClick(item)}
                    className="text-micro tracking-wider px-2.5 py-0.5 border leading-none font-medium text-warning border-warning hover:bg-warning/10 active:scale-[0.97] transition-[colors,transform]"
                  >
                    {item}
                  </button>
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

          {/* Enrichment */}
          <div className="px-4 py-2 border-b border-b-DEFAULT">
            {enrichedDetails ? (
              <div className="stagger-in">
                {!!enrichedDetails.backstory && (
                  <div>
                    <div className="text-micro text-t-dim tracking-widest mt-1 mb-1">{"// BACKSTORY"}</div>
                    <div className="text-detail text-t-secondary normal-case tracking-normal leading-relaxed">
                      {enrichedDetails.backstory as string}
                    </div>
                  </div>
                )}
                {(enrichedDetails.notable_traits as string[])?.length > 0 && (
                  <div>
                    <div className="text-micro text-t-dim tracking-widest mt-3 mb-1">{"// TRAITS"}</div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {(enrichedDetails.notable_traits as string[]).map((trait, i) => (
                        <span key={i} className="text-detail text-t-secondary px-2 py-0.5 border border-b-DEFAULT normal-case tracking-normal">
                          {trait}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {(enrichedDetails.relationships as Array<{name: string; relation: string}>)?.length > 0 && (
                  <div>
                    <div className="text-micro text-t-dim tracking-widest mt-3 mb-1">{"// RELATIONSHIPS"}</div>
                    {(enrichedDetails.relationships as Array<{name: string; relation: string}>).map((rel, i) => (
                      <div key={i} className="text-detail normal-case tracking-normal truncate">
                        <span className="text-t-DEFAULT">{rel.name}</span>
                        <span className="text-t-dim mx-1">&mdash;</span>
                        <span className="text-t-secondary">{rel.relation}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={onEnrich}
                  disabled={enriching}
                  className="h-7 px-3 text-micro tracking-wider border border-b-DEFAULT text-t-muted hover:bg-surface-1/20 hover:border-primary hover:text-primary active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed transition-[colors,transform]"
                >
                  {enriching ? t("enriching") : t("enrich")}
                </button>
                {enrichError && (
                  <span className="text-micro text-danger tracking-wider">{t("enrich_failed")}</span>
                )}
              </div>
            )}
          </div>

          {/* Actions */}
          {!isDead && (
            <div className="flex items-center gap-2 px-4 py-2">
              {isHumanControlled ? (
                <button
                  type="button"
                  key="controlled"
                  onClick={onReleaseControl}
                  className="h-8 px-3 text-micro tracking-wider border border-primary text-primary hover:bg-primary hover:text-void active:scale-[0.97] transition-[colors,transform] animate-[event-flash_600ms_ease]"
                >
                  <span className="transition-all duration-150">{t("release_control")}</span>
                </button>
              ) : (
                <button
                  type="button"
                  key="autonomous"
                  onClick={onTakeControl}
                  className="h-8 px-3 text-micro tracking-wider border border-b-DEFAULT text-t-muted hover:bg-surface-1/20 hover:border-primary hover:text-primary active:scale-[0.97] transition-[colors,transform]"
                >
                  <span className="transition-all duration-150">{t("take_control")}</span>
                </button>
              )}
              <button
                type="button"
                onClick={onChat}
                className="h-8 px-3 text-micro tracking-wider border border-b-DEFAULT text-t-muted hover:bg-surface-1/20 hover:border-primary hover:text-primary active:scale-[0.97] transition-[colors,transform]"
              >
                {t("chat")}
              </button>
              <button
                type="button"
                onClick={onExtract}
                className="h-8 px-3 text-micro tracking-wider border border-b-DEFAULT text-t-muted hover:border-info hover:text-info active:scale-[0.97] transition-[colors,transform]"
              >
                {t("extract")}
              </button>
            </div>
          )}
        </div>
      </div>
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
  enrichedDetails,
  enriching,
  enrichError,
  onEnrich,
}: {
  item: ItemInfo;
  expanded: boolean;
  onToggle: () => void;
  cachedDetail: SavedSeedData | null;
  onGenerate: () => void;
  generating: boolean;
  error?: boolean;
  enrichedDetails: Record<string, unknown> | null;
  enriching: boolean;
  enrichError: boolean;
  onEnrich: () => void;
}) {
  const { t } = useLocale();
  const detail = cachedDetail?.data;
  const description = (detail?.description as string) || "";

  // Auto-enrich when expanded and no enrichment exists
  const autoEnrichRef = useRef(false);
  useEffect(() => {
    if (expanded && !enrichedDetails && !enriching && !enrichError && !autoEnrichRef.current) {
      autoEnrichRef.current = true;
      onEnrich();
    }
    if (!expanded) {
      autoEnrichRef.current = false;
    }
  }, [expanded, enrichedDetails, enriching, enrichError, onEnrich]);

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
      {/* Expanded content — accordion transition */}
      <div className="accordion-grid border-t border-b-DEFAULT" data-open={expanded}>
        <div className="accordion-inner bg-void">
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
                <div key={h.agentId} className="flex items-center gap-2 text-detail text-t-secondary min-w-0">
                  <StatusDot status="idle" />
                  <span className="truncate">{h.agentName}</span>
                </div>
              ))}
            </div>
          </div>
          {/* Enrichment */}
          <div className="px-4 py-2 border-b border-b-DEFAULT">
            {enrichedDetails ? (
              <>
                {enrichedDetails.description && (
                  <>
                    <div className="text-micro text-t-dim tracking-widest mt-1 mb-1">{"// DESCRIPTION"}</div>
                    <div className="text-detail text-t-secondary normal-case tracking-normal leading-relaxed">
                      {enrichedDetails.description as string}
                    </div>
                  </>
                )}
                {enrichedDetails.origin && (
                  <>
                    <div className="text-micro text-t-dim tracking-widest mt-3 mb-1">{"// ORIGIN"}</div>
                    <div className="text-detail text-t-secondary normal-case tracking-normal leading-relaxed">
                      {enrichedDetails.origin as string}
                    </div>
                  </>
                )}
                {(enrichedDetails.properties as string[])?.length > 0 && (
                  <>
                    <div className="text-micro text-t-dim tracking-widest mt-3 mb-1">{"// PROPERTIES"}</div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {(enrichedDetails.properties as string[]).map((prop, i) => (
                        <span key={i} className="text-detail text-t-secondary px-2 py-0.5 border border-b-DEFAULT normal-case tracking-normal">
                          {prop}
                        </span>
                      ))}
                    </div>
                  </>
                )}
                {enrichedDetails.significance && (
                  <>
                    <div className="text-micro text-t-dim tracking-widest mt-3 mb-1">{"// SIGNIFICANCE"}</div>
                    <div className="text-detail text-t-secondary normal-case tracking-normal leading-relaxed">
                      {enrichedDetails.significance as string}
                    </div>
                  </>
                )}
              </>
            ) : (
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={onEnrich}
                  disabled={enriching}
                  className="h-7 px-3 text-micro tracking-wider border border-b-DEFAULT text-t-muted hover:bg-surface-1/20 hover:border-primary hover:text-primary active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed transition-[colors,transform]"
                >
                  {enriching ? t("enriching") : t("enrich")}
                </button>
                {enrichError && (
                  <span className="text-micro text-danger tracking-wider">{t("enrich_failed")}</span>
                )}
              </div>
            )}
          </div>
          {/* Generate / status */}
          <div className="px-4 py-2 flex items-center gap-3">
            {cachedDetail ? (
              <span className="text-micro text-primary tracking-wider">{t("saved_ok")}</span>
            ) : (
              <>
                <button
                  type="button"
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
      </div>
    </div>
  );
}

// ── Location row (expandable) ──
function LocationRow({
  location,
  agentsHere,
  expanded,
  onToggle,
  enrichedDetails,
  enriching,
  enrichError,
  onEnrich,
}: {
  location: { name: string; description: string };
  agentsHere: { id: string; name: string; status: string }[];
  expanded: boolean;
  onToggle: () => void;
  enrichedDetails: Record<string, unknown> | null;
  enriching: boolean;
  enrichError: boolean;
  onEnrich: () => void;
}) {
  const { t } = useLocale();

  // Auto-enrich when expanded and no enrichment exists
  const autoEnrichRef = useRef(false);
  useEffect(() => {
    if (expanded && !enrichedDetails && !enriching && !enrichError && !autoEnrichRef.current) {
      autoEnrichRef.current = true;
      onEnrich();
    }
    if (!expanded) {
      autoEnrichRef.current = false;
    }
  }, [expanded, enrichedDetails, enriching, enrichError, onEnrich]);

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
      {/* Expanded content — accordion transition */}
      <div className="accordion-grid border-t border-b-DEFAULT" data-open={expanded}>
        <div className="accordion-inner bg-void">
          <div className="px-4 py-2 border-b border-b-DEFAULT">
            <div className="text-detail text-t-secondary normal-case tracking-normal leading-relaxed">
              {location.description}
            </div>
          </div>
          {agentsHere.length > 0 && (
            <div className="px-4 py-2 border-b border-b-DEFAULT">
              <div className="flex flex-col gap-1">
                {agentsHere.map((a) => (
                  <div key={a.id} className="flex items-center gap-2 text-detail text-t-secondary">
                    <StatusDot status={a.status} />
                    {a.name}
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* Enrichment */}
          <div className="px-4 py-2">
            {enrichedDetails ? (
              <>
                {enrichedDetails.description && (
                  <>
                    <div className="text-micro text-t-dim tracking-widest mt-1 mb-1">{"// DESCRIPTION"}</div>
                    <div className="text-detail text-t-secondary normal-case tracking-normal leading-relaxed">
                      {enrichedDetails.description as string}
                    </div>
                  </>
                )}
                {enrichedDetails.atmosphere && (
                  <>
                    <div className="text-micro text-t-dim tracking-widest mt-3 mb-1">{"// ATMOSPHERE"}</div>
                    <div className="text-detail text-t-secondary normal-case tracking-normal leading-relaxed">
                      {enrichedDetails.atmosphere as string}
                    </div>
                  </>
                )}
                {(enrichedDetails.notable_features as string[])?.length > 0 && (
                  <>
                    <div className="text-micro text-t-dim tracking-widest mt-3 mb-1">{"// FEATURES"}</div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {(enrichedDetails.notable_features as string[]).map((feature, i) => (
                        <span key={i} className="text-detail text-t-secondary px-2 py-0.5 border border-b-DEFAULT normal-case tracking-normal">
                          {feature}
                        </span>
                      ))}
                    </div>
                  </>
                )}
                {enrichedDetails.history && (
                  <>
                    <div className="text-micro text-t-dim tracking-widest mt-3 mb-1">{"// HISTORY"}</div>
                    <div className="text-detail text-t-secondary normal-case tracking-normal leading-relaxed">
                      {enrichedDetails.history as string}
                    </div>
                  </>
                )}
              </>
            ) : (
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={onEnrich}
                  disabled={enriching}
                  className="h-7 px-3 text-micro tracking-wider border border-b-DEFAULT text-t-muted hover:bg-surface-1/20 hover:border-primary hover:text-primary active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed transition-[colors,transform]"
                >
                  {enriching ? t("enriching") : t("enrich")}
                </button>
                {enrichError && (
                  <span className="text-micro text-danger tracking-wider">{t("enrich_failed")}</span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
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
  controlledAgents,
  onTakeControl,
  onReleaseControl,
}: {
  state: WorldState | null;
  activeAgentId: string | null;
  sessionId: string;
  onChat: (agentId: string, agentName: string) => void;
  onExtractAgent: (agentId: string) => void;
  onExtractWorld: () => void;
  controlledAgents?: Set<string>;
  onTakeControl?: (agentId: string) => void;
  onReleaseControl?: (agentId: string) => void;
}) {
  const { t } = useLocale();
  const [tab, setTab] = useState<Tab>("agents");
  const prevTabRef = useRef<Tab>("agents");
  const tabIndicatorRef = useRef<HTMLSpanElement>(null);
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [expandedLocation, setExpandedLocation] = useState<string | null>(null);
  const [itemCache, setItemCache] = useState<Map<string, SavedSeedData>>(new Map());
  const [generatingItem, setGeneratingItem] = useState<string | null>(null);
  const [genError, setGenError] = useState<string | null>(null);

  // Enrichment state
  const [enrichCache, setEnrichCache] = useState<Map<string, Record<string, unknown>>>(new Map());
  const [enrichingEntity, setEnrichingEntity] = useState<string | null>(null);
  const [enrichError, setEnrichError] = useState<string | null>(null);

  // Load cached item assets on mount
  useEffect(() => {
    let mounted = true;
    fetchAssets("item").then((assets) => {
      if (!mounted || !Array.isArray(assets)) return;
      const map = new Map<string, SavedSeedData>();
      assets.forEach((a) => map.set(a.name, a));
      setItemCache(map);
    }).catch(() => { /* item cache is optional — proceed without */ });
    return () => { mounted = false; };
  }, []);

  // Hydrate enrichCache from state.entity_details when state changes
  useEffect(() => {
    if (!state?.entity_details) return;
    setEnrichCache((prev) => {
      const next = new Map(prev);
      for (const [entityId, details] of Object.entries(state.entity_details!)) {
        if (!next.has(entityId)) {
          next.set(entityId, details);
        }
      }
      return next;
    });
  }, [state?.entity_details]);

  async function handleEnrich(entityType: "agent" | "item" | "location", entityId: string) {
    if (enrichingEntity) return;
    setEnrichingEntity(entityId);
    setEnrichError(null);
    try {
      const details = await enrichEntity(sessionId, entityType, entityId);
      setEnrichCache((prev) => {
        const next = new Map(prev);
        next.set(entityId, details);
        return next;
      });
    } catch {
      setEnrichError(entityId);
    } finally {
      setEnrichingEntity(null);
    }
  }

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

  const agents = useMemo(() => state?.agents ?? {}, [state?.agents]);
  const locations = useMemo(() => state?.locations ?? [], [state?.locations]);
  const allRelations = useMemo(() => state?.relations ?? [], [state?.relations]);

  // Build agent name lookup
  const agentNames = useMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    if (state?.agents) {
      Object.entries(state.agents).forEach(([id, a]) => { map[id] = a.name; });
    }
    return map;
  }, [state?.agents]);

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
      <div role="tablist" aria-label="Asset tabs" className="flex shrink-0 border-b border-b-DEFAULT bg-surface-1 relative"
        onKeyDown={(e) => {
          const keys = TABS.map((t) => t.key);
          const idx = keys.indexOf(tab);
          if (e.key === "ArrowRight") { e.preventDefault(); setTab(keys[(idx + 1) % keys.length]); }
          if (e.key === "ArrowLeft") { e.preventDefault(); setTab(keys[(idx - 1 + keys.length) % keys.length]); }
        }}
      >
        {TABS.map((t_item) => (
          <button
            type="button"
            key={t_item.key}
            role="tab"
            tabIndex={tab === t_item.key ? 0 : -1}
            aria-selected={tab === t_item.key}
            aria-controls={`tabpanel-${t_item.key}`}
            onClick={() => setTab(t_item.key)}
            className={`flex-1 px-2 py-3 text-micro tracking-wider text-center transition-colors ${
              tab === t_item.key
                ? "text-primary"
                : "text-t-muted hover:text-t-DEFAULT"
            }`}
            ref={(el) => {
              if (el && t_item.key === tab && tabIndicatorRef.current) {
                tabIndicatorRef.current.style.left = `${el.offsetLeft}px`;
                tabIndicatorRef.current.style.width = `${el.offsetWidth}px`;
              }
            }}
          >
            {t(t_item.labelKey)}
            {t_item.count > 0 && (
              <span className="ml-1 text-t-dim">{t_item.count}</span>
            )}
          </button>
        ))}
        {/* Sliding indicator */}
        <span
          ref={tabIndicatorRef}
          className="absolute bottom-0 h-px bg-primary pointer-events-none"
          style={{
            transition: "left 150ms cubic-bezier(0.16, 1, 0.3, 1), width 150ms cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        />
      </div>

      {/* Content */}
      <div key={tab} className={`flex-1 overflow-y-auto ${
        (() => { const tabs: Tab[] = ["agents", "items", "locations", "world"]; const prev = tabs.indexOf(prevTabRef.current); const cur = tabs.indexOf(tab); prevTabRef.current = tab; return cur >= prev ? "animate-[oracle-slide-right_150ms_ease-out_both]" : "animate-oracle-slide-left"; })()
      }`} role="tabpanel" id={`tabpanel-${tab}`}>
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
                  agentId={id}
                  isActive={id === activeAgentId}
                  expanded={expandedAgent === id}
                  onToggle={() => setExpandedAgent(expandedAgent === id ? null : id)}
                  onChat={() => onChat(id, agent.name)}
                  onExtract={() => onExtractAgent(id)}
                  onItemClick={(itemName) => { setTab("items"); setExpandedItem(itemName); }}
                  enrichedDetails={enrichCache.get(id) || null}
                  enriching={enrichingEntity === id}
                  enrichError={enrichError === id}
                  onEnrich={() => handleEnrich("agent", id)}
                  relations={allRelations.filter(r => r.source === id || r.target === id)}
                  agentNames={agentNames}
                  isHumanControlled={controlledAgents?.has(id)}
                  onTakeControl={() => onTakeControl?.(id)}
                  onReleaseControl={() => onReleaseControl?.(id)}
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
                  enrichedDetails={enrichCache.get(item.name) || null}
                  enriching={enrichingEntity === item.name}
                  enrichError={enrichError === item.name}
                  onEnrich={() => handleEnrich("item", item.name)}
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
                    enrichedDetails={enrichCache.get(loc.name) || null}
                    enriching={enrichingEntity === loc.name}
                    enrichError={enrichError === loc.name}
                    onEnrich={() => handleEnrich("location", loc.name)}
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
                  <div className="text-body font-semibold truncate">{state.name}</div>
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
                    type="button"
                    onClick={onExtractWorld}
                    className="w-full h-9 text-micro tracking-wider border border-b-DEFAULT text-t-muted hover:bg-surface-1/20 hover:border-primary hover:text-primary active:scale-[0.97] transition-[colors,transform]"
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
