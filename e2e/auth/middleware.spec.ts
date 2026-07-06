import { test, expect } from "../fixtures/auth";
import { EXPECT_TIMEOUT } from "../fixtures/constants";

test.describe("Middleware — Route Protection", () => {
  test.describe("Unauthenticated user", () => {
    test("should redirect /dashboard to /login", async ({ anonPage: page }) => {
      await page.goto("/dashboard");
      await page.waitForURL(/\/login/, { timeout: EXPECT_TIMEOUT });
      await expect(page).toHaveURL(/\/login/);
    });

    test("should redirect /ideas to /login", async ({ anonPage: page }) => {
      await page.goto("/ideas");
      await page.waitForURL(/\/login/, { timeout: EXPECT_TIMEOUT });
      await expect(page).toHaveURL(/\/login/);
    });

    test("should redirect /agents to /login", async ({ anonPage: page }) => {
      await page.goto("/agents");
      await page.waitForURL(/\/login/, { timeout: EXPECT_TIMEOUT });
      await expect(page).toHaveURL(/\/login/);
    });

    test("should redirect /admin to /login", async ({ anonPage: page }) => {
      await page.goto("/admin");
      await page.waitForURL(/\/login/, { timeout: EXPECT_TIMEOUT });
      await expect(page).toHaveURL(/\/login/);
    });

    test("should allow access to public landing page", async ({ anonPage: page }) => {
      await page.goto("/");
      await page.waitForLoadState("domcontentloaded");
      await expect(page).toHaveURL(/\/$/);
    });

    test("should allow access to guide pages", async ({ anonPage: page }) => {
      await page.goto("/guide");
      await page.waitForLoadState("domcontentloaded");
      await expect(page).toHaveURL(/\/guide/);
    });
  });

  test.describe("Middleware-excluded API routes", () => {
    // /api/terminal is excluded from the middleware matcher (card b6e5c728) and
    // does its own auth. An unauthenticated mint must be answered by the ROUTE
    // (clean 401 JSON) — a redirect, 500, or empty response means the exclusion
    // regressed. Uses the built-in `request` fixture, which carries no auth state.
    test("unauthenticated POST /api/terminal/session returns 401 from the route", async ({
      request,
    }) => {
      const res = await request.post("/api/terminal/session", { data: {} });
      expect(res.status()).toBe(401);
      expect(await res.json()).toEqual({ error: "Not authenticated" });
    });
  });

  test.describe("Global Response poisoning regression (card b6e5c728)", () => {
    // mcp-handler@1.0.7 (via @modelcontextprotocol/sdk@1.25.2 → @hono/node-server
    // getRequestListener) REPLACED globalThis.Response when the MCP route module
    // loaded. Next's `res instanceof Response` check then rejected
    // Response.json()/NextResponse.json() from OTHER routes in the same function
    // instance → empty 500 "No response is returned from route handler". Victims:
    // /api/terminal/session and the three /api/ai/* routes. Fixed by bumping
    // mcp-handler to 1.1.0 (web-standard transport, no global mutation).
    //
    // The ORDER here is the pin: hit /api/mcp FIRST to force the MCP route module
    // to load, then assert the other routes still return their own JSON responses.
    test("MCP route load does not poison other routes' Response handling", async ({
      request,
    }) => {
      // 1. Load the MCP route module. Unauthenticated → withMcpAuth 401 JSON.
      const mcp = await request.get("/api/mcp");
      expect(mcp.status()).toBe(401);
      const mcpBody = await mcp.json();
      expect(mcpBody.error).toBe("invalid_token");

      // 2. Terminal mint AFTER the MCP module loaded — must still be the route's
      //    own 401 JSON, never an empty 500.
      const terminal = await request.post("/api/terminal/session", { data: {} });
      expect(terminal.status()).toBe(401);
      expect(await terminal.json()).toEqual({ error: "Not authenticated" });

      // 3. The three AI routes — all check auth first and return 401 JSON.
      for (const path of [
        "/api/ai/enhance",
        "/api/ai/enhance-create",
        "/api/ai/generate-tasks",
      ]) {
        const res = await request.post(path, { data: {} });
        expect(res.status(), `${path} should 401, not empty-500`).toBe(401);
        expect(await res.json()).toEqual({ error: "Not authenticated" });
      }
    });
  });

  test.describe("Authenticated user", () => {
    test("should access /dashboard without redirect", async ({ userAPage: page }) => {
      await page.goto("/dashboard");
      await page.waitForLoadState("domcontentloaded");
      await expect(page).toHaveURL(/\/dashboard/);
    });

    test("should access /ideas without redirect", async ({ userAPage: page }) => {
      await page.goto("/ideas");
      await page.waitForLoadState("domcontentloaded");
      await expect(page).toHaveURL(/\/ideas/);
    });

    test("should redirect /admin to /dashboard for non-admin", async ({ userAPage: page }) => {
      await page.goto("/admin");
      await page.waitForURL(/\/dashboard/, { timeout: EXPECT_TIMEOUT });
      await expect(page).toHaveURL(/\/dashboard/);
    });

    test("should allow admin access to /admin", async ({ adminPage: page }) => {
      await page.goto("/admin");
      await page.waitForLoadState("domcontentloaded");
      await expect(page).toHaveURL(/\/admin/);
    });
  });
});
