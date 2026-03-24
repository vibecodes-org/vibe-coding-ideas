import { defineConfig } from "@playwright/test";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";

dotenv.config({ path: path.resolve(__dirname, "../../.env.test"), override: true });

// Check if auth state exists and is fresh (< 45 min old)
const authFile = path.resolve(__dirname, "../.auth/user-a.json");
const isAuthFresh = (() => {
  try {
    const stat = fs.statSync(authFile);
    return Date.now() - stat.mtimeMs < 45 * 60 * 1000;
  } catch {
    return false;
  }
})();

if (!isAuthFresh) {
  console.warn(
    "\n⚠ Auth state is missing or expired. Run this first:\n" +
    "  npx playwright test --project=setup\n"
  );
}

export default defineConfig({
  testDir: "./",
  testMatch: "record-demo.ts",
  fullyParallel: false,
  retries: 0,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 15_000 },

  reporter: [["list"]],

  use: {
    baseURL: "http://localhost:3000",
    viewport: { width: 1920, height: 1080 },
    colorScheme: "dark",
    storageState: authFile,
    navigationTimeout: 60_000,
    actionTimeout: 15_000,
    video: {
      mode: "on",
      size: { width: 1920, height: 1080 },
    },
  },

  webServer: {
    command: process.env.CI
      ? [
          'node -e "const fs=require(\'fs\');try{fs.renameSync(\'.env.local\',\'.env.local.e2e-bak\')}catch{}"',
          "npm run build",
          'node -e "const fs=require(\'fs\');try{fs.renameSync(\'.env.local.e2e-bak\',\'.env.local\')}catch{}"',
          "npm start",
        ].join(" && ")
      : "npm run dev",
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
