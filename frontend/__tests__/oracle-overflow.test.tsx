import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import OracleChat from "@/components/OracleChat";
import OracleSeedCard from "@/components/OracleSeedCard";

const t = (key: string) => key;

describe("Oracle overflow handling", () => {
  it("lets long seed descriptions expand", () => {
    const longDescription = "A".repeat(220);
    const { container } = render(
      <OracleSeedCard
        seed={{
          name: "Long Seed",
          description: longDescription,
          agents: [{ name: "Agent with a very long ceremonial title" }],
          locations: [{ name: "The Observatory Above the Endless Sea" }],
          rules: ["Rule 1"],
        }}
        onPrimaryAction={() => {}}
        primaryActionLabel="apply"
        actionPending={false}
        t={t}
      />
    );

    expect(screen.getByText("expand")).toBeInTheDocument();
    const description = container.querySelector(".line-clamp-4");
    expect(description).toBeTruthy();

    fireEvent.click(screen.getByText("expand"));

    expect(screen.getByText("collapse")).toBeInTheDocument();
    expect(container.querySelector(".line-clamp-4")).toBeFalsy();
  });

  it("lets long oracle messages expand", () => {
    const longMessage = "Signal ".repeat(80);

    const { container } = render(
      <OracleChat
        messages={[
          {
            id: "oracle-1",
            role: "oracle",
            content: longMessage,
            tick: 0,
            created_at: new Date().toISOString(),
          },
        ]}
        loading={false}
        error={null}
        mode="narrate"
        historyLoaded={true}
        latestMsgId={null}
        generatedSeed={null}
        creatingSeed={false}
        scrollRef={createRef<HTMLDivElement>()}
        onSend={() => {}}
        onDismissError={() => {}}
        onPrimaryAction={() => {}}
        primaryActionLabel="apply"
        t={t}
      />
    );

    expect(screen.getByText("expand")).toBeInTheDocument();
    expect(container.querySelector(".line-clamp-6")).toBeTruthy();

    fireEvent.click(screen.getByText("expand"));

    expect(screen.getByText("collapse")).toBeInTheDocument();
    expect(container.querySelector(".line-clamp-6")).toBeFalsy();
  });
});
