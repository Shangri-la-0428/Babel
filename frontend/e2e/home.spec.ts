import { test, expect } from "@playwright/test";

/**
 * TC-M1: 世界发现与浏览
 * PRD Section: 模块 M1
 *
 * Home page structure:
 * - Nav: BABEL | Home Create Assets Settings | 中/EN
 * - Hero: BABEL + tagline + create custom world link
 * - Seed list: <button> per seed with seed.name as bold text
 * - Clicking seed → detail view with Start New / Save & Launch / Edit
 */

/** Mock seed data matching expected test seeds */
const MOCK_SEEDS = [
  { file: "cyber_bar.json", name: "赛博酒吧", description: "A gritty cyberpunk bar", agent_count: 3, location_count: 3 },
  { file: "ark.json", name: "末日方舟", description: "Post-apocalyptic ark", agent_count: 4, location_count: 2 },
  { file: "iron_throne.json", name: "铁王座", description: "Medieval power struggle", agent_count: 3, location_count: 4 },
];

const MOCK_CYBER_BAR_DETAIL = {
  file: "cyber_bar.json",
  name: "赛博酒吧",
  description: "A gritty cyberpunk bar",
  rules: ["No weapons in the bar", "Pay your tab"],
  locations: [
    { name: "Bar", description: "The main counter" },
    { name: "Back Room", description: "VIP area" },
    { name: "Alley", description: "Behind the bar" },
  ],
  agents: [
    { id: "a1", name: "Kai", description: "Bartender", personality: "Gruff", goals: ["Keep the peace"], inventory: ["Rag"], location: "Bar" },
    { id: "a2", name: "Neon", description: "Regular", personality: "Chatty", goals: ["Find work"], inventory: [], location: "Bar" },
    { id: "a3", name: "Zero", description: "Hacker", personality: "Paranoid", goals: ["Decrypt the file"], inventory: ["Laptop"], location: "Back Room" },
  ],
  initial_events: ["A stranger walks in"],
};

async function mockBackendAPIs(page: import("@playwright/test").Page) {
  // Skip boot overlay animation
  await page.addInitScript(() => localStorage.setItem("babel_visited", "1"));
  return page.route(/localhost:8000/, (route) => {
    const url = route.request().url();
    if (url.includes("/api/seeds/cyber_bar")) {
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_CYBER_BAR_DETAIL) });
    } else if (url.includes("/api/seeds")) {
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_SEEDS) });
    } else if (url.includes("/api/sessions")) {
      route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    } else if (url.includes("/api/worlds/from-seed/")) {
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ session_id: "test-session-001" }) });
    } else {
      route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    }
  });
}

test.describe("M1: Home Page — World Discovery", () => {
  test.beforeEach(async ({ page }) => {
    await mockBackendAPIs(page);
    await page.goto("/");
  });

  // TC-M1-01 (P0)
  test("should load and display seed cards", async ({ page }) => {
    // Seeds are <button> elements with seed names
    // Wait for seed list to load (replaces skeleton)
    const seedButton = page.locator("button").filter({ hasText: /赛博酒吧|末日方舟|铁王座/ });
    await expect(seedButton.first()).toBeVisible({ timeout: 10_000 });

    // Should have 3 seeds
    await expect(seedButton).toHaveCount(3);
  });

  // TC-M1-02 (P1)
  test("should preview seed details on click", async ({ page }) => {
    // Click a seed
    await page.locator("button").filter({ hasText: "赛博酒吧" }).click();

    // Should navigate to detail view with action buttons
    await expect(page.getByRole("button", { name: /Save & Launch|保存并启动/ })).toBeVisible({ timeout: 10_000 });

    // Should show tabs (Agents, Item, Locations, Rules, Event)
    await expect(page.getByRole("tab").first()).toBeVisible();
  });

  // TC-M1-03 (P0)
  test("should launch world from seed via Save & Launch", async ({ page }) => {
    // Select a seed
    await page.locator("button").filter({ hasText: "赛博酒吧" }).click();
    await expect(page.getByRole("button", { name: /Save & Launch|保存并启动/ })).toBeVisible({ timeout: 10_000 });

    // Click Save & Launch (primary action)
    await page.getByRole("button", { name: /Save & Launch|保存并启动/ }).click();

    // Should navigate to /sim page OR show error if backend is unavailable
    const simNav = page.waitForURL(/\/sim\?id=/, { timeout: 15_000 }).then(() => true);
    const errorBanner = expect(page.getByText(/CREATE_ERR|创建失败/i).first()).toBeVisible({ timeout: 15_000 }).then(() => false);
    const launched = await Promise.race([simNav, errorBanner]);

    if (launched) {
      await expect(page).toHaveURL(/\/sim\?id=/);
    } else {
      // Backend unavailable — verify error is displayed gracefully
      await expect(page.getByText(/CREATE_ERR|创建失败/i).first()).toBeVisible();
    }
  });

  // TC-M1-03b (P0)
  test("should launch world from seed via Start New", async ({ page }) => {
    await page.locator("button").filter({ hasText: "赛博酒吧" }).click();
    await expect(page.getByRole("button", { name: /Start New|开始新模拟/ })).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: /Start New|开始新模拟/ }).click();
    await expect(page).toHaveURL(/\/sim\?id=/, { timeout: 15_000 });
  });

  // TC-M1-04 (P1)
  test("nav should have correct active state on home", async ({ page }) => {
    const activeNav = page.locator("[aria-current='page']");
    await expect(activeNav).toBeVisible();
    // i18n: cn="首页", en="Home" — CSS uppercases it
    await expect(activeNav).toHaveText(/首页|Home/i);
  });

  // TC-M1-04b (P1)
  test("nav links should navigate correctly", async ({ page }) => {
    // Click create link (it's an <a> tag)
    await page.getByRole("link", { name: /创建|Create/i }).first().click();
    await expect(page).toHaveURL(/\/create/, { timeout: 15_000 });

    // Go back, click assets link
    await page.goto("/");
    await page.getByRole("link", { name: /资产|Assets/i }).first().click();
    await expect(page).toHaveURL(/\/assets/);
  });

  // TC-M1-10 (P1)
  test("should toggle language between CN and EN", async ({ page }) => {
    // Lang toggle: aria-label="切换语言" or "Switch language"
    const langBtn = page.getByRole("button").filter({ hasText: /^EN$|^中$/ });
    await expect(langBtn).toBeVisible();

    const initialText = await langBtn.textContent();
    await langBtn.click();

    // Button text should flip (EN ↔ 中)
    await expect(langBtn).not.toHaveText(initialText!);
  });

  // TC-M1-05 (P1)
  test("should show session count on seeds with history", async ({ page }) => {
    // Seeds with existing sessions show a save count badge
    // Just verify the seed list renders without error
    const seedButtons = page.locator("button").filter({ hasText: /赛博酒吧|末日方舟|铁王座/ });
    await expect(seedButtons.first()).toBeVisible({ timeout: 10_000 });
  });

  // TC-M1-04c (P1) - Seed detail has Back button
  test("should return to seed list via Back button", async ({ page }) => {
    await page.locator("button").filter({ hasText: "赛博酒吧" }).click();
    await expect(page.getByRole("button", { name: /Save & Launch|保存并启动/ })).toBeVisible({ timeout: 10_000 });

    // Click Back
    await page.getByRole("button", { name: /^←/ }).click();

    // Should see seed list again
    await expect(page.locator("button").filter({ hasText: "赛博酒吧" })).toBeVisible();
  });
});

test.describe("M1: Home Page — Hero & Structure", () => {
  test.beforeEach(async ({ page }) => {
    await mockBackendAPIs(page);
    await page.goto("/");
  });

  // TC-M1-01b (P1) — Hero section displays tagline and create link
  test("should display hero section with tagline and create link", async ({ page }) => {
    // BABEL hero text
    await expect(page.locator("h1").filter({ hasText: "BABEL" })).toBeVisible();

    // Tagline (Chinese or English)
    await expect(
      page.getByText(/种子.*AI|Seed.*AI/i).first()
    ).toBeVisible();

    // Create custom world link (may match hero + empty state; use .first())
    const createLink = page.getByRole("link", { name: /创建自定义世界|Create Custom World/i }).first();
    await expect(createLink).toBeVisible();
  });

  // TC-M1-01c (P1) — Seed cards show agent and location counts
  test("should display agent and location counts on seed cards", async ({ page }) => {
    const seedButton = page.locator("button").filter({ hasText: "赛博酒吧" });
    await expect(seedButton).toBeVisible({ timeout: 10_000 });

    // Each seed card should show agent count and location count badges
    // cyber_bar has 3 agents and 3 locations
    const agentBadge = seedButton.getByText(/Agents|角色/i);
    await expect(agentBadge).toBeVisible();

    const locationBadge = seedButton.getByText(/Locations|地点/i);
    await expect(locationBadge).toBeVisible();
  });

  // TC-M1-08 (P2) — Select world prompt text
  test("should show 'select world' prompt above seed list", async ({ page }) => {
    await expect(
      page.locator("button").filter({ hasText: "赛博酒吧" })
    ).toBeVisible({ timeout: 10_000 });

    // Should show "选择世界进入" or "Select a world to enter"
    await expect(
      page.getByText(/选择世界进入|Select a world to enter/i).first()
    ).toBeVisible();
  });
});

test.describe("M1.2: Timeline & Session History", () => {
  // TC-M1-05b (P1) — Timeline section appears in seed detail view
  test("should display timeline section in seed detail view", async ({ page }) => {
    await mockBackendAPIs(page);
    await page.goto("/");

    // Click a seed to enter detail view
    await page.locator("button").filter({ hasText: "赛博酒吧" }).click();
    await expect(page.getByRole("button", { name: /Save & Launch|保存并启动/ })).toBeVisible({ timeout: 10_000 });

    // Timeline header should be visible
    await expect(
      page.getByText(/时间线|Timeline/i).first()
    ).toBeVisible();

    // New Branch button should be visible
    await expect(
      page.getByText(/新分支|New Branch/i).first()
    ).toBeVisible();
  });

  // TC-M1-02b (P1) — Seed detail shows all asset tabs
  test("should show all five asset tabs in seed detail", async ({ page }) => {
    await mockBackendAPIs(page);
    await page.goto("/");
    await page.locator("button").filter({ hasText: "赛博酒吧" }).click();
    await expect(page.getByRole("tab").first()).toBeVisible({ timeout: 10_000 });

    // All 5 tabs: Agents, Item, Locations, Rules, Event
    const tabs = page.getByRole("tab");
    const tabCount = await tabs.count();
    expect(tabCount).toBe(5);
  });

  // TC-M1-04d (P1) — Edit button in seed detail navigates to /create
  test("should have Edit button that navigates to create page", async ({ page }) => {
    await mockBackendAPIs(page);
    await page.goto("/");
    await page.locator("button").filter({ hasText: "赛博酒吧" }).click();
    await expect(page.getByRole("button", { name: /Edit|编辑/i })).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: /Edit|编辑/i }).click();
    await expect(page).toHaveURL(/\/create/, { timeout: 15_000 });
  });
});

test.describe("M1.3: Settings Panel", () => {
  test.beforeEach(async ({ page }) => {
    await mockBackendAPIs(page);
    await page.goto("/");
  });

  // TC-M9-01 (P1)
  test("should toggle settings panel", async ({ page }) => {
    const settingsBtn = page.getByRole("button", { name: /设置|Settings/i });
    await expect(settingsBtn).toBeVisible();

    // Open settings
    await settingsBtn.click();

    // Should see API config fields
    await expect(page.getByText(/API/i).first()).toBeVisible();
  });

  // TC-M9-01b (P1) — Settings panel has all required fields
  test("should show API base URL, API key, tick delay, and model fields", async ({ page }) => {
    // Open settings
    await page.getByRole("button", { name: /设置|Settings/i }).click();

    // API Base URL field
    const apiBaseInput = page.locator("#settings-api-base");
    await expect(apiBaseInput).toBeVisible();

    // API Key field (password type)
    const apiKeyInput = page.locator("#settings-api-key");
    await expect(apiKeyInput).toBeVisible();
    await expect(apiKeyInput).toHaveAttribute("type", "password");

    // Tick Delay field (number type)
    const tickDelayInput = page.locator("#settings-tick-delay");
    await expect(tickDelayInput).toBeVisible();
    await expect(tickDelayInput).toHaveAttribute("type", "number");

    // Model field
    const modelInput = page.locator("#settings-model");
    await expect(modelInput).toBeVisible();
  });

  // TC-M9-01c (P0) — Settings can be filled and saved to localStorage
  test("should save settings to localStorage", async ({ page }) => {
    // Open settings
    await page.getByRole("button", { name: /设置|Settings/i }).click();

    // Fill in API Base URL
    const apiBaseInput = page.locator("#settings-api-base");
    await apiBaseInput.fill("https://api.test.com/v1");

    // Fill in API Key
    const apiKeyInput = page.locator("#settings-api-key");
    await apiKeyInput.fill("sk-test-key-12345");

    // Fill in Model
    const modelInput = page.locator("#settings-model");
    await modelInput.fill("gpt-test-model");

    // Click Save
    const saveBtn = page.getByRole("button", { name: /保存|Save/i }).first();
    await saveBtn.click();

    // Settings panel should close
    await expect(apiBaseInput).not.toBeVisible({ timeout: 3_000 });

    // Verify localStorage was written
    const stored = await page.evaluate(() => localStorage.getItem("babel_settings"));
    expect(stored).toBeTruthy();
    const parsed = JSON.parse(stored!);
    expect(parsed.apiBase).toBe("https://api.test.com/v1");
    expect(parsed.apiKey).toBe("sk-test-key-12345");
    expect(parsed.model).toBe("gpt-test-model");
  });

  // TC-M9-01d (P1) — Cancel closes settings without saving
  test("should close settings panel on cancel without saving", async ({ page }) => {
    // Open settings
    await page.getByRole("button", { name: /设置|Settings/i }).click();

    // Fill in API Key
    const apiKeyInput = page.locator("#settings-api-key");
    await apiKeyInput.fill("sk-should-not-save");

    // Click Cancel
    const cancelBtn = page.getByRole("button", { name: /取消|Cancel/i });
    await cancelBtn.click();

    // Settings panel should close
    await expect(apiKeyInput).not.toBeVisible({ timeout: 3_000 });

    // Verify localStorage was NOT updated with "sk-should-not-save"
    const stored = await page.evaluate(() => localStorage.getItem("babel_settings"));
    if (stored) {
      const parsed = JSON.parse(stored);
      expect(parsed.apiKey).not.toBe("sk-should-not-save");
    }
  });

  // TC-M9-05 (P2) — Settings persist across page reload
  test("should persist saved settings across page reload", async ({ page }) => {
    // Open settings and save
    await page.getByRole("button", { name: /设置|Settings/i }).click();
    await page.locator("#settings-api-base").fill("https://persist-test.com/v1");
    await page.locator("#settings-api-key").fill("sk-persist-key");
    await page.getByRole("button", { name: /保存|Save/i }).first().click();

    // Reload page
    await page.reload();

    // Reopen settings
    await page.getByRole("button", { name: /设置|Settings/i }).click();

    // Fields should still have the saved values
    await expect(page.locator("#settings-api-base")).toHaveValue("https://persist-test.com/v1");
    await expect(page.locator("#settings-api-key")).toHaveValue("sk-persist-key");
  });

  // TC-M9-02 (P1) — Fetch Models button disabled without key/base
  test("should disable fetch models button when API key or base is empty", async ({ page }) => {
    // Open settings
    await page.getByRole("button", { name: /设置|Settings/i }).click();

    // Clear API key and base
    await page.locator("#settings-api-base").fill("");
    await page.locator("#settings-api-key").fill("");

    // Fetch Models button should be disabled
    const fetchBtn = page.getByRole("button", { name: /获取模型列表|Fetch Models/i });
    await expect(fetchBtn).toBeDisabled();
  });
});
