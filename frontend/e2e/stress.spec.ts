import { test, expect, Page } from "@playwright/test";

/**
 * Stress & Resilience Tests
 * - WS disconnect detection
 * - Event feed rendering under load
 * - Page responsiveness
 */

const MOCK_SEEDS = [
  { file: "cyber_bar.json", name: "赛博酒吧", description: "A gritty cyberpunk bar in 2077", agent_count: 3, location_count: 3 },
];

const MOCK_CYBER_BAR_DETAIL = {
  file: "cyber_bar.json",
  name: "赛博酒吧",
  description: "A gritty cyberpunk bar in 2077",
  rules: ["No weapons"],
  locations: [{ name: "吧台", description: "The main counter" }],
  agents: [
    { id: "a1", name: "陈妈", description: "Bar owner", personality: "Gruff", goals: ["Keep the peace"], inventory: [], location: "吧台" },
  ],
  initial_events: [],
};

const MOCK_WORLD_STATE = {
  session_id: "test-session-001",
  name: "赛博酒吧",
  description: "A gritty cyberpunk bar in 2077",
  tick: 0,
  status: "paused",
  locations: [{ name: "吧台", description: "The main counter" }],
  rules: ["No weapons"],
  agents: {
    a1: { id: "a1", name: "陈妈", description: "Bar owner", personality: "Gruff", goals: ["Keep the peace"], memory: [], inventory: [], location: "吧台", status: "idle", role: "main" },
  },
  recent_events: [],
};

function makeEvents(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `e${i}`,
    tick: Math.floor(i / 3),
    agent_id: "a1",
    agent_name: "陈妈",
    agent_role: "main",
    action_type: "speak",
    action: {},
    result: `Event message ${i}`,
  }));
}

async function setupMocks(page: Page, eventCount = 0) {
  const stateWithEvents = {
    ...MOCK_WORLD_STATE,
    tick: eventCount > 0 ? Math.floor(eventCount / 3) : 0,
    recent_events: makeEvents(eventCount),
  };

  await page.addInitScript(() => localStorage.setItem("babel_visited", "1"));
  await page.route(/localhost:8000/, (route) => {
    const url = route.request().url();
    const method = route.request().method();
    if (url.includes("/api/seeds/cyber_bar")) {
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_CYBER_BAR_DETAIL) });
    } else if (url.includes("/api/seeds")) {
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_SEEDS) });
    } else if (url.includes("/api/sessions")) {
      route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    } else if (url.includes("/api/worlds/from-seed/") && method === "POST") {
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ session_id: "test-session-001" }) });
    } else if (url.includes("/api/worlds/") && url.includes("/state")) {
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(stateWithEvents) });
    } else if (url.includes("/api/worlds/") && url.includes("/timeline")) {
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ nodes: [], branch: "main" }) });
    } else {
      route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    }
  });
}

async function navigateToSim(page: Page, eventCount = 0) {
  await setupMocks(page, eventCount);
  await page.goto("/");
  await page.locator("button").filter({ hasText: "赛博酒吧" }).click();
  const startBtn = page.getByRole("button", { name: /Start New|开始新模拟/ });
  await expect(startBtn).toBeVisible({ timeout: 10_000 });
  await startBtn.click();
  await page.waitForURL(/\/sim\?id=/, { timeout: 15_000 });
  await expect(page.getByRole("toolbar")).toBeVisible({ timeout: 10_000 });
}

// ── WS Disconnect Detection ──

test.describe("Stress: WebSocket Status", () => {
  test.describe.configure({ timeout: 60_000 });

  test("should show DISCONNECTED status when no WS server available", async ({ page }) => {
    await navigateToSim(page);

    // No WS server in test — page should show disconnected status
    // The ControlBar shows connection status indicator
    const toolbar = page.getByRole("toolbar");
    await expect(
      toolbar.getByText(/DISCONNECTED|断开/i)
    ).toBeVisible({ timeout: 10_000 });
  });

  test("should show world state despite WS failure", async ({ page }) => {
    await navigateToSim(page);

    // Even without WS, initial state loads via HTTP GET /state
    // World name should be visible
    await expect(page.getByText(/赛博酒吧/).first()).toBeVisible();

    // Agent should be visible in asset panel
    await expect(page.getByText("陈妈").first()).toBeVisible();

    // Controls should be functional
    const toolbar = page.getByRole("toolbar");
    await expect(
      toolbar.getByRole("button", { name: /Run|运行/ })
    ).toBeVisible();
  });
});

// ── Event Feed Capacity ──

test.describe("Stress: Event Feed with Many Events", () => {
  test.describe.configure({ timeout: 60_000 });

  test("should render page with 300 initial events without freezing", async ({ page }) => {
    await navigateToSim(page, 300);

    // Page should be responsive
    const feedSection = page.locator("section[aria-label='Event feed']");
    await expect(feedSection).toBeVisible();

    // Should show event count
    await expect(
      page.getByText(/300/).first()
    ).toBeVisible({ timeout: 10_000 });

    // Should show trimmed indicator (200 render window)
    // "100 events_count total · 200 events_count" or similar
    await expect(
      page.getByText(/200/).first()
    ).toBeVisible();

    // Last event should be visible (event 299)
    await expect(
      page.getByText(/Event message 299/).first()
    ).toBeVisible({ timeout: 5_000 });
  });

  test("should handle 500 events at render window cap", async ({ page }) => {
    await navigateToSim(page, 500);

    // Page should still load
    const toolbar = page.getByRole("toolbar");
    await expect(toolbar).toBeVisible();

    // Should show the event count
    await expect(
      page.getByText(/500/).first()
    ).toBeVisible({ timeout: 10_000 });

    // Controls should remain responsive
    await expect(
      toolbar.getByRole("button", { name: /Run|运行/ })
    ).toBeEnabled();
  });

  test("should not show any events on empty world", async ({ page }) => {
    await navigateToSim(page, 0);

    // Empty state message should appear
    await expect(
      page.getByText(/DORMANT|休眠/i).first()
    ).toBeVisible({ timeout: 10_000 });

    // Event count should be 0
    await expect(
      page.getByText(/0 EVENT/i).first().or(page.getByText(/0 事件/).first())
    ).toBeVisible();
  });
});
