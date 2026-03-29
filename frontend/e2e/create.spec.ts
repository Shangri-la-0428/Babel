import { test, expect } from "@playwright/test";

/**
 * TC-M2: 世界创建
 * PRD Section: 模块 M2
 *
 * Create page structure:
 * - Nav with active "create"
 * - Form: world name, description, rules (structured list), locations (structured cards),
 *         initial_events (structured list), agents (repeatable section)
 * - Text fields are inputs/textareas, while list sections use structured editors
 * - Labels use i18n keys rendered via CSS uppercase
 *
 * NOTE: The create page calls fetchAssets("agent") and fetchAssets("event")
 * on mount. Without the backend, these hang for 15s. We mock them via page.route().
 */

test.describe("M2: Create World", () => {
  test.beforeEach(async ({ page }) => {
    // Mock ALL backend API calls (create page calls fetchAssets on mount → localhost:8000)
    await page.route(/localhost:8000/, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: "[]" })
    );
    await page.goto("/create", { timeout: 30_000 });
    // Wait for page to fully load
    await expect(page.locator("nav")).toBeVisible({ timeout: 10_000 });
  });

  // TC-M2-01 (P0)
  test("should render create form with all sections", async ({ page }) => {
    // World name input should exist
    const nameInput = page.locator("input").first();
    await expect(nameInput).toBeVisible();

    // Should have textarea elements for rules, locations, events
    const textareas = page.locator("textarea");
    const count = await textareas.count();
    expect(count).toBeGreaterThanOrEqual(1);

    // Should have add agent button
    await expect(
      page.getByRole("button", { name: /添加角色|Add Agent/i })
    ).toBeVisible();
  });

  // TC-M2-03 (P1)
  test("should support structured rules input", async ({ page }) => {
    const ruleDraft = page.locator("#world-rule-draft");
    await ruleDraft.fill("Rule 1");
    await page.getByRole("button", { name: /添加规则|Add Rule/i }).click();

    const firstRule = page.locator("#world-rule-0");
    await expect(firstRule).toHaveValue("Rule 1");
  });

  // TC-M2-06 (P2)
  test("should add and remove agents", async ({ page }) => {
    const addBtn = page.getByRole("button", { name: /添加角色|Add Agent/i });

    // Add a second agent
    await addBtn.click();

    // Wait for remove buttons to appear (need 2+ agents)
    const removeButtons = page.getByRole("button", { name: /移除|Remove/i });
    await expect(removeButtons.first()).toBeVisible({ timeout: 3_000 });
    const count = await removeButtons.count();
    expect(count).toBeGreaterThanOrEqual(1);

    // Remove one (animated 150ms delay before DOM update)
    // With only 1 agent remaining, UI hides all remove buttons
    await removeButtons.first().click();
    await expect(removeButtons).toHaveCount(0, { timeout: 3_000 });
  });

  // TC-M2-09 (P3)
  test("should show hint text for rules and events", async ({ page }) => {
    await expect(
      page.getByText(/每行一条|One per line/i).first()
    ).toBeVisible();
  });

  // TC-M2-04 (P1) - Import from assets (only visible when saved assets exist)
  test("should show import button when assets available", async ({ page }) => {
    // Override beforeEach mock: return actual agent data so button appears
    await page.route(/localhost:8000/, (route) => {
      const url = route.request().url();
      if (url.includes("type=agent")) {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([{ id: "test", name: "Test Agent", type: "agent", data: {} }]),
        });
      } else {
        route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
      }
    });
    await page.goto("/create", { timeout: 30_000 });
    await expect(page.locator("nav")).toBeVisible({ timeout: 10_000 });

    // Should now show import button
    await expect(
      page.getByText(/从资产库导入|Import from Assets/i).first()
    ).toBeVisible({ timeout: 5_000 });
  });

  // TC-M2-08 (P2) — Submit button disabled when world name is empty
  test("should disable submit button when world name is empty", async ({ page }) => {
    // Submit button: t("ignite_world") = "点燃世界" / "IGNITE WORLD"
    const submitBtn = page.getByRole("button", { name: /点燃世界|IGNITE WORLD/i });
    await expect(submitBtn).toBeVisible();

    // Should be disabled when name is empty
    await expect(submitBtn).toBeDisabled();
  });

  // TC-M2-08b (P2) — Submit button enabled when world name is filled
  test("should enable submit button when world name is filled", async ({ page }) => {
    // Fill in world name
    const nameInput = page.locator("#world-name");
    await nameInput.fill("Test World");

    // Submit button should be enabled
    const submitBtn = page.getByRole("button", { name: /点燃世界|IGNITE WORLD/i });
    await expect(submitBtn).toBeEnabled();
  });

  // TC-M2-01b (P1) — Agent section has all required fields
  test("should render agent section with all required fields", async ({ page }) => {
    // Each agent section should have: name, personality, description, goals, inventory, location
    // Agent 1 header should be visible
    await expect(
      page.getByText(/角色 1|Agent 1/i).first()
    ).toBeVisible();

    // Name field
    const nameLabels = page.locator("label").filter({ hasText: /^名称$|^Name$/i });
    await expect(nameLabels.first()).toBeVisible();

    // Personality field
    await expect(
      page.locator("label").filter({ hasText: /^性格$|^Personality$/i }).first()
    ).toBeVisible();

    // Description field (agent-level, not world-level)
    // Goals field
    await expect(
      page.locator("label").filter({ hasText: /^目标$|^Goals$/i }).first()
    ).toBeVisible();

    // Inventory field
    await expect(
      page.locator("label").filter({ hasText: /^物品栏$|^Inventory$/i }).first()
    ).toBeVisible();

    // Starting Location field
    await expect(
      page.locator("label").filter({ hasText: /^起始位置$|^Starting Location$/i }).first()
    ).toBeVisible();
  });

  // TC-M2-07 (P2) — Can fill world description textarea
  test("should allow filling world description", async ({ page }) => {
    const descTextarea = page.locator("#world-desc");
    await descTextarea.fill("A vast post-apocalyptic landscape");
    await expect(descTextarea).toHaveValue("A vast post-apocalyptic landscape");
  });

  // TC-M2-01c (P1) — Locations support structured editing
  test("should support structured locations input", async ({ page }) => {
    const locationName = page.locator('input[id^="location-name-"]').first();
    const locationDescription = page.locator('textarea[id^="location-desc-"]').first();

    await locationName.fill("Tavern");
    await locationDescription.fill("A dark corner pub");

    await expect(locationName).toHaveValue("Tavern");
    await expect(locationDescription).toHaveValue("A dark corner pub");
  });

  // TC-M2-01d (P1) — Initial events support structured editing
  test("should support structured initial events input", async ({ page }) => {
    const eventDraft = page.locator("#world-event-draft");
    await eventDraft.fill("A stranger arrives");
    await page.getByRole("button", { name: /添加事件|Add Event/i }).click();

    const firstEvent = page.locator("#world-event-0");
    await expect(firstEvent).toHaveValue("A stranger arrives");
  });

  // TC-M2-01e (P1) — Back button navigates to home
  test("should navigate back to home via back button", async ({ page }) => {
    const backBtn = page.getByRole("button", { name: /返回|Back/i });
    await expect(backBtn).toBeVisible();
    await backBtn.click();
    await expect(page).toHaveURL("/", { timeout: 10_000 });
  });

  // TC-M2-01f (P1) — Cancel link navigates to home
  test("should navigate to home via cancel link", async ({ page }) => {
    const cancelLink = page.getByRole("link", { name: /取消|Cancel/i });
    await expect(cancelLink).toBeVisible();
    await cancelLink.click();
    await expect(page).toHaveURL("/", { timeout: 10_000 });
  });

  test("should return to world detail when opened from world edit", async ({ page }) => {
    await page.route(/localhost:8000/, (route) => {
      const url = route.request().url();
      if (url.includes("/api/seeds/cyber_bar.json")) {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            file: "cyber_bar.json",
            name: "赛博酒吧",
            description: "A gritty cyberpunk bar",
            rules: ["No weapons in the bar"],
            locations: [{ name: "Bar", description: "The main counter" }],
            agents: [{ id: "a1", name: "Kai", description: "Bartender", personality: "Gruff", goals: ["Keep the peace"], inventory: ["Rag"], location: "Bar" }],
            initial_events: ["A stranger walks in"],
          }),
        });
      } else {
        route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
      }
    });

    await page.goto("/create?seed=cyber_bar.json&back=%2F%3Fseed%3Dcyber_bar.json", { timeout: 30_000 });
    await expect(page.locator("#world-name")).toHaveValue("赛博酒吧");

    await page.getByRole("button", { name: /返回|Back/i }).click();
    await expect(page).toHaveURL("/?seed=cyber_bar.json", { timeout: 10_000 });
  });
});
