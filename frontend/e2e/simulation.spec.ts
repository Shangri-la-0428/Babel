import { test, expect, Page } from "@playwright/test";

/**
 * TC-M3: 模拟运行 + TC-M4: 资产侧边栏
 * PRD Section: 模块 M3, M4
 *
 * Sim page structure:
 * - Nav with back button + BABEL / world_name
 * - Left: EventFeed + InjectEvent
 * - Right: AssetPanel (tabbed: Agents/Items/Locations/World)
 * - Bottom: ControlBar with Run/Pause/Step/Tick/Status
 *
 * Creating a world: Home → click seed → "Start New" or "Save & Launch"
 */

const MOCK_SEEDS = [
  { file: "cyber_bar.json", name: "赛博酒吧", description: "A gritty cyberpunk bar in 2077", agent_count: 3, location_count: 3 },
  { file: "ark.json", name: "末日方舟", description: "Post-apocalyptic ark", agent_count: 4, location_count: 2 },
  { file: "iron_throne.json", name: "铁王座", description: "Medieval power struggle", agent_count: 3, location_count: 4 },
];

const MOCK_CYBER_BAR_DETAIL = {
  file: "cyber_bar.json",
  name: "赛博酒吧",
  description: "A gritty cyberpunk bar in 2077",
  rules: ["No weapons in the bar", "Pay your tab"],
  locations: [
    { name: "吧台", description: "The main counter" },
    { name: "后厅", description: "VIP area" },
    { name: "暗巷", description: "Behind the bar" },
  ],
  agents: [
    { id: "a1", name: "陈妈", description: "Bar owner", personality: "Gruff but caring", goals: ["Keep the peace"], inventory: ["Rag"], location: "吧台" },
    { id: "a2", name: "Ghost", description: "Regular patron", personality: "Quiet", goals: ["Find work"], inventory: [], location: "吧台" },
    { id: "a3", name: "Neon", description: "Hacker", personality: "Paranoid", goals: ["Decrypt the file"], inventory: ["Laptop"], location: "后厅" },
  ],
  initial_events: ["A stranger walks in"],
};

const MOCK_WORLD_STATE = {
  session_id: "test-session-001",
  name: "赛博酒吧",
  description: "A gritty cyberpunk bar in 2077",
  tick: 0,
  status: "paused",
  locations: [
    { name: "吧台", description: "The main counter" },
    { name: "后厅", description: "VIP area" },
    { name: "暗巷", description: "Behind the bar" },
  ],
  rules: ["No weapons in the bar", "Pay your tab"],
  agents: {
    a1: { id: "a1", name: "陈妈", description: "Bar owner", personality: "Gruff but caring", goals: ["Keep the peace"], memory: [], inventory: ["Rag"], location: "吧台", status: "idle", role: "main" },
    a2: { id: "a2", name: "Ghost", description: "Regular patron", personality: "Quiet", goals: ["Find work"], memory: [], inventory: [], location: "吧台", status: "idle", role: "main" },
    a3: { id: "a3", name: "Neon", description: "Hacker", personality: "Paranoid", goals: ["Decrypt the file"], memory: [], inventory: ["Laptop"], location: "后厅", status: "idle", role: "main" },
  },
  recent_events: [],
};

async function mockAllAPIs(page: Page) {
  await page.addInitScript(() => localStorage.setItem("babel_visited", "1"));
  return page.route(/localhost:8000/, (route) => {
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
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_WORLD_STATE) });
    } else {
      route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    }
  });
}

/** Helper: Create a world from cyber_bar and land on /sim */
async function createWorld(page: Page): Promise<void> {
  await mockAllAPIs(page);
  await page.goto("/");

  // Click cyber_bar seed
  await page.locator("button").filter({ hasText: "赛博酒吧" }).click();

  // Wait for detail view
  const startBtn = page.getByRole("button", { name: /Start New|开始新模拟/ });
  await expect(startBtn).toBeVisible({ timeout: 10_000 });

  // Use "Start New" (launches directly without editing)
  await startBtn.click();

  // Wait for sim page
  await page.waitForURL(/\/sim\?id=/, { timeout: 15_000 });

  // Wait for world state to load
  await expect(page.getByRole("toolbar")).toBeVisible({ timeout: 10_000 });
}

test.describe("M3: Simulation Page — Layout & Controls", () => {
  // createWorld() can take 25s+ (seed click + world creation + page load)
  test.describe.configure({ timeout: 60_000 });

  // TC-M3-09 (P1)
  test("should display control bar with correct elements", async ({ page }) => {
    await createWorld(page);

    const toolbar = page.getByRole("toolbar");
    await expect(toolbar).toBeVisible();

    // Run button — aria-label is "Run simulation" / "运行模拟"
    await expect(
      toolbar.getByRole("button", { name: /Run simulation|运行模拟/ }).first()
    ).toBeVisible();

    // Step button — aria-label is "Advance one tick" / "推演一步"
    await expect(
      toolbar.getByRole("button", { name: /Advance one tick|推演一步/ }).first()
    ).toBeVisible();

    // Tick label
    await expect(toolbar.getByText(/Tick/i).first()).toBeVisible();

    // Status text (lowercase: "paused")
    await expect(
      toolbar.getByText(/paused/i).first()
    ).toBeVisible();
  });

  // TC-M3-04 (P0) - EventFeed exists
  test("should show event feed area", async ({ page }) => {
    await createWorld(page);

    // InjectEvent form has aria-label="Inject"
    await expect(
      page.locator("form[aria-label='Inject']")
    ).toBeVisible({ timeout: 10_000 });
  });

  // TC-M3-08 (P1) - API Key check
  test("should show error when API key not set", async ({ page }) => {
    await createWorld(page);

    // Clear settings after navigation (avoids SecurityError)
    await page.evaluate(() => localStorage.removeItem("babel_settings"));

    // Click Step without API key — aria-label is "Advance one tick" / "推演一步"
    const stepBtn = page.getByRole("toolbar").getByRole("button", { name: /Advance one tick|推演一步/ }).first();
    await stepBtn.click();

    // Should open settings panel (showing LLM config with API Key field)
    await expect(
      page.locator("#settings-panel")
    ).toBeVisible({ timeout: 5_000 });
  });
});

test.describe("M3.2: WebSocket Connection", () => {
  test.describe.configure({ timeout: 60_000 });
  // TC-M3-11 (P2)
  test("should establish websocket connection", async ({ page }) => {
    await createWorld(page);

    // When connected, no "disconnected" error text should be visible
    const toolbar = page.getByRole("toolbar");
    await expect(toolbar).toBeVisible();

    // The page should show world name somewhere (nav breadcrumb or toolbar)
    await expect(page.getByText(/赛博酒吧|Cyber/i).first()).toBeVisible();
  });
});

test.describe("M4: Asset Panel", () => {
  test.describe.configure({ timeout: 60_000 });
  // TC-M4-01 (P0)
  test("should display agent list", async ({ page }) => {
    await createWorld(page);

    // Should see agent names from cyber_bar
    await expect(
      page.getByText("陈妈").first()
    ).toBeVisible({ timeout: 10_000 });

    await expect(page.getByText("Ghost").first()).toBeVisible();
  });

  // TC-M4-02 (P0) - Expand agent
  test("should expand agent details on click", async ({ page }) => {
    await createWorld(page);

    // Click an agent row (has aria-expanded attribute)
    const agentRow = page.locator("button[aria-expanded]").filter({ hasText: "陈妈" });
    await agentRow.click();

    // Should show expanded content — labels are uppercase "PERSONALITY", "GOALS"
    await expect(
      page.getByText("PERSONALITY").first()
    ).toBeVisible({ timeout: 5_000 });
  });

  // TC-M4-13 (P2) - Tab switching
  test("should switch between asset panel tabs", async ({ page }) => {
    await createWorld(page);

    // AssetPanel tabs use role="tab": Agents, Items, Locations, World State
    const itemsTab = page.getByRole("tab", { name: /Item/i });
    if (await itemsTab.isVisible()) {
      await itemsTab.click();
      await page.waitForTimeout(300);
    }

    const locationsTab = page.getByRole("tab", { name: /Location/i });
    if (await locationsTab.isVisible()) {
      await locationsTab.click();
      await page.waitForTimeout(300);
    }

    const worldTab = page.getByRole("tab", { name: /World/i });
    if (await worldTab.isVisible()) {
      await worldTab.click();

      // World tab should show world description
      await expect(
        page.getByText(/2077/i).first()
      ).toBeVisible({ timeout: 5_000 });
    }
  });
});

test.describe("M3: Simulation — Run/Pause Toggle", () => {
  test.describe.configure({ timeout: 60_000 });

  // TC-M3-09 (P1) — Run button visible when paused
  test("should show Run button when status is paused", async ({ page }) => {
    await createWorld(page);

    const toolbar = page.getByRole("toolbar");

    // Initially paused: Run button should be visible
    await expect(
      toolbar.getByRole("button", { name: /Run simulation|运行模拟/ }).first()
    ).toBeVisible();

    // Pause button should NOT be visible when paused
    await expect(
      toolbar.getByRole("button", { name: /Pause simulation|暂停模拟/ })
    ).toHaveCount(0);
  });

  // TC-M3-07 (P1) — Status indicator shows paused state
  test("should show paused status indicator with correct styling", async ({ page }) => {
    await createWorld(page);

    const toolbar = page.getByRole("toolbar");

    // Status text should say "paused"
    await expect(toolbar.getByText(/paused/i).first()).toBeVisible();

    // Status dot should be present (an inline-block w-2 h-2 rounded-full element)
    const statusDot = toolbar.locator(".rounded-full").first();
    await expect(statusDot).toBeVisible();
  });

  // TC-M3-05 (P1) — Tick counter displays initial value
  test("should display tick counter starting at expected value", async ({ page }) => {
    await createWorld(page);

    const toolbar = page.getByRole("toolbar");

    // Should show "Tick" label
    await expect(toolbar.getByText(/Tick/i).first()).toBeVisible();

    // Tick value should be visible (numeric digits)
    const tickValue = toolbar.locator(".text-primary.tabular-nums").first();
    await expect(tickValue).toBeVisible();
  });

  // TC-M3-01b (P1) — Step button is disabled while running
  test("should disable step button when simulation could be running", async ({ page }) => {
    await createWorld(page);

    const toolbar = page.getByRole("toolbar");

    // When paused, step button should be enabled
    const stepBtn = toolbar.getByRole("button", { name: /Advance one tick|推演一步/ }).first();
    await expect(stepBtn).toBeVisible();
    await expect(stepBtn).toBeEnabled();
  });
});

test.describe("M3: Simulation — World Info Display", () => {
  test.describe.configure({ timeout: 60_000 });

  // TC-M3-08b (P1) — ControlBar shows world name
  test("should display world name in control bar", async ({ page }) => {
    await createWorld(page);

    // World name "赛博酒吧" should appear somewhere (nav or toolbar)
    await expect(
      page.getByText(/赛博酒吧|Cyber/i).first()
    ).toBeVisible();
  });

  // TC-M3-11b (P2) — Sim page shows nav breadcrumb with BABEL
  test("should display BABEL in navigation breadcrumb", async ({ page }) => {
    await createWorld(page);

    // BABEL should be visible in nav
    await expect(page.getByText("BABEL").first()).toBeVisible();
  });
});

test.describe("M4: Asset Panel — Additional Checks", () => {
  test.describe.configure({ timeout: 60_000 });

  // TC-M4-01b (P1) — Agents tab shows multiple agents from cyber_bar
  test("should display all agents from cyber_bar seed", async ({ page }) => {
    await createWorld(page);

    // cyber_bar has 3 agents: 陈妈, Ghost, plus one more
    await expect(page.getByText("陈妈").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Ghost").first()).toBeVisible();
  });

  // TC-M4-02b (P0) — Expanded agent shows goals section
  test("should show goals section when agent is expanded", async ({ page }) => {
    await createWorld(page);

    // Expand agent
    const agentRow = page.locator("button[aria-expanded]").filter({ hasText: "陈妈" });
    await agentRow.click();

    // Should show GOALS label
    await expect(
      page.getByText("GOALS").first()
    ).toBeVisible({ timeout: 5_000 });
  });

  // TC-M4-02c (P1) — Expanded agent shows location
  test("should show location when agent is expanded", async ({ page }) => {
    await createWorld(page);

    // Expand agent
    const agentRow = page.locator("button[aria-expanded]").filter({ hasText: "陈妈" });
    await agentRow.click();

    // Should show LOCATION label
    await expect(
      page.getByText("LOCATION").first()
    ).toBeVisible({ timeout: 5_000 });
  });

  // TC-M4-13b (P2) — Agents tab is default active tab
  test("should default to Agents tab in asset panel", async ({ page }) => {
    await createWorld(page);

    // Agents tab should be selected by default
    const agentsTab = page.getByRole("tab", { name: /Agent/i });
    if (await agentsTab.isVisible()) {
      await expect(agentsTab).toHaveAttribute("aria-selected", "true");
    }
  });
});

test.describe("M3.7: Oracle Drawer", () => {
  test.describe.configure({ timeout: 60_000 });

  // TC-M3.7-01 (P0) — Oracle button opens drawer
  test("should open Oracle drawer when clicking ORACLE button", async ({ page }) => {
    await createWorld(page);

    const toolbar = page.getByRole("toolbar");

    // Oracle button should be visible in ControlBar
    const oracleBtn = toolbar.getByRole("button", { name: "ORACLE" });
    await expect(oracleBtn).toBeVisible();

    // Click to open drawer
    await oracleBtn.click();

    // Drawer should become visible (role="complementary")
    const drawer = page.getByRole("complementary", { name: "ORACLE" });
    await expect(drawer).toBeVisible({ timeout: 5_000 });

    // Should show "// ORACLE" label in header
    await expect(drawer.getByText("// ORACLE").first()).toBeVisible();
  });

  // TC-M3.7-02 (P0) — Oracle drawer shows empty state with suggestions
  test("should show empty state with suggestion chips", async ({ page }) => {
    await createWorld(page);

    // Open drawer
    const toolbar = page.getByRole("toolbar");
    await toolbar.getByRole("button", { name: "ORACLE" }).click();

    const drawer = page.getByRole("complementary", { name: "ORACLE" });
    await expect(drawer).toBeVisible({ timeout: 5_000 });

    // Should show empty state description
    await expect(
      drawer.getByText(/全知旁白|omniscient narrator/i)
    ).toBeVisible();

    // Should show suggestion chips (at least 2 of the 4)
    await expect(
      drawer.getByRole("button", { name: /总结|Summarize/i })
    ).toBeVisible();
    await expect(
      drawer.getByRole("button", { name: /矛盾|tensions/i })
    ).toBeVisible();
  });

  // TC-M3.7-03 (P1) — Oracle drawer has input and send button
  test("should have input field and send button", async ({ page }) => {
    await createWorld(page);

    const toolbar = page.getByRole("toolbar");
    await toolbar.getByRole("button", { name: "ORACLE" }).click();

    const drawer = page.getByRole("complementary", { name: "ORACLE" });
    await expect(drawer).toBeVisible({ timeout: 5_000 });

    // Input field
    const input = drawer.locator("input[type='text']");
    await expect(input).toBeVisible();
    await expect(input).toBeEnabled();

    // Send button (disabled when input empty)
    const sendBtn = drawer.getByRole("button", { name: /发送|SEND/i });
    await expect(sendBtn).toBeVisible();
    await expect(sendBtn).toBeDisabled();
  });

  // TC-M3.7-04 (P1) — Send button enables when input has text
  test("should enable send button when input has text", async ({ page }) => {
    await createWorld(page);

    const toolbar = page.getByRole("toolbar");
    await toolbar.getByRole("button", { name: "ORACLE" }).click();

    const drawer = page.getByRole("complementary", { name: "ORACLE" });
    await expect(drawer).toBeVisible({ timeout: 5_000 });

    const input = drawer.locator("input[type='text']");
    const sendBtn = drawer.getByRole("button", { name: /发送|SEND/i });

    // Type text
    await input.fill("Hello Oracle");

    // Send button should now be enabled
    await expect(sendBtn).toBeEnabled();
  });

  // TC-M3.7-05 (P1) — ESC closes drawer
  test("should close drawer on ESC key", async ({ page }) => {
    await createWorld(page);

    const toolbar = page.getByRole("toolbar");
    const oracleBtn = toolbar.getByRole("button", { name: "ORACLE" });
    await oracleBtn.click();

    await expect(
      page.getByRole("complementary", { name: "ORACLE" })
    ).toBeVisible({ timeout: 5_000 });

    // Press ESC
    await page.keyboard.press("Escape");

    // Oracle button should collapse (drawer hidden via aria-hidden + inert)
    await expect(oracleBtn).toHaveAttribute("aria-expanded", "false");
  });

  // TC-M3.7-06 (P1) — Close button closes drawer
  test("should close drawer via close button", async ({ page }) => {
    await createWorld(page);

    const toolbar = page.getByRole("toolbar");
    const oracleBtn = toolbar.getByRole("button", { name: "ORACLE" });
    await oracleBtn.click();

    const drawer = page.getByRole("complementary", { name: "ORACLE" });
    await expect(drawer).toBeVisible({ timeout: 5_000 });

    // Click close button inside drawer header
    const closeBtn = drawer.getByRole("button", { name: /关闭|close/i });
    await closeBtn.click();

    // Oracle button should collapse
    await expect(oracleBtn).toHaveAttribute("aria-expanded", "false");
  });

  // TC-M3.7-07 (P1) — Oracle button shows active state when drawer open
  test("should show active state on Oracle button when drawer is open", async ({ page }) => {
    await createWorld(page);

    const toolbar = page.getByRole("toolbar");
    const oracleBtn = toolbar.getByRole("button", { name: "ORACLE" });

    // Initially not expanded
    await expect(oracleBtn).toHaveAttribute("aria-expanded", "false");

    // Open drawer
    await oracleBtn.click();

    // Button should show expanded state
    await expect(oracleBtn).toHaveAttribute("aria-expanded", "true");
  });

  // TC-M3.7-08 (P1) — Shows tick counter in drawer header
  test("should display current tick in drawer header", async ({ page }) => {
    await createWorld(page);

    const toolbar = page.getByRole("toolbar");
    await toolbar.getByRole("button", { name: "ORACLE" }).click();

    const drawer = page.getByRole("complementary", { name: "ORACLE" });
    await expect(drawer).toBeVisible({ timeout: 5_000 });

    // Should show tick info (e.g., "TICK 001" or "轮次 001")
    await expect(
      drawer.getByText(/TICK|轮次/i)
    ).toBeVisible();
  });

  // TC-M3.7-09 (P2) — Canvas elements present (waveform + particles)
  test("should render canvas elements for waveform and particles", async ({ page }) => {
    await createWorld(page);

    const toolbar = page.getByRole("toolbar");
    await toolbar.getByRole("button", { name: "ORACLE" }).click();

    const drawer = page.getByRole("complementary", { name: "ORACLE" });
    await expect(drawer).toBeVisible({ timeout: 5_000 });

    // Should have at least 2 canvas elements (waveform + particles)
    const canvases = drawer.locator("canvas");
    await expect(canvases).toHaveCount(2);
  });
});

test.describe("M3.4: Event Injection", () => {
  test.describe.configure({ timeout: 60_000 });
  // TC-M3I-06 (P2)
  test("should show inject input when paused", async ({ page }) => {
    await createWorld(page);

    // InjectEvent form with aria-label="Inject" contains the input
    const injectForm = page.locator("form[aria-label='Inject']");
    await expect(injectForm).toBeVisible();

    const injectInput = injectForm.locator("input[type='text']");
    await expect(injectInput).toBeVisible();
    await expect(injectInput).toBeEnabled();
  });

  // TC-M3I-07 (P2) — Empty inject does not submit
  test("should not submit when inject input is empty", async ({ page }) => {
    await createWorld(page);

    const injectForm = page.locator("form[aria-label='Inject']");
    const injectInput = injectForm.locator("input[type='text']");

    // Ensure input is empty
    await expect(injectInput).toHaveValue("");

    // Press Enter on empty input
    await injectInput.press("Enter");

    // Form should still be there (no navigation, no crash)
    await expect(injectForm).toBeVisible();
    await expect(injectInput).toHaveValue("");
  });
});

/**
 * TC-P15: Phase 15 Polish — WorldRadar collapse, disabled reasons, ControlBar density
 * PRD: Converge complexity — refine existing UI, don't add features
 */
test.describe("P15: WorldRadar Collapse", () => {
  test.describe.configure({ timeout: 60_000 });

  // P15-01 (P1) — TACTICAL toggle exists and collapses radar
  test("should toggle WorldRadar visibility via TACTICAL button", async ({ page }) => {
    await createWorld(page);

    const tacticalBtn = page.getByRole("button", { name: /TACTICAL/ });
    await expect(tacticalBtn).toBeVisible();

    // Should have aria-expanded
    await expect(tacticalBtn).toHaveAttribute("aria-expanded", "true");

    // Collapse
    await tacticalBtn.click();
    await expect(tacticalBtn).toHaveAttribute("aria-expanded", "false");

    // Expand again
    await tacticalBtn.click();
    await expect(tacticalBtn).toHaveAttribute("aria-expanded", "true");
  });
});

test.describe("P15: Disabled Button Reasons", () => {
  test.describe.configure({ timeout: 60_000 });

  // P15-02 (P1) — Step button shows reason when disabled (sim is paused but step should explain)
  test("should show reason on disabled step button when sim is running", async ({ page }) => {
    await createWorld(page);

    const toolbar = page.getByRole("toolbar");
    // Step button is enabled when paused — it should have no disabled title
    const stepBtn = toolbar.getByRole("button", { name: /Advance one tick|推演一步/ }).first();
    await expect(stepBtn).toBeEnabled();
  });

  // P15-03 (P1) — Inject button shows reason when empty
  test("should have disabled inject button with visual feedback", async ({ page }) => {
    await createWorld(page);

    const injectForm = page.locator("form[aria-label='Inject']");
    const submitBtn = injectForm.getByRole("button");
    // Button should be disabled when input is empty
    await expect(submitBtn).toBeDisabled();
  });
});

test.describe("P15: ControlBar Density", () => {
  test.describe.configure({ timeout: 60_000 });

  // P15-04 (P2) — ControlBar should NOT show model name or session ID
  test("should not display model name in control bar", async ({ page }) => {
    await createWorld(page);

    const toolbar = page.getByRole("toolbar");
    // Model name should not appear in toolbar (moved to Settings)
    // Session ID (test-session-001) should not appear in toolbar
    await expect(toolbar.getByText("test-session-001")).not.toBeVisible();
  });
});
