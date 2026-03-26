import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock requestAnimationFrame/cancelAnimationFrame before importing module
let rafCallbacks: Array<(now: number) => void> = [];
let rafIdCounter = 0;
let cancelledIds = new Set<number>();

vi.stubGlobal("requestAnimationFrame", (cb: (now: number) => void) => {
  const id = ++rafIdCounter;
  rafCallbacks.push(cb);
  return id;
});

vi.stubGlobal("cancelAnimationFrame", (id: number) => {
  cancelledIds.add(id);
});

function flushRAF(now = 16.67) {
  const cbs = rafCallbacks.splice(0);
  cbs.forEach((cb) => cb(now));
}

// Re-import each test to get fresh module state
let subscribe: typeof import("@/lib/raf").subscribe;

beforeEach(async () => {
  rafCallbacks = [];
  rafIdCounter = 0;
  cancelledIds.clear();
  // Reset module to clear subscribers/state between tests
  vi.resetModules();
  const mod = await import("@/lib/raf");
  subscribe = mod.subscribe;
});

describe("raf shared scheduler", () => {
  it("calls subscriber on each frame", () => {
    const cb = vi.fn();
    subscribe(cb);

    flushRAF(16);
    expect(cb).toHaveBeenCalledWith(16);
    expect(cb).toHaveBeenCalledTimes(1);

    flushRAF(33);
    expect(cb).toHaveBeenCalledWith(33);
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("calls multiple subscribers per frame", () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    subscribe(cb1);
    subscribe(cb2);

    flushRAF(16);
    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).toHaveBeenCalledTimes(1);
  });

  it("unsubscribe removes callback from loop", () => {
    const cb = vi.fn();
    const unsub = subscribe(cb);

    flushRAF(16);
    expect(cb).toHaveBeenCalledTimes(1);

    unsub();

    flushRAF(33);
    expect(cb).toHaveBeenCalledTimes(1); // not called again
  });

  it("stops loop when all subscribers removed", () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const unsub1 = subscribe(cb1);
    const unsub2 = subscribe(cb2);

    unsub1();
    unsub2();

    // After last unsub, cancelAnimationFrame should be called
    expect(cancelledIds.size).toBeGreaterThan(0);
  });

  it("restarts loop when new subscriber added after stop", () => {
    const cb1 = vi.fn();
    const unsub1 = subscribe(cb1);
    unsub1();

    const rafCountBefore = rafCallbacks.length;

    const cb2 = vi.fn();
    subscribe(cb2);

    // A new rAF should have been requested
    expect(rafCallbacks.length).toBeGreaterThan(rafCountBefore);

    flushRAF(50);
    expect(cb2).toHaveBeenCalledWith(50);
  });

  it("does not double-start when adding subscriber while running", () => {
    const cb1 = vi.fn();
    subscribe(cb1);
    const countAfterFirst = rafCallbacks.length;

    const cb2 = vi.fn();
    subscribe(cb2);

    // Should not have added another rAF registration
    expect(rafCallbacks.length).toBe(countAfterFirst);
  });

  it("unsubscribe is idempotent", () => {
    const cb = vi.fn();
    const unsub = subscribe(cb);

    unsub();
    unsub(); // double-call should not throw

    flushRAF(16);
    expect(cb).not.toHaveBeenCalled();
  });
});
