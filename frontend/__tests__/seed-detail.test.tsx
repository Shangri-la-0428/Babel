import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi, afterEach, describe, expect, it } from "vitest";
import SeedDetail from "@/components/SeedDetail";

const apiMocks = vi.hoisted(() => ({
  enrichEntity: vi.fn(),
  getEntityDetails: vi.fn(),
  getSessions: vi.fn(),
  updateAsset: vi.fn(),
}));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    enrichEntity: apiMocks.enrichEntity,
    getEntityDetails: apiMocks.getEntityDetails,
    getSessions: apiMocks.getSessions,
    updateAsset: apiMocks.updateAsset,
  };
});

describe("SeedDetail", () => {
  afterEach(() => {
    apiMocks.enrichEntity.mockReset();
    apiMocks.getEntityDetails.mockReset();
    apiMocks.getSessions.mockReset();
    apiMocks.updateAsset.mockReset();
  });

  it("saves edited item seed data while preserving the canonical item key", async () => {
    apiMocks.getEntityDetails.mockResolvedValue(null);
    apiMocks.getSessions.mockResolvedValue([]);

    const seed = {
      id: "item-seed-1",
      type: "item" as const,
      name: "Neon Blade",
      description: "Old description",
      tags: ["weapon"],
      data: {
        name: "Neon Blade",
        description: "Old description",
        properties: ["glowing"],
      },
      source_world: "session-1",
      created_at: "2026-03-29T00:00:00Z",
    };

    const updatedSeed = {
      ...seed,
      name: "Neon Blade Mk II",
      description: "Updated description",
      tags: ["weapon", "prototype"],
      data: {
        ...seed.data,
        name: "Neon Blade Mk II",
        description: "Updated description",
        origin: "Recovered from the vault",
        properties: ["glowing", "charged"],
        significance: "A symbol of the old regime",
      },
    };

    apiMocks.updateAsset.mockResolvedValue(updatedSeed);
    const onChange = vi.fn();

    render(<SeedDetail seed={seed} onClose={() => {}} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: /编辑种子|Edit Seed|edit_seed/i }));

    fireEvent.change(screen.getByLabelText(/描述|Description|description/i), {
      target: { value: "Updated description" },
    });
    fireEvent.change(screen.getByLabelText(/起源|Origin|origin/i), {
      target: { value: "Recovered from the vault" },
    });
    const propertyInputs = screen.getAllByPlaceholderText(/属性|PROPERTIES|properties/i);
    fireEvent.change(propertyInputs[propertyInputs.length - 1], {
      target: { value: "charged" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^\+ 添加属性$|^\+ Add Property$|^add_property$/i }));
    fireEvent.change(screen.getByLabelText(/意义|Significance|significance/i), {
      target: { value: "A symbol of the old regime" },
    });
    fireEvent.change(screen.getByLabelText(/名称|Name|name/i), {
      target: { value: "Neon Blade Mk II" },
    });

    fireEvent.click(screen.getByRole("button", { name: /保存|Save|save/i }));

    await waitFor(() => {
      expect(apiMocks.updateAsset).toHaveBeenCalledWith(
        "item-seed-1",
        expect.objectContaining({
          name: "Neon Blade Mk II",
          description: "Updated description",
          data: expect.objectContaining({
            name: "Neon Blade Mk II",
            description: "Updated description",
            origin: "Recovered from the vault",
            properties: ["glowing", "charged"],
            significance: "A symbol of the old regime",
          }),
        }),
      );
    });

    expect(onChange).toHaveBeenCalledWith(updatedSeed);
  });

  it("shows generate details for source-world assets by resolving the latest matching session", async () => {
    apiMocks.getEntityDetails.mockResolvedValue(null);
    apiMocks.getSessions.mockResolvedValue([
      {
        id: "session-cyber-bar",
        world_seed: JSON.stringify({ name: "赛博酒吧" }),
        tick: 6,
        status: "ended",
        created_at: "2026-03-29T00:00:00Z",
      },
    ]);
    apiMocks.enrichEntity.mockResolvedValue({
      description: "一把老旧却关键的钥匙。",
    });

    const seed = {
      id: "item-seed-2",
      type: "item" as const,
      name: "酒吧钥匙",
      description: "",
      tags: [],
      data: {
        name: "酒吧钥匙",
      },
      source_world: "赛博酒吧",
      created_at: "2026-03-29T00:00:00Z",
    };

    render(<SeedDetail seed={seed} onClose={() => {}} />);

    const generateButton = await screen.findByRole("button", { name: /生成详情|Generate Details|enrich/i });
    expect(generateButton).toBeTruthy();

    fireEvent.click(generateButton);

    await waitFor(() => {
      expect(apiMocks.enrichEntity).toHaveBeenCalledWith(
        "session-cyber-bar",
        "item",
        "酒吧钥匙",
        { language: "cn" },
      );
    });

    expect(await screen.findByRole("button", { name: /优化内容|optimize_item/i })).toBeTruthy();
  });
});
