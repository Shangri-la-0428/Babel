import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import InjectEvent from "@/components/InjectEvent";

vi.mock("@/lib/locale-context", () => ({
  useLocale: () => ({
    locale: "cn",
    toggle: vi.fn(),
    t: (key: string) => key,
  }),
}));

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const apiMocks = vi.hoisted(() => ({
  injectEvent: vi.fn(),
  stepWorld: vi.fn(),
}));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    injectEvent: apiMocks.injectEvent,
    stepWorld: apiMocks.stepWorld,
  };
});

describe("InjectEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.stepWorld.mockResolvedValue({ tick: 1, events: [] });
  });

  it("keeps the input editable while queued injections process sequentially", async () => {
    const firstInject = createDeferred<{ id: string; tick: number; result: string }>();
    const secondInject = createDeferred<{ id: string; tick: number; result: string }>();

    apiMocks.injectEvent
      .mockImplementationOnce(() => firstInject.promise)
      .mockImplementationOnce(() => secondInject.promise);

    render(
      <InjectEvent
        sessionId="session-1"
        settings={{
          apiKey: "sk-test",
          apiBase: "https://api.openai.com/v1",
          model: "gpt-4o-mini",
          tickDelay: 3,
        }}
      />,
    );

    const input = screen.getByLabelText("inject_placeholder") as HTMLInputElement;
    const submit = screen.getByRole("button", { name: "inject" });

    fireEvent.change(input, { target: { value: "first event" } });
    fireEvent.click(submit);

    expect(input.disabled).toBe(false);
    expect(input.value).toBe("");
    expect(apiMocks.injectEvent).toHaveBeenCalledTimes(1);
    expect(apiMocks.injectEvent).toHaveBeenLastCalledWith("session-1", "first event");

    fireEvent.change(input, { target: { value: "second event" } });
    fireEvent.click(screen.getByRole("button", { name: "inject" }));

    expect(input.disabled).toBe(false);
    expect(apiMocks.injectEvent).toHaveBeenCalledTimes(1);

    firstInject.resolve({ id: "evt-1", tick: 0, result: "ok" });

    await waitFor(() => {
      expect(apiMocks.stepWorld).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(apiMocks.injectEvent).toHaveBeenCalledTimes(2);
    });
    expect(apiMocks.injectEvent).toHaveBeenLastCalledWith("session-1", "second event");

    secondInject.resolve({ id: "evt-2", tick: 1, result: "ok" });

    await waitFor(() => {
      expect(apiMocks.stepWorld).toHaveBeenCalledTimes(2);
    });
  });
});
