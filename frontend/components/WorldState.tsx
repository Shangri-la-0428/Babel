"use client";

import { WorldState as WorldStateType } from "@/lib/api";

function JsonValue({ value }: { value: unknown }) {
  if (typeof value === "string")
    return <span className="text-t-secondary">&quot;{value}&quot;</span>;
  if (typeof value === "number")
    return <span className="text-warning">{value}</span>;
  if (typeof value === "boolean")
    return <span className="text-info">{String(value)}</span>;
  if (value === null) return <span className="text-t-dim">null</span>;
  return <span className="text-t-secondary">{JSON.stringify(value)}</span>;
}

export default function WorldStatePanel({ state }: { state: WorldStateType | null }) {
  if (!state) {
    return (
      <div className="p-4 text-detail text-t-dim">No world loaded</div>
    );
  }

  const summary = {
    name: state.name,
    tick: state.tick,
    status: state.status,
    agents: Object.keys(state.agents).length,
    locations: state.locations.map((l) => l.name),
    rules: state.rules.length,
    events: state.recent_events.length,
  };

  return (
    <pre className="font-mono text-detail leading-relaxed normal-case tracking-normal p-4 whitespace-pre-wrap">
      <span className="text-t-muted">{"{\n"}</span>
      {Object.entries(summary).map(([key, val], i, arr) => (
        <span key={key}>
          {"  "}
          <span className="text-primary">&quot;{key}&quot;</span>
          <span className="text-t-muted">: </span>
          {Array.isArray(val) ? (
            <>
              <span className="text-t-muted">[</span>
              {val.map((v, j) => (
                <span key={j}>
                  <JsonValue value={v} />
                  {j < val.length - 1 && <span className="text-t-muted">, </span>}
                </span>
              ))}
              <span className="text-t-muted">]</span>
            </>
          ) : (
            <JsonValue value={val} />
          )}
          {i < arr.length - 1 && <span className="text-t-muted">,</span>}
          {"\n"}
        </span>
      ))}
      <span className="text-t-muted">{"}"}</span>
    </pre>
  );
}
