import { test, expect } from "../fixtures/auth";

test.describe("Landing page", () => {
  test.describe("anonymous visitor", () => {
    test("renders hero section with heading text", async ({ anonPage }) => {
      await anonPage.goto("/");

      const heading = anonPage.getByRole("heading", {
        name: /where vibe coding ideas come to life/i,
      });
      await expect(heading).toBeVisible();

      // Tagline paragraph
      await expect(
        anonPage.getByText(
          /drop an idea\. let ai refine it, generate a task board, and assign agents to build it/i
        )
      ).toBeVisible();
    });

    test("CTA button links to /signup", async ({ anonPage }) => {
      await anonPage.goto("/");

      const ctaLink = anonPage.getByRole("link", { name: /get started/i }).first();
      await expect(ctaLink).toBeVisible();
      await expect(ctaLink).toHaveAttribute("href", "/signup");
    });

    test("shows features section", async ({ anonPage }) => {
      await anonPage.goto("/");

      // Section heading
      await expect(
        anonPage.getByRole("heading", { name: /everything you need to ship/i })
      ).toBeVisible();

      // All six feature cards
      const featureTitles = [
        "Idea Feed",
        "Kanban Boards",
        "AI Agent Personas",
        "Collaboration",
        "Real-time Everything",
        "Secure by Default",
      ];

      for (const title of featureTitles) {
        await expect(anonPage.getByText(title, { exact: true })).toBeVisible();
      }
    });

    test("footer contains Guide and Privacy links", async ({ anonPage }) => {
      await anonPage.goto("/");

      // Use last() — landing page has a testimonial <footer> and the site <footer>
      const footer = anonPage.locator("footer").last();
      await expect(footer).toBeVisible();

      // Guide link
      const guideLink = footer.getByRole("link", { name: "Guide" });
      await expect(guideLink).toBeVisible();
      await expect(guideLink).toHaveAttribute("href", "/guide");

      // Privacy link
      const privacyLink = footer.getByRole("link", { name: "Privacy" });
      await expect(privacyLink).toBeVisible();
      await expect(privacyLink).toHaveAttribute("href", "/privacy");
    });

    test("landing page loads for anonymous users", async ({ anonPage }) => {
      await anonPage.goto("/");

      // Should stay on landing page, not redirect to login or dashboard
      await anonPage.waitForLoadState("domcontentloaded");
      const url = anonPage.url();
      expect(url).not.toContain("/login");
      expect(url).not.toContain("/dashboard");

      // Navbar should be present
      await expect(anonPage.locator("nav")).toBeVisible({ timeout: 15_000 });

      // VibeCodes branding in footer — use first() to avoid strict mode if multiple matches
      await expect(anonPage.locator("footer").getByText("VibeCodes").first()).toBeVisible({ timeout: 15_000 });
    });
  });

  test.describe("authenticated user", () => {
    test("visiting / redirects to /dashboard", async ({ userAPage }) => {
      await userAPage.goto("/");

      // The server-side redirect should send authenticated users to /dashboard
      await userAPage.waitForURL("**/dashboard", { timeout: 15_000 });
      await expect(userAPage).toHaveURL(/\/dashboard$/);
    });
  });
});
