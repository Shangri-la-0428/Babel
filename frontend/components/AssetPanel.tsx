"use client";

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { AgentData, WorldState, SavedSeedData, RelationData, HumanWaitingContext, fetchAssets, enrichEntity, saveAsset, saveEntityDetails, updateAsset } from "@/lib/api";
import { useLocale } from "@/lib/locale-context";
import { AutoTextarea, ExpandableInput, StatusDot, StringListEditor } from "./ui";
import SeedDetail from "./SeedDetail";
import Modal from "./Modal";
import { assetMatchesContext, buildAssetsHref, buildSimHref } from "@/lib/navigation";

type Tab = "agents" | "items" | "locations" | "world";

function entityCacheKey(entityType: "agent" | "item" | "location", entityId: string): string {
  return `${entityType}:${entityId}`;
}

function normalizeItemDetails(details?: Record<string, unknown> | null) {
  return {
    description: typeof details?.description === "string" ? details.description : "",
    origin: typeof details?.origin === "string" ? details.origin : "",
    properties: Array.isArray(details?.properties) ? details.properties.map(String).filter(Boolean) : [],
    significance: typeof details?.significance === "string" ? details.significance : "",
  };
}

function hasItemNarrative(details?: Record<string, unknown> | null): boolean {
  const normalized = normalizeItemDetails(details);
  return Boolean(
    normalized.description.trim() ||
    normalized.origin.trim() ||
    normalized.properties.length > 0 ||
    normalized.significance.trim(),
  );
}

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

const HUMAN_ACTION_TYPES = [
  { key: "speak", needsTarget: true, needsContent: true, targetType: "agent" },
  { key: "move", needsTarget: true, needsContent: false, targetType: "location" },
  { key: "trade", needsTarget: true, needsContent: true, targetType: "agent" },
  { key: "use_item", needsTarget: true, needsContent: false, targetType: "item" },
  { key: "observe", needsTarget: false, needsContent: false, targetType: null },
  { key: "wait", needsTarget: false, needsContent: false, targetType: null },
] as const;

type HumanActionKey = typeof HUMAN_ACTION_TYPES[number]["key"];

function InlineHumanControl({
  agentId,
  context,
  waiting,
  onSubmit,
}: {
  agentId: string;
  context: HumanWaitingContext;
  waiting: boolean;
  onSubmit?: (agentId: string, actionType: string, target: string, content: string) => Promise<void> | void;
}) {
  const { t } = useLocale();
  const [selectedAction, setSelectedAction] = useState<HumanActionKey>("speak");
  const [target, setTarget] = useState("");
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const actionDef = useMemo(
    () => HUMAN_ACTION_TYPES.find((action) => action.key === selectedAction) || HUMAN_ACTION_TYPES[0],
    [selectedAction],
  );

  const sameLocAgents = useMemo(
    () => context.visible_agents.filter((agent) => agent.location === context.location),
    [context],
  );

  const otherLocations = useMemo(
    () => context.reachable_locations.filter((location) => location !== context.location),
    [context],
  );

  const targetOptions = useMemo(() => {
    switch (actionDef.targetType) {
      case "agent":
        return sameLocAgents.map((agent) => ({ value: agent.id, label: agent.name }));
      case "location":
        return otherLocations.map((location) => ({ value: location, label: location }));
      case "item":
        return context.inventory.map((item) => ({ value: item, label: item }));
      default:
        return [];
    }
  }, [actionDef.targetType, context.inventory, otherLocations, sameLocAgents]);

  useEffect(() => {
    if (!actionDef.needsTarget) {
      if (target) setTarget("");
      return;
    }
    if (targetOptions.some((option) => option.value === target)) return;
    setTarget(targetOptions.length === 1 ? targetOptions[0].value : "");
  }, [actionDef.needsTarget, target, targetOptions]);

  const canSubmit = waiting && Boolean(selectedAction) && (!actionDef.needsTarget || Boolean(target));

  async function handleSubmit() {
    if (!canSubmit || submitting || !onSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmit(agentId, selectedAction, target, content.trim());
      if (selectedAction === "speak" || selectedAction === "trade") {
        setContent("");
      }
    } catch {
      setSubmitError(t("human_action_failed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="border-t border-b-DEFAULT">
      <div className="flex items-center justify-between gap-3 px-4 py-2 border-b border-b-DEFAULT">
        <span className={`text-micro tracking-widest ${waiting ? "text-primary" : "text-t-dim"}`}>
          {waiting ? t("waiting_for_action") : t("manual_control_standby")}
        </span>
        <span className="text-micro text-t-dim tracking-wider shrink-0">{context.agent_name}</span>
      </div>

      <div className="grid grid-cols-2 gap-px bg-b-DEFAULT border-b border-b-DEFAULT">
        <div className="bg-void px-3 py-2 min-w-0">
          <div className="text-micro text-t-dim tracking-widest mb-0.5">{t("you_are_here")}</div>
          <div className="text-detail text-t-secondary normal-case tracking-normal truncate">
            {context.location || "\u2014"}
          </div>
        </div>
        <div className="bg-void px-3 py-2 min-w-0">
          <div className="text-micro text-t-dim tracking-widest mb-0.5">{t("your_inventory")}</div>
          <div className="text-detail text-t-secondary normal-case tracking-normal truncate">
            {context.inventory.length > 0 ? context.inventory.join(", ") : "\u2014"}
          </div>
        </div>
        <div className="bg-void px-3 py-2 min-w-0">
          <div className="text-micro text-t-dim tracking-widest mb-0.5">{t("nearby_agents")}</div>
          <div className="text-detail text-t-secondary normal-case tracking-normal truncate">
            {sameLocAgents.length > 0 ? sameLocAgents.map((agent) => agent.name).join(", ") : "\u2014"}
          </div>
        </div>
        <div className="bg-void px-3 py-2 min-w-0">
          <div className="text-micro text-t-dim tracking-widest mb-0.5">{t("reachable")}</div>
          <div className="text-detail text-t-secondary normal-case tracking-normal truncate">
            {otherLocations.length > 0 ? otherLocations.join(", ") : "\u2014"}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-px bg-b-DEFAULT border-b border-b-DEFAULT">
        {HUMAN_ACTION_TYPES.map((action) => {
          const isSelected = selectedAction === action.key;
          const isDisabled =
            (action.targetType === "agent" && sameLocAgents.length === 0) ||
            (action.targetType === "location" && otherLocations.length === 0) ||
            (action.targetType === "item" && context.inventory.length === 0);

          return (
            <button
              type="button"
              key={action.key}
              onClick={() => {
                if (isDisabled) return;
                setSelectedAction(action.key);
                setSubmitError(null);
              }}
              disabled={isDisabled}
              className={`bg-void px-3 py-2 text-micro tracking-widest transition-colors ${
                isSelected
                  ? "text-primary shadow-[inset_0_-1px_0_var(--color-primary)]"
                  : isDisabled
                  ? "text-t-dim opacity-40 cursor-not-allowed"
                  : "text-t-muted hover:text-t-DEFAULT hover:bg-surface-1"
              }`}
            >
              {t(`action_${action.key}` as Parameters<typeof t>[0])}
            </button>
          );
        })}
      </div>

      <div className="flex gap-px bg-b-DEFAULT border-b border-b-DEFAULT">
        {actionDef.needsTarget && (
          <div className="flex-1 bg-void px-3 py-2">
            <label className="text-micro text-t-dim tracking-widest mb-1 block">
              {t("action_target")}
            </label>
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              disabled={!waiting}
              className="w-full h-9 px-3 bg-void border border-b-DEFAULT text-detail text-t-DEFAULT normal-case tracking-normal focus:border-primary focus:outline-none hover:border-b-hover disabled:opacity-50 transition-colors"
            >
              <option value="">---</option>
              {targetOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {actionDef.needsContent && (
          <div className="flex-1 bg-void px-3 py-2">
            <label className="text-micro text-t-dim tracking-widest mb-1 block">
              {t("action_content")}
            </label>
            <ExpandableInput
              value={content}
              onValueChange={setContent}
              placeholder={t("manual_instruction_placeholder")}
              disabled={!waiting}
              className="w-full h-9 px-3 bg-void border border-b-DEFAULT text-detail text-t-DEFAULT normal-case tracking-normal focus:border-primary focus:outline-none hover:border-b-hover transition-colors"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && canSubmit) {
                  e.preventDefault();
                  void handleSubmit();
                }
              }}
            />
          </div>
        )}
      </div>

      <div className="px-4 py-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={!canSubmit || submitting}
          className="h-8 px-3 text-micro tracking-wider border border-primary bg-primary text-void hover:bg-transparent hover:text-primary hover:shadow-[0_0_12px_var(--color-primary-glow)] active:scale-[0.97] disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-primary disabled:hover:text-void disabled:hover:shadow-none transition-[colors,box-shadow,transform]"
        >
          {submitting ? t("submitting_action") : t("action_submit")}
        </button>
        <span className="min-w-0 flex-1 text-micro tracking-wider text-t-dim break-words">
          {submitError || (waiting ? t("manual_control_ready_hint") : t("manual_control_waiting_hint"))}
        </span>
      </div>
    </div>
  );
}

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
  manualContext,
  waitingForHuman,
  onTakeControl,
  onReleaseControl,
  onSubmitHumanAction,
  relationDeltas,
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
  manualContext?: HumanWaitingContext | null;
  waitingForHuman?: boolean;
  onTakeControl?: () => void;
  onReleaseControl?: () => void;
  onSubmitHumanAction?: (agentId: string, actionType: string, target: string, content: string) => Promise<void> | void;
  relationDeltas?: Map<string, number>;
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
                <span className={`text-micro tracking-wider px-2.5 py-0.5 border leading-none font-medium ${
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
                        className={`text-micro tracking-wider px-2.5 py-0.5 border leading-none font-medium normal-case ${
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
                <span className={`text-micro tracking-wider px-2.5 py-0.5 border leading-none font-medium ${GOAL_STATUS_COLORS[agent.active_goal.status] || GOAL_STATUS_COLORS.active}`}>
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
              {/* Strategy & next step */}
              {agent.active_goal.strategy && (
                <div className="mt-2 text-micro text-t-dim tracking-wider">
                  <span className="text-t-muted">{t("goal_strategy")}</span>{" "}
                  <span className="normal-case tracking-normal text-detail text-t-secondary">{agent.active_goal.strategy}</span>
                </div>
              )}
              {agent.active_goal.next_step && (
                <div className="mt-1 text-micro text-t-dim tracking-wider">
                  <span className="text-t-muted">{t("goal_next_step")}</span>{" "}
                  <span className="normal-case tracking-normal text-detail text-t-secondary">{agent.active_goal.next_step}</span>
                </div>
              )}
              {/* Blockers */}
              {(agent.active_goal.blockers?.length ?? 0) > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {agent.active_goal.blockers!.map((b, i) => (
                    <span key={i} className="text-micro tracking-wider px-2.5 py-0.5 border border-warning text-warning leading-none font-medium normal-case">
                      {b}
                    </span>
                  ))}
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
                    <div key={i} className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="text-detail text-t-DEFAULT normal-case tracking-normal">{otherName}</span>
                        <span className={`text-micro tracking-wider px-2.5 py-0.5 border leading-none font-medium ${colors}`}>
                          {t(`relation_${rel.type}` as Parameters<typeof t>[0])}
                        </span>
                        <div className="flex-1 h-0.5 bg-surface-3 overflow-hidden min-w-[40px]">
                          <div
                            className={`h-full ${rel.type === "hostile" ? "bg-danger" : rel.type === "rival" ? "bg-warning" : "bg-primary"}`}
                            style={{ width: `${Math.round(rel.strength * 100)}%` }}
                          />
                        </div>
                        <span className="text-micro text-t-dim tabular-nums shrink-0">{Math.round(rel.strength * 100)}%</span>
                        {(() => {
                          const d = relationDeltas?.get(`${rel.source}→${rel.target}`);
                          if (!d) return null;
                          return (
                            <span className={`text-micro tabular-nums shrink-0 ${d > 0 ? "text-primary" : "text-danger"}`}>
                              {d > 0 ? "+" : ""}{Math.round(d * 100)}
                            </span>
                          );
                        })()}
                      </div>
                      {/* Trust / Tension sub-metrics */}
                      {(rel.trust != null || rel.tension != null) && (
                        <div className="flex items-center gap-3 ml-0 pl-0">
                          {rel.trust != null && (
                            <div className="flex items-center gap-1">
                              <span className="text-micro text-t-dim tracking-wider">{t("rel_trust")}</span>
                              <div className="w-12 h-0.5 bg-surface-3 overflow-hidden">
                                <div className="h-full bg-info" style={{ width: `${Math.round(rel.trust * 100)}%` }} />
                              </div>
                              <span className="text-micro text-t-dim tabular-nums">{Math.round(rel.trust * 100)}</span>
                            </div>
                          )}
                          {rel.tension != null && rel.tension > 0 && (
                            <div className="flex items-center gap-1">
                              <span className="text-micro text-t-dim tracking-wider">{t("rel_tension")}</span>
                              <div className="w-12 h-0.5 bg-surface-3 overflow-hidden">
                                <div className="h-full bg-danger" style={{ width: `${Math.round(rel.tension * 100)}%` }} />
                              </div>
                              <span className="text-micro text-t-dim tabular-nums">{Math.round(rel.tension * 100)}</span>
                            </div>
                          )}
                        </div>
                      )}
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
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={onEnrich}
                  disabled={enriching}
                  className="inline-flex h-7 shrink-0 items-center justify-center whitespace-nowrap px-3 text-micro tracking-wider font-medium border border-b-DEFAULT text-t-muted hover:border-primary hover:text-primary active:scale-[0.97] disabled:opacity-30 disabled:cursor-not-allowed transition-[colors,transform]"
                >
                  {enriching ? t("enriching") : t("enrich")}
                </button>
                {enrichError && (
                  <span className="min-w-0 flex-1 text-micro text-danger tracking-wider break-words">{t("enrich_failed")}</span>
                )}
              </div>
            )}
          </div>

          {/* Actions */}
          {!isDead && (
            <div className="flex items-center gap-2 px-4 py-2">
              <button
                type="button"
                onClick={isHumanControlled ? onReleaseControl : onTakeControl}
                className={`h-8 px-3 text-micro tracking-wider border active:scale-[0.97] transition-[colors,transform] ${
                  isHumanControlled
                    ? "border-primary text-primary hover:bg-primary hover:text-void animate-[event-flash_600ms_ease]"
                    : "border-b-DEFAULT text-t-muted hover:bg-surface-1/20 hover:border-primary hover:text-primary"
                }`}
              >
                <span className="transition-all duration-150">
                  {t(isHumanControlled ? "release_control" : "take_control")}
                </span>
              </button>
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
          {isHumanControlled && manualContext && (
            <InlineHumanControl
              agentId={agentId}
              context={manualContext}
              waiting={Boolean(waitingForHuman)}
              onSubmit={onSubmitHumanAction}
            />
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

function WorldItemDetailModal({
  itemName,
  holders,
  initialDetails,
  saving,
  errorMessage,
  onClose,
  onSave,
}: {
  itemName: string;
  holders: { agentId: string; agentName: string }[];
  initialDetails: Record<string, unknown> | null;
  saving: boolean;
  errorMessage?: string | null;
  onClose: () => void;
  onSave: (details: Record<string, unknown>) => Promise<void> | void;
}) {
  const { t } = useLocale();
  const [draft, setDraft] = useState(() => normalizeItemDetails(initialDetails));

  useEffect(() => {
    setDraft(normalizeItemDetails(initialDetails));
  }, [initialDetails]);

  return (
    <Modal onClose={onClose} ariaLabel={itemName} width="w-[560px]">
      <div className="flex flex-col flex-1 min-h-0 animate-[seed-detail-enter_200ms_ease-out_both]">
        <div className="px-6 py-4 border-b border-b-DEFAULT flex items-center justify-between shrink-0">
          <div className="min-w-0">
            <div className="text-micro text-warning tracking-widest mb-1">{t("world_item_details")}</div>
            <div className="text-body font-semibold truncate">{itemName}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-micro text-t-muted tracking-wider hover:text-t-DEFAULT transition-colors"
          >
            {t("close")}
          </button>
        </div>

        <div className="px-6 py-3 border-b border-b-DEFAULT text-detail text-t-dim normal-case tracking-normal">
          {t("world_item_local_only")}
        </div>

        <div className="px-6 py-4 overflow-y-auto flex-1 flex flex-col gap-4">
          <div>
            <div className="text-micro text-t-muted tracking-widest mb-1.5">{t("panel_held_by")}</div>
            {holders.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {holders.map((holder) => (
                  <span key={holder.agentId} className="text-micro text-info tracking-wider px-2.5 py-0.5 border border-info leading-none font-medium">
                    {holder.agentName}
                  </span>
                ))}
              </div>
            ) : (
              <div className="text-detail text-t-dim normal-case tracking-normal">{t("world_item_unassigned")}</div>
            )}
          </div>
          <div>
            <label htmlFor="world-item-description" className="text-micro text-t-muted tracking-widest mb-1.5 block">{t("description")}</label>
            <AutoTextarea
              id="world-item-description"
              rows={4}
              className="w-full min-h-[88px] px-3 py-2 bg-void border border-b-DEFAULT text-detail text-t-DEFAULT normal-case tracking-normal leading-relaxed resize-none focus:border-primary focus:outline-none hover:border-b-hover transition-colors"
              value={draft.description}
              onChange={(e) => setDraft((prev) => ({ ...prev, description: e.target.value }))}
            />
          </div>
          <div>
            <label htmlFor="world-item-origin" className="text-micro text-t-muted tracking-widest mb-1.5 block">{t("origin")}</label>
            <AutoTextarea
              id="world-item-origin"
              rows={4}
              className="w-full min-h-[88px] px-3 py-2 bg-void border border-b-DEFAULT text-detail text-t-DEFAULT normal-case tracking-normal leading-relaxed resize-none focus:border-primary focus:outline-none hover:border-b-hover transition-colors"
              value={draft.origin}
              onChange={(e) => setDraft((prev) => ({ ...prev, origin: e.target.value }))}
            />
          </div>
          <div>
            <label className="text-micro text-t-muted tracking-widest mb-1.5 block">{t("properties")}</label>
            <StringListEditor
              idBase={`world-item-properties-${itemName}`}
              values={draft.properties}
              addLabel={t("add_property")}
              itemPlaceholder={t("ph_item_property")}
              addPlaceholder={t("ph_item_property")}
              onChange={(value) => setDraft((prev) => ({ ...prev, properties: value }))}
            />
          </div>
          <div>
            <label htmlFor="world-item-significance" className="text-micro text-t-muted tracking-widest mb-1.5 block">{t("significance")}</label>
            <AutoTextarea
              id="world-item-significance"
              rows={4}
              className="w-full min-h-[88px] px-3 py-2 bg-void border border-b-DEFAULT text-detail text-t-DEFAULT normal-case tracking-normal leading-relaxed resize-none focus:border-primary focus:outline-none hover:border-b-hover transition-colors"
              value={draft.significance}
              onChange={(e) => setDraft((prev) => ({ ...prev, significance: e.target.value }))}
            />
          </div>
        </div>

        <div className="px-6 py-3 border-t border-b-DEFAULT flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => void onSave(draft)}
            disabled={saving}
            className="h-8 px-4 text-micro tracking-wider border border-primary bg-primary text-void hover:bg-transparent hover:text-primary active:scale-[0.97] disabled:opacity-30 disabled:cursor-not-allowed transition-[colors,transform]"
          >
            {saving ? t("saving") : t("save_world_item_details")}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="h-8 px-4 text-micro tracking-wider border border-b-DEFAULT text-t-muted hover:border-primary hover:text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            {t("cancel")}
          </button>
          {errorMessage && (
            <span className="min-w-0 flex-1 text-micro text-danger tracking-wider break-words">
              {errorMessage}
            </span>
          )}
        </div>
      </div>
    </Modal>
  );
}

function ItemRow({
  item,
  expanded,
  onToggle,
  exportedSeed,
  localDetails,
  onGenerateDetails,
  onEditDetails,
  onExportSeed,
  onEditExportedSeed,
  exporting,
  generating,
  errorMessage,
}: {
  item: ItemInfo;
  expanded: boolean;
  onToggle: () => void;
  exportedSeed: SavedSeedData | null;
  localDetails: Record<string, unknown> | null;
  onGenerateDetails: () => void;
  onEditDetails: () => void;
  onExportSeed: () => void;
  onEditExportedSeed: () => void;
  exporting: boolean;
  generating: boolean;
  errorMessage?: string | null;
}) {
  const { t } = useLocale();
  const localItemDetails = normalizeItemDetails(localDetails);
  const assetDetails = normalizeItemDetails(exportedSeed?.data || null);
  const hasLocalNarrative = hasItemNarrative(localDetails);
  const hasExportedNarrative = Boolean(
    assetDetails.description || assetDetails.origin || assetDetails.properties.length > 0 || assetDetails.significance,
  );

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
          {/* World-local details */}
          <div className="px-4 py-2 border-b border-b-DEFAULT">
            <div className="text-micro text-t-muted tracking-widest mb-1">{t("world_item_details")}</div>
            {hasLocalNarrative ? (
              <>
                {localItemDetails.description && (
                  <div className="text-detail text-t-secondary normal-case tracking-normal leading-relaxed">
                    {localItemDetails.description}
                  </div>
                )}
                {localItemDetails.origin && (
                  <>
                    <div className="text-micro text-t-dim tracking-widest mt-3 mb-1">{"// " + t("origin").toUpperCase()}</div>
                    <div className="text-detail text-t-secondary normal-case tracking-normal leading-relaxed">
                      {localItemDetails.origin}
                    </div>
                  </>
                )}
                {localItemDetails.properties.length > 0 && (
                  <>
                    <div className="text-micro text-t-dim tracking-widest mt-3 mb-1">{"// " + t("properties").toUpperCase()}</div>
                    <div className="flex flex-wrap gap-1">
                      {localItemDetails.properties.map((property, index) => (
                        <span key={index} className="text-detail text-t-secondary px-2 py-0.5 border border-b-DEFAULT normal-case tracking-normal">
                          {property}
                        </span>
                      ))}
                    </div>
                  </>
                )}
                {localItemDetails.significance && (
                  <>
                    <div className="text-micro text-t-dim tracking-widest mt-3 mb-1">{"// " + t("significance").toUpperCase()}</div>
                    <div className="text-detail text-t-secondary normal-case tracking-normal leading-relaxed">
                      {localItemDetails.significance}
                    </div>
                  </>
                )}
              </>
            ) : (
              <div className="text-detail text-t-dim normal-case tracking-normal">{t("world_item_empty")}</div>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={onEditDetails}
                className="inline-flex h-7 shrink-0 items-center justify-center whitespace-nowrap px-3 text-micro tracking-wider font-medium border border-b-DEFAULT text-t-muted hover:border-primary hover:text-primary active:scale-[0.97] disabled:opacity-30 disabled:cursor-not-allowed transition-[colors,transform]"
              >
                {t("edit_item_details")}
              </button>
              <button
                type="button"
                onClick={onGenerateDetails}
                disabled={generating}
                className="inline-flex h-7 shrink-0 items-center justify-center whitespace-nowrap px-3 text-micro tracking-wider font-medium border border-b-DEFAULT text-t-muted hover:border-primary hover:text-primary active:scale-[0.97] disabled:opacity-30 disabled:cursor-not-allowed transition-[colors,transform]"
              >
                {generating ? t("generating") : hasLocalNarrative ? t("optimize_item") : t("generate_details")}
              </button>
              {errorMessage && (
                <span className="min-w-0 flex-1 text-micro text-danger tracking-wider break-words">{errorMessage}</span>
              )}
            </div>
          </div>
          {/* Exported asset seed */}
          <div className="px-4 py-2 border-b border-b-DEFAULT">
            <div className="text-micro text-t-muted tracking-widest mb-1">{t("asset_seed_label")}</div>
            {exportedSeed ? (
              <>
                {assetDetails.description && (
                  <>
                    <div className="text-micro text-t-dim tracking-widest mt-1 mb-1">{"// DESCRIPTION"}</div>
                    <div className="text-detail text-t-secondary normal-case tracking-normal leading-relaxed">
                      {assetDetails.description}
                    </div>
                  </>
                )}
                {assetDetails.origin && (
                  <>
                    <div className="text-micro text-t-dim tracking-widest mt-3 mb-1">{"// ORIGIN"}</div>
                    <div className="text-detail text-t-secondary normal-case tracking-normal leading-relaxed">
                      {assetDetails.origin}
                    </div>
                  </>
                )}
                {assetDetails.properties.length > 0 && (
                  <>
                    <div className="text-micro text-t-dim tracking-widest mt-3 mb-1">{"// PROPERTIES"}</div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {assetDetails.properties.map((prop, i) => (
                        <span key={i} className="text-detail text-t-secondary px-2 py-0.5 border border-b-DEFAULT normal-case tracking-normal">
                          {prop}
                        </span>
                      ))}
                    </div>
                  </>
                )}
                {assetDetails.significance && (
                  <>
                    <div className="text-micro text-t-dim tracking-widest mt-3 mb-1">{"// SIGNIFICANCE"}</div>
                    <div className="text-detail text-t-secondary normal-case tracking-normal leading-relaxed">
                      {assetDetails.significance}
                    </div>
                  </>
                )}
                {!hasExportedNarrative && (
                  <div className="text-micro text-t-dim tracking-wider">{t("world_item_exported_sparse")}</div>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <span className="text-micro text-primary tracking-wider">{t("world_item_exported")}</span>
                  <button
                    type="button"
                    onClick={onEditExportedSeed}
                    className="inline-flex h-7 shrink-0 items-center justify-center whitespace-nowrap px-3 text-micro tracking-wider font-medium border border-b-DEFAULT text-t-muted hover:border-primary hover:text-primary active:scale-[0.97] disabled:opacity-30 disabled:cursor-not-allowed transition-[colors,transform]"
                  >
                    {t("edit_exported_seed")}
                  </button>
                  <button
                    type="button"
                    onClick={onExportSeed}
                    disabled={exporting}
                    className="inline-flex h-7 shrink-0 items-center justify-center whitespace-nowrap px-3 text-micro tracking-wider font-medium border border-b-DEFAULT text-t-muted hover:border-primary hover:text-primary active:scale-[0.97] disabled:opacity-30 disabled:cursor-not-allowed transition-[colors,transform]"
                  >
                    {exporting ? t("saving") : t("export_seed_update")}
                  </button>
                </div>
              </>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={onExportSeed}
                  disabled={exporting}
                  className="inline-flex h-7 shrink-0 items-center justify-center whitespace-nowrap px-3 text-micro tracking-wider font-medium border border-b-DEFAULT text-t-muted hover:border-primary hover:text-primary active:scale-[0.97] disabled:opacity-30 disabled:cursor-not-allowed transition-[colors,transform]"
                >
                  {exporting ? t("saving") : t("export_to_seed_library")}
                </button>
                <span className="min-w-0 flex-1 text-micro text-t-dim tracking-wider break-words">{t("world_item_not_exported")}</span>
              </div>
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
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={onEnrich}
                  disabled={enriching}
                  className="inline-flex h-7 shrink-0 items-center justify-center whitespace-nowrap px-3 text-micro tracking-wider font-medium border border-b-DEFAULT text-t-muted hover:border-primary hover:text-primary active:scale-[0.97] disabled:opacity-30 disabled:cursor-not-allowed transition-[colors,transform]"
                >
                  {enriching ? t("enriching") : t("enrich")}
                </button>
                {enrichError && (
                  <span className="min-w-0 flex-1 text-micro text-danger tracking-wider break-words">{t("enrich_failed")}</span>
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
  seedFile,
  onChat,
  onExtractAgent,
  onExtractWorld,
  controlledAgents,
  waitingAgents,
  onTakeControl,
  onReleaseControl,
  onSubmitHumanAction,
  relationDeltas,
}: {
  state: WorldState | null;
  activeAgentId: string | null;
  sessionId: string;
  seedFile?: string;
  onChat: (agentId: string, agentName: string) => void;
  onExtractAgent: (agentId: string) => void;
  onExtractWorld: () => void;
  controlledAgents?: Set<string>;
  waitingAgents?: Record<string, HumanWaitingContext>;
  onTakeControl?: (agentId: string) => void;
  onReleaseControl?: (agentId: string) => void;
  onSubmitHumanAction?: (agentId: string, actionType: string, target: string, content: string) => Promise<void> | void;
  relationDeltas?: Map<string, number>;
}) {
  const { t, locale } = useLocale();
  const worldName = state?.name || "";
  const [tab, setTab] = useState<Tab>("agents");
  const prevTabRef = useRef<Tab>("agents");
  const tabIndicatorRef = useRef<HTMLSpanElement>(null);
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [expandedLocation, setExpandedLocation] = useState<string | null>(null);
  const [itemCache, setItemCache] = useState<Map<string, SavedSeedData>>(new Map());
  const [exportingItem, setExportingItem] = useState<string | null>(null);
  const [itemActionError, setItemActionError] = useState<{ itemName: string; messageKey: string } | null>(null);
  const [editingItemDetail, setEditingItemDetail] = useState<{ itemName: string; holders: { agentId: string; agentName: string }[]; details: Record<string, unknown> | null } | null>(null);
  const [savingItemDetail, setSavingItemDetail] = useState(false);
  const [itemDetailErrorKey, setItemDetailErrorKey] = useState<string | null>(null);
  const [editingItemSeed, setEditingItemSeed] = useState<{ itemName: string; seed: SavedSeedData } | null>(null);

  // Enrichment state
  const [enrichCache, setEnrichCache] = useState<Map<string, Record<string, unknown>>>(new Map());
  const [enrichingEntity, setEnrichingEntity] = useState<string | null>(null);
  const [enrichError, setEnrichError] = useState<string | null>(null);

  useEffect(() => {
    const waitingIds = Object.keys(waitingAgents || {});
    if (waitingIds.length === 0) return;
    setTab("agents");
    setExpandedAgent((prev) => (prev && waitingIds.includes(prev) ? prev : waitingIds[0]));
  }, [waitingAgents]);

  const getItemSeedKey = useCallback((asset: SavedSeedData): string => {
    const seedName = typeof asset.data?.name === "string" ? asset.data.name.trim() : "";
    return seedName || asset.name;
  }, []);

  const getItemSeedKeys = useCallback((asset: SavedSeedData): string[] => {
    const previousNames = Array.isArray(asset.data?.previous_names)
      ? asset.data.previous_names.map((value) => String(value).trim()).filter(Boolean)
      : [];
    return Array.from(new Set([getItemSeedKey(asset), asset.name.trim(), ...previousNames].filter(Boolean)));
  }, [getItemSeedKey]);

  const getSeedScopeRank = useCallback((asset: SavedSeedData): number => {
    if (asset.source_world === sessionId) return 2;
    if (worldName && asset.source_world === worldName) return 1;
    return 0;
  }, [sessionId, worldName]);

  // Load cached item assets on mount
  useEffect(() => {
    let mounted = true;
    fetchAssets("item").then((assets) => {
      if (!mounted || !Array.isArray(assets)) return;
      const map = new Map<string, SavedSeedData>();
      assets
        .filter((asset) => assetMatchesContext(asset, { sessionId, worldName }))
        .forEach((asset) => {
          getItemSeedKeys(asset).forEach((key) => {
            const existing = map.get(key);
            if (!existing || getSeedScopeRank(asset) >= getSeedScopeRank(existing)) {
              map.set(key, asset);
            }
          });
        });
      setItemCache(map);
    }).catch(() => { /* item cache is optional — proceed without */ });
    return () => { mounted = false; };
  }, [sessionId, worldName, getItemSeedKeys, getSeedScopeRank]);

  // Hydrate enrichCache from state.entity_details when state changes
  useEffect(() => {
    if (!state?.entity_details) return;
    setEnrichCache((prev) => {
      const next = new Map(prev);
      const rawDetails = state.entity_details as unknown;
      if (Array.isArray(rawDetails)) {
        rawDetails.forEach((row) => {
          if (!row || typeof row !== "object") return;
          const entry = row as { entity_type?: unknown; entity_id?: unknown; details?: unknown };
          if (typeof entry.entity_type !== "string" || typeof entry.entity_id !== "string") return;
          const cacheKey = entityCacheKey(entry.entity_type as "agent" | "item" | "location", entry.entity_id);
          if (!next.has(cacheKey) && entry.details && typeof entry.details === "object") {
            next.set(cacheKey, entry.details as Record<string, unknown>);
          }
        });
        return next;
      }
      for (const [cacheKey, details] of Object.entries(state.entity_details!)) {
        if (!next.has(cacheKey) && details && typeof details === "object") {
          next.set(cacheKey, details);
        }
      }
      return next;
    });
  }, [state?.entity_details]);

  async function handleEnrich(entityType: "agent" | "item" | "location", entityId: string) {
    if (enrichingEntity) return;
    const cacheKey = entityCacheKey(entityType, entityId);
    setEnrichingEntity(cacheKey);
    setEnrichError(null);
    if (entityType === "item") {
      setItemActionError(null);
    }
    try {
      const details = await enrichEntity(sessionId, entityType, entityId, { language: locale });
      setEnrichCache((prev) => {
        const next = new Map(prev);
        next.set(cacheKey, details);
        return next;
      });
    } catch {
      if (entityType === "item") {
        setItemActionError({ itemName: entityId, messageKey: "gen_item_failed" });
      } else {
        setEnrichError(cacheKey);
      }
    } finally {
      setEnrichingEntity(null);
    }
  }

  async function handleExportItemSeed(item: ItemInfo) {
    if (exportingItem) return;
    setExportingItem(item.name);
    setItemActionError(null);
    const details = normalizeItemDetails(enrichCache.get(entityCacheKey("item", item.name)) || null);
    const payload = {
      type: "item" as const,
      name: item.name,
      description: details.description,
      tags: [],
      data: {
        name: item.name,
        description: details.description,
        origin: details.origin,
        properties: details.properties,
        significance: details.significance,
        holders: item.holders.map((holder) => holder.agentName),
      },
      source_world: worldName || sessionId,
    };

    try {
      const existingSeed = itemCache.get(item.name) || null;
      let nextSeed: SavedSeedData;
      if (existingSeed) {
        nextSeed = await updateAsset(existingSeed.id, payload);
      } else {
        const saved = await saveAsset(payload);
        nextSeed = {
          id: saved.id,
          type: "item",
          name: item.name,
          description: details.description,
          tags: [],
          data: payload.data,
          source_world: worldName || sessionId,
          created_at: "",
        };
      }
      setItemCache((prev) => {
        const next = new Map(prev);
        getItemSeedKeys(nextSeed).forEach((key) => next.set(key, nextSeed));
        return next;
      });
    } catch {
      setItemActionError({ itemName: item.name, messageKey: "export_item_seed_failed" });
    } finally {
      setExportingItem(null);
    }
  }

  async function handleSaveItemDetail(itemName: string, details: Record<string, unknown>) {
    if (savingItemDetail) return;
    setSavingItemDetail(true);
    setItemDetailErrorKey(null);
    setItemActionError(null);
    try {
      const savedDetails = await saveEntityDetails(sessionId, "item", itemName, details);
      setEnrichCache((prev) => {
        const next = new Map(prev);
        next.set(entityCacheKey("item", itemName), savedDetails);
        return next;
      });
      setEditingItemDetail(null);
    } catch {
      setItemDetailErrorKey("save_world_item_details_failed");
    } finally {
      setSavingItemDetail(false);
    }
  }

  function handleItemSeedUpdated(itemName: string, updatedSeed: SavedSeedData) {
    setItemCache((prev) => {
      const next = new Map(prev);
      next.delete(itemName);
      getItemSeedKeys(updatedSeed).forEach((key) => next.set(key, updatedSeed));
      next.set(itemName, updatedSeed);
      return next;
    });
    setEditingItemSeed((prev) => (prev?.itemName === itemName ? { itemName, seed: updatedSeed } : prev));
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

  const manualContextByAgent = useMemo<Record<string, HumanWaitingContext>>(() => {
    const contexts: Record<string, HumanWaitingContext> = {};
    Object.entries(agents).forEach(([agentId, agent]) => {
      contexts[agentId] = waitingAgents?.[agentId] || {
        agent_name: agent.name,
        location: agent.location,
        inventory: agent.inventory || [],
        visible_agents: Object.entries(agents)
          .filter(([otherId, otherAgent]) => otherId !== agentId && otherAgent.location === agent.location)
          .map(([otherId, otherAgent]) => ({
            id: otherId,
            name: otherAgent.name,
            location: otherAgent.location,
          })),
        reachable_locations: locations.map((location) => location.name),
      };
    });
    return contexts;
  }, [agents, locations, waitingAgents]);

  // Aggregate items from agent inventories + world seed items
  const items = useMemo<ItemInfo[]>(() => {
    const map = new Map<string, ItemInfo>();
    // Items held by agents
    Object.entries(agents).forEach(([agentId, agent]) => {
      (agent.inventory || []).forEach((itemName) => {
        if (!map.has(itemName)) {
          map.set(itemName, { name: itemName, holders: [] });
        }
        map.get(itemName)!.holders.push({ agentId, agentName: agent.name });
      });
    });
    // World-level items (from seed) not yet held by anyone
    (state?.items || []).forEach((item) => {
      if (!map.has(item.name)) {
        map.set(item.name, { name: item.name, holders: [] });
      }
    });
    return Array.from(map.values());
  }, [agents, state?.items]);

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
                  enrichedDetails={enrichCache.get(entityCacheKey("agent", id)) || null}
                  enriching={enrichingEntity === entityCacheKey("agent", id)}
                  enrichError={enrichError === entityCacheKey("agent", id)}
                  onEnrich={() => handleEnrich("agent", id)}
                  relations={allRelations.filter(r => r.source === id || r.target === id)}
                  agentNames={agentNames}
                  isHumanControlled={controlledAgents?.has(id)}
                  manualContext={manualContextByAgent[id] || null}
                  waitingForHuman={Boolean(waitingAgents?.[id])}
                  onTakeControl={() => onTakeControl?.(id)}
                  onReleaseControl={() => onReleaseControl?.(id)}
                  onSubmitHumanAction={onSubmitHumanAction}
                  relationDeltas={relationDeltas}
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
                  exportedSeed={itemCache.get(item.name) || null}
                  localDetails={enrichCache.get(entityCacheKey("item", item.name)) || null}
                  onGenerateDetails={() => handleEnrich("item", item.name)}
                  onEditDetails={() => {
                    setItemDetailErrorKey(null);
                    setEditingItemDetail({
                      itemName: item.name,
                      holders: item.holders,
                      details: enrichCache.get(entityCacheKey("item", item.name)) || null,
                    });
                  }}
                  onExportSeed={() => handleExportItemSeed(item)}
                  onEditExportedSeed={() => {
                    const seed = itemCache.get(item.name);
                    if (seed) setEditingItemSeed({ itemName: item.name, seed });
                  }}
                  exporting={exportingItem === item.name}
                  generating={enrichingEntity === entityCacheKey("item", item.name)}
                  errorMessage={
                    itemActionError?.itemName === item.name
                      ? t(itemActionError.messageKey as Parameters<typeof t>[0])
                      : null
                  }
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
                    enrichedDetails={enrichCache.get(entityCacheKey("location", loc.name)) || null}
                    enriching={enrichingEntity === entityCacheKey("location", loc.name)}
                    enrichError={enrichError === entityCacheKey("location", loc.name)}
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
        href={buildAssetsHref({
          sessionId,
          worldName,
          seedFile,
          backHref: buildSimHref({ sessionId, seedFile }),
        })}
        className="px-4 py-3 border-t border-b-DEFAULT bg-surface-1 text-micro text-t-muted tracking-wider hover:text-primary transition-colors text-center shrink-0"
      >
        {t("view_all_assets")}
      </a>

      {editingItemSeed && (
        <SeedDetail
          seed={editingItemSeed.seed}
          onClose={() => setEditingItemSeed(null)}
          onChange={(updatedSeed) => handleItemSeedUpdated(editingItemSeed.itemName, updatedSeed)}
        />
      )}

      {editingItemDetail && (
        <WorldItemDetailModal
          itemName={editingItemDetail.itemName}
          holders={editingItemDetail.holders}
          initialDetails={editingItemDetail.details}
          saving={savingItemDetail}
          errorMessage={itemDetailErrorKey ? t(itemDetailErrorKey as Parameters<typeof t>[0]) : null}
          onClose={() => setEditingItemDetail(null)}
          onSave={(details) => handleSaveItemDetail(editingItemDetail.itemName, details)}
        />
      )}
    </aside>
  );
}
