import { test, expect } from "../fixtures/auth";
import { EXPECT_TIMEOUT } from "../fixtures/constants";

test.describe("Dashboard", () => {
  test("should display Dashboard heading", async ({ userAPage: page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({ timeout: EXPECT_TIMEOUT });
  });

  test("should show welcome message or dashboard sections", async ({ userAPage: page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({ timeout: EXPECT_TIMEOUT });
    // Dashboard content varies (first-run vs standard), just verify it loaded
    await expect(page.getByText(/Welcome back|My Ideas|Setup Progress/i).first()).toBeVisible({ timeout: EXPECT_TIMEOUT });
  });

  test("should have actionable content below the heading", async ({ userAPage: page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({ timeout: EXPECT_TIMEOUT });
    // Dashboard renders either first-run or standard mode — both have links/buttons.
    // Accept any actionable element as proof the page loaded fully.
    await expect(page.getByRole("main").getByRole("link").first()).toBeVisible({ timeout: EXPECT_TIMEOUT });
  });

  test("should have link to manage agents", async ({ userAPage: page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({ timeout: EXPECT_TIMEOUT });
    await expect(page.getByRole("link", { name: "Manage" })).toBeVisible();
  });

  // Regression test for a bad fix to the board's missing-horizontal-scrollbar
  // bug: adding `min-h-0` to the shared `(main)` layout's content wrapper
  // (src/app/(main)/layout.tsx) capped that wrapper's box to the space left
  // in the viewport instead of letting it grow to its content's full height.
  // On any page taller than one screen, the page's own content then rendered
  // past the wrapper's (now-too-short) box while the Footer — a sibling of
  // the wrapper, positioned by the wrapper's box rather than its overflowing
  // content — landed right after that box, overlapping the tail of the page
  // instead of sitting below it. A shrunk viewport forces the Dashboard's
  // content taller than the visible area so this always exercises the
  // overflow path, not just on wide/tall real accounts.
  test("footer never overlaps page content on a tall page", async ({ userAPage: page }) => {
    await page.setViewportSize({ width: 800, height: 400 });
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({ timeout: EXPECT_TIMEOUT });

    const { contentBottom, footerTop } = await page.evaluate(() => {
      const main = document.querySelector("main");
      const footer = document.querySelector("footer");
      if (!main || !footer) throw new Error("main/footer not found");
      // Scroll the app's own scroll container (main has overflow-y-auto, not
      // the window) all the way down, then find the true bottom-most
      // rendered pixel of the page's content — not the wrapper box's own
      // (possibly capped) height, which is exactly what the buggy fix left
      // unbounded-looking while still overlapping.
      main.scrollTop = main.scrollHeight;
      const contentWrapper = main.firstElementChild as HTMLElement | null;
      if (!contentWrapper) throw new Error("content wrapper not found");
      let maxBottom = 0;
      for (const el of contentWrapper.querySelectorAll("*")) {
        maxBottom = Math.max(maxBottom, el.getBoundingClientRect().bottom);
      }
      return { contentBottom: maxBottom, footerTop: footer.getBoundingClientRect().top };
    });

    // Small tolerance for sub-pixel rounding — content must end at or before
    // the footer begins, never spill past it.
    expect(contentBottom).toBeLessThanOrEqual(footerTop + 2);
  });
});
