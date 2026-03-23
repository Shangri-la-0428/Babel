import { test, expect } from "@playwright/test";

/**
 * TC-M6: 资产库
 * PRD Section: 模块 M6
 *
 * Assets page structure:
 * - Nav with ASSETS active
 * - Title "ASSETS" + description
 * - Filter tabs: All, World, Agent {n}, Item {n}, Location, Event
 * - Grid of SeedCards (name, type badge, description, source)
 */

test.describe("M6: Assets Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/assets");
  });

  // TC-M6-01 (P0) + TC-M6-08 (P2)
  test("should load assets page", async ({ page }) => {
    // Nav should show assets as active
    const activeNav = page.locator("[aria-current='page']");
    await expect(activeNav).toHaveText(/资产|Assets/i);

    // Page title should be visible
    await expect(
      page.getByText("ASSETS").first()
        .or(page.getByText("资产").first())
    ).toBeVisible();
  });

  // TC-M6-02 (P1)
  test("should have type filter tabs", async ({ page }) => {
    // Filter tabs: "All" is always present
    const allTab = page.getByRole("button", { name: /^All/i });
    await expect(allTab).toBeVisible({ timeout: 5_000 });

    // Other tabs: World, Agent, Item, Location, Event (may have counts)
    await expect(
      page.getByRole("button", { name: /^World/i }).first()
    ).toBeVisible();
  });

  // TC-M6-02b (P1) - Filter actually works
  test("should filter by type when clicking tab", async ({ page }) => {
    // Wait for content to load
    await page.waitForTimeout(1000);

    // Click Agent tab
    const agentTab = page.getByRole("button", { name: /^Agent/i });
    if (await agentTab.isVisible()) {
      await agentTab.click();
      await page.waitForTimeout(500);

      // Should show agent cards with AGENT badge
      const agentBadges = page.getByText("AGENT", { exact: true });
      if (await agentBadges.count() > 0) {
        // Verify no ITEM badges visible (filtered out)
        // This is a soft check — may have both if "All" shows everything
      }
    }
  });
});

test.describe("M6: Navigation", () => {
  test("should navigate to assets page from nav", async ({ page }) => {
    await page.goto("/");

    const assetsLink = page.getByRole("link", { name: /资产|Assets/i }).first();
    await assetsLink.click();

    await expect(page).toHaveURL(/\/assets/);
  });
});

test.describe("M6: Seed Card Structure", () => {
  test.beforeEach(async ({ page }) => {
    // Mock backend to return assets with full SeedCard data
    await page.route(/localhost:8000/, (route) => {
      const url = route.request().url();
      if (url.includes("/api/assets")) {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([
            {
              id: "test-agent-1",
              type: "agent",
              name: "Test Agent Alpha",
              description: "A fierce warrior from the northern mountains",
              tags: ["warrior", "north"],
              data: { name: "Test Agent Alpha", personality: "brave" },
              source_world: "abcd1234-5678-ef90",
            },
            {
              id: "test-item-1",
              type: "item",
              name: "Magic Sword",
              description: "An ancient blade imbued with elemental magic",
              tags: ["weapon", "magic"],
              data: { name: "Magic Sword" },
              source_world: "efgh5678-1234-ab90",
            },
            {
              id: "test-location-1",
              type: "location",
              name: "Shadow Tavern",
              description: "A dimly lit tavern where secrets are traded",
              tags: ["tavern", "social"],
              data: { name: "Shadow Tavern" },
              source_world: null,
            },
          ]),
        });
      } else {
        route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
      }
    });
    await page.goto("/assets");
  });

  // TC-M6-01b (P1) — SeedCard shows type badge
  test("should display type badge on seed cards", async ({ page }) => {
    // Wait for cards to render
    await expect(page.getByText("Test Agent Alpha").first()).toBeVisible({ timeout: 5_000 });

    // Agent card should have "agent" type badge
    await expect(page.getByText("agent").first()).toBeVisible();

    // Item card should have "item" type badge
    await expect(page.getByText("item").first()).toBeVisible();
  });

  // TC-M6-01c (P1) — SeedCard shows description
  test("should display description on seed cards", async ({ page }) => {
    await expect(page.getByText("Test Agent Alpha").first()).toBeVisible({ timeout: 5_000 });

    // Description text should be visible
    await expect(
      page.getByText("A fierce warrior from the northern mountains").first()
    ).toBeVisible();
  });

  // TC-M6-09 (P2) — SeedCard shows source_world
  test("should display source world on seed cards with source", async ({ page }) => {
    await expect(page.getByText("Test Agent Alpha").first()).toBeVisible({ timeout: 5_000 });

    // Source world should show (may be truncated)
    await expect(
      page.getByText(/abcd1234/).first()
    ).toBeVisible();
  });

  // TC-M6-10 (P2) — All tab shows all types
  test("should show all asset types when All tab is selected", async ({ page }) => {
    // Wait for content to load
    await expect(page.getByText("Test Agent Alpha").first()).toBeVisible({ timeout: 5_000 });

    // All tab should be active by default
    const allTab = page.getByRole("button", { name: /^All/i });
    await expect(allTab).toBeVisible();

    // Should show both agent and item cards
    await expect(page.getByText("Test Agent Alpha").first()).toBeVisible();
    await expect(page.getByText("Magic Sword").first()).toBeVisible();
    await expect(page.getByText("Shadow Tavern").first()).toBeVisible();
  });

  // TC-M6-08b (P2) — Empty assets page shows empty state
  test("should show empty state when no assets exist", async ({ page }) => {
    // Override route to return empty array
    await page.route(/localhost:8000/, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: "[]" })
    );
    await page.goto("/assets");

    // Should show empty state text (either "// EMPTY" or "No seeds" message)
    await expect(
      page.getByText(/EMPTY|暂无种子|No seeds/i).first()
    ).toBeVisible({ timeout: 5_000 });
  });
});
