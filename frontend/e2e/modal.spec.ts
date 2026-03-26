import { test, expect } from "@playwright/test";

/**
 * TC-M9 + TC-M10: UI 基础组件 + 模态框
 * PRD Section: 模块 M9, M10
 */

const MOCK_SEEDS = [
  { file: "cyber_bar.json", name: "赛博酒吧", description: "A gritty cyberpunk bar", agent_count: 3, location_count: 3 },
  { file: "ark.json", name: "末日方舟", description: "Post-apocalyptic ark", agent_count: 4, location_count: 2 },
  { file: "iron_throne.json", name: "铁王座", description: "Medieval power struggle", agent_count: 3, location_count: 4 },
];

const MOCK_CYBER_BAR_DETAIL = {
  file: "cyber_bar.json",
  name: "赛博酒吧",
  description: "A gritty cyberpunk bar",
  rules: ["No weapons in the bar"],
  locations: [{ name: "吧台", description: "The main counter" }, { name: "后厅", description: "VIP area" }, { name: "暗巷", description: "Behind the bar" }],
  agents: [
    { id: "a1", name: "陈妈", description: "Bar owner", personality: "Gruff but caring", goals: ["Keep the peace"], inventory: ["Rag"], location: "吧台" },
    { id: "a2", name: "Ghost", description: "Regular patron", personality: "Quiet", goals: ["Find work"], inventory: [], location: "吧台" },
    { id: "a3", name: "Neon", description: "Hacker", personality: "Paranoid", goals: ["Decrypt the file"], inventory: ["Laptop"], location: "后厅" },
  ],
  initial_events: ["A stranger walks in"],
};

async function mockBackend(page: import("@playwright/test").Page) {
  await page.addInitScript(() => localStorage.setItem("babel_visited", "1"));
  return page.route(/localhost:8000/, (route) => {
    const url = route.request().url();
    if (url.includes("/api/seeds/")) {
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_CYBER_BAR_DETAIL) });
    } else if (url.includes("/api/seeds")) {
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_SEEDS) });
    } else if (url.includes("/api/sessions")) {
      route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    } else {
      route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    }
  });
}

test.describe("M9: UI Primitives", () => {
  test("should render nav with BABEL logo", async ({ page }) => {
    await mockBackend(page);
    await page.goto("/");
    await expect(page.getByText("BABEL").first()).toBeVisible();
  });

  test("should render nav links", async ({ page }) => {
    await mockBackend(page);
    await page.goto("/");

    const nav = page.getByRole("navigation");
    await expect(nav).toBeVisible();

    // Nav has Home (active), Create, Assets links
    await expect(page.locator("[aria-current='page']")).toBeVisible();
    await expect(page.getByRole("link", { name: /创建|Create/i }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /资产|Assets/i }).first()).toBeVisible();
  });

  test("should render assets page without crash", async ({ page }) => {
    await mockBackend(page);
    await page.goto("/assets");
    await expect(page.locator("nav")).toBeVisible();
    // Page should render title
    await expect(page.locator("h1, h2, [class*='heading']").first()).toBeVisible();
  });

  test("should render create page without crash", async ({ page }) => {
    // Mock ALL backend API calls (create page calls fetchAssets on mount)
    await page.route(/localhost:8000/, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: "[]" })
    );
    await page.goto("/create", { timeout: 30_000 });
    await expect(page.locator("nav")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("input").first()).toBeVisible();
  });
});

test.describe("M10: Modal & Keyboard Interactions", () => {
  // TC-M10-01 (P1) - Modals appear in sim page (AgentChat, SeedPreview)
  // We test that the seed detail view on home opens/closes correctly
  test("should close seed detail with Back button", async ({ page }) => {
    await mockBackend(page);
    await page.goto("/");

    // Open seed detail
    await page.locator("button").filter({ hasText: "赛博酒吧" }).click();
    await expect(page.getByRole("button", { name: /Save & Launch|保存并启动/ })).toBeVisible({ timeout: 10_000 });

    // Close via Back
    await page.getByRole("button", { name: /Back|返回/ }).click();

    // Should see seed list again
    await expect(page.locator("button").filter({ hasText: "赛博酒吧" })).toBeVisible();
  });

  // Verify nav keyboard accessibility
  test("should have focusable nav elements", async ({ page }) => {
    await mockBackend(page);
    await page.goto("/");

    // Tab should reach nav links
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");

    // Some element should have focus
    const focused = page.locator(":focus");
    await expect(focused).toBeVisible();
  });

  // TC-M10-01b (P1) — Settings panel can be toggled open and closed
  test("should toggle settings panel open and closed", async ({ page }) => {
    await mockBackend(page);
    await page.goto("/");

    const settingsBtn = page.getByRole("button", { name: /设置|Settings/i });

    // Open settings
    await settingsBtn.click();
    const apiBaseInput = page.locator("#settings-api-base");
    await expect(apiBaseInput).toBeVisible();

    // Close by clicking Cancel
    await page.getByRole("button", { name: /取消|Cancel/i }).click();
    await expect(apiBaseInput).not.toBeVisible({ timeout: 3_000 });
  });

  // TC-M9-08 (P2) — Settings panel exists on assets page too
  test("should show settings button on assets page", async ({ page }) => {
    await mockBackend(page);
    await page.goto("/assets");

    const settingsBtn = page.getByRole("button", { name: /设置|Settings/i });
    await expect(settingsBtn).toBeVisible();

    // Open settings
    await settingsBtn.click();
    await expect(page.locator("#settings-api-base")).toBeVisible();
  });

  // TC-M9-08b (P2) — Settings panel exists on create page
  test("should show settings button on create page", async ({ page }) => {
    // Mock backend for create page
    await page.route(/localhost:8000/, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: "[]" })
    );
    await page.goto("/create", { timeout: 30_000 });
    await expect(page.locator("nav")).toBeVisible({ timeout: 10_000 });

    const settingsBtn = page.getByRole("button", { name: /设置|Settings/i });
    await expect(settingsBtn).toBeVisible();
  });
});
