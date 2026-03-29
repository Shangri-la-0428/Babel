import { describe, expect, it } from "vitest";

import { buildItemHolders, mergeWorldItemsWithInventories } from "@/lib/world-items";

describe("world item helpers", () => {
  it("keeps authored item details while backfilling inventory-only items", () => {
    const merged = mergeWorldItemsWithInventories(
      [
        {
          name: "Command Terminal",
          description: "Portable command uplink.",
          origin: "Found in the debris field",
          properties: ["encrypted"],
          significance: "Contains evacuation routes.",
        },
      ],
      [
        { name: "Doctor", inventory: ["Command Terminal", "Black Card"] },
        { name: "Amiya", inventory: ["Black Card"] },
      ],
    );

    expect(merged).toEqual([
      {
        name: "Command Terminal",
        description: "Portable command uplink.",
        origin: "Found in the debris field",
        properties: ["encrypted"],
        significance: "Contains evacuation routes.",
      },
      {
        name: "Black Card",
        description: "",
        origin: "",
        properties: [],
        significance: "",
      },
    ]);
  });

  it("builds a unique holder list for each inventory item", () => {
    const holders = buildItemHolders([
      { name: "Doctor", inventory: ["Black Card", "Black Card"] },
      { name: "Amiya", inventory: ["Black Card", "Notebook"] },
    ]);

    expect(holders.get("Black Card")).toEqual(["Doctor", "Amiya"]);
    expect(holders.get("Notebook")).toEqual(["Amiya"]);
  });
});
