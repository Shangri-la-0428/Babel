"use client";

import { useEffect, useRef, useState } from "react";
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
  worldTime?: { display: string; period: string; is_night: boolean } | null;
  onOracle?: () => void;
  oracleOpen?: boolean;
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

function DigitCascade({ value, padTo = 3 }: { value: number; padTo?: number }) {
  const str = String(value).padStart(padTo, "0");
  return (
    <span className="inline-flex overflow-hidden">
      {str.split("").map((digit, i) => (
        <span
          key={`${i}-${digit}`}
          className="inline-block animate-[digit-drop_250ms_cubic-bezier(0.16,1,0.3,1)_both]"
          style={{ animationDelay: `${i * 50}ms` }}
        >
          {digit}
        </span>
      ))}
    </span>
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
  worldTime,
  onOracle,
  oracleOpen,
}: ControlBarProps) {
  const { t } = useLocale();
  const isRunning = status === "running";
  const prevStatusRef = useRef(status);
  const prevWsRef = useRef(wsStatus);
  const [showBoot, setShowBoot] = useState(false);

  // Boot sweep on status → running
  useEffect(() => {
    if (prevStatusRef.current !== "running" && status === "running") {
      setShowBoot(true);
      const timer = setTimeout(() => setShowBoot(false), 700);
      return () => clearTimeout(timer);
    }
    prevStatusRef.current = status;
  }, [status]);

  // Boot sweep on WS connected
  useEffect(() => {
    if (prevWsRef.current !== "connected" && wsStatus === "connected") {
      setShowBoot(true);
      const timer = setTimeout(() => setShowBoot(false), 700);
      return () => clearTimeout(timer);
    }
    prevWsRef.current = wsStatus;
  }, [wsStatus]);

  return (
    <div className="flex items-center gap-3 px-4 h-14 bg-surface-1 border-t border-b-DEFAULT shrink-0 relative overflow-hidden" role="toolbar" aria-label={t("aria_controls")}>
      {showBoot && (
        <span
          className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/8 to-transparent bg-[length:200%_100%] animate-[boot-sweep_700ms_cubic-bezier(0.16,1,0.3,1)_both] pointer-events-none"
          aria-hidden="true"
        />
      )}
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

      {/* Oracle toggle */}
      {onOracle && (
        <button
          onClick={onOracle}
          aria-expanded={!!oracleOpen}
          className={`inline-flex items-center justify-center gap-2 h-9 px-4 text-micro font-medium tracking-wider border active:scale-[0.97] transition-[colors,box-shadow,transform] ${
            oracleOpen
              ? "border-info text-info shadow-[0_0_12px_rgba(14,165,233,0.3)]"
              : "border-b-DEFAULT text-t-muted hover:border-b-hover hover:text-t-DEFAULT"
          }`}
        >
          {t("oracle")}
        </button>
      )}

      {/* Divider */}
      <div className="w-px h-6 bg-b-DEFAULT" />

      {/* Tick counter + world time */}
      <div className="flex items-baseline gap-2">
        <span className="text-micro text-t-muted tracking-widest">{t("tick")}</span>
        <span key={tick} className="text-heading font-bold text-primary tabular-nums">
          <DigitCascade value={tick} />
        </span>
        {worldTime && worldTime.display && !worldTime.display.startsWith("Tick") && (
          <>
            <span className="text-t-dim mx-1">|</span>
            <span className="text-detail text-t-secondary tabular-nums">{worldTime.display}</span>
            {worldTime.period && (
              <span className={`text-micro tracking-wider px-1.5 py-0.5 border ${worldTime.is_night ? "text-info border-info" : "text-warning border-warning"}`}>
                {worldTime.period.toUpperCase()}
              </span>
            )}
          </>
        )}
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
            <span className={`text-micro tracking-wider flex items-center gap-1.5 ${wsStatus === "disconnected" ? "text-danger" : "text-t-dim"}`}>
              <span className={`inline-block w-1.5 h-1.5 rounded-full ${
                wsStatus === "disconnected"
                  ? "bg-danger shadow-[0_0_6px_var(--color-danger-glow)]"
                  : "bg-t-dim animate-[blink_1s_step-end_infinite]"
              }`} />
              {wsStatus === "disconnected" ? t("disconnected") : t("connecting")}
            </span>
          )}
        </>
      )}
    </div>
  );
}
