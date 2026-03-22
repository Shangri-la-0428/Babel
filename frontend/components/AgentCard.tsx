"use client";

import { useState } from "react";
import { AgentData, extractSeed } from "@/lib/api";
import { useLocale } from "@/lib/locale-context";

function StatusDot({ status }: { status: string }) {
  const cls =
    status === "acting"
      ? "bg-primary shadow-[0_0_8px_var(--color-primary-glow-strong)]"
      : status === "dead"
      ? "bg-danger shadow-[0_0_8px_theme(colors.danger.dim)]"
      : "bg-t-dim";
  return <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${cls}`} />;
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-[2px] text-micro font-medium tracking-wider border leading-none text-t-muted border-b-DEFAULT">
      {children}
    </span>
  );
}

export default function AgentCard({
  agentId,
  agent,
  isActive,
  sessionId,
  onChat,
}: {
  agentId: string;
  agent: AgentData;
  isActive?: boolean;
  sessionId?: string;
  onChat?: () => void;
}) {
  const [extractState, setExtractState] = useState<"idle" | "saving" | "saved">("idle");
  const { t } = useLocale();

  async function handleExtract() {
    if (!sessionId || extractState !== "idle") return;
    setExtractState("saving");
    try {
      await extractSeed("agent", sessionId, agentId);
      setExtractState("saved");
      setTimeout(() => setExtractState("idle"), 2000);
    } catch {
      setExtractState("idle");
    }
  }

  const isDead = agent.status === "dead";
  const borderCls = isActive
    ? "border-primary shadow-[0_0_0_1px_var(--color-primary)]"
    : isDead
    ? "border-danger opacity-40"
    : "border-b-DEFAULT hover:border-b-hover";

  const statusVariant = isActive ? "text-primary border-primary" : isDead ? "text-danger border-danger" : "text-t-muted border-b-DEFAULT";

  return (
    <div className={`bg-surface-1 border p-4 flex flex-col gap-3 transition-colors group ${borderCls}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-body font-semibold flex items-center gap-2">
            <StatusDot status={agent.status} />
            {agent.name}
          </div>
          <div className="text-micro text-t-dim tracking-wider">{agentId}</div>
        </div>
        <div className="flex items-center gap-2">
          {sessionId && (
            <button
              onClick={handleExtract}
              disabled={extractState !== "idle"}
              className={`text-micro tracking-wider transition-colors ${
                extractState === "saved"
                  ? "text-primary"
                  : "text-t-dim opacity-0 group-hover:opacity-100 hover:text-info"
              }`}
              title={t("extract")}
            >
              {extractState === "saved" ? t("saved") : extractState === "saving" ? "..." : t("extract")}
            </button>
          )}
          <span className={`inline-flex items-center gap-1 px-2.5 py-[2px] text-micro font-medium tracking-wider border leading-none ${statusVariant}`}>
            {agent.status}
          </span>
        </div>
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
          <div className="text-micro text-t-muted tracking-widest">{t("location")}</div>
          <div className="text-detail mt-1">{agent.location || "—"}</div>
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

      {/* Chat button */}
      {onChat && !isDead && (
        <button
          onClick={onChat}
          className="w-full h-8 text-micro tracking-wider border border-b-DEFAULT text-t-muted hover:border-primary hover:text-primary transition-colors"
        >
          {t("chat")}
        </button>
      )}
    </div>
  );
}
