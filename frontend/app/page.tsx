"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchSeeds, createFromSeed, getSessions, SeedInfo } from "@/lib/api";
import Nav from "@/components/Nav";

interface SessionRecord {
  id: string;
  world_seed: string;
  tick: number;
  status: string;
  created_at: string;
}

export default function Home() {
  const router = useRouter();
  const [seeds, setSeeds] = useState<SeedInfo[]>([]);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [seedsLoading, setSeedsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSeeds()
      .then(setSeeds)
      .catch(() => setError("Failed to load worlds. Is the backend running?"))
      .finally(() => setSeedsLoading(false));
    getSessions()
      .then((rows) => {
        const parsed = rows.map((r) => {
          let worldName = "Unknown";
          try {
            const ws = JSON.parse(r.world_seed);
            worldName = ws.name || worldName;
          } catch {}
          return { ...r, world_name: worldName };
        });
        setSessions(parsed);
      })
      .catch(() => {});
  }, []);

  async function handleLaunch(filename: string) {
    setLoading(true);
    setError(null);
    try {
      const { session_id } = await createFromSeed(filename);
      router.push(`/sim?id=${session_id}`);
    } catch {
      setError("Failed to create world. Check backend connection.");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-void">
      <Nav activePage="home" />

      <main className="flex-1 flex flex-col items-center justify-center px-6">
        <h1 className="font-sans font-black text-[clamp(3rem,10vw,6rem)] leading-none tracking-tight text-center animate-[fade-in_0.8s_ease]">
          BABEL
        </h1>
        <p className="mt-4 text-body text-t-muted normal-case tracking-normal text-center max-w-md leading-relaxed animate-[fade-in_1s_ease]">
          Seed + AI Runtime = World State Machine
        </p>

        <div className="mt-12 w-full max-w-2xl animate-[slide-up_0.6s_ease]">
          <div className="text-micro text-t-muted tracking-widest mb-4">
            Available Worlds
          </div>

          {/* Error banner */}
          {error && (
            <div className="mb-4 px-4 py-3 border border-danger text-detail text-danger flex items-center justify-between" role="alert">
              <span className="normal-case tracking-normal">{error}</span>
              <button onClick={() => setError(null)} className="text-micro text-danger hover:text-white transition-colors ml-4" aria-label="Dismiss error">
                Dismiss
              </button>
            </div>
          )}

          {seedsLoading ? (
            <div className="flex flex-col gap-px bg-b-DEFAULT">
              {[1, 2].map((i) => (
                <div key={i} className="bg-void p-6">
                  <div className="h-4 w-48 mb-3 bg-gradient-to-r from-surface-2 via-surface-3 to-surface-2 bg-[length:200%_100%] animate-[shimmer_1.5s_ease_infinite]" />
                  <div className="h-3 w-full mb-2 bg-gradient-to-r from-surface-2 via-surface-3 to-surface-2 bg-[length:200%_100%] animate-[shimmer_1.5s_ease_infinite]" />
                  <div className="h-3 w-24 bg-gradient-to-r from-surface-2 via-surface-3 to-surface-2 bg-[length:200%_100%] animate-[shimmer_1.5s_ease_infinite]" />
                </div>
              ))}
            </div>
          ) : seeds.length === 0 && !error ? (
            <div className="text-detail text-t-dim p-8 border border-b-DEFAULT text-center">
              No seed files found. Add YAML files to backend/babel/seeds/
            </div>
          ) : (
            <div className="flex flex-col gap-px bg-b-DEFAULT">
              {seeds.map((seed) => (
                <button
                  key={seed.file}
                  onClick={() => handleLaunch(seed.file)}
                  disabled={loading}
                  className="bg-void p-6 text-left hover:bg-surface-1 transition-colors disabled:opacity-30 group"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-body font-semibold group-hover:text-primary transition-colors">
                      {seed.name}
                    </span>
                    <span className="text-micro text-t-dim tracking-wider">
                      {seed.file}
                    </span>
                  </div>
                  <p className="text-detail text-t-muted normal-case tracking-normal leading-relaxed mb-3">
                    {seed.description}
                  </p>
                  <div className="flex gap-4 text-micro text-t-muted tracking-wider">
                    <span>{seed.agent_count} Agents</span>
                    <span>{seed.location_count} Locations</span>
                  </div>
                </button>
              ))}
            </div>
          )}

          <a
            href="/create"
            className="mt-4 inline-flex items-center justify-center gap-2 h-12 w-full text-detail font-medium tracking-wider border border-b-DEFAULT text-t-muted hover:border-primary hover:text-primary transition-colors"
          >
            + Create Custom World
          </a>

          {/* Previous sessions */}
          {sessions.length > 0 && (
            <div className="mt-10">
              <div className="text-micro text-t-muted tracking-widest mb-4">
                Previous Sessions
              </div>
              <div className="flex flex-col gap-px bg-b-DEFAULT">
                {sessions.map((s) => {
                  let worldName = "Unknown";
                  try {
                    worldName = JSON.parse(s.world_seed).name || worldName;
                  } catch {}
                  return (
                    <a
                      key={s.id}
                      href={`/sim?id=${s.id}`}
                      className="bg-void px-6 py-4 hover:bg-surface-1 transition-colors flex items-center justify-between group"
                    >
                      <div>
                        <span className="text-body font-semibold group-hover:text-primary transition-colors">
                          {worldName}
                        </span>
                        <div className="flex gap-4 mt-1 text-micro text-t-dim tracking-wider">
                          <span>Tick {s.tick}</span>
                          <span>{s.status}</span>
                          <span>{s.id}</span>
                        </div>
                      </div>
                      <span className="text-micro text-t-dim tracking-wider">
                        Resume
                      </span>
                    </a>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
