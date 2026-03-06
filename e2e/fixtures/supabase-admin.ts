import { createClient } from "@supabase/supabase-js";

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing Supabase env vars — check .env.test");
}

/** Service-role client that bypasses RLS — for test data seeding/cleanup only */
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export interface TestUser {
  id: string;
  email: string;
  password: string;
}

const TEST_USERS = {
  userA: {
    email: process.env.TEST_USER_A_EMAIL ?? "test-user-a@vibecodes-test.local",
    password: process.env.TEST_USER_A_PASSWORD ?? "TestPassword123!",
    fullName: "Test User A",
  },
  userB: {
    email: process.env.TEST_USER_B_EMAIL ?? "test-user-b@vibecodes-test.local",
    password: process.env.TEST_USER_B_PASSWORD ?? "TestPassword123!",
    fullName: "Test User B",
  },
  admin: {
    email: process.env.TEST_ADMIN_EMAIL ?? "test-admin@vibecodes-test.local",
    password: process.env.TEST_ADMIN_PASSWORD ?? "TestPassword123!",
    fullName: "Test Admin",
  },
  fresh: {
    email: process.env.TEST_FRESH_EMAIL ?? "test-fresh@vibecodes-test.local",
    password: process.env.TEST_FRESH_PASSWORD ?? "TestPassword123!",
    fullName: "Fresh User",
  },
} as const;

/** Look up a user by email via the public.users table (bypasses listUsers pagination issues) */
async function getUserByEmail(email: string): Promise<{ id: string } | null> {
  const { data } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  return data;
}

/** Ensures all 4 test users exist in the test Supabase project. Idempotent. */
export async function ensureTestUsers(): Promise<Record<string, TestUser>> {
  const users: Record<string, TestUser> = {};

  for (const [key, config] of Object.entries(TEST_USERS)) {
    // Try to create the user — if they already exist, look them up
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: config.email,
      password: config.password,
      email_confirm: true,
      user_metadata: { full_name: config.fullName },
    });

    if (error) {
      if (error.message.includes("already been registered")) {
        // User exists — find their ID and ensure password is correct
        const existing = await getUserByEmail(config.email);
        if (!existing) throw new Error(`User ${config.email} registered in auth but not in public.users`);
        await supabaseAdmin.auth.admin.updateUserById(existing.id, {
          password: config.password,
        });
        users[key] = { id: existing.id, email: config.email, password: config.password };
      } else {
        throw new Error(`Failed to create ${key}: ${error.message}`);
      }
    } else {
      users[key] = { id: data.user.id, email: config.email, password: config.password };
    }

    // Set admin flag for admin user
    if (key === "admin") {
      await supabaseAdmin
        .from("users")
        .update({ is_admin: true })
        .eq("id", users[key].id);
    }

    // Set full_name and mark onboarding complete for non-fresh users
    // (prevents the onboarding dialog from blocking E2E interactions)
    if (key !== "fresh") {
      await supabaseAdmin
        .from("users")
        .update({ full_name: config.fullName, onboarding_completed_at: new Date().toISOString() })
        .eq("id", users[key].id);
    }
  }

  return users;
}
