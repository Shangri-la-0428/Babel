"use client";

import { AgentData } from "@/lib/api";
import { useLocale } from "@/lib/locale-context";
import { Badge } from "./ui";
import Modal from "./Modal";

function DataRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-b-DEFAULT">
      <div className="px-5 py-1.5 bg-surface-1">
        <span className="text-micro text-t-muted tracking-widest">{label}</span>
      </div>
      <div className="px-5 py-3">{children}</div>
    </div>
  );
}

export default function AgentDetail({
  agentId,
  agent,
  onClose,
  onChat,
  onExtract,
}: {
  agentId: string;
  agent: AgentData;
  onClose: () => void;
  onChat?: () => void;
  onExtract?: () => void;
}) {
  const { t } = useLocale();
  const isDead = agent.status === "dead";

  const statusStyle =
    agent.status === "acting"
      ? "text-primary border-primary"
      : isDead
      ? "text-danger border-danger"
      : "text-t-muted border-b-DEFAULT";

  return (
    <Modal onClose={onClose} ariaLabel={`${t("agent")}: ${agent.name}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-b-DEFAULT bg-surface-1 shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-body font-semibold">{agent.name}</span>
          <span className={`text-micro tracking-wider px-2.5 py-0.5 border leading-none font-medium ${statusStyle}`}>
            {agent.status}
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-micro text-t-muted tracking-wider hover:text-t-DEFAULT transition-colors"
          aria-label={t("close")}
        >
          {t("close")}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* ID */}
        <div className="px-5 py-2 border-b border-b-DEFAULT">
          <span className="text-micro text-t-dim tracking-wider">{agentId}</span>
        </div>

        {/* Description */}
        {agent.description && (
          <DataRow label={t("description")}>
            <div className="text-detail text-t-secondary normal-case tracking-normal leading-relaxed">
              {agent.description}
            </div>
          </DataRow>
        )}

        {/* Personality */}
        {agent.personality && (
          <DataRow label={t("personality")}>
            <div className="text-detail text-t-secondary normal-case tracking-normal leading-relaxed">
              {agent.personality}
            </div>
          </DataRow>
        )}

        {/* Goals */}
        {agent.goals.length > 0 && (
          <DataRow label={t("goals_label")}>
            <div className="flex flex-col gap-1.5">
              {agent.goals.map((goal, i) => (
                <div key={i} className="flex items-baseline gap-2">
                  <span className="text-micro text-t-dim tracking-wider shrink-0">{String(i + 1).padStart(2, "0")}</span>
                  <span className="text-detail text-t-secondary normal-case tracking-normal">{goal}</span>
                </div>
              ))}
            </div>
          </DataRow>
        )}

        {/* Location */}
        <DataRow label={t("location")}>
          <span className="text-detail">{agent.location || "—"}</span>
        </DataRow>

        {/* Inventory */}
        <DataRow label={t("inventory_label")}>
          {agent.inventory.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {agent.inventory.map((item, i) => (
                <Badge key={i}>{item}</Badge>
              ))}
            </div>
          ) : (
            <span className="text-detail text-t-dim">—</span>
          )}
        </DataRow>

        {/* Memory */}
        {agent.memory && agent.memory.length > 0 && (
          <DataRow label={t("memory")}>
            <div className="flex flex-col gap-1">
              {agent.memory.map((mem, i) => (
                <div
                  key={i}
                  className="text-detail text-t-dim normal-case tracking-normal leading-relaxed border-l-2 border-surface-3 pl-3"
                >
                  {mem}
                </div>
              ))}
            </div>
          </DataRow>
        )}
      </div>

      {/* Footer actions */}
      <div className="flex items-center gap-2 px-5 py-3 border-t border-b-DEFAULT bg-surface-1 shrink-0">
        {onExtract && !isDead && (
          <button
            onClick={onExtract}
            className="h-8 px-4 text-micro tracking-wider border border-b-DEFAULT text-t-muted hover:border-info hover:text-info transition-colors"
          >
            {t("extract_seed")}
          </button>
        )}
        {onChat && !isDead && (
          <button
            onClick={onChat}
            className="h-8 px-4 text-micro tracking-wider border border-b-DEFAULT text-t-muted hover:border-primary hover:text-primary transition-colors"
          >
            {t("chat")}
          </button>
        )}
        <div className="flex-1" />
        <button
          onClick={onClose}
          className="h-8 px-4 text-micro tracking-wider text-t-dim hover:text-t-DEFAULT transition-colors"
        >
          {t("close")}
        </button>
      </div>
    </Modal>
  );
}
