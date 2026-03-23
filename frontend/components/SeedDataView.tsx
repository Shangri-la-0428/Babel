import { SeedTypeValue } from "@/lib/api";
import { TransKey } from "@/lib/i18n";

export const TYPE_STYLES: Record<string, string> = {
  world: "text-primary border-primary",
  agent: "text-info border-info",
  item: "text-warning border-warning",
  location: "text-t-secondary border-t-secondary",
  event: "text-danger border-danger",
};

function DataField({ label, value, asList }: { label: string; value: string | string[]; asList?: boolean }) {
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    if (asList) {
      return (
        <div>
          <div className="text-micro text-t-muted tracking-widest mb-1">{label}</div>
          <div className="flex flex-col gap-1">
            {value.map((v, i) => (
              <div key={i} className="flex items-baseline gap-2">
                <span className="text-micro text-t-dim tracking-wider shrink-0">{String(i + 1).padStart(2, "0")}</span>
                <span className="text-detail text-t-secondary normal-case tracking-normal">{v}</span>
              </div>
            ))}
          </div>
        </div>
      );
    }
    return (
      <div>
        <div className="text-micro text-t-muted tracking-widest mb-1">{label}</div>
        <div className="flex flex-wrap gap-1">
          {value.map((v, i) => (
            <span key={i} className="text-detail text-t-secondary px-2 py-0.5 border border-b-DEFAULT normal-case tracking-normal">
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

export function renderSeedData(
  type: SeedTypeValue,
  data: Record<string, unknown>,
  t: (key: TransKey, ...args: string[]) => string,
) {
  switch (type) {
    case "agent":
      return (
        <div className="flex flex-col gap-3">
          <DataField label={t("personality")} value={data.personality as string} />
          <DataField label={t("goals_label")} value={data.goals as string[]} asList />
          <DataField label={t("location")} value={data.location as string} />
          <DataField label={t("inventory_label")} value={data.inventory as string[]} />
        </div>
      );
    case "item":
      return (
        <div className="flex flex-col gap-3">
          <DataField label={t("name")} value={data.name as string} />
          <DataField label={t("description")} value={(data.description as string) || ""} />
          <DataField label={t("tags_label")} value={(data.tags as string[]) || []} />
        </div>
      );
    case "location":
      return (
        <div className="flex flex-col gap-3">
          <DataField label={t("description")} value={data.description as string} />
        </div>
      );
    case "event":
      return (
        <div className="flex flex-col gap-3">
          <DataField label={t("content_label")} value={data.content as string} />
          <DataField label={t("action_type")} value={data.action_type as string} />
        </div>
      );
    case "world":
      return (
        <div className="flex flex-col gap-3">
          <DataField label={t("description")} value={data.description as string} />
          <DataField label={t("rules_label")} value={data.rules as string[]} asList />
          <DataField label={t("locations_label")} value={(data.locations as { name: string }[])?.map(l => l.name) || []} />
          <DataField label={t("agents")} value={(data.agents as { name: string }[])?.map(a => a.name) || []} />
          <DataField label={t("initial_events_label")} value={data.initial_events as string[]} asList />
        </div>
      );
    default:
      return (
        <pre className="text-detail text-t-secondary normal-case tracking-normal leading-relaxed whitespace-pre-wrap">
          {JSON.stringify(data, null, 2)}
        </pre>
      );
  }
}
