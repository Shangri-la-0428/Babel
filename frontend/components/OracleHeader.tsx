"use client";

import { StatusDot } from "./ui";

type OracleMode = "narrate" | "create";

interface OracleHeaderProps {
  mode: OracleMode;
  onModeChange: (mode: OracleMode) => void;
  tick: number;
  onClose: () => void;
  t: (key: string, ...args: string[]) => string;
}

export default function OracleHeader({
  mode,
  onModeChange,
  tick,
  onClose,
  t,
}: OracleHeaderProps) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-info/15 bg-surface-1 shrink-0">
      <span className="text-micro text-info tracking-widest drop-shadow-[0_0_8px_rgba(14,165,233,0.3)] flex items-center gap-1.5">
        <StatusDot status="info" />
        {t("oracle_label")}
      </span>
      <div className="flex items-center gap-3">
        {/* Mode toggle */}
        <div className="flex border border-info/20">
          <button
            type="button"
            onClick={() => onModeChange("narrate")}
            className={`text-micro tracking-wider px-2.5 py-1 transition-colors ${
              mode === "narrate"
                ? "bg-info/10 text-info"
                : "text-t-dim hover:text-info/60"
            }`}
          >
            {t("oracle_mode_narrate")}
          </button>
          <button
            type="button"
            onClick={() => onModeChange("create")}
            className={`text-micro tracking-wider px-2.5 py-1 border-l border-info/20 transition-colors ${
              mode === "create"
                ? "bg-info/10 text-info"
                : "text-t-dim hover:text-info/60"
            }`}
          >
            {t("oracle_mode_create")}
          </button>
        </div>
        <span className="text-micro text-info/40 tracking-wider tabular-nums">
          {t("oracle_at_tick")} {String(tick).padStart(3, "0")}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-micro text-t-muted hover:text-t-DEFAULT transition-colors tracking-wider"
          aria-label={t("close")}
        >
          {t("close")}
        </button>
      </div>
    </div>
  );
}
