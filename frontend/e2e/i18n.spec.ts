import { test, expect } from "@playwright/test";

/**
 * TC-M1.4: 国际化
 * PRD Section: 模块 M1.4
 *
 * i18n: cn="首页" en="Home" — CSS text-transform: uppercase renders as "HOME"
 * Lang button: shows "EN" when cn, "中" when en
 * localStorage key: "babel_locale"
 */

test.describe("M1.4: Internationalization", () => {
  // TC-M1-10 (P1) - Language toggle persistence
  test("should persist language preference across page reload", async ({ page }) => {
    await page.goto("/");

    // Get lang toggle button (the one with "EN" or "中")
    const langBtn = page.getByRole("button").filter({ hasText: /^EN$|^中$/ });
    const initial = await langBtn.textContent();

    // Toggle language
    await langBtn.click();
    await page.waitForTimeout(300);

    const toggled = await langBtn.textContent();
    expect(toggled).not.toBe(initial);

    // Reload page
    await page.reload();

    // Should keep toggled language (wait for useEffect hydration)
    await expect(
      page.getByRole("button").filter({ hasText: /^EN$|^中$/ })
    ).toHaveText(toggled!, { timeout: 5_000 });
  });

  // Verify Chinese renders
  test("should render Chinese text when locale is CN", async ({ page }) => {
    // Navigate first, then set localStorage, then reload
    await page.goto("/");
    await page.evaluate(() => localStorage.setItem("babel_locale", "cn"));
    await page.reload();

    // Should see Chinese nav text
    await expect(page.locator("[aria-current='page']")).toHaveText("首页");
  });

  // Verify English renders
  test("should render English text when locale is EN", async ({ page }) => {
    // Navigate first, then set localStorage, then reload
    await page.goto("/");
    await page.evaluate(() => localStorage.setItem("babel_locale", "en"));
    await page.reload();

    // HTML text is "Home" (CSS uppercases to "HOME" visually)
    await expect(page.locator("[aria-current='page']")).toHaveText("Home");
  });
});
