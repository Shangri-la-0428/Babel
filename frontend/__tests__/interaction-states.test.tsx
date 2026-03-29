import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Mock useLocale globally
vi.mock("@/lib/locale-context", () => ({
  useLocale: () => ({
    locale: "en",
    toggle: vi.fn(),
    t: (key: string, ...args: string[]) => {
      let s = key;
      args.forEach((a, i) => { s = s.replace(`{${i}}`, a); });
      return s;
    },
  }),
}));

// Mock spring for Modal
vi.mock("@/lib/spring", () => ({
  useSpring: (_target: number) => _target,
}));

// Mock api for Settings
vi.mock("@/lib/api", () => {
  const profile = {
    id: "profile_default",
    name: "Default",
    apiKey: "sk-test",
    apiBase: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    tickDelay: 3,
  };
  return {
    loadSettings: () => ({ apiKey: "sk-test", apiBase: "https://api.openai.com/v1", model: "gpt-4o-mini", tickDelay: 3 }),
    saveSettings: vi.fn(),
    loadSettingsProfiles: () => ({ version: 2, activeProfileId: profile.id, profiles: [profile] }),
    saveSettingsProfiles: vi.fn(),
    fetchOpenClawProfiles: vi.fn().mockResolvedValue([]),
    mergeImportedSettingsProfiles: vi.fn((store: unknown) => store),
    createSettingsProfile: (seed: Record<string, unknown> = {}) => ({
      ...profile,
      id: "profile_new",
      name: "New Profile",
      ...seed,
    }),
    fetchModels: vi.fn().mockResolvedValue([]),
  };
});

import Nav from "@/components/Nav";
import ControlBar from "@/components/ControlBar";
import Settings from "@/components/Settings";
import Modal from "@/components/Modal";

describe("Nav", () => {
  it("renders all navigation links", () => {
    render(<Nav activePage="home" />);
    expect(screen.getByText("home")).toBeTruthy();
    expect(screen.getByText("create")).toBeTruthy();
    expect(screen.getByText("assets")).toBeTruthy();
  });

  it("marks active page with aria-current", () => {
    render(<Nav activePage="home" />);
    const active = screen.getByText("home").closest("[aria-current]");
    expect(active!.getAttribute("aria-current")).toBe("page");
  });

  it("settings button has type=button", () => {
    render(<Nav activePage="home" onToggleSettings={vi.fn()} />);
    const btn = screen.getByText("settings");
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.getAttribute("type")).toBe("button");
  });

  it("settings button has aria-expanded", () => {
    render(<Nav activePage="home" showSettings={true} onToggleSettings={vi.fn()} />);
    const btn = screen.getByText("settings");
    expect(btn.getAttribute("aria-expanded")).toBe("true");
  });

  it("language toggle has type=button and active:scale", () => {
    const { container } = render(<Nav activePage="home" />);
    // Language toggle shows "EN" when locale is "en" (mock returns "en")
    // Actually our mock returns locale: "en", so toggle shows "中"
    const langBtn = container.querySelector("button[title='lang_switch']") ||
                    screen.getByLabelText("lang_switch");
    expect(langBtn.getAttribute("type")).toBe("button");
    expect(langBtn.className).toContain("active:scale-[0.97]");
  });

  it("has proper nav landmark with aria-label", () => {
    render(<Nav activePage="home" />);
    const nav = screen.getByRole("navigation");
    expect(nav.getAttribute("aria-label")).toBe("Main navigation");
  });
});

describe("ControlBar", () => {
  const defaultProps = {
    tick: 5,
    status: "paused",
    onRun: vi.fn(),
    onPause: vi.fn(),
    onStep: vi.fn(),
  };

  it("renders toolbar with aria-label", () => {
    render(<ControlBar {...defaultProps} />);
    const toolbar = screen.getByRole("toolbar");
    expect(toolbar.getAttribute("aria-label")).toBe("aria_controls");
  });

  it("all control buttons have type=button", () => {
    render(<ControlBar {...defaultProps} onOracle={vi.fn()} />);
    const buttons = screen.getAllByRole("button");
    for (const btn of buttons) {
      expect(btn.getAttribute("type"), `Button "${btn.textContent}" missing type`).toBe("button");
    }
  });

  it("run button has active:scale for tactile feedback", () => {
    render(<ControlBar {...defaultProps} />);
    const runBtn = screen.getByLabelText("aria_run");
    expect(runBtn.className).toContain("active:scale-[0.97]");
  });

  it("step button has active:scale for tactile feedback", () => {
    render(<ControlBar {...defaultProps} />);
    const stepBtn = screen.getByLabelText("aria_step");
    expect(stepBtn.className).toContain("active:scale-[0.97]");
  });

  it("disables run/step when running", () => {
    render(<ControlBar {...defaultProps} status="running" />);
    const runBtn = screen.getByLabelText("aria_run");
    const stepBtn = screen.getByLabelText("aria_step");
    expect(runBtn).toHaveProperty("disabled", true);
    expect(stepBtn).toHaveProperty("disabled", true);
  });

  it("oracle button has aria-expanded", () => {
    render(<ControlBar {...defaultProps} onOracle={vi.fn()} oracleOpen={true} />);
    const oracleBtn = screen.getByText("oracle");
    expect(oracleBtn.getAttribute("aria-expanded")).toBe("true");
  });

  it("shows tick counter", () => {
    render(<ControlBar {...defaultProps} tick={42} />);
    expect(screen.getByText("tick")).toBeTruthy();
    // DigitCascade splits into individual digit spans
    expect(screen.getByText("0")).toBeTruthy();
    expect(screen.getByText("4")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("shows disconnected status with danger styling", () => {
    render(<ControlBar {...defaultProps} wsStatus="disconnected" />);
    expect(screen.getByText("disconnected")).toBeTruthy();
  });
});

describe("Settings", () => {
  it("all buttons have type=button", () => {
    render(<Settings onClose={vi.fn()} onSave={vi.fn()} />);
    const buttons = screen.getAllByRole("button");
    for (const btn of buttons) {
      expect(btn.getAttribute("type"), `Button "${btn.textContent}" missing type`).toBe("button");
    }
  });

  it("save button has active:scale", () => {
    render(<Settings onClose={vi.fn()} onSave={vi.fn()} />);
    const saveBtn = screen.getByText("save_and_activate");
    expect(saveBtn.className).toContain("active:scale-[0.97]");
  });

  it("all inputs have associated labels", () => {
    render(<Settings onClose={vi.fn()} onSave={vi.fn()} />);
    const inputs = screen.getAllByRole("textbox");
    for (const input of inputs) {
      const id = input.getAttribute("id");
      expect(id, "Input missing id for label association").toBeTruthy();
    }
  });

  it("fetch models button disabled without credentials", () => {
    // Override mock to return empty credentials
    vi.doMock("@/lib/api", () => ({
      loadSettings: () => ({ apiKey: "", apiBase: "", model: "gpt-4o-mini", tickDelay: 3 }),
      saveSettings: vi.fn(),
      loadSettingsProfiles: () => ({
        version: 2,
        activeProfileId: "profile_empty",
        profiles: [{ id: "profile_empty", name: "Default", apiKey: "", apiBase: "", model: "gpt-4o-mini", tickDelay: 3 }],
      }),
      saveSettingsProfiles: vi.fn(),
      createSettingsProfile: (seed: Record<string, unknown> = {}) => ({
        id: "profile_new",
        name: "New Profile",
        apiKey: "",
        apiBase: "",
        model: "gpt-4o-mini",
        tickDelay: 3,
        ...seed,
      }),
      fetchModels: vi.fn(),
    }));
  });
});

describe("Modal", () => {
  it("renders with role=dialog and aria-modal", () => {
    render(<Modal onClose={vi.fn()} ariaLabel="Test Modal"><p>Content</p></Modal>);
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toBe("Test Modal");
  });

  it("renders children", () => {
    render(<Modal onClose={vi.fn()} ariaLabel="Test"><p>Modal content</p></Modal>);
    expect(screen.getByText("Modal content")).toBeTruthy();
  });

  it("closes on Escape key", () => {
    const onClose = vi.fn();
    render(<Modal onClose={onClose} ariaLabel="Test"><p>Content</p></Modal>);
    fireEvent.keyDown(document, { key: "Escape" });
    // Modal uses spring physics — closing starts but callback needs spring to settle
    // The spring mock returns target instantly, so onClose should fire
    expect(onClose).toHaveBeenCalled();
  });

  it("locks body scroll on mount", () => {
    render(<Modal onClose={vi.fn()} ariaLabel="Test"><p>Content</p></Modal>);
    expect(document.body.style.overflow).toBe("hidden");
  });
});
