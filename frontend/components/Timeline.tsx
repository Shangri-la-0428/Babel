"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import { getSessionEvents, deleteSession, EventData } from "@/lib/api";
import { useLocale } from "@/lib/locale-context";
import Modal from "./Modal";

export interface BranchData {
  id: string;
  tick: number;
  status: string;
  created_at: string;
}

interface TimelineProps {
  branches: BranchData[];
  onSelect: (sessionId: string) => void;
  onNew: () => void;
  onDeleted?: (sessionId: string) => void;
}

/* ── layout ── */
const ORIGIN_X = 56;
const FORK_W = 48;
const BRANCH_H = 56;
const PAD_TOP = 32;
const PAD_BOTTOM = 20;
const LABEL_W = 240;
const NODE_R = 3;
const HEAD_R = 5;
const ORIGIN_R = 6;
const MIN_PX_TICK = 5;
const MAX_PX_TICK = 14;

export default function Timeline({ branches, onSelect, onNew, onDeleted }: TimelineProps) {
  const { t } = useLocale();
  const containerRef = useRef<HTMLDivElement>(null);
  const [cw, setCw] = useState(800);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [latestEvents, setLatestEvents] = useState<Record<string, string>>({});
  const [branchEvents, setBranchEvents] = useState<Record<string, EventData[]>>({});
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const prefersReducedMotion = typeof window !== "undefined"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const sorted = useMemo(
    () =>
      [...(branches || [])].sort((a, b) => {
        const aa = a.status !== "ended" ? 1 : 0;
        const ba = b.status !== "ended" ? 1 : 0;
        if (aa !== ba) return ba - aa;
        return b.tick - a.tick;
      }),
    [branches]
  );

  /* Measure container */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([e]) => setCw(e.contentRect.width));
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  /* Fetch latest event per branch */
  const fetchedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    let mounted = true;
    sorted.forEach(async (b) => {
      if (fetchedRef.current.has(b.id)) return;
      fetchedRef.current.add(b.id);
      try {
        const evts = await getSessionEvents(b.id, 1);
        if (mounted) setLatestEvents((p) => ({ ...p, [b.id]: evts.length > 0 ? evts[0].result : "" }));
      } catch { /* network error — skip */ }
    });
    return () => { mounted = false; };
  }, [sorted]);

  /* Fetch more events when branch is expanded */
  useEffect(() => {
    if (!expanded || branchEvents[expanded]) return;
    let mounted = true;
    (async () => {
      try {
        const evts = await getSessionEvents(expanded, 8);
        if (mounted) setBranchEvents((p) => ({ ...p, [expanded]: evts }));
      } catch { /* network error — skip */ }
    })();
    return () => { mounted = false; };
  }, [expanded]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Delete handler */
  async function handleDelete(id: string) {
    setDeleting(true);
    try {
      await deleteSession(id);
      setConfirmDelete(null);
      setExpanded(null);
      onDeleted?.(id);
    } catch { /* ignore */ }
    setDeleting(false);
  }

  /* Geometry */
  const maxTick = Math.max(...sorted.map((s) => s.tick), 1);
  const available = cw - ORIGIN_X - FORK_W - LABEL_W;
  const pxTick = Math.max(MIN_PX_TICK, Math.min(MAX_PX_TICK, available / maxTick));
  const svgW = Math.max(cw, ORIGIN_X + FORK_W + maxTick * pxTick + LABEL_W);
  const rows = Math.max(sorted.length, 1);
  const svgH = PAD_TOP + rows * BRANCH_H + PAD_BOTTOM;
  const originY = PAD_TOP + (rows * BRANCH_H) / 2;

  function branchY(i: number) {
    const totalH = sorted.length * BRANCH_H;
    return originY - totalH / 2 + BRANCH_H / 2 + i * BRANCH_H;
  }
  function tickX(tick: number) {
    return ORIGIN_X + FORK_W + tick * pxTick;
  }
  function tickNodes(tick: number) {
    const interval = tick > 80 ? 20 : tick > 40 ? 10 : 5;
    const out: number[] = [];
    for (let t = interval; t < tick; t += interval) out.push(t);
    return out;
  }

  const C_PRIMARY = "var(--color-primary, #C0FE04)";
  const C_DIM = "var(--color-surface-4, #252525)";
  const C_MUTED = "var(--color-t-muted, #888)";
  const C_DIMTEXT = "var(--color-t-dim, #555)";

  const expandedBranch = expanded ? sorted.find((b) => b.id === expanded) : null;

  return (
    <div className="border-t border-b border-b-DEFAULT bg-surface-1">
      {/* Header */}
      <div className="px-6 py-3 flex items-center justify-between">
        <span className="text-micro text-t-muted tracking-widest">{t("timeline")}</span>
        <button
          onClick={onNew}
          className="text-micro text-t-muted tracking-wider hover:text-primary transition-colors"
        >
          + {t("new_branch")}
        </button>
      </div>

      {/* SVG + detail panel */}
      <div ref={containerRef} className="overflow-x-auto overflow-y-hidden px-2">
        {sorted.length === 0 ? (
          <div className="px-6 py-10 flex flex-col items-center gap-2">
            <div className="text-micro text-t-dim tracking-widest">{"// NO BRANCHES"}</div>
            <div className="text-detail text-t-muted normal-case tracking-normal">
              {t("timeline_empty")}
            </div>
          </div>
        ) : (
          <svg width={svgW} height={svgH} className="select-none" style={{ minWidth: "100%" }}
            role="img" aria-label={t("timeline")}>
            {/* Tick axis */}
            {(() => {
              const axisY = svgH - PAD_BOTTOM + 4;
              const interval = maxTick > 80 ? 20 : maxTick > 40 ? 10 : 5;
              const marks: JSX.Element[] = [];
              for (let tk = 0; tk <= maxTick; tk += interval) {
                const x = tickX(tk);
                marks.push(
                  <g key={`ax-${tk}`}>
                    <line x1={x} y1={axisY} x2={x} y2={axisY + 4} stroke={C_DIM} strokeWidth={1} />
                    <text x={x} y={axisY + 14} textAnchor="middle" fill={C_DIMTEXT}
                      style={{ fontSize: 9, fontFamily: "var(--font-mono, monospace)" }}>{tk}</text>
                  </g>
                );
              }
              marks.push(
                <line key="ax-line" x1={tickX(0)} y1={axisY} x2={tickX(maxTick)} y2={axisY} stroke={C_DIM} strokeWidth={1} />
              );
              return marks;
            })()}

            {/* Origin */}
            <circle cx={ORIGIN_X} cy={originY} r={ORIGIN_R} fill={C_PRIMARY} />
            <text x={ORIGIN_X} y={originY - ORIGIN_R - 8} textAnchor="middle" fill={C_MUTED}
              style={{ fontSize: 10, fontFamily: "var(--font-mono, monospace)", letterSpacing: "0.1em" }}>SEED</text>

            {/* Branches */}
            {sorted.map((branch, i) => {
              const by = branchY(i);
              const headX = tickX(branch.tick);
              const startX = ORIGIN_X + FORK_W;
              const active = branch.status !== "ended";
              const isExpanded = expanded === branch.id;
              const color = active ? C_PRIMARY : C_DIM;
              const textColor = active ? C_PRIMARY : C_MUTED;
              const sw = isExpanded ? 3 : 2;
              const nodes = tickNodes(branch.tick);
              const evtText = latestEvents[branch.id] || "";
              const fork = `M ${ORIGIN_X} ${originY} C ${ORIGIN_X + FORK_W * 0.65} ${originY}, ${ORIGIN_X + FORK_W * 0.35} ${by}, ${startX} ${by}`;

              return (
                <g
                  key={branch.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`${branch.id.slice(0, 8)} T:${branch.tick} ${active ? t("branch_active") : t("branch_ended")}`}
                  aria-expanded={isExpanded}
                  className="cursor-pointer"
                  onClick={() => setExpanded(isExpanded ? null : branch.id)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpanded(isExpanded ? null : branch.id); } }}
                  opacity={isExpanded ? 1 : expanded ? 0.4 : 0.8}
                  style={{ transition: "opacity 0.15s", outline: "none" }}
                >
                  <path d={fork} fill="none" stroke={color} strokeWidth={sw} />
                  <line x1={startX} y1={by} x2={headX} y2={by} stroke={color} strokeWidth={sw} />
                  {/* Energy flow overlay for active branches */}
                  {active && !prefersReducedMotion && (
                    <>
                      <path d={fork} fill="none" stroke={C_PRIMARY} strokeWidth={1}
                        strokeDasharray="4 8" opacity={0.4}>
                        <animate attributeName="stroke-dashoffset" from="0" to="-12" dur="0.8s" repeatCount="indefinite" />
                      </path>
                      <line x1={startX} y1={by} x2={headX} y2={by}
                        stroke={C_PRIMARY} strokeWidth={1}
                        strokeDasharray="4 8" opacity={0.4}>
                        <animate attributeName="stroke-dashoffset" from="0" to="-12" dur="0.8s" repeatCount="indefinite" />
                      </line>
                    </>
                  )}
                  {nodes.map((tn) => (
                    <circle key={tn} cx={tickX(tn)} cy={by} r={NODE_R} fill={color} />
                  ))}
                  <circle cx={headX} cy={by} r={HEAD_R} fill={color} />

                  {active && !prefersReducedMotion && (
                    <circle cx={headX} cy={by} r={HEAD_R + 5} fill="none" stroke={color} strokeWidth={1} opacity={0.25}>
                      <animate attributeName="r" values={`${HEAD_R + 3};${HEAD_R + 8};${HEAD_R + 3}`} dur="2s" repeatCount="indefinite" />
                      <animate attributeName="opacity" values="0.3;0.08;0.3" dur="2s" repeatCount="indefinite" />
                    </circle>
                  )}

                  {/* Label */}
                  <text x={headX + 16} y={by - 5} fill={textColor}
                    style={{ fontSize: 10, fontFamily: "var(--font-mono, monospace)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                    T:{String(branch.tick).padStart(3, "0")}
                    {" \u00B7 "}{branch.id.slice(0, 8)}
                    {" \u00B7 "}{active ? t("branch_active") : t("branch_ended")}
                  </text>
                  {evtText && (
                    <text x={headX + 16} y={by + 12} fill={C_DIMTEXT}
                      style={{ fontSize: 11, fontFamily: "var(--font-mono, monospace)", letterSpacing: "0.02em" }}
                      textLength={Math.min(evtText.length * 7, LABEL_W - 16)} lengthAdjust="spacing">
                      {evtText.length > 36 ? evtText.slice(0, 36) + "\u2026" : evtText}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        )}
      </div>

      {/* Expanded branch detail panel */}
      {expandedBranch && (
        <div className="border-t border-b-DEFAULT bg-void px-6 py-4 animate-[fade-in_0.15s_ease]">
          <div className="max-w-3xl flex flex-col gap-3">
            {/* Header row */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className={`w-2 h-2 ${expandedBranch.status !== "ended" ? "bg-primary" : "bg-surface-4"}`} />
                <span className="text-body font-semibold">
                  {expandedBranch.id.slice(0, 8)}
                </span>
                <span className="text-micro text-t-dim tracking-wider">
                  T:{String(expandedBranch.tick).padStart(3, "0")}
                </span>
                <span className={`text-micro tracking-wider ${expandedBranch.status !== "ended" ? "text-primary" : "text-t-dim"}`}>
                  {expandedBranch.status !== "ended" ? t("branch_active") : t("branch_ended")}
                </span>
                <span className="text-micro text-t-dim tracking-wider normal-case">
                  {t("branch_created")} {new Date(expandedBranch.created_at).toLocaleDateString()}
                </span>
              </div>
              <button onClick={() => setExpanded(null)} className="text-micro text-t-dim hover:text-t-DEFAULT transition-colors">
                {t("close")}
              </button>
            </div>

            {/* Recent events */}
            <div className="flex flex-col gap-px bg-b-DEFAULT">
              {!branchEvents[expandedBranch.id] ? (
                <div className="bg-surface-1 px-4 py-3 text-detail text-t-dim normal-case tracking-normal animate-[blink_1s_step-end_infinite]">
                  {t("loading")}
                </div>
              ) : branchEvents[expandedBranch.id].length === 0 ? (
                <div className="bg-surface-1 px-4 py-3 text-detail text-t-dim normal-case tracking-normal">
                  {t("branch_no_events")}
                </div>
              ) : (
                branchEvents[expandedBranch.id].map((evt) => (
                  <div key={evt.id} className="bg-surface-1 px-4 py-2 flex items-baseline gap-3 min-w-0">
                    <span className="text-micro text-t-dim tracking-wider shrink-0">T:{String(evt.tick).padStart(3, "0")}</span>
                    {evt.agent_name && (
                      <span className="text-micro text-info tracking-wider shrink-0">{evt.agent_name}</span>
                    )}
                    <span className="text-detail text-t-secondary normal-case tracking-normal flex-1 truncate">{evt.result}</span>
                    <span className="text-micro text-t-dim tracking-wider shrink-0">{evt.action_type}</span>
                  </div>
                ))
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3 pt-1">
              <button
                onClick={() => onSelect(expandedBranch.id)}
                className="h-9 px-5 text-micro font-medium tracking-wider bg-primary text-void border border-primary hover:bg-transparent hover:text-primary active:scale-[0.97] transition-[colors,transform]"
              >
                {expandedBranch.status !== "ended" ? t("resume") : t("world_review")} &rarr;
              </button>
              <button
                onClick={() => setConfirmDelete(expandedBranch.id)}
                className="h-9 px-4 text-micro tracking-wider text-danger hover:text-danger/80 transition-colors"
              >
                {t("branch_delete")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {confirmDelete && (
        <Modal onClose={() => !deleting && setConfirmDelete(null)} ariaLabel={t("branch_delete")} width="max-w-md">
          <div className="p-6">
            <p className="text-body text-t-DEFAULT normal-case tracking-normal mb-6">
              {t("branch_delete_confirm")}
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={() => handleDelete(confirmDelete)}
                disabled={deleting}
                className="h-9 px-5 text-micro font-medium tracking-wider bg-danger text-void border border-danger hover:bg-transparent hover:text-danger disabled:opacity-30 transition-colors"
              >
                {deleting ? t("loading") : t("delete")}
              </button>
              <button
                onClick={() => setConfirmDelete(null)}
                disabled={deleting}
                className="h-9 px-4 text-micro tracking-wider text-t-muted hover:text-t-DEFAULT transition-colors"
              >
                {t("cancel")}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
