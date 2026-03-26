"use client";

interface OracleSeedCardProps {
  seed: Record<string, unknown>;
  onCreateWorld: () => void;
  creating: boolean;
  t: (key: string, ...args: string[]) => string;
}

export default function OracleSeedCard({
  seed,
  onCreateWorld,
  creating,
  t,
}: OracleSeedCardProps) {
  const agents = (seed.agents as Array<{ name: string; personality?: string }>) || [];
  const locations = (seed.locations as Array<{ name: string }>) || [];
  const rules = (seed.rules as string[]) || [];
  const seedName = String(seed.name || "UNTITLED");
  const seedDesc = seed.description ? String(seed.description) : "";

  return (
    <div className="border border-info/30 bg-info/[0.03] animate-oracle-slide-left">
      {/* Seed header */}
      <div className="px-3 py-2 border-b border-info/15 flex items-center justify-between">
        <span className="text-micro text-info tracking-widest truncate min-w-0">
          {seedName}
        </span>
        <span className="text-micro text-info/40 tracking-wider">SEED</span>
      </div>

      {/* Description */}
      {seedDesc && (
        <div className="px-3 py-2 border-b border-info/10">
          <div className="text-detail text-t-secondary normal-case tracking-normal leading-relaxed line-clamp-3">
            {seedDesc}
          </div>
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-px bg-info/10 border-b border-info/10">
        <div className="bg-void px-3 py-2">
          <div className="text-micro text-info/50 tracking-widest">{t("oracle_seed_agents")}</div>
          <div className="text-body font-semibold text-info mt-0.5">{agents.length}</div>
        </div>
        <div className="bg-void px-3 py-2">
          <div className="text-micro text-info/50 tracking-widest">{t("oracle_seed_locations")}</div>
          <div className="text-body font-semibold text-info mt-0.5">{locations.length}</div>
        </div>
        <div className="bg-void px-3 py-2">
          <div className="text-micro text-info/50 tracking-widest">{t("oracle_seed_rules")}</div>
          <div className="text-body font-semibold text-info mt-0.5">{rules.length}</div>
        </div>
      </div>

      {/* Agent names */}
      {agents.length > 0 && (
        <div className="px-3 py-2 border-b border-info/10">
          <div className="flex flex-wrap gap-1">
            {agents.map((a, i) => (
              <span key={i} className="text-micro tracking-wider px-2 py-0.5 border border-info/20 text-info/70 truncate max-w-[160px]">
                {a.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Location names */}
      {locations.length > 0 && (
        <div className="px-3 py-2 border-b border-info/10">
          <div className="flex flex-wrap gap-1">
            {locations.map((loc, i) => (
              <span key={i} className="text-micro tracking-wider px-2 py-0.5 border border-surface-3 text-t-muted truncate max-w-[160px]">
                {loc.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Create button */}
      <div className="px-3 py-2">
        <button
          type="button"
          onClick={onCreateWorld}
          disabled={creating}
          className="w-full h-9 text-micro font-medium tracking-wider bg-info text-void border border-info hover:bg-transparent hover:text-info hover:shadow-[0_0_16px_rgba(14,165,233,0.3)] active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none transition-[colors,box-shadow,transform]"
        >
          {creating ? t("oracle_creating") : t("oracle_create_world")}
        </button>
      </div>
    </div>
  );
}
