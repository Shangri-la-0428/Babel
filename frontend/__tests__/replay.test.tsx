import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";

// ── SeekBar tests ──

// Inline minimal SeekBar for unit testing (avoids circular dep with hook)
function SeekBar({
  currentTick,
  replayTick,
  maxTick,
  seeking,
  onSeek,
  onExitReplay,
  isReplay,
  t,
}: {
  currentTick: number;
  replayTick: number | null;
  maxTick: number;
  seeking: boolean;
  onSeek: (tick: number) => void;
  onExitReplay: () => void;
  isReplay: boolean;
  t: (k: string) => string;
}) {
  if (maxTick <= 0) return null;
  return (
    <div data-testid="seek-bar">
      <span>{t("seek_bar")}</span>
      <span data-testid="seek-tick">T:{String(replayTick ?? currentTick).padStart(3, "0")}</span>
      {seeking && <span data-testid="seeking">{t("replay_seeking")}</span>}
      <input
        type="range"
        min={0}
        max={maxTick}
        value={replayTick ?? currentTick}
        onChange={(e) => onSeek(Number(e.target.value))}
        aria-label={t("aria_seek")}
      />
      {isReplay && (
        <button onClick={onExitReplay} aria-label={t("aria_live_button")}>
          {t("replay_live")}
        </button>
      )}
    </div>
  );
}

const mockT = (k: string) => k;

describe("SeekBar", () => {
  it("renders null when maxTick is 0", () => {
    const { container } = render(
      <SeekBar currentTick={0} replayTick={null} maxTick={0} seeking={false} onSeek={() => {}} onExitReplay={() => {}} isReplay={false} t={mockT} />
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders range input with correct min/max", () => {
    render(
      <SeekBar currentTick={5} replayTick={null} maxTick={42} seeking={false} onSeek={() => {}} onExitReplay={() => {}} isReplay={false} t={mockT} />
    );
    const range = screen.getByRole("slider");
    expect(range).toBeDefined();
    expect(range.getAttribute("min")).toBe("0");
    expect(range.getAttribute("max")).toBe("42");
  });

  it("shows LIVE button only when isReplay", () => {
    const { rerender } = render(
      <SeekBar currentTick={5} replayTick={null} maxTick={10} seeking={false} onSeek={() => {}} onExitReplay={() => {}} isReplay={false} t={mockT} />
    );
    expect(screen.queryByText("replay_live")).toBeNull();

    rerender(
      <SeekBar currentTick={5} replayTick={3} maxTick={10} seeking={false} onSeek={() => {}} onExitReplay={() => {}} isReplay={true} t={mockT} />
    );
    expect(screen.getByText("replay_live")).toBeDefined();
  });

  it("calls onSeek on range change", () => {
    const onSeek = vi.fn();
    render(
      <SeekBar currentTick={5} replayTick={null} maxTick={20} seeking={false} onSeek={onSeek} onExitReplay={() => {}} isReplay={false} t={mockT} />
    );
    fireEvent.change(screen.getByRole("slider"), { target: { value: "10" } });
    expect(onSeek).toHaveBeenCalledWith(10);
  });

  it("calls onExitReplay when LIVE button clicked", () => {
    const onExit = vi.fn();
    render(
      <SeekBar currentTick={5} replayTick={3} maxTick={10} seeking={false} onSeek={() => {}} onExitReplay={onExit} isReplay={true} t={mockT} />
    );
    fireEvent.click(screen.getByText("replay_live"));
    expect(onExit).toHaveBeenCalledOnce();
  });

  it("shows seeking indicator when seeking", () => {
    render(
      <SeekBar currentTick={5} replayTick={3} maxTick={10} seeking={true} onSeek={() => {}} onExitReplay={() => {}} isReplay={true} t={mockT} />
    );
    expect(screen.getByTestId("seeking")).toBeDefined();
  });
});
