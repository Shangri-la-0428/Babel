"use client";

import { AgentData } from "@/lib/api";

function StatusDot({ status }: { status: string }) {
  const cls =
    status === "acting"
      ? "bg-primary shadow-[0_0_8px_var(--color-primary-glow-strong)]"
      : status === "dead"
      ? "bg-danger shadow-[0_0_8px_theme(colors.danger.dim)]"
      : "bg-t-dim";
  return <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${cls}`} />;
}

function Badge({
  children,
  variant = "muted",
}: {
  children: React.ReactNode;
  variant?: "primary" | "danger" | "muted";
}) {
  const styles = {
    primary: "text-primary border-primary",
    danger: "text-danger border-danger",
    muted: "text-t-muted border-b-DEFAULT",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-[2px] text-micro font-medium tracking-wider border leading-none ${styles[variant]}`}
    >
      {children}
    </span>
  );
}

export default function AgentCard({
  agentId,
  agent,
  isActive,
}: {
  agentId: string;
  agent: AgentData;
  isActive?: boolean;
}) {
  const isDead = agent.status === "dead";
  const borderCls = isActive
    ? "border-primary shadow-[0_0_0_1px_var(--color-primary)]"
    : isDead
    ? "border-danger opacity-40"
    : "border-b-DEFAULT hover:border-b-hover";

  return (
    <div className={`bg-surface-1 border p-4 flex flex-col gap-3 transition-colors ${borderCls}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-body font-semibold flex items-center gap-2">
            <StatusDot status={agent.status} />
            {agent.name}
          </div>
          <div className="text-micro text-t-dim tracking-wider">{agentId}</div>
        </div>
        <Badge variant={isActive ? "primary" : isDead ? "danger" : "muted"}>
          {agent.status}
        </Badge>
      </div>

      {/* Description */}
      {agent.description && (
        <div className="text-detail text-t-muted normal-case tracking-normal leading-relaxed">
          {agent.description}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-px bg-b-DEFAULT">
        <div className="bg-surface-2 p-2 px-3">
          <div className="text-micro text-t-muted tracking-widest">Location</div>
          <div className="text-detail mt-1">{agent.location || "—"}</div>
        </div>
        <div className="bg-surface-2 p-2 px-3">
          <div className="text-micro text-t-muted tracking-widest">Goal</div>
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
    </div>
  );
}
