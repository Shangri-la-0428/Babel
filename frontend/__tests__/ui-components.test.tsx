import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StatusDot, Badge, ErrorBanner, EmptyState, FormLabel, DetailSection, ExpandableInput, StringListEditor } from "@/components/ui";

// Mock useLocale for components that need it
vi.mock("@/lib/locale-context", () => ({
  useLocale: () => ({
    locale: "en",
    toggle: vi.fn(),
    t: (key: string) => key,
  }),
}));

describe("StatusDot", () => {
  it("renders with correct status class", () => {
    const { container } = render(<StatusDot status="running" />);
    const dot = container.querySelector("span");
    expect(dot).toBeTruthy();
    expect(dot!.className).toContain("bg-primary");
    expect(dot!.className).toContain("animate-pulse-glow");
  });

  it("falls back to idle for unknown status", () => {
    const { container } = render(<StatusDot status="nonexistent" />);
    const dot = container.querySelector("span");
    expect(dot!.className).toContain("bg-t-dim");
  });

  it("applies custom className", () => {
    const { container } = render(<StatusDot status="idle" className="w-4 h-4" />);
    const dot = container.querySelector("span");
    expect(dot!.className).toContain("w-4 h-4");
  });

  it("is aria-hidden (decorative)", () => {
    const { container } = render(<StatusDot status="idle" />);
    const dot = container.querySelector("span");
    expect(dot!.getAttribute("aria-hidden")).toBe("true");
  });

  it("is always circular (rounded-full)", () => {
    const { container } = render(<StatusDot status="acting" />);
    const dot = container.querySelector("span");
    expect(dot!.className).toContain("rounded-full");
  });
});

describe("Badge", () => {
  it("renders children", () => {
    render(<Badge>TEST</Badge>);
    expect(screen.getByText("TEST")).toBeTruthy();
  });

  it("applies default variant classes", () => {
    const { container } = render(<Badge>Default</Badge>);
    const span = container.querySelector("span");
    expect(span!.className).toContain("text-t-muted");
    expect(span!.className).toContain("border-b-DEFAULT");
  });

  it("applies danger variant", () => {
    const { container } = render(<Badge variant="danger">Error</Badge>);
    const span = container.querySelector("span");
    expect(span!.className).toContain("text-danger");
    expect(span!.className).toContain("border-danger");
  });

  it("uses design system text-micro size", () => {
    const { container } = render(<Badge>Small</Badge>);
    const span = container.querySelector("span");
    expect(span!.className).toContain("text-micro");
  });
});

describe("ErrorBanner", () => {
  it("displays error message", () => {
    render(<ErrorBanner message="Something broke" onDismiss={vi.fn()} />);
    expect(screen.getByText("Something broke")).toBeTruthy();
  });

  it("has role=alert for accessibility", () => {
    render(<ErrorBanner message="Error" onDismiss={vi.fn()} />);
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("calls onDismiss when dismiss button clicked", () => {
    const onDismiss = vi.fn();
    render(<ErrorBanner message="Error" onDismiss={onDismiss} />);
    // Button text is the t("dismiss") key
    fireEvent.click(screen.getByText("dismiss"));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("dismiss button has type=button", () => {
    render(<ErrorBanner message="Error" onDismiss={vi.fn()} />);
    const btn = screen.getByText("dismiss");
    expect(btn.getAttribute("type")).toBe("button");
  });

  it("renders children (e.g. retry button)", () => {
    render(
      <ErrorBanner message="Error" onDismiss={vi.fn()}>
        <button type="button">Retry</button>
      </ErrorBanner>
    );
    expect(screen.getByText("Retry")).toBeTruthy();
  });

  it("applies header variant classes", () => {
    const { container } = render(
      <ErrorBanner message="Error" onDismiss={vi.fn()} variant="header" />
    );
    const alert = container.querySelector("[role=alert]");
    expect(alert!.className).toContain("bg-surface-1");
  });

  it("applies inline variant by default", () => {
    const { container } = render(
      <ErrorBanner message="Error" onDismiss={vi.fn()} />
    );
    const alert = container.querySelector("[role=alert]");
    expect(alert!.className).toContain("border-danger");
    expect(alert!.className).not.toContain("bg-surface-1");
  });
});

describe("EmptyState", () => {
  it("renders label text", () => {
    render(<EmptyState label="// NO DATA" />);
    expect(screen.getByText("// NO DATA")).toBeTruthy();
  });

  it("renders children", () => {
    render(
      <EmptyState label="Empty">
        <span>Create something</span>
      </EmptyState>
    );
    expect(screen.getByText("Create something")).toBeTruthy();
  });

  it("has cursor animation element", () => {
    const { container } = render(<EmptyState label="Waiting" variant="waiting" />);
    const cursor = container.querySelector("[aria-hidden=true]");
    expect(cursor).toBeTruthy();
    expect(cursor!.className).toContain("animate-");
  });
});

describe("FormLabel", () => {
  it("renders as <label>", () => {
    const { container } = render(<FormLabel>Test Label</FormLabel>);
    expect(container.querySelector("label")).toBeTruthy();
  });

  it("links to input via htmlFor", () => {
    const { container } = render(<FormLabel htmlFor="my-input">Label</FormLabel>);
    const label = container.querySelector("label");
    expect(label!.getAttribute("for")).toBe("my-input");
  });

  it("uses design system label classes", () => {
    const { container } = render(<FormLabel>Label</FormLabel>);
    const label = container.querySelector("label");
    expect(label!.className).toContain("text-micro");
    expect(label!.className).toContain("text-t-muted");
    expect(label!.className).toContain("tracking-widest");
  });
});

describe("DetailSection", () => {
  it("renders label and children", () => {
    render(<DetailSection label="STATUS">Active</DetailSection>);
    expect(screen.getByText("STATUS")).toBeTruthy();
    expect(screen.getByText("Active")).toBeTruthy();
  });

  it("uses design system section classes", () => {
    const { container } = render(<DetailSection label="Test">Content</DetailSection>);
    const div = container.firstChild as HTMLElement;
    expect(div.className).toContain("border-b");
  });
});

describe("ExpandableInput", () => {
  it("supports manual expand and collapse for text fields", () => {
    const onValueChange = vi.fn();
    const { container } = render(
      <ExpandableInput id="expandable" value="Short text" onValueChange={onValueChange} className="w-full h-9" />
    );

    fireEvent.click(screen.getByText("expand"));
    expect(container.querySelector("textarea")).toBeTruthy();

    fireEvent.click(screen.getByText("collapse"));
    expect(container.querySelector("input")).toBeTruthy();
  });

  it("normalizes line breaks when expanded", () => {
    const onValueChange = vi.fn();
    const { container } = render(
      <ExpandableInput id="expandable-lines" value="Line" onValueChange={onValueChange} className="w-full h-9" />
    );

    fireEvent.click(screen.getByText("expand"));
    const textarea = container.querySelector("textarea");
    expect(textarea).toBeTruthy();
    fireEvent.change(textarea!, { target: { value: "alpha\nbeta" } });
    expect(onValueChange).toHaveBeenLastCalledWith("alpha beta");
  });
});

describe("StringListEditor", () => {
  it("adds a new independent item", () => {
    function Harness() {
      const [items, setItems] = React.useState<string[]>(["dagger"]);
      return (
        <StringListEditor
          values={items}
          onChange={setItems}
          addLabel="add"
          itemPlaceholder="item"
          addPlaceholder="item"
        />
      );
    }

    render(<Harness />);
    const inputs = screen.getAllByRole("textbox");
    fireEvent.change(inputs[1], { target: { value: "torch" } });
    fireEvent.click(screen.getByText("add"));
    expect(screen.getAllByRole("textbox")).toHaveLength(3);
    expect(screen.getByDisplayValue("dagger")).toBeTruthy();
    expect(screen.getByDisplayValue("torch")).toBeTruthy();
  });

  it("removes an emptied item on blur instead of merging text", () => {
    function Harness() {
      const [items, setItems] = React.useState<string[]>(["dagger", "torch"]);
      return (
        <StringListEditor
          values={items}
          onChange={setItems}
          addLabel="add"
          itemPlaceholder="item"
        />
      );
    }

    render(<Harness />);
    const inputs = screen.getAllByRole("textbox");
    fireEvent.change(inputs[0], { target: { value: "" } });
    fireEvent.blur(inputs[0]);
    expect(screen.queryByDisplayValue("dagger")).toBeNull();
    expect(screen.getByDisplayValue("torch")).toBeTruthy();
  });
});
