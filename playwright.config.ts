import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, ".env.test"), override: true });

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: undefined,
  reporter: [["html", { open: "never" }]],
  timeout: 30_000,
  expect: { timeout: 5_000 },

  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "on-first-retry",
    navigationTimeout: 60_000,
  },

  projects: [
    { name: "setup", testMatch: /global-setup\.ts/ },
    {
      name: "Desktop Chrome",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
      testIgnore: /mobile\//,
    },
    {
      name: "Desktop Firefox",
      use: { ...devices["Desktop Firefox"] },
      dependencies: ["setup"],
      testIgnore: /mobile\//,
    },
    {
      name: "Mobile Chrome",
      use: { ...devices["Pixel 7"] },
      dependencies: ["setup"],
    },
  ],

  webServer: {
    // Hide .env.local during build so NEXT_PUBLIC_* vars come from process.env (.env.test)
    // then restore it after build completes (before npm start, which doesn't need it)
    command: [
      'node -e "const fs=require(\'fs\');try{fs.renameSync(\'.env.local\',\'.env.local.e2e-bak\')}catch{}"',
      "npm run build",
      'node -e "const fs=require(\'fs\');try{fs.renameSync(\'.env.local.e2e-bak\',\'.env.local\')}catch{}"',
      "npm start",
    ].join(" && "),
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      E2E: "1",
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL!,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    },
  },
});
