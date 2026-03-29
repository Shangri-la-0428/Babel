export interface SessionHistoryItem {
  id: string;
  world_seed: string;
  tick: number;
  status: string;
  created_at: string;
}

export interface CollapsedSessionHistory<T extends SessionHistoryItem = SessionHistoryItem> {
  sessions: T[];
  hiddenDraftCount: number;
}

export function collapseSessionHistory<T extends SessionHistoryItem>(
  sessions: T[],
): CollapsedSessionHistory<T> {
  const sorted = [...sessions].sort((a, b) => {
    const dateDelta = Date.parse(b.created_at) - Date.parse(a.created_at);
    if (!Number.isNaN(dateDelta) && dateDelta !== 0) return dateDelta;
    return b.tick - a.tick;
  });

  const seenDraftSeeds = new Set<string>();
  const visible: T[] = [];
  let hiddenDraftCount = 0;

  for (const session of sorted) {
    const isUnstartedDraft = session.tick === 0 && session.status === "paused";
    if (isUnstartedDraft) {
      const seedKey = session.world_seed;
      if (seenDraftSeeds.has(seedKey)) {
        hiddenDraftCount += 1;
        continue;
      }
      seenDraftSeeds.add(seedKey);
    }
    visible.push(session);
  }

  return { sessions: visible, hiddenDraftCount };
}
