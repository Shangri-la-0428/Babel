import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import EventFeed from "@/components/EventFeed";

vi.mock("@/lib/locale-context", () => ({
  useLocale: () => ({
    locale: "cn",
    toggle: vi.fn(),
    t: (key: string) => key,
  }),
}));

describe("EventFeed", () => {
  it("uses an explicit manual-save label for event assets", () => {
    const onSeed = vi.fn();

    render(
      <EventFeed
        events={[
          {
            id: "evt-1",
            tick: 3,
            agent_id: null,
            agent_name: null,
            action_type: "world_event",
            action: {},
            result: "[WORLD] A neon sign flickers.",
          },
        ]}
        onSeed={onSeed}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "save_event" }));
    expect(onSeed).toHaveBeenCalledWith("evt-1");
  });
});
