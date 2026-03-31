"use client";

import { useState, useEffect } from "react";
import { SavedSeedData, enrichEntity, getEntityDetails, getSessions, updateAsset } from "@/lib/api";
import { useLocale } from "@/lib/locale-context";
import { TYPE_STYLES, renderSeedData } from "./SeedDataView";
import { AutoTextarea, DecodeText, ExpandableInput, StringListEditor } from "./ui";
import Modal from "./Modal";

// Entity types that support enrichment
const ENRICHABLE_TYPES = new Set(["agent", "item", "location"]);

function parseSessionWorldName(rawWorldSeed: string): string {
  try {
    const parsed = JSON.parse(rawWorldSeed);
    return parsed && typeof parsed.name === "string" ? parsed.name.trim() : "";
  } catch {
    return "";
  }
}

// Render enriched details by entity type with decode animation
function EnrichedContent({
  type,
  details,
  isNew,
}: {
  type: string;
  details: Record<string, unknown>;
  isNew: boolean;
}) {
  const { t } = useLocale();
  const Txt = ({ text }: { text: string }) =>
    isNew ? <DecodeText text={text} duration={1200} /> : <>{text}</>;

  if (type === "agent") {
    return (
      <div className="stagger-in">
        {!!details.backstory && (
          <>
            <div className="text-micro text-t-dim tracking-widest mt-1 mb-1">{"// " + t("backstory").toUpperCase()}</div>
            <div className="text-detail text-t-secondary normal-case tracking-normal leading-relaxed">
              <Txt text={details.backstory as string} />
            </div>
          </>
        )}
        {(details.notable_traits as string[])?.length > 0 && (
          <>
            <div className="text-micro text-t-dim tracking-widest mt-3 mb-1">{"// " + t("traits").toUpperCase()}</div>
            <div className="flex flex-wrap gap-1 mt-1">
              {(details.notable_traits as string[]).map((trait, i) => (
                <span key={i} className="text-detail text-t-secondary px-2 py-0.5 border border-b-DEFAULT normal-case tracking-normal">
                  {isNew ? <DecodeText text={trait} duration={600} /> : trait}
                </span>
              ))}
            </div>
          </>
        )}
        {(details.relationships as Array<{ name: string; relation: string }>)?.length > 0 && (
          <>
            <div className="text-micro text-t-dim tracking-widest mt-3 mb-1">{"// " + t("relationships").toUpperCase()}</div>
            {(details.relationships as Array<{ name: string; relation: string }>).map((rel, i) => (
              <div key={i} className="text-detail normal-case tracking-normal">
                <span className="text-t-DEFAULT">{rel.name}</span>
                <span className="text-t-dim mx-1">&mdash;</span>
                <span className="text-t-secondary">
                  {isNew ? <DecodeText text={rel.relation} duration={800} /> : rel.relation}
                </span>
              </div>
            ))}
          </>
        )}
      </div>
    );
  }

  if (type === "item") {
    return (
      <div className="stagger-in">
        {!!details.description && (
          <>
            <div className="text-micro text-t-dim tracking-widest mt-1 mb-1">{"// " + t("description").toUpperCase()}</div>
            <div className="text-detail text-t-secondary normal-case tracking-normal leading-relaxed">
              <Txt text={details.description as string} />
            </div>
          </>
        )}
        {!!details.origin && (
          <>
            <div className="text-micro text-t-dim tracking-widest mt-3 mb-1">{"// " + t("origin").toUpperCase()}</div>
            <div className="text-detail text-t-secondary normal-case tracking-normal leading-relaxed">
              <Txt text={details.origin as string} />
            </div>
          </>
        )}
        {(details.properties as string[])?.length > 0 && (
          <>
            <div className="text-micro text-t-dim tracking-widest mt-3 mb-1">{"// " + t("properties").toUpperCase()}</div>
            <div className="flex flex-wrap gap-1 mt-1">
              {(details.properties as string[]).map((prop, i) => (
                <span key={i} className="text-detail text-t-secondary px-2 py-0.5 border border-b-DEFAULT normal-case tracking-normal">
                  {isNew ? <DecodeText text={prop} duration={600} /> : prop}
                </span>
              ))}
            </div>
          </>
        )}
        {!!details.significance && (
          <>
            <div className="text-micro text-t-dim tracking-widest mt-3 mb-1">{"// " + t("significance").toUpperCase()}</div>
            <div className="text-detail text-t-secondary normal-case tracking-normal leading-relaxed">
              <Txt text={details.significance as string} />
            </div>
          </>
        )}
      </div>
    );
  }

  if (type === "location") {
    return (
      <div className="stagger-in">
        {!!details.description && (
          <>
            <div className="text-micro text-t-dim tracking-widest mt-1 mb-1">{"// " + t("description").toUpperCase()}</div>
            <div className="text-detail text-t-secondary normal-case tracking-normal leading-relaxed">
              <Txt text={details.description as string} />
            </div>
          </>
        )}
        {!!details.atmosphere && (
          <>
            <div className="text-micro text-t-dim tracking-widest mt-3 mb-1">{"// " + t("atmosphere").toUpperCase()}</div>
            <div className="text-detail text-t-secondary normal-case tracking-normal leading-relaxed">
              <Txt text={details.atmosphere as string} />
            </div>
          </>
        )}
        {(details.notable_features as string[])?.length > 0 && (
          <>
            <div className="text-micro text-t-dim tracking-widest mt-3 mb-1">{"// " + t("notable_features").toUpperCase()}</div>
            <div className="flex flex-wrap gap-1 mt-1">
              {(details.notable_features as string[]).map((feature, i) => (
                <span key={i} className="text-detail text-t-secondary px-2 py-0.5 border border-b-DEFAULT normal-case tracking-normal">
                  {isNew ? <DecodeText text={feature} duration={600} /> : feature}
                </span>
              ))}
            </div>
          </>
        )}
        {!!details.history && (
          <>
            <div className="text-micro text-t-dim tracking-widest mt-3 mb-1">{"// " + t("history").toUpperCase()}</div>
            <div className="text-detail text-t-secondary normal-case tracking-normal leading-relaxed">
              <Txt text={details.history as string} />
            </div>
          </>
        )}
      </div>
    );
  }

  return null;
}

export default function SeedDetail({
  seed,
  onClose,
  onChange,
}: {
  seed: SavedSeedData;
  onClose: () => void;
  onChange?: (seed: SavedSeedData) => void;
}) {
  const { t, locale } = useLocale();
  const style = TYPE_STYLES[seed.type] || "text-t-muted border-b-DEFAULT";
  const [enrichSessionId, setEnrichSessionId] = useState(seed.context_session_id || "");
  const [resolvingEnrichSession, setResolvingEnrichSession] = useState(false);
  const canEnrichType = ENRICHABLE_TYPES.has(seed.type);
  const canEnrich = canEnrichType && !!enrichSessionId;
  const canEdit = seed.type !== "world" && !seed.virtual;

  const [enrichedDetails, setEnrichedDetails] = useState<Record<string, unknown> | null>(null);
  const [enriching, setEnriching] = useState(false);
  const [enrichError, setEnrichError] = useState(false);
  const [isNewEnrichment, setIsNewEnrichment] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState(() => ({
    name: seed.name,
    description: seed.description || "",
    tags: seed.tags || [],
    data: JSON.parse(JSON.stringify(seed.data || {})) as Record<string, unknown>,
  }));

  useEffect(() => {
    setIsEditing(false);
    setSaveError(false);
    setEnrichSessionId(seed.context_session_id || "");
    setResolvingEnrichSession(false);
    setEnrichNoSession(false);
    setDraft({
      name: seed.name,
      description: seed.description || "",
      tags: seed.tags || [],
      data: JSON.parse(JSON.stringify(seed.data || {})) as Record<string, unknown>,
    });
  }, [seed]);

  useEffect(() => {
    if (!canEnrichType) {
      setEnrichSessionId("");
      setResolvingEnrichSession(false);
      return;
    }

    const explicitSessionId = seed.context_session_id?.trim() || "";
    if (explicitSessionId) {
      setEnrichSessionId(explicitSessionId);
      setResolvingEnrichSession(false);
      return;
    }

    const sourceWorld = seed.source_world?.trim() || "";
    if (!sourceWorld) {
      setEnrichSessionId("");
      setResolvingEnrichSession(false);
      return;
    }

    let cancelled = false;
    setResolvingEnrichSession(true);

    (async () => {
      try {
        const sessions = await getSessions();
        if (cancelled) return;

        const directSession = sessions.find((session) => session.id === sourceWorld);
        if (directSession) {
          setEnrichSessionId(directSession.id);
          setResolvingEnrichSession(false);
          return;
        }

        const worldSession = sessions.find(
          (session) => parseSessionWorldName(session.world_seed) === sourceWorld,
        );
        setEnrichSessionId(worldSession?.id || "");
      } catch {
        if (!cancelled) {
          setEnrichSessionId("");
        }
      } finally {
        if (!cancelled) {
          setResolvingEnrichSession(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [canEnrichType, seed.context_session_id, seed.source_world]);

  // Auto-load existing enrichment on mount (read-only, no LLM call)
  useEffect(() => {
    if (!canEnrich) return;
    let mounted = true;

    async function loadExisting() {
      try {
        const details = await getEntityDetails(
          enrichSessionId,
          seed.type as "agent" | "item" | "location",
          seed.name,
        );
        if (mounted && details && Object.keys(details).length > 0) {
          setEnrichedDetails(details);
        }
      } catch {
        // Silently fail — user can click to generate
      }
    }

    loadExisting();
    return () => { mounted = false; };
  }, [canEnrich, enrichSessionId, seed.type, seed.name]);

  const [enrichNoSession, setEnrichNoSession] = useState(false);

  async function handleEnrich() {
    if (enriching || !enrichSessionId) return;
    setEnriching(true);
    setEnrichError(false);
    setEnrichNoSession(false);
    try {
      const details = await enrichEntity(
        enrichSessionId,
        seed.type as "agent" | "item" | "location",
        seed.name,
        { language: locale },
      );
      setEnrichedDetails(details);
      setIsNewEnrichment(true);
    } catch (err) {
      if (err instanceof Error && err.message.includes("404")) {
        setEnrichNoSession(true);
      } else {
        setEnrichError(true);
      }
    } finally {
      setEnriching(false);
    }
  }

  function setDraftData(patch: Record<string, unknown>) {
    setDraft((prev) => ({ ...prev, data: { ...prev.data, ...patch } }));
  }

  function normalizeDraft(): {
    name: string;
    description: string;
    tags: string[];
    data: Record<string, unknown>;
  } {
    const name = draft.name.trim();
    const description = draft.description.trim();
    const tags = draft.tags.map((tag) => tag.trim()).filter(Boolean);
    const data = JSON.parse(JSON.stringify(draft.data || {})) as Record<string, unknown>;

    if (seed.type === "agent") {
      data.id = typeof data.id === "string" && data.id.trim() ? data.id.trim() : seed.data.id || seed.id;
      data.name = name;
      data.description = description;
      data.personality = typeof data.personality === "string" ? data.personality.trim() : "";
      data.location = typeof data.location === "string" ? data.location.trim() : "";
      data.goals = Array.isArray(data.goals)
        ? data.goals.map((value) => String(value).trim()).filter(Boolean)
        : [];
      data.inventory = Array.isArray(data.inventory)
        ? data.inventory.map((value) => String(value).trim()).filter(Boolean)
        : [];
    }

    if (seed.type === "item") {
      const previousNames = Array.isArray(data.previous_names)
        ? data.previous_names.map((value) => String(value).trim()).filter(Boolean)
        : [];
      const currentName =
        typeof seed.data?.name === "string" && seed.data.name.trim()
          ? seed.data.name.trim()
          : seed.name.trim();
      const mergedPreviousNames = Array.from(
        new Set(
          [currentName, seed.name.trim(), ...previousNames]
            .filter(Boolean)
            .filter((value) => value !== name),
        ),
      );

      data.name = name;
      data.description = description;
      data.origin = typeof data.origin === "string" ? data.origin.trim() : "";
      data.significance = typeof data.significance === "string" ? data.significance.trim() : "";
      data.properties = Array.isArray(data.properties)
        ? data.properties.map((value) => String(value).trim()).filter(Boolean)
        : [];
      data.previous_names = mergedPreviousNames;
    }

    if (seed.type === "location") {
      data.name = name;
      data.description = description;
    }

    if (seed.type === "event") {
      data.content = typeof data.content === "string" ? data.content.trim() : "";
      data.action_type = typeof data.action_type === "string" ? data.action_type.trim() : "";
    }

    return { name, description, tags, data };
  }

  async function handleSave() {
    if (saving) return;
    const normalized = normalizeDraft();
    if (!normalized.name) {
      setSaveError(true);
      return;
    }
    setSaving(true);
    setSaveError(false);
    try {
      const updated = await updateAsset(seed.id, {
        name: normalized.name,
        description: normalized.description,
        tags: normalized.tags,
        data: normalized.data,
      });
      onChange?.(updated);
      setIsEditing(false);
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  const inputCls = "w-full h-9 px-3 bg-void border border-b-DEFAULT text-detail text-t-DEFAULT normal-case tracking-normal focus:border-primary focus:outline-none hover:border-b-hover transition-colors";
  const textareaCls = "w-full min-h-[72px] px-3 py-2 bg-void border border-b-DEFAULT text-detail text-t-DEFAULT normal-case tracking-normal leading-relaxed resize-none focus:border-primary focus:outline-none hover:border-b-hover transition-colors";
  const fieldLabel = "text-micro text-t-muted tracking-widest mb-1.5 block";

  return (
    <Modal onClose={onClose} ariaLabel={seed.name} width="w-[560px]">
      {/* Spatial entrance wrapper */}
      <div className="flex flex-col flex-1 min-h-0 animate-[seed-detail-enter_200ms_ease-out_both]">
      {/* Header */}
      <div className="px-6 py-4 border-b border-b-DEFAULT flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <span className={`text-micro tracking-wider px-2.5 py-0.5 border leading-none font-medium shrink-0 ${style}`}>
            {seed.type}
          </span>
          <span className="text-body font-semibold truncate min-w-0">{seed.name}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-micro text-t-muted tracking-wider hover:text-t-DEFAULT transition-colors"
        >
          {t("close")}
        </button>
      </div>

      {/* Description */}
      {seed.description && !isEditing && (
        <div className="px-6 py-3 border-b border-b-DEFAULT">
          <div className="text-detail text-t-muted normal-case tracking-normal leading-relaxed">
            {seed.description}
          </div>
        </div>
      )}

      {/* Data */}
      <div className="px-6 py-4 overflow-y-auto flex-1">
        {isEditing ? (
          <div className="flex flex-col gap-4">
            <div>
              <label htmlFor="asset-name" className={fieldLabel}>{t("name")}</label>
              <ExpandableInput
                id="asset-name"
                className={inputCls}
                value={draft.name}
                onValueChange={(value) => setDraft((prev) => ({ ...prev, name: value }))}
              />
            </div>
            <div>
              <label htmlFor="asset-description" className={fieldLabel}>{t("description")}</label>
              <AutoTextarea
                id="asset-description"
                rows={3}
                className={textareaCls}
                value={draft.description}
                onChange={(e) => setDraft((prev) => ({ ...prev, description: e.target.value }))}
              />
            </div>
            <div>
              <label className={fieldLabel}>{t("tags_label")}</label>
              <StringListEditor
                idBase="asset-tags"
                values={draft.tags}
                addLabel={t("add_tag")}
                itemPlaceholder={t("tags_label")}
                addPlaceholder={t("tags_label")}
                onChange={(value) => setDraft((prev) => ({ ...prev, tags: value }))}
              />
            </div>

            {seed.type === "agent" && (
              <>
                <div>
                  <label htmlFor="asset-agent-personality" className={fieldLabel}>{t("personality")}</label>
                  <ExpandableInput
                    id="asset-agent-personality"
                    className={inputCls}
                    value={String(draft.data.personality || "")}
                    onValueChange={(value) => setDraftData({ personality: value })}
                  />
                </div>
                <div>
                  <label htmlFor="asset-agent-location" className={fieldLabel}>{t("location")}</label>
                  <ExpandableInput
                    id="asset-agent-location"
                    className={inputCls}
                    value={String(draft.data.location || "")}
                    onValueChange={(value) => setDraftData({ location: value })}
                  />
                </div>
                <div>
                  <label className={fieldLabel}>{t("goals_label")}</label>
                  <StringListEditor
                    idBase="asset-agent-goals"
                    values={Array.isArray(draft.data.goals) ? draft.data.goals.map(String) : []}
                    addLabel={t("add_goal")}
                    itemPlaceholder={t("ph_goals")}
                    addPlaceholder={t("ph_goals")}
                    onChange={(value) => setDraftData({ goals: value })}
                  />
                </div>
                <div>
                  <label className={fieldLabel}>{t("inventory_label")}</label>
                  <StringListEditor
                    idBase="asset-agent-inventory"
                    values={Array.isArray(draft.data.inventory) ? draft.data.inventory.map(String) : []}
                    addLabel={t("add_inventory_item")}
                    itemPlaceholder={t("ph_inventory")}
                    addPlaceholder={t("ph_inventory")}
                    onChange={(value) => setDraftData({ inventory: value })}
                  />
                </div>
              </>
            )}

            {seed.type === "item" && (
              <>
                <div>
                  <label htmlFor="asset-item-origin" className={fieldLabel}>{t("origin")}</label>
                  <AutoTextarea
                    id="asset-item-origin"
                    rows={3}
                    className={textareaCls}
                    value={String(draft.data.origin || "")}
                    onChange={(e) => setDraftData({ origin: e.target.value })}
                  />
                </div>
                <div>
                  <label className={fieldLabel}>{t("properties")}</label>
                  <StringListEditor
                    idBase="asset-item-properties"
                    values={Array.isArray(draft.data.properties) ? draft.data.properties.map(String) : []}
                    addLabel={t("add_property")}
                    itemPlaceholder={t("properties")}
                    addPlaceholder={t("properties")}
                    onChange={(value) => setDraftData({ properties: value })}
                  />
                </div>
                <div>
                  <label htmlFor="asset-item-significance" className={fieldLabel}>{t("significance")}</label>
                  <AutoTextarea
                    id="asset-item-significance"
                    rows={3}
                    className={textareaCls}
                    value={String(draft.data.significance || "")}
                    onChange={(e) => setDraftData({ significance: e.target.value })}
                  />
                </div>
              </>
            )}

            {seed.type === "location" && (
              <div>
                <label htmlFor="asset-location-description" className={fieldLabel}>{t("description")}</label>
                <AutoTextarea
                  id="asset-location-description"
                  rows={4}
                  className={textareaCls}
                  value={draft.description}
                  onChange={(e) => setDraft((prev) => ({ ...prev, description: e.target.value }))}
                />
              </div>
            )}

            {seed.type === "event" && (
              <>
                <div>
                  <label htmlFor="asset-event-content" className={fieldLabel}>{t("content_label")}</label>
                  <AutoTextarea
                    id="asset-event-content"
                    rows={3}
                    className={textareaCls}
                    value={String(draft.data.content || "")}
                    onChange={(e) => setDraftData({ content: e.target.value })}
                  />
                </div>
                <div>
                  <label htmlFor="asset-event-type" className={fieldLabel}>{t("action_type")}</label>
                  <ExpandableInput
                    id="asset-event-type"
                    className={inputCls}
                    value={String(draft.data.action_type || "")}
                    onValueChange={(value) => setDraftData({ action_type: value })}
                  />
                </div>
              </>
            )}

            {saveError && (
              <div className="text-micro text-danger tracking-wider">{t("save_failed")}</div>
            )}
          </div>
        ) : (
          renderSeedData(seed.type, seed.data, t)
        )}

        {/* Enrichment section */}
        {!isEditing && canEnrichType && (
          <div className="mt-4 pt-4 border-t border-b-DEFAULT">
            {enrichedDetails ? (
              <>
                <EnrichedContent
                  type={seed.type}
                  details={enrichedDetails}
                  isNew={isNewEnrichment}
                />
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={handleEnrich}
                    disabled={enriching || !canEnrich || resolvingEnrichSession}
                    className="inline-flex h-7 shrink-0 items-center justify-center whitespace-nowrap px-3 text-micro tracking-wider border border-b-DEFAULT text-t-muted hover:bg-surface-1/20 hover:border-primary hover:text-primary active:scale-[0.97] disabled:opacity-30 disabled:cursor-not-allowed transition-[colors,transform]"
                  >
                    {enriching
                      ? t("enriching")
                      : seed.type === "item"
                      ? t("optimize_item")
                      : t("generate_details")}
                  </button>
                  {enrichError && (
                    <span className="min-w-0 flex-1 text-micro text-danger tracking-wider break-words">{t("enrich_failed")}</span>
                  )}
                  {!canEnrich && !resolvingEnrichSession && (
                    <span className="min-w-0 flex-1 text-micro text-t-dim tracking-wider break-words">{t("seed_generate_requires_timeline")}</span>
                  )}
                </div>
              </>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={handleEnrich}
                  disabled={enriching || enrichNoSession || !canEnrich || resolvingEnrichSession}
                  className="inline-flex h-7 shrink-0 items-center justify-center whitespace-nowrap px-3 text-micro tracking-wider border border-b-DEFAULT text-t-muted hover:bg-surface-1/20 hover:border-primary hover:text-primary active:scale-[0.97] disabled:opacity-30 disabled:cursor-not-allowed transition-[colors,transform]"
                >
                  {resolvingEnrichSession ? t("loading") : enriching ? t("enriching") : t("enrich")}
                </button>
                {enrichError && (
                  <span className="min-w-0 flex-1 text-micro text-danger tracking-wider break-words">{t("enrich_failed")}</span>
                )}
                {enrichNoSession && (
                  <span className="min-w-0 flex-1 text-micro text-t-dim tracking-wider break-words">{t("enrich_no_session")}</span>
                )}
                {!enrichNoSession && !canEnrich && !resolvingEnrichSession && (
                  <span className="min-w-0 flex-1 text-micro text-t-dim tracking-wider break-words">{t("seed_generate_requires_timeline")}</span>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-6 py-3 border-t border-b-DEFAULT flex items-center justify-between shrink-0">
        <div className="flex min-w-0 flex-wrap items-center gap-4">
          {(seed.tags || []).length > 0 && (
            <div className="flex flex-wrap gap-1">
              {(seed.tags || []).map((tag, i) => (
                <span key={i} className="text-micro text-t-dim tracking-wider px-2.5 py-0.5 border border-surface-3 leading-none font-medium">
                  {tag}
                </span>
              ))}
            </div>
          )}
          {seed.source_world && (
            <span className="min-w-0 max-w-[240px] truncate text-micro text-t-dim tracking-wider" title={seed.source_world}>
              {t("source")}: {seed.source_world}
            </span>
          )}
          {canEdit && (
            isEditing ? (
              <>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="h-7 px-3 text-micro tracking-wider border border-primary bg-primary text-void hover:bg-transparent hover:text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-[colors,transform]"
                >
                  {saving ? t("loading") : t("save")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsEditing(false);
                    setSaveError(false);
                    setDraft({
                      name: seed.name,
                      description: seed.description || "",
                      tags: seed.tags || [],
                      data: JSON.parse(JSON.stringify(seed.data || {})) as Record<string, unknown>,
                    });
                  }}
                  disabled={saving}
                  className="h-7 px-3 text-micro tracking-wider border border-b-DEFAULT text-t-muted hover:border-primary hover:text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  {t("cancel")}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setIsEditing(true)}
                className="h-7 px-3 text-micro tracking-wider border border-b-DEFAULT text-t-muted hover:border-primary hover:text-primary transition-colors"
              >
                {t("edit_seed")}
              </button>
            )
          )}
          <button
            type="button"
            onClick={() => {
              const blob = new Blob([JSON.stringify({
                type: seed.type,
                name: seed.name,
                description: seed.description,
                tags: seed.tags,
                data: seed.data,
              }, null, 2)], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `${seed.type}-${seed.name.replace(/\s+/g, "_")}.babel.json`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            className="h-7 px-3 text-micro tracking-wider border border-b-DEFAULT text-t-muted hover:border-primary hover:text-primary active:scale-[0.97] transition-[colors,transform]"
          >
            {t("export_seed")}
          </button>
        </div>
        {!seed.virtual && (
          <span className="text-micro text-t-dim tracking-wider tabular-nums">
            {seed.id}
          </span>
        )}
      </div>
      </div>
    </Modal>
  );
}
