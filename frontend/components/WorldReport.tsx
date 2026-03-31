"use client";

import { useEffect, useState, useCallback } from "react";
import { WorldReport as WorldReportData, getWorldReport } from "@/lib/api";
import { useLocale } from "@/lib/locale-context";
import { Badge, SectionLabel, StatusDot } from "./ui";

interface WorldReportProps {
  sessionId: string;
  open: boolean;
  onClose: () => void;
}

// ── Axis bar — horizontal significance bar ───────────

function AxisBar({ label, count, max }: { label: string; count: number; max: number }) {
  const pct = max > 0 ? (count / max) * 100 : 0;
  return (
    <div className="flex items-center gap-3 h-7">
      <span className="text-micro tracking-wider text-t-muted w-24 text-right shrink-0">
        {label.toUpperCase()}
      </span>
      <div className="flex-1 h-1.5 bg-surface-2 relative">
        <div
          className="absolute inset-y-0 left-0 bg-primary transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-micro tabular-nums text-t-secondary w-8 text-right">{count}</span>
    </div>
  );
}

// ── Stat cell — single readout ───────────────────────

function Stat({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div className="flex flex-col gap-1 px-4 py-3 bg-void">
      <span className="text-micro text-t-dim tracking-widest">{label}</span>
      <span className={`text-heading font-bold tabular-nums ${accent ? "text-primary" : "text-t-DEFAULT"}`}>
        {value}
      </span>
    </div>
  );
}

// ── Milestone row ────────────────────────────────────

function MilestoneRow({ event }: { event: WorldReportData["milestones"][0] }) {
  return (
    <div className="flex gap-3 px-4 py-2.5 bg-void border-l-2 border-primary">
      <span className="text-micro tabular-nums text-primary shrink-0 w-12 text-right">
        T{String(event.tick).padStart(3, "0")}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-detail text-t-DEFAULT leading-relaxed truncate">{event.result}</p>
        {event.reasons.length > 0 && (
          <p className="text-micro text-t-dim mt-0.5 truncate">
            {event.reasons[0]}
          </p>
        )}
      </div>
      <Badge variant="primary">{event.primary_axis.toUpperCase()}</Badge>
    </div>
  );
}

// ── Agent arc card ───────────────────────────────────

function AgentArcCard({ arc, t }: { arc: WorldReportData["agent_arcs"][0]; t: ReturnType<typeof useLocale>["t"] }) {
  return (
    <div className="flex flex-col gap-px bg-b-DEFAULT border border-b-DEFAULT">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-void">
        <div className="flex items-center gap-2">
          <StatusDot status={arc.alive ? "idle" : "dead"} />
          <span className="text-detail font-medium text-t-DEFAULT">{arc.name}</span>
        </div>
        <div className="flex items-center gap-2">
          {arc.goal_status === "stalled" && <Badge variant="warning">{t("report_stalled")}</Badge>}
          {!arc.alive && <Badge variant="danger">{t("report_dead")}</Badge>}
          <span className="text-micro text-t-dim">{arc.location}</span>
        </div>
      </div>

      {/* Personality */}
      <div className="px-4 py-2 bg-void">
        <p className="text-detail text-t-secondary leading-relaxed line-clamp-2">
          {arc.personality}
        </p>
      </div>

      {/* Goal + progress */}
      {arc.goal_text && (
        <div className="px-4 py-2 bg-void">
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <span className="text-micro text-t-muted tracking-widest">{t("report_goal")}</span>
            <span className="text-micro tabular-nums text-primary">
              {Math.round(arc.goal_progress * 100)}%
            </span>
          </div>
          <p className="text-detail text-t-DEFAULT mb-1.5">{arc.goal_text}</p>
          <div className="h-1 bg-surface-2">
            <div
              className="h-full bg-primary transition-[width] duration-500"
              style={{ width: `${arc.goal_progress * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Key events */}
      {arc.key_events.length > 0 && (
        <div className="px-4 py-2 bg-void">
          <SectionLabel className="mb-1.5">
            {t("report_key_events")} ({arc.event_count})
          </SectionLabel>
          <div className="flex flex-col gap-1">
            {arc.key_events.map((ev, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="text-micro tabular-nums text-t-dim shrink-0 w-8 text-right">
                  T{ev.tick}
                </span>
                <p className="text-detail text-t-secondary leading-snug truncate">
                  {ev.result}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Relation row ─────────────────────────────────────

function RelationRow({ rel }: { rel: WorldReportData["relation_arcs"][0] }) {
  const typeColor = rel.type === "hostile" || rel.type === "rival"
    ? "text-danger" : rel.type === "ally" || rel.type === "trust"
    ? "text-primary" : "text-t-muted";

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-void">
      <span className="text-detail text-t-DEFAULT w-28 truncate text-right shrink-0">
        {rel.source_name}
      </span>
      <span className={`text-micro tracking-wider font-medium w-16 text-center ${typeColor}`}>
        {rel.type.toUpperCase()}
      </span>
      <span className="text-detail text-t-DEFAULT w-28 truncate shrink-0">
        {rel.target_name}
      </span>
      <div className="flex-1" />
      <div className="flex items-center gap-3 text-micro tabular-nums">
        <span className="text-t-dim">
          T<span className="text-primary">{rel.trust.toFixed(2)}</span>
        </span>
        <span className="text-t-dim">
          X<span className="text-danger">{rel.tension.toFixed(2)}</span>
        </span>
        <span className="text-t-dim">
          S<span className="text-t-secondary">{rel.strength.toFixed(2)}</span>
        </span>
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────

export default function WorldReport({ sessionId, open, onClose }: WorldReportProps) {
  const [report, setReport] = useState<WorldReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const { t } = useLocale();

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const data = await getWorldReport(sessionId);
      setReport(data);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    if (open) void fetchReport();
  }, [open, fetchReport]);

  // Escape key to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  // Sorted axes by count (descending)
  const sortedAxes = report
    ? Object.entries(report.axis_distribution).sort((a, b) => b[1] - a[1])
    : [];
  const maxAxisCount = sortedAxes.length > 0 ? sortedAxes[0][1] : 1;

  // Sorted actions by count
  const sortedActions = report
    ? Object.entries(report.action_distribution).sort((a, b) => b[1] - a[1])
    : [];
  const maxActionCount = sortedActions.length > 0 ? sortedActions[0][1] : 1;

  return (
    <div className="fixed inset-0 z-50 bg-void/95 flex flex-col animate-[fade-in_300ms_ease_both]">
      {/* Header */}
      <header className="flex items-center justify-between h-14 px-6 border-b border-b-DEFAULT shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-micro tracking-[0.2em] text-primary font-medium">
            {t("report_title")}
          </span>
          {report && (
            <>
              <span className="text-t-dim">|</span>
              <span className="text-detail text-t-DEFAULT">{report.name}</span>
              <span className="text-t-dim">|</span>
              <span className="text-micro tabular-nums text-t-muted">
                TICK {String(report.tick).padStart(3, "0")}
              </span>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="h-9 px-4 text-micro font-medium tracking-wider border border-b-DEFAULT text-t-muted hover:border-primary hover:text-primary active:scale-[0.97] transition-[colors,transform]"
        >
          {t("report_close")}
        </button>
      </header>

      {/* Loading / Error states */}
      {loading && (
        <div className="flex-1 flex items-center justify-center">
          <span className="text-micro tracking-widest text-t-dim animate-pulse">
            {t("report_loading")}
          </span>
        </div>
      )}

      {error && (
        <div className="flex-1 flex items-center justify-center">
          <span className="text-micro tracking-widest text-danger">
            {t("report_error")}
          </span>
        </div>
      )}

      {/* Report content */}
      {report && !loading && (
        <div className="flex-1 overflow-y-auto px-6 py-6">
          <div className="max-w-[1100px] mx-auto flex flex-col gap-8 stagger-in">

            {/* ── Overview stats ── */}
            <section>
              <SectionLabel className="mb-3">{t("report_overview")}</SectionLabel>
              <div className="grid grid-cols-4 gap-px bg-b-DEFAULT border border-b-DEFAULT sm:grid-cols-7">
                <Stat label={t("tick")} value={report.tick} accent />
                <Stat label={t("report_alive")} value={report.agents_alive} />
                <Stat label={t("report_dead")} value={report.agents_dead} />
                <Stat label={t("report_total_events")} value={report.total_events} />
                <Stat label={t("report_significant")} value={report.significant_events} accent />
                <Stat label={t("report_durable")} value={report.durable_events} accent />
                <Stat label={t("report_sig_ratio")} value={`${(report.significance_ratio * 100).toFixed(1)}%`} />
              </div>
              {report.description && (
                <p className="text-detail text-t-secondary mt-3 leading-relaxed max-w-prose">
                  {report.description}
                </p>
              )}
            </section>

            {/* ── Milestones ── */}
            {report.milestones.length > 0 && (
              <section>
                <SectionLabel className="mb-3">
                  {t("report_milestones")} ({report.milestones.length})
                </SectionLabel>
                <div className="flex flex-col gap-px bg-b-DEFAULT border border-b-DEFAULT">
                  {report.milestones.map((m, i) => (
                    <MilestoneRow key={i} event={m} />
                  ))}
                </div>
              </section>
            )}

            {/* ── Agent Arcs ── */}
            <section>
              <SectionLabel className="mb-3">
                {t("report_agent_arcs")} ({report.agent_arcs.length})
              </SectionLabel>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {report.agent_arcs.map((arc) => (
                  <AgentArcCard key={arc.agent_id} arc={arc} t={t} />
                ))}
              </div>
            </section>

            {/* ── Social Dynamics ── */}
            {report.relation_arcs.length > 0 && (
              <section>
                <SectionLabel className="mb-3">{t("report_social")}</SectionLabel>

                {/* Highlights */}
                <div className="grid grid-cols-2 gap-4 mb-4">
                  {/* Alliances */}
                  <div className="border border-b-DEFAULT">
                    <div className="px-4 py-2 bg-surface-1 border-b border-b-DEFAULT">
                      <span className="text-micro tracking-widest text-primary font-medium">
                        {t("report_alliances")}
                      </span>
                    </div>
                    <div className="flex flex-col gap-px bg-b-DEFAULT">
                      {report.social_highlights.alliances.length === 0 && (
                        <div className="px-4 py-2 bg-void text-micro text-t-dim">
                          {t("report_none")}
                        </div>
                      )}
                      {report.social_highlights.alliances.map((a, i) => (
                        <div key={i} className="flex items-center justify-between px-4 py-2 bg-void">
                          <span className="text-detail text-t-DEFAULT">{a.pair}</span>
                          <span className="text-micro tabular-nums text-primary">{a.trust.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Rivalries */}
                  <div className="border border-b-DEFAULT">
                    <div className="px-4 py-2 bg-surface-1 border-b border-b-DEFAULT">
                      <span className="text-micro tracking-widest text-danger font-medium">
                        {t("report_rivalries")}
                      </span>
                    </div>
                    <div className="flex flex-col gap-px bg-b-DEFAULT">
                      {report.social_highlights.rivalries.length === 0 && (
                        <div className="px-4 py-2 bg-void text-micro text-t-dim">
                          {t("report_none")}
                        </div>
                      )}
                      {report.social_highlights.rivalries.map((r, i) => (
                        <div key={i} className="flex items-center justify-between px-4 py-2 bg-void">
                          <span className="text-detail text-t-DEFAULT">{r.pair}</span>
                          <span className="text-micro tabular-nums text-danger">{r.tension.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Full relation table */}
                <div className="flex flex-col gap-px bg-b-DEFAULT border border-b-DEFAULT">
                  {report.relation_arcs.map((rel, i) => (
                    <RelationRow key={i} rel={rel} />
                  ))}
                </div>
              </section>
            )}

            {/* ── Significance Axes + Action Distribution ── */}
            <div className="grid grid-cols-2 gap-4">
              {/* Axes */}
              <section>
                <SectionLabel className="mb-3">{t("report_axis")}</SectionLabel>
                <div className="border border-b-DEFAULT px-4 py-3 bg-void flex flex-col gap-1">
                  {sortedAxes.map(([axis, count]) => (
                    <AxisBar key={axis} label={axis} count={count} max={maxAxisCount} />
                  ))}
                  {sortedAxes.length === 0 && (
                    <span className="text-micro text-t-dim">{t("report_none")}</span>
                  )}
                </div>
              </section>

              {/* Actions */}
              <section>
                <SectionLabel className="mb-3">{t("report_actions")}</SectionLabel>
                <div className="border border-b-DEFAULT px-4 py-3 bg-void flex flex-col gap-1">
                  {sortedActions.map(([action, count]) => (
                    <AxisBar key={action} label={action} count={count} max={maxActionCount} />
                  ))}
                </div>
              </section>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
