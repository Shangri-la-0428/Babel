"use client";

import { WorldItemData } from "@/lib/api";

type InventoryAgentLike = {
  name?: string;
  id?: string;
  inventory?: string[];
};

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

export function normalizeWorldItem(raw?: Partial<WorldItemData> | null): WorldItemData {
  return {
    name: typeof raw?.name === "string" ? raw.name.trim() : "",
    description: typeof raw?.description === "string" ? raw.description : "",
    origin: typeof raw?.origin === "string" ? raw.origin : "",
    properties: Array.isArray(raw?.properties)
      ? uniqueStrings(raw.properties.map((value) => String(value)))
      : [],
    significance: typeof raw?.significance === "string" ? raw.significance : "",
  };
}

export function mergeWorldItemsWithInventories(
  items: WorldItemData[] | undefined,
  agents: InventoryAgentLike[] | undefined,
): WorldItemData[] {
  const merged = new Map<string, WorldItemData>();

  (items || []).forEach((item) => {
    const normalized = normalizeWorldItem(item);
    if (!normalized.name) return;
    merged.set(normalized.name, normalized);
  });

  (agents || []).forEach((agent) => {
    (agent.inventory || []).forEach((itemName) => {
      const normalizedName = itemName.trim();
      if (!normalizedName || merged.has(normalizedName)) return;
      merged.set(normalizedName, normalizeWorldItem({ name: normalizedName }));
    });
  });

  return Array.from(merged.values());
}

export function buildItemHolders(
  agents: InventoryAgentLike[] | undefined,
): Map<string, string[]> {
  const holdersByItem = new Map<string, string[]>();

  (agents || []).forEach((agent) => {
    const holderName = agent.name?.trim() || agent.id?.trim() || "";
    (agent.inventory || []).forEach((itemName) => {
      const normalizedName = itemName.trim();
      if (!normalizedName) return;
      const holders = holdersByItem.get(normalizedName) || [];
      if (holderName) holders.push(holderName);
      holdersByItem.set(normalizedName, uniqueStrings(holders));
    });
  });

  return holdersByItem;
}
