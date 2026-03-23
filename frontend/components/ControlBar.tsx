"use client";

import { useLocale } from "@/lib/locale-context";

interface ControlBarProps {
  tick: number;
  status: string;
  onRun: () => void;
  onPause: () => void;
  onStep: () => void;
  disabled?: boolean;
  worldName?: string;
  sessionId?: string;
  model?: string;
  wsStatus?: "connecting" | "connected" | "disconnected";
}

function PlayIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
      <polygon points="3,1 12,7 3,13" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
      <rect x="2" y="1" width="3.5" height="12" />
      <rect x="8.5" y="1" width="3.5" height="12" />
    </svg>
  );
}

function StepIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
      <polygon points="1,1 8,7 1,13" />
      <rect x="9" y="1" width="3" height="12" />
    </svg>
  );
}

export default function ControlBar({
  tick,
  status,
  onRun,
  onPause,
  onStep,
  disabled,
  worldName,
  sessionId,
  model,
  wsStatus,
}: ControlBarProps) {
  const { t } = useLocale();
  const isRunning = status === "running";

  return (
    <div className="flex items-center gap-3 px-4 h-14 bg-surface-1 border-t border-b-DEFAULT shrink-0" role="toolbar" aria-label={t("aria_controls")}>
      {/* Run / Pause */}
      {isRunning ? (
        <button
          onClick={onPause}
          disabled={disabled}
          aria-label={t("aria_pause")}
          className="inline-flex items-center justify-center gap-2 h-9 min-w-[100px] px-4 text-micro font-medium tracking-wider border border-b-DEFAULT bg-transparent text-t-DEFAULT hover:border-b-hover active:scale-[0.97] disabled:opacity-30 transition-[colors,transform]"
        >
          <PauseIcon /> {t("pause")}
        </button>
      ) : (
        <button
          onClick={onRun}
          disabled={disabled}
          aria-label={t("aria_run")}
          className="inline-flex items-center justify-center gap-2 h-9 min-w-[100px] px-4 text-micro font-medium tracking-wider border border-primary bg-primary text-void hover:bg-transparent hover:text-primary hover:shadow-[0_0_16px_var(--color-primary-glow-strong)] active:scale-[0.97] disabled:opacity-30 transition-[colors,box-shadow,transform]"
        >
          <PlayIcon /> {t("run")}
        </button>
      )}

      {/* Step */}
      <button
        onClick={onStep}
        disabled={disabled || isRunning}
        aria-label={t("aria_step")}
        className="inline-flex items-center justify-center gap-2 h-9 px-4 text-micro font-medium tracking-wider border border-b-DEFAULT bg-transparent text-t-DEFAULT hover:border-b-hover active:scale-[0.97] disabled:opacity-30 transition-[colors,transform]"
      >
        <StepIcon /> {t("step")}
      </button>

      {/* Divider */}
      <div className="w-px h-6 bg-b-DEFAULT" />

      {/* Tick counter */}
      <div className="flex items-baseline gap-2">
        <span className="text-micro text-t-muted tracking-widest">{t("tick")}</span>
        <span key={tick} className="text-heading font-bold text-primary tabular-nums animate-tick-bump">
          {String(tick).padStart(3, "0")}
        </span>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Status */}
      <div className="flex items-center gap-2">
        <span
          className={`inline-block w-2 h-2 rounded-full ${
            isRunning
              ? "bg-primary animate-pulse-glow"
              : status === "ended"
              ? "bg-danger shadow-[0_0_6px_var(--color-danger-glow)]"
              : "bg-t-dim"
          }`}
        />
        <span
          className={`text-micro tracking-wider ${
            isRunning ? "text-primary" : "text-t-muted"
          }`}
        >
          {status === "running" ? t("status_running") : status === "ended" ? t("status_ended") : t("status_paused")}
        </span>
      </div>

      {/* World info */}
      {worldName && (
        <>
          <div className="w-px h-6 bg-b-DEFAULT" />
          <span className="text-micro text-t-muted tracking-wider truncate max-w-[200px]" title={`${worldName}${sessionId ? ` · ${sessionId}` : ""}`}>
            {worldName}
            {sessionId && ` · ${sessionId.slice(0, 6)}`}
          </span>
        </>
      )}

      {/* Model + WS status */}
      {(model || wsStatus) && (
        <>
          <div className="w-px h-6 bg-b-DEFAULT" />
          {model && (
            <span className="text-micro text-t-dim tracking-wider">{model}</span>
          )}
          {wsStatus && wsStatus !== "connected" && (
            <span className={`text-micro tracking-wider ${wsStatus === "disconnected" ? "text-danger" : "text-t-dim"}`}>
              {wsStatus === "disconnected" ? t("disconnected") : t("connecting")}
            </span>
          )}
        </>
      )}
    </div>
  );
}
