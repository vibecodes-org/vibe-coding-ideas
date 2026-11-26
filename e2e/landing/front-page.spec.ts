import { test, expect } from "@playwright/test";
import { EXPECT_TIMEOUT } from "../fixtures/constants";

// The front page is public: these tests run signed out.
test.describe("Front page (Aurora look)", () => {
  test("shows one main headline and the key wording", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("team of AI agents");
    await expect(page.getByText("tools, one command")).toBeVisible();
    await expect(page.getByText("88", { exact: true })).toBeVisible();
    await expect(page.getByText(/AI agents (have shipped|ship cards)/)).toBeVisible();
  });

  test("Log in is visible and goes to /login", async ({ page }) => {
    await page.goto("/");
    const main = page.getByRole("navigation", { name: "Main" });
    await expect(main.getByRole("link", { name: "Log in" })).toBeVisible();
    await main.getByRole("link", { name: "Log in" }).click();
    await page.waitForURL(/\/login/, { timeout: EXPECT_TIMEOUT });
  });

  test("Get started free goes to /signup", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("main").getByRole("link", { name: /Get started free/ }).first().click();
    await page.waitForURL(/\/signup/, { timeout: EXPECT_TIMEOUT });
  });

  test("Watch a card ship scrolls to How a card ships", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Watch a card ship" }).click();
    await expect(page).toHaveURL(/#how$/);
    await expect(page.getByRole("heading", { name: /One card\. Five agents/ })).toBeInViewport();
  });

  test("Copy puts the install command on the clipboard", async ({ page, context, browserName }) => {
    test.skip(browserName !== "chromium", "clipboard permission is Chromium only");
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/");
    await page.getByRole("button", { name: "Copy" }).click();
    await expect(page.getByText("Copied")).toBeVisible();
    const text = await page.evaluate(() => navigator.clipboard.readText());
    expect(text).toBe(
      "claude mcp add -s user --transport http vibecodes https://vibecodes.co.uk/api/mcp"
    );
  });

  test("closing band and footer links have the right addresses", async ({ page }) => {
    await page.goto("/");
    const github = "https://github.com/vibecodes-org/vibe-coding-ideas";
    await expect(page.getByRole("link", { name: "View on GitHub" })).toHaveAttribute("href", github);
    const footer = page.getByRole("contentinfo");
    await expect(footer.getByRole("link", { name: "Guide" })).toHaveAttribute("href", "/guide");
    await expect(footer.getByRole("link", { name: "Changelog" })).toHaveAttribute("href", "/changelog");
    await expect(footer.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
    await expect(footer.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
    await expect(footer.getByRole("link", { name: "GitHub" })).toHaveAttribute("href", github);
  });

  for (const width of [375, 1280]) {
    test(`no sideways scroll at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/");
      const { scroll, visible } = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        visible: document.documentElement.clientWidth,
      }));
      expect(scroll).toBeLessThanOrEqual(visible);
    });
  }

  test("footer links all fit inside a phone screen", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/");
    const links = page.getByRole("contentinfo").getByRole("link");
    const count = await links.count();
    expect(count).toBe(5);
    for (let i = 0; i < count; i++) {
      const box = await links.nth(i).boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(375);
    }
  });

  test("is dark even when the theme is light", async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: "light" });
    const page = await context.newPage();
    await page.addInitScript(() => localStorage.setItem("theme", "light"));
    await page.goto("/");
    const bg = await page
      .getByRole("navigation", { name: "Main" })
      .evaluate((el) => getComputedStyle(el.parentElement!).backgroundColor);
    expect(bg).toBe("rgb(6, 6, 11)");
    await context.close();
  });

  test("all animation stops when the visitor asks for reduced motion", async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.goto("/");
    const running = await page.evaluate(() =>
      document
        .getAnimations()
        .filter((a) => a.playState === "running")
        .map((a) => (a as CSSAnimation).animationName ?? a.constructor.name)
    );
    expect(running).toEqual([]);
    await context.close();
  });

  test("the example board's working cards animate normally", async ({ page }) => {
    await page.goto("/");
    const names = await page.evaluate(() =>
      document.getAnimations().map((a) => (a as CSSAnimation).animationName)
    );
    expect(names.some((n) => n?.includes("spin"))).toBe(true);
  });
});
