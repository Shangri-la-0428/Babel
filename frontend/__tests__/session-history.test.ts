import { describe, expect, it } from "vitest";
import { collapseSessionHistory } from "@/lib/session-history";

describe("collapseSessionHistory", () => {
  it("collapses identical unstarted drafts but keeps distinct histories", () => {
    const worldSeed = JSON.stringify({ name: "赛博酒吧", version: 1 });
    const otherSeed = JSON.stringify({ name: "赛博酒吧", version: 2 });

    const result = collapseSessionHistory([
      { id: "a", world_seed: worldSeed, tick: 0, status: "paused", created_at: "2026-03-23 20:36:45" },
      { id: "b", world_seed: worldSeed, tick: 0, status: "paused", created_at: "2026-03-23 20:36:46" },
      { id: "c", world_seed: worldSeed, tick: 12, status: "paused", created_at: "2026-03-24 20:36:46" },
      { id: "d", world_seed: otherSeed, tick: 0, status: "paused", created_at: "2026-03-25 20:36:46" },
    ]);

    expect(result.hiddenDraftCount).toBe(1);
    expect(result.sessions.map((session) => session.id)).toEqual(["d", "c", "b"]);
  });
});
