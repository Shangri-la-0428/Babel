"use client";

import { useState, useEffect } from "react";
import { SavedSeedData, enrichEntity, getEntityDetails } from "@/lib/api";
import { useLocale } from "@/lib/locale-context";
import { TYPE_STYLES, renderSeedData } from "./SeedDataView";
import { DecodeText } from "./ui";
import Modal from "./Modal";

// Entity types that support enrichment
const ENRICHABLE_TYPES = new Set(["agent", "item", "location"]);

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
      <>
        {details.backstory && (
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
      </>
    );
  }

  if (type === "item") {
    return (
      <>
        {details.description && (
          <>
            <div className="text-micro text-t-dim tracking-widest mt-1 mb-1">{"// " + t("description").toUpperCase()}</div>
            <div className="text-detail text-t-secondary normal-case tracking-normal leading-relaxed">
              <Txt text={details.description as string} />
            </div>
          </>
        )}
        {details.origin && (
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
        {details.significance && (
          <>
            <div className="text-micro text-t-dim tracking-widest mt-3 mb-1">{"// " + t("significance").toUpperCase()}</div>
            <div className="text-detail text-t-secondary normal-case tracking-normal leading-relaxed">
              <Txt text={details.significance as string} />
            </div>
          </>
        )}
      </>
    );
  }

  if (type === "location") {
    return (
      <>
        {details.description && (
          <>
            <div className="text-micro text-t-dim tracking-widest mt-1 mb-1">{"// " + t("description").toUpperCase()}</div>
            <div className="text-detail text-t-secondary normal-case tracking-normal leading-relaxed">
              <Txt text={details.description as string} />
            </div>
          </>
        )}
        {details.atmosphere && (
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
        {details.history && (
          <>
            <div className="text-micro text-t-dim tracking-widest mt-3 mb-1">{"// " + t("history").toUpperCase()}</div>
            <div className="text-detail text-t-secondary normal-case tracking-normal leading-relaxed">
              <Txt text={details.history as string} />
            </div>
          </>
        )}
      </>
    );
  }

  return null;
}

export default function SeedDetail({
  seed,
  onClose,
}: {
  seed: SavedSeedData;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const style = TYPE_STYLES[seed.type] || "text-t-muted border-b-DEFAULT";
  const canEnrich = ENRICHABLE_TYPES.has(seed.type) && !!seed.source_world;

  const [enrichedDetails, setEnrichedDetails] = useState<Record<string, unknown> | null>(null);
  const [enriching, setEnriching] = useState(false);
  const [enrichError, setEnrichError] = useState(false);
  const [isNewEnrichment, setIsNewEnrichment] = useState(false);

  // Auto-load existing enrichment on mount (read-only, no LLM call)
  useEffect(() => {
    if (!canEnrich) return;
    let mounted = true;

    async function loadExisting() {
      try {
        const details = await getEntityDetails(
          seed.source_world!,
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
  }, [canEnrich, seed.source_world, seed.type, seed.name]);

  const [enrichNoSession, setEnrichNoSession] = useState(false);

  async function handleEnrich() {
    if (enriching || !seed.source_world) return;
    setEnriching(true);
    setEnrichError(false);
    setEnrichNoSession(false);
    try {
      const details = await enrichEntity(
        seed.source_world,
        seed.type as "agent" | "item" | "location",
        seed.name,
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

  return (
    <Modal onClose={onClose} ariaLabel={seed.name} width="w-[560px]">
      {/* Header */}
      <div className="px-6 py-4 border-b border-b-DEFAULT flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <span className={`text-micro tracking-wider px-2.5 py-0.5 border leading-none font-medium ${style}`}>
            {seed.type}
          </span>
          <span className="text-body font-semibold">{seed.name}</span>
        </div>
        <button
          onClick={onClose}
          className="text-micro text-t-muted tracking-wider hover:text-t-DEFAULT transition-colors"
        >
          {t("close")}
        </button>
      </div>

      {/* Description */}
      {seed.description && (
        <div className="px-6 py-3 border-b border-b-DEFAULT">
          <div className="text-detail text-t-muted normal-case tracking-normal leading-relaxed">
            {seed.description}
          </div>
        </div>
      )}

      {/* Data */}
      <div className="px-6 py-4 overflow-y-auto flex-1">
        {renderSeedData(seed.type, seed.data, t)}

        {/* Enrichment section */}
        {canEnrich && (
          <div className="mt-4 pt-4 border-t border-b-DEFAULT">
            {enrichedDetails ? (
              <EnrichedContent
                type={seed.type}
                details={enrichedDetails}
                isNew={isNewEnrichment}
              />
            ) : (
              <div className="flex items-center gap-3">
                <button
                  onClick={handleEnrich}
                  disabled={enriching || enrichNoSession}
                  className="h-7 px-3 text-micro tracking-wider border border-b-DEFAULT text-t-muted hover:border-primary hover:text-primary active:scale-[0.97] disabled:opacity-30 transition-[colors,transform]"
                >
                  {enriching ? t("enriching") : t("enrich")}
                </button>
                {enrichError && (
                  <span className="text-micro text-danger tracking-wider">{t("enrich_failed")}</span>
                )}
                {enrichNoSession && (
                  <span className="text-micro text-t-dim tracking-wider">{t("enrich_no_session")}</span>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-6 py-3 border-t border-b-DEFAULT flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          {(seed.tags || []).length > 0 && (
            <div className="flex flex-wrap gap-1">
              {(seed.tags || []).map((tag, i) => (
                <span key={i} className="text-micro text-t-dim tracking-wider px-2 py-0.5 border border-surface-3">
                  {tag}
                </span>
              ))}
            </div>
          )}
          {seed.source_world && (
            <span className="text-micro text-t-dim tracking-wider">
              {t("source")}: {seed.source_world.slice(0, 8)}
            </span>
          )}
        </div>
        <span className="text-micro text-t-dim tracking-wider tabular-nums">
          {seed.id}
        </span>
      </div>
    </Modal>
  );
}
