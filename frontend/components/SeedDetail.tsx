"use client";

import { SavedSeedData } from "@/lib/api";

const TYPE_STYLES: Record<string, string> = {
  world: "text-primary border-primary",
  agent: "text-info border-info",
  item: "text-warning border-warning",
  location: "text-t-secondary border-t-secondary",
  event: "text-danger border-danger",
};

function DataField({ label, value }: { label: string; value: string | string[] }) {
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    return (
      <div>
        <div className="text-micro text-t-muted tracking-widest mb-1">{label}</div>
        <div className="flex flex-wrap gap-1">
          {value.map((v, i) => (
            <span key={i} className="text-detail text-t-secondary px-2 py-[2px] border border-b-DEFAULT normal-case tracking-normal">
              {v}
            </span>
          ))}
        </div>
      </div>
    );
  }
  if (!value) return null;
  return (
    <div>
      <div className="text-micro text-t-muted tracking-widest mb-1">{label}</div>
      <div className="text-detail text-t-secondary normal-case tracking-normal leading-relaxed">{value}</div>
    </div>
  );
}

function renderSeedData(seed: SavedSeedData) {
  const d = seed.data;

  switch (seed.type) {
    case "agent":
      return (
        <div className="flex flex-col gap-3">
          <DataField label="Personality" value={d.personality as string} />
          <DataField label="Goals" value={d.goals as string[]} />
          <DataField label="Location" value={d.location as string} />
          <DataField label="Inventory" value={d.inventory as string[]} />
        </div>
      );
    case "item":
      return (
        <div className="flex flex-col gap-3">
          <DataField label="Name" value={d.name as string} />
          <DataField label="Description" value={(d.description as string) || ""} />
          <DataField label="Tags" value={(d.tags as string[]) || []} />
        </div>
      );
    case "location":
      return (
        <div className="flex flex-col gap-3">
          <DataField label="Description" value={d.description as string} />
        </div>
      );
    case "event":
      return (
        <div className="flex flex-col gap-3">
          <DataField label="Content" value={d.content as string} />
          <DataField label="Action Type" value={d.action_type as string} />
        </div>
      );
    case "world":
      return (
        <div className="flex flex-col gap-3">
          <DataField label="Description" value={d.description as string} />
          <DataField label="Rules" value={d.rules as string[]} />
          <DataField label="Locations" value={(d.locations as { name: string }[])?.map(l => l.name) || []} />
          <DataField label="Agents" value={(d.agents as { name: string }[])?.map(a => a.name) || []} />
          <DataField label="Initial Events" value={d.initial_events as string[]} />
        </div>
      );
    default:
      return (
        <pre className="text-detail text-t-secondary normal-case tracking-normal leading-relaxed whitespace-pre-wrap">
          {JSON.stringify(d, null, 2)}
        </pre>
      );
  }
}

export default function SeedDetail({
  seed,
  onClose,
}: {
  seed: SavedSeedData;
  onClose: () => void;
}) {
  const style = TYPE_STYLES[seed.type] || "text-t-muted border-b-DEFAULT";

  return (
    <div
      className="fixed inset-0 bg-[rgba(0,0,0,0.8)] flex items-center justify-center z-[400] animate-[fade-in_150ms_ease]"
      onClick={onClose}
    >
      <div
        className="bg-surface-1 border border-b-DEFAULT w-[560px] max-w-[90vw] max-h-[80vh] flex flex-col animate-[slide-up_300ms_ease]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-b-DEFAULT flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <span className={`text-micro tracking-wider px-2.5 py-[2px] border leading-none font-medium ${style}`}>
              {seed.type}
            </span>
            <span className="text-body font-semibold">{seed.name}</span>
          </div>
          <button
            onClick={onClose}
            className="text-micro text-t-muted tracking-wider hover:text-white transition-colors"
          >
            Close
          </button>
        </div>

        {/* Description */}
        {seed.description && (
          <div className="px-6 py-3 border-b border-b-DEFAULT">
            <div className="text-detail text-t-muted normal-case tracking-normal leading-relaxed">
              {seed.description}
            </div>
          </div>
        )}

        {/* Data */}
        <div className="px-6 py-4 overflow-y-auto flex-1">
          {renderSeedData(seed)}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-b-DEFAULT flex items-center justify-between shrink-0">
          <div className="flex items-center gap-4">
            {seed.tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {seed.tags.map((tag, i) => (
                  <span key={i} className="text-micro text-t-dim tracking-wider px-2 py-[1px] border border-surface-3">
                    {tag}
                  </span>
                ))}
              </div>
            )}
            {seed.source_world && (
              <span className="text-micro text-t-dim tracking-wider">
                from {seed.source_world}
              </span>
            )}
          </div>
          <span className="text-micro text-t-dim tracking-wider tabular-nums">
            {seed.id}
          </span>
        </div>
      </div>
    </div>
  );
}
