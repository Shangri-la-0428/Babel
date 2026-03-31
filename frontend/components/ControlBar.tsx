"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "@/lib/locale-context";
import { StatusDot } from "./ui";

interface ControlBarProps {
  tick: number;
  status: string;
  onRun: () => void;
  onPause: () => void;
  onStep: () => void;
  disabled?: boolean;
  wsStatus?: "connecting" | "connected" | "disconnected";
  worldTime?: { display: string; period: string; is_night: boolean } | null;
  onOracle?: () => void;
  oracleOpen?: boolean;
  isReplay?: boolean;
  onFork?: () => void;
  hasControlledAgents?: boolean;
  onReport?: () => void;
  reportOpen?: boolean;
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
  wsStatus,
  worldTime,
  onOracle,
  oracleOpen,
  isReplay,
  onFork,
  hasControlledAgents,
  onReport,
  reportOpen,
}: ControlBarProps) {
  const { t } = useLocale();
  const isRunning = status === "running";
  const prevStatusRef = useRef(status);
  const prevWsRef = useRef(wsStatus);
  const [showBoot, setShowBoot] = useState(false);
  const [showStep, setShowStep] = useState(false);
  const [showDisconnect, setShowDisconnect] = useState(false);
  const prevPeriodRef = useRef(worldTime?.period);
  const [periodGlitch, setPeriodGlitch] = useState(false);
  const stepTimerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(stepTimerRef.current), []);

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
    // Danger flash on WS disconnect
    if (prevWsRef.current === "connected" && wsStatus === "disconnected") {
      setShowDisconnect(true);
      const timer = setTimeout(() => setShowDisconnect(false), 1200);
      prevWsRef.current = wsStatus;
      return () => clearTimeout(timer);
    }
    prevWsRef.current = wsStatus;
  }, [wsStatus]);

  // CRT glitch on day/night period change
  useEffect(() => {
    const currentPeriod = worldTime?.period;
    if (prevPeriodRef.current && currentPeriod && prevPeriodRef.current !== currentPeriod) {
      setPeriodGlitch(true);
      const timer = setTimeout(() => setPeriodGlitch(false), 300);
      prevPeriodRef.current = currentPeriod;
      return () => clearTimeout(timer);
    }
    prevPeriodRef.current = currentPeriod;
  }, [worldTime?.period]);

  return (
    <div className="flex items-center gap-3 px-4 h-14 bg-surface-1 border-t border-b-DEFAULT shrink-0 relative overflow-hidden" role="toolbar" aria-label={t("aria_controls")}>
      {showBoot && (
        <span
          className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/8 to-transparent bg-[length:200%_100%] animate-[boot-sweep_700ms_cubic-bezier(0.16,1,0.3,1)_both] pointer-events-none"
          aria-hidden="true"
        />
      )}
      {showStep && (
        <span
          className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/6 to-transparent bg-[length:200%_100%] animate-[boot-sweep_400ms_cubic-bezier(0.16,1,0.3,1)_both] pointer-events-none"
          aria-hidden="true"
        />
      )}
      {showDisconnect && (
        <span className="absolute inset-0 animate-[event-flash-danger_1.2s_ease_both] pointer-events-none" aria-hidden="true" />
      )}
      {/* Run / Pause — cross-fade */}
      <div className="relative h-9 min-w-[100px]">
        <button
          type="button"
          onClick={onRun}
          disabled={disabled || isRunning || isReplay}
          title={isReplay ? t("replay_disabled") : isRunning ? t("already_running") : undefined}
          aria-label={t("aria_run")}
          aria-hidden={isRunning}
          tabIndex={isRunning ? -1 : 0}
          className={`group absolute inset-0 inline-flex items-center justify-center gap-2 h-9 min-w-[100px] px-4 text-micro font-medium tracking-wider border border-primary bg-primary text-void hover:bg-transparent hover:text-primary hover:shadow-[0_0_16px_var(--color-primary-glow-strong)] active:scale-[0.97] disabled:opacity-30 disabled:cursor-not-allowed transition-[colors,box-shadow,transform,opacity] duration-150 ${
            isRunning ? "opacity-0 pointer-events-none" : "opacity-100"
          }`}
          style={{ transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)" }}
        >
          <span className="inline-block transition-transform group-hover:translate-x-px"><PlayIcon /></span> {t("run")}
        </button>
        <button
          type="button"
          onClick={onPause}
          disabled={disabled || !isRunning}
          aria-label={t("aria_pause")}
          aria-hidden={!isRunning}
          tabIndex={isRunning ? 0 : -1}
          className={`absolute inset-0 inline-flex items-center justify-center gap-2 h-9 min-w-[100px] px-4 text-micro font-medium tracking-wider border border-b-DEFAULT bg-transparent text-t-DEFAULT hover:border-b-hover active:scale-[0.97] disabled:opacity-30 disabled:cursor-not-allowed transition-[colors,transform,opacity] duration-150 ${
            isRunning ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
          style={{ transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)" }}
        >
          <PauseIcon /> {t("pause")}
        </button>
      </div>

      {/* Step */}
      <button
        type="button"
        onClick={() => {
          onStep();
          setShowStep(true);
          if (stepTimerRef.current) clearTimeout(stepTimerRef.current);
          stepTimerRef.current = setTimeout(() => setShowStep(false), 400);
        }}
        disabled={disabled || isRunning || isReplay}
        title={isReplay ? t("replay_disabled") : isRunning ? t("pause_first") : undefined}
        aria-label={t("aria_step")}
        className="inline-flex items-center justify-center gap-2 h-9 px-4 text-micro font-medium tracking-wider border border-b-DEFAULT bg-transparent text-t-DEFAULT hover:border-b-hover active:scale-[0.97] disabled:opacity-30 disabled:cursor-not-allowed transition-[colors,transform]"
      >
        <StepIcon /> {t("step")}
      </button>

      {/* ── Intervention Verbs ── */}
      <div className="flex items-center gap-px bg-b-DEFAULT border border-b-DEFAULT">
        {/* OBSERVE — oracle drawer */}
        {onOracle && (
          <button
            type="button"
            onClick={onOracle}
            aria-expanded={!!oracleOpen}
            className={`inline-flex items-center justify-center h-9 px-3 text-micro font-medium tracking-wider bg-void active:scale-[0.97] transition-[colors,box-shadow,transform] ${
              oracleOpen
                ? "text-info shadow-[0_0_8px_rgba(14,165,233,0.3)]"
                : "text-t-muted hover:text-t-DEFAULT"
            }`}
          >
            {t("verb_observe")}
          </button>
        )}
        {/* NUDGE — inject event (focus handled by sim page) */}
        <button
          type="button"
          onClick={() => {
            const el = document.getElementById("nudge-input");
            el?.focus();
          }}
          className="inline-flex items-center justify-center h-9 px-3 text-micro font-medium tracking-wider bg-void text-t-muted hover:text-primary active:scale-[0.97] transition-[colors,transform]"
        >
          {t("verb_nudge")}
        </button>
        {/* DIRECT — human control indicator */}
        <button
          type="button"
          onClick={() => {
            const el = document.querySelector("[data-panel='agents']");
            el?.scrollIntoView({ behavior: "smooth" });
          }}
          className={`inline-flex items-center justify-center h-9 px-3 text-micro font-medium tracking-wider bg-void active:scale-[0.97] transition-[colors,transform] ${
            hasControlledAgents
              ? "text-warning shadow-[0_0_8px_rgba(255,184,0,0.2)]"
              : "text-t-muted hover:text-t-DEFAULT"
          }`}
        >
          {t("verb_direct")}
        </button>
        {/* FORK — timeline branching */}
        {onFork && (
          <button
            type="button"
            onClick={onFork}
            className="inline-flex items-center justify-center h-9 px-3 text-micro font-medium tracking-wider bg-void text-t-muted hover:text-primary active:scale-[0.97] transition-[colors,transform]"
          >
            {t("verb_fork")}
          </button>
        )}
      </div>

      {/* Report */}
      {onReport && (
        <button
          type="button"
          onClick={onReport}
          aria-pressed={!!reportOpen}
          className={`inline-flex items-center justify-center h-9 px-3 text-micro font-medium tracking-wider border active:scale-[0.97] transition-[colors,box-shadow,transform] ${
            reportOpen
              ? "border-primary text-primary shadow-[0_0_8px_var(--color-primary-glow)]"
              : "border-b-DEFAULT text-t-muted hover:border-primary hover:text-primary"
          }`}
        >
          {t("report")}
        </button>
      )}

      {/* Replay badge */}
      {isReplay && (
        <span className="text-micro tracking-wider px-2.5 py-0.5 border text-warning border-warning font-medium leading-none">
          {t("replay_mode")}
        </span>
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
              <span
                className={`text-micro tracking-wider px-1.5 py-0.5 border ${worldTime.is_night ? "text-info border-info" : "text-warning border-warning"}`}
                style={periodGlitch ? { animation: "crt-glitch 200ms ease both" } : undefined}
              >
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
        <span className="relative inline-flex">
          <StatusDot
            status={isRunning ? "running" : status === "ended" ? "danger" : "idle"}
            className="w-2 h-2"
          />
          {isRunning && (
            <span className="absolute inset-0 border border-primary animate-ping opacity-20" aria-hidden="true" />
          )}
        </span>
        <span
          className={`text-micro tracking-wider ${
            isRunning ? "text-primary" : "text-t-muted"
          }`}
        >
          {isReplay ? t("replay_mode") : status === "running" ? t("status_running") : status === "ended" ? t("status_ended") : t("status_paused")}
        </span>
      </div>

      {/* WS status (always visible) */}
      {wsStatus && wsStatus !== "connected" && (
        <>
          <div className="w-px h-6 bg-b-DEFAULT" />
          <span className={`text-micro tracking-wider flex items-center gap-1.5 ${wsStatus === "disconnected" ? "text-danger" : "text-t-dim"}`}>
            <StatusDot status={wsStatus === "disconnected" ? "danger" : "connecting"} />
            {wsStatus === "disconnected" ? t("disconnected") : t("connecting")}
          </span>
        </>
      )}
    </div>
  );
}
