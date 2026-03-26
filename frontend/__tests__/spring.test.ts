import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// Mock performance.now and rAF
let perfNow = 0;
vi.stubGlobal("performance", { now: () => perfNow });

let rafCallbacks: Array<(now: number) => void> = [];
vi.stubGlobal("requestAnimationFrame", (cb: (now: number) => void) => {
  rafCallbacks.push(cb);
  return rafCallbacks.length;
});
vi.stubGlobal("cancelAnimationFrame", vi.fn());

// Default: no reduced motion
const matchMediaMock = vi.fn().mockReturnValue({ matches: false });
vi.stubGlobal("matchMedia", matchMediaMock);

function flushFrames(count: number, dtMs = 16) {
  for (let i = 0; i < count; i++) {
    perfNow += dtMs;
    const cbs = rafCallbacks.splice(0);
    cbs.forEach((cb) => cb(perfNow));
  }
}

import { useSpring } from "@/lib/spring";

beforeEach(() => {
  perfNow = 0;
  rafCallbacks = [];
  matchMediaMock.mockReturnValue({ matches: false });
});

describe("useSpring", () => {
  it("returns initial value on first render", () => {
    const { result } = renderHook(() => useSpring(100, {}, 0));
    expect(result.current).toBe(0);
  });

  it("uses target as initial value when from is not provided", () => {
    const { result } = renderHook(() => useSpring(50));
    expect(result.current).toBe(50);
  });

  it("animates toward target over multiple frames", () => {
    const { result } = renderHook(() =>
      useSpring(100, { tension: 170, friction: 26 }, 0)
    );

    expect(result.current).toBe(0);

    // Run several frames to let spring advance
    act(() => {
      flushFrames(60, 16);
    });

    // Should have moved significantly toward 100
    expect(result.current).toBeGreaterThan(50);
  });

  it("settles at target value", () => {
    const { result } = renderHook(() =>
      useSpring(100, { tension: 300, friction: 30, precision: 0.01 }, 0)
    );

    // Run many frames to ensure settling
    act(() => {
      flushFrames(200, 16);
    });

    expect(result.current).toBe(100);
  });

  it("respects prefers-reduced-motion by snapping instantly", () => {
    matchMediaMock.mockReturnValue({ matches: true });

    const { result } = renderHook(() => useSpring(100, {}, 0));

    // Should snap immediately to target
    expect(result.current).toBe(100);
  });

  it("responds to target changes", () => {
    let target = 100;
    const { result, rerender } = renderHook(() =>
      useSpring(target, { tension: 300, friction: 30 }, 0)
    );

    // Animate toward 100
    act(() => {
      flushFrames(200, 16);
    });
    expect(result.current).toBe(100);

    // Change target
    target = 0;
    rerender();

    act(() => {
      flushFrames(200, 16);
    });

    expect(result.current).toBe(0);
  });

  it("does not re-render when already settled at target", () => {
    const { result } = renderHook(() => useSpring(50));

    // Already at target, no animation should happen
    const initialValue = result.current;
    act(() => {
      flushFrames(10, 16);
    });

    expect(result.current).toBe(initialValue);
  });

  it("clamps dt to prevent physics explosion from long frames", () => {
    const { result } = renderHook(() =>
      useSpring(100, { tension: 170, friction: 26 }, 0)
    );

    // Simulate a very long frame (e.g., tab was backgrounded)
    act(() => {
      perfNow += 5000; // 5 seconds
      const cbs = rafCallbacks.splice(0);
      cbs.forEach((cb) => cb(perfNow));
    });

    // Should not have exploded past the target
    expect(result.current).toBeLessThanOrEqual(200);
    expect(result.current).toBeGreaterThanOrEqual(-100);
  });
});
