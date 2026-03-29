import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import AssetPanel from "@/components/AssetPanel";

vi.mock("@/lib/locale-context", () => ({
  useLocale: () => ({
    locale: "cn",
    toggle: vi.fn(),
    t: (key: string) => key,
  }),
}));

const apiMocks = vi.hoisted(() => ({
  fetchAssets: vi.fn().mockResolvedValue([]),
  enrichEntity: vi.fn().mockResolvedValue({}),
  saveAsset: vi.fn(),
  saveEntityDetails: vi.fn(),
  updateAsset: vi.fn(),
}));

vi.mock("@/lib/api", () => apiMocks);

const baseState = {
  name: "Cyber Bar",
  description: "A neon sandbox",
  tick: 3,
  rules: ["Stay alive"],
  locations: [
    { name: "Bar", description: "Main floor" },
    { name: "Alley", description: "Back exit" },
  ],
  agents: {
    a1: {
      id: "a1",
      name: "Drifter",
      description: "Mercenary",
      personality: "Cold",
      goals: ["Find the chip"],
      memory: [],
      inventory: ["Knife"],
      location: "Bar",
      status: "idle",
      role: "main",
    },
    a2: {
      id: "a2",
      name: "Fixer",
      description: "Broker",
      personality: "Calm",
      goals: ["Close the deal"],
      memory: [],
      inventory: [],
      location: "Bar",
      status: "idle",
      role: "main",
    },
  },
  relations: [],
  recent_events: [],
} as const;

describe("AssetPanel human control", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.fetchAssets.mockResolvedValue([]);
    apiMocks.enrichEntity.mockResolvedValue({});
    apiMocks.saveEntityDetails.mockResolvedValue({});
  });

  it("shows the inline manual panel with the clearer toggle label", async () => {
    render(
      <AssetPanel
        state={baseState}
        activeAgentId={null}
        sessionId="session-1"
        onChat={vi.fn()}
        onExtractAgent={vi.fn()}
        onExtractWorld={vi.fn()}
        controlledAgents={new Set(["a1"])}
        waitingAgents={{}}
        onTakeControl={vi.fn()}
        onReleaseControl={vi.fn()}
        onSubmitHumanAction={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Drifter/ }));

    expect(await screen.findByText("release_control")).toBeTruthy();
    expect(screen.getByText("manual_control_standby")).toBeTruthy();
    expect(screen.getByText("manual_control_waiting_hint")).toBeTruthy();
  });

  it("submits the inline action when the agent is waiting", async () => {
    const onSubmitHumanAction = vi.fn().mockResolvedValue(undefined);

    render(
      <AssetPanel
        state={baseState}
        activeAgentId={null}
        sessionId="session-1"
        onChat={vi.fn()}
        onExtractAgent={vi.fn()}
        onExtractWorld={vi.fn()}
        controlledAgents={new Set(["a1"])}
        waitingAgents={{
          a1: {
            agent_name: "Drifter",
            location: "Bar",
            inventory: ["Knife"],
            visible_agents: [{ id: "a2", name: "Fixer", location: "Bar" }],
            reachable_locations: ["Bar", "Alley"],
          },
        }}
        onTakeControl={vi.fn()}
        onReleaseControl={vi.fn()}
        onSubmitHumanAction={onSubmitHumanAction}
      />,
    );

    expect(await screen.findByText("waiting_for_action")).toBeTruthy();

    const input = screen.getByPlaceholderText("manual_instruction_placeholder");
    fireEvent.change(input, { target: { value: "Ask about the chip" } });

    const targetSelect = screen.getByRole("combobox");
    fireEvent.change(targetSelect, { target: { value: "a2" } });

    fireEvent.click(screen.getByRole("button", { name: "action_submit" }));

    await waitFor(() => {
      expect(onSubmitHumanAction).toHaveBeenCalledWith("a1", "speak", "a2", "Ask about the chip");
    });
  });

  it("only generates item details on demand, then shows an explicit item edit button", async () => {
    apiMocks.enrichEntity.mockResolvedValue({
      description: "A worn combat knife.",
      properties: ["Sharp"],
    });

    render(
      <AssetPanel
        state={baseState}
        activeAgentId={null}
        sessionId="session-1"
        onChat={vi.fn()}
        onExtractAgent={vi.fn()}
        onExtractWorld={vi.fn()}
        controlledAgents={new Set()}
        waitingAgents={{}}
        onTakeControl={vi.fn()}
        onReleaseControl={vi.fn()}
        onSubmitHumanAction={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(apiMocks.fetchAssets).toHaveBeenCalledWith("item");
    });

    fireEvent.click(screen.getByRole("tab", { name: /item/i }));
    fireEvent.click(screen.getByRole("button", { name: /Knife/i }));
    expect(screen.queryByText("A worn combat knife.")).toBeNull();
    expect(screen.getByText("world_item_empty")).toBeTruthy();
    expect(screen.getByRole("button", { name: "export_to_seed_library" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "generate_details" }));

    expect(await screen.findByText("A worn combat knife.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "edit_item_details" })).toBeTruthy();
  });

  it("edits world-local item details without exporting a seed", async () => {
    apiMocks.saveEntityDetails.mockResolvedValue({
      description: "A knife wrapped in old tape.",
      origin: "",
      properties: ["Sharp"],
      significance: "Drifter trusts it more than people.",
    });

    render(
      <AssetPanel
        state={baseState}
        activeAgentId={null}
        sessionId="session-1"
        onChat={vi.fn()}
        onExtractAgent={vi.fn()}
        onExtractWorld={vi.fn()}
        controlledAgents={new Set()}
        waitingAgents={{}}
        onTakeControl={vi.fn()}
        onReleaseControl={vi.fn()}
        onSubmitHumanAction={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(apiMocks.fetchAssets).toHaveBeenCalledWith("item");
    });

    fireEvent.click(screen.getByRole("tab", { name: /item/i }));
    fireEvent.click(screen.getByRole("button", { name: /Knife/i }));
    fireEvent.click(screen.getByRole("button", { name: "edit_item_details" }));

    fireEvent.change(screen.getByLabelText("description"), {
      target: { value: "A knife wrapped in old tape." },
    });
    fireEvent.change(screen.getByLabelText("significance"), {
      target: { value: "Drifter trusts it more than people." },
    });
    fireEvent.change(screen.getByPlaceholderText("ph_item_property"), {
      target: { value: "Sharp" },
    });
    fireEvent.click(screen.getByRole("button", { name: "add_property" }));
    fireEvent.click(screen.getByRole("button", { name: "save_world_item_details" }));

    await waitFor(() => {
      expect(apiMocks.saveEntityDetails).toHaveBeenCalledWith("session-1", "item", "Knife", {
        description: "A knife wrapped in old tape.",
        origin: "",
        properties: ["Sharp"],
        significance: "Drifter trusts it more than people.",
      });
    });

    expect(await screen.findByText("A knife wrapped in old tape.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "export_to_seed_library" })).toBeTruthy();
  });
});
