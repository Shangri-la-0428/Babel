"use client";

import { useLocale } from "@/lib/locale-context";

interface SeekBarProps {
  currentTick: number;
  replayTick: number | null;
  maxTick: number;
  seeking: boolean;
  onSeek: (tick: number) => void;
  onExitReplay: () => void;
  isReplay: boolean;
}

export default function SeekBar({
  currentTick,
  replayTick,
  maxTick,
  seeking,
  onSeek,
  onExitReplay,
  isReplay,
}: SeekBarProps) {
  const { t } = useLocale();

  if (maxTick <= 0) return null;

  const displayTick = replayTick ?? currentTick;
  const progress = maxTick > 0 ? (displayTick / maxTick) * 100 : 0;

  return (
    <div className="flex items-center gap-3 h-10 px-4 bg-surface-1 border-t border-b-DEFAULT shrink-0 relative overflow-hidden">
      {seeking && (
        <span
          className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/6 to-transparent bg-[length:200%_100%] animate-[boot-sweep_700ms_cubic-bezier(0.16,1,0.3,1)_both] pointer-events-none"
          aria-hidden="true"
        />
      )}
      <span className="text-micro text-t-muted tracking-widest shrink-0 select-none">
        {t("seek_bar")}
      </span>
      <span className="text-micro text-t-secondary tracking-wider tabular-nums shrink-0 w-12">
        T:{String(displayTick).padStart(3, "0")}
      </span>
      <input
        type="range"
        min={0}
        max={maxTick}
        value={displayTick}
        onChange={(e) => onSeek(Number(e.target.value))}
        aria-label={t("aria_seek")}
        className="seek-track flex-1 h-[2px] cursor-pointer"
        style={{
          background: `linear-gradient(to right, var(--color-primary) ${progress}%, var(--color-surface-3) ${progress}%)`,
        }}
      />
      {isReplay && (
        <button
          type="button"
          onClick={onExitReplay}
          aria-label={t("aria_live_button")}
          className="h-7 px-3 text-micro tracking-wider font-medium border border-primary text-primary hover:bg-primary hover:text-void active:scale-[0.97] transition-[colors,transform]"
        >
          {t("replay_live")}
        </button>
      )}
    </div>
  );
}
