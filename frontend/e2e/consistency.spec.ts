import { test, expect } from "@playwright/test";

/**
 * Export → Import → diff = 0 consistency tests
 * Verifies round-trip data integrity of .babel.json files.
 */

const MOCK_ASSETS = [
  {
    id: "asset-1",
    type: "agent",
    name: "Test Agent Alpha",
    description: "A fierce warrior from the northern mountains",
    tags: ["warrior", "north"],
    data: { name: "Test Agent Alpha", personality: "brave", goals: ["conquer"] },
    source_world: "world-001",
  },
  {
    id: "asset-2",
    type: "location",
    name: "Shadow Tavern",
    description: "A dimly lit tavern",
    tags: ["tavern"],
    data: { name: "Shadow Tavern", capacity: 50 },
    source_world: null,
  },
];

/** Track what was POSTed to /api/assets for round-trip verification */
let lastImportedPayload: Record<string, unknown> | null = null;

function mockAPI(page: import("@playwright/test").Page) {
  lastImportedPayload = null;
  return page.route(/localhost:8000/, async (route) => {
    const url = route.request().url();
    const method = route.request().method();

    if (method === "POST" && url.includes("/api/assets")) {
      // Capture the POST body for round-trip verification
      const body = route.request().postDataJSON();
      lastImportedPayload = body;
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ id: "imported-new", name: body?.name || "Imported", type: body?.type || "agent" }),
      });
    } else if (url.includes("/api/assets")) {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_ASSETS),
      });
    } else {
      route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    }
  });
}

test.describe("Consistency: Export → Import round-trip", () => {
  test("exported file contains correct portable fields", async ({ page }) => {
    await mockAPI(page);
    await page.goto("/assets");

    // Open seed detail
    await page.getByText("Test Agent Alpha").first().click();

    // Click export and capture download
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: /EXPORT|导出/i }).click();
    const download = await downloadPromise;

    // Verify filename format
    const filename = download.suggestedFilename();
    expect(filename).toMatch(/^agent-.*\.babel\.json$/);

    // Read exported content
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const content = JSON.parse(Buffer.concat(chunks).toString("utf-8"));

    // Portable fields only — no id, no source_world, no created_at
    expect(content).toHaveProperty("type", "agent");
    expect(content).toHaveProperty("name", "Test Agent Alpha");
    expect(content).toHaveProperty("description", "A fierce warrior from the northern mountains");
    expect(content).toHaveProperty("tags");
    expect(content.tags).toEqual(["warrior", "north"]);
    expect(content).toHaveProperty("data");
    expect(content.data).toEqual({ name: "Test Agent Alpha", personality: "brave", goals: ["conquer"] });

    // Non-portable fields must be absent
    expect(content).not.toHaveProperty("id");
    expect(content).not.toHaveProperty("source_world");
    expect(content).not.toHaveProperty("created_at");
  });

  test("importing exported file produces identical data", async ({ page }) => {
    await mockAPI(page);
    await page.goto("/assets");

    // Step 1: Export
    await page.getByText("Test Agent Alpha").first().click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: /EXPORT|导出/i }).click();
    const download = await downloadPromise;

    // Read exported content
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const exportedContent = Buffer.concat(chunks).toString("utf-8");
    const exportedData = JSON.parse(exportedContent);

    // Close modal (click outside or press ESC)
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    // Step 2: Import the same file
    const fileInput = page.locator("input[type='file']");
    await fileInput.setInputFiles({
      name: "agent-test.babel.json",
      mimeType: "application/json",
      buffer: Buffer.from(exportedContent),
    });

    // Wait for import to process
    await page.waitForTimeout(500);

    // No error should appear
    await expect(page.getByText(/INVALID_FORMAT/i)).not.toBeVisible({ timeout: 3_000 });
    await expect(page.getByText(/FILE_TOO_LARGE/i)).not.toBeVisible({ timeout: 1_000 });

    // Step 3: Verify round-trip — the POST body should match exported data
    // The import handler sends: { type, name, description, tags, data }
    // which is exactly what export produces
    expect(lastImportedPayload).not.toBeNull();
    expect(lastImportedPayload).toHaveProperty("type", exportedData.type);
    expect(lastImportedPayload).toHaveProperty("name", exportedData.name);
    expect((lastImportedPayload as Record<string, unknown>).data).toEqual(exportedData.data);
  });

  test("round-trip preserves all seed types", async ({ page }) => {
    await mockAPI(page);
    await page.goto("/assets");

    // Test with location type seed
    await page.getByText("Shadow Tavern").first().click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: /EXPORT|导出/i }).click();
    const download = await downloadPromise;

    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const content = JSON.parse(Buffer.concat(chunks).toString("utf-8"));

    // Location type preserved
    expect(content.type).toBe("location");
    expect(content.name).toBe("Shadow Tavern");
    expect(content.data).toEqual({ name: "Shadow Tavern", capacity: 50 });

    // Filename should reflect type
    expect(download.suggestedFilename()).toMatch(/^location-/);
  });

  test("import rejects file with missing required fields", async ({ page }) => {
    await mockAPI(page);
    await page.goto("/assets");

    // Missing 'data' field
    const incomplete = JSON.stringify({ type: "agent", name: "No Data" });
    const fileInput = page.locator("input[type='file']");
    await fileInput.setInputFiles({
      name: "bad.babel.json",
      mimeType: "application/json",
      buffer: Buffer.from(incomplete),
    });

    await expect(page.getByText(/INVALID_FORMAT/i).first()).toBeVisible({ timeout: 5_000 });
  });

  test("import rejects file with invalid type", async ({ page }) => {
    await mockAPI(page);
    await page.goto("/assets");

    const badType = JSON.stringify({ type: "spaceship", name: "USS Enterprise", data: {} });
    const fileInput = page.locator("input[type='file']");
    await fileInput.setInputFiles({
      name: "bad-type.babel.json",
      mimeType: "application/json",
      buffer: Buffer.from(badType),
    });

    await expect(page.getByText(/INVALID_FORMAT/i).first()).toBeVisible({ timeout: 5_000 });
  });
});
