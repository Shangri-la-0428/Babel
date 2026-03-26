/**
 * Shared RAF scheduler — single requestAnimationFrame loop
 * for all canvas components. Reduces per-frame overhead from
 * N separate rAF registrations to 1.
 */

type TickCallback = (now: number) => void;

const subscribers = new Set<TickCallback>();
let frameId = 0;
let running = false;

function tick(now: number) {
  subscribers.forEach((cb) => cb(now));
  if (subscribers.size > 0) {
    frameId = requestAnimationFrame(tick);
  } else {
    running = false;
  }
}

function start() {
  if (running) return;
  running = true;
  frameId = requestAnimationFrame(tick);
}

/** Subscribe a callback to the shared animation loop. Returns unsubscribe fn. */
export function subscribe(cb: TickCallback): () => void {
  subscribers.add(cb);
  start();
  return () => {
    subscribers.delete(cb);
    if (subscribers.size === 0) {
      cancelAnimationFrame(frameId);
      running = false;
    }
  };
}
