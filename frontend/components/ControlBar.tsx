"use client";

interface ControlBarProps {
  tick: number;
  status: string;
  onRun: () => void;
  onPause: () => void;
  onStep: () => void;
  disabled?: boolean;
  worldName?: string;
  sessionId?: string;
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
}: ControlBarProps) {
  const isRunning = status === "running";

  return (
    <div className="flex items-center gap-3 px-4 h-14 bg-surface-1 border-t border-b-DEFAULT shrink-0" role="toolbar" aria-label="Simulation controls">
      {/* Run / Pause */}
      {isRunning ? (
        <button
          onClick={onPause}
          disabled={disabled}
          aria-label="Pause simulation"
          className="inline-flex items-center justify-center gap-2 h-9 min-w-[100px] px-4 text-micro font-medium tracking-wider border border-b-DEFAULT bg-transparent text-white hover:border-white disabled:opacity-30 transition-colors"
        >
          <PauseIcon /> Pause
        </button>
      ) : (
        <button
          onClick={onRun}
          disabled={disabled}
          aria-label="Run simulation"
          className="inline-flex items-center justify-center gap-2 h-9 min-w-[100px] px-4 text-micro font-medium tracking-wider border border-primary bg-primary text-void hover:bg-transparent hover:text-primary disabled:opacity-30 transition-colors"
        >
          <PlayIcon /> Run
        </button>
      )}

      {/* Step */}
      <button
        onClick={onStep}
        disabled={disabled || isRunning}
        aria-label="Advance one tick"
        className="inline-flex items-center justify-center gap-2 h-9 px-4 text-micro font-medium tracking-wider border border-b-DEFAULT bg-transparent text-white hover:border-white disabled:opacity-30 transition-colors"
      >
        <StepIcon /> Step
      </button>

      {/* Divider */}
      <div className="w-px h-6 bg-b-DEFAULT" />

      {/* Tick counter */}
      <div className="flex items-baseline gap-2">
        <span className="text-micro text-t-muted tracking-widest">Tick</span>
        <span className="text-heading font-bold text-primary tabular-nums">
          {String(tick).padStart(3, "0")}
        </span>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Status */}
      <div className="flex items-center gap-2">
        <span
          className={`inline-block w-1.5 h-1.5 rounded-full ${
            isRunning
              ? "bg-primary shadow-[0_0_8px_var(--color-primary-glow-strong)]"
              : status === "ended"
              ? "bg-danger"
              : "bg-t-dim"
          }`}
        />
        <span
          className={`text-micro tracking-wider ${
            isRunning ? "text-primary" : "text-t-muted"
          }`}
        >
          {status}
        </span>
      </div>

      {/* World info */}
      {worldName && (
        <>
          <div className="w-px h-6 bg-b-DEFAULT" />
          <span className="text-micro text-t-muted tracking-wider">
            {worldName}
            {sessionId && ` · ${sessionId.slice(0, 6)}`}
          </span>
        </>
      )}
    </div>
  );
}
