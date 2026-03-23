"use client";

import { AgentData } from "@/lib/api";
import { useLocale } from "@/lib/locale-context";
import { StatusDot, Badge } from "./ui";

export default function AgentCard({
  agentId,
  agent,
  isActive,
  onClick,
}: {
  agentId: string;
  agent: AgentData;
  isActive?: boolean;
  onClick?: () => void;
}) {
  const { t } = useLocale();

  const isDead = agent.status === "dead";
  const borderCls = isActive
    ? "border-primary shadow-[0_0_0_1px_var(--color-primary)]"
    : isDead
    ? "border-danger opacity-40"
    : "border-b-DEFAULT hover:border-b-hover";

  const statusVariant = isActive ? "text-primary border-primary" : isDead ? "text-danger border-danger" : "text-t-muted border-b-DEFAULT";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`bg-surface-1 border p-4 flex flex-col gap-3 transition-colors text-left w-full cursor-pointer ${borderCls}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between w-full gap-2">
        <div className="min-w-0">
          <div className="text-body font-semibold flex items-center gap-2">
            <StatusDot status={agent.status} />
            <span className="truncate">{agent.name}</span>
          </div>
          <div className="text-micro text-t-dim tracking-wider">{agentId}</div>
        </div>
        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 text-micro font-medium tracking-wider border leading-none ${statusVariant}`}>
          {agent.status}
        </span>
      </div>

      {/* Description */}
      {agent.description && (
        <div className="text-detail text-t-muted normal-case tracking-normal leading-relaxed">
          {agent.description}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-px bg-b-DEFAULT w-full">
        <div className="bg-surface-2 p-2 px-3">
          <div className="text-micro text-t-muted tracking-widest">{t("location")}</div>
          <div className="text-detail mt-1 truncate">{agent.location || "—"}</div>
        </div>
        <div className="bg-surface-2 p-2 px-3">
          <div className="text-micro text-t-muted tracking-widest">{t("goal")}</div>
          <div className="text-detail mt-1 truncate">{agent.goals[0] || "—"}</div>
        </div>
      </div>

      {/* Inventory */}
      {agent.inventory.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {agent.inventory.map((item, i) => (
            <Badge key={i}>{item}</Badge>
          ))}
        </div>
      )}
    </button>
  );
}
