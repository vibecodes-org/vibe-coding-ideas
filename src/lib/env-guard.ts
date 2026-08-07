import { logger } from "@/lib/logger";

/**
 * Env vars the app cannot run correctly without. A var that is PRESENT but
 * blank is almost never intentional — it's the Vercel "sensitive" CLI footgun
 * (`vercel env add` on a sensitive var silently storing "", which always reads
 * back as "" so the failed write is invisible). A blank `ANTHROPIC_MODEL` took
 * down every AI feature from 2026-07-23 to 2026-08-07 this way.
 */
export const REQUIRED_ENV_VARS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "API_KEY_ENCRYPTION_KEY",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_MODEL",
] as const;

/** Names (from `names`) that are defined in `env` but blank or whitespace-only. */
export function findBlankEnvVars(
  env: Record<string, string | undefined>,
  names: readonly string[] = REQUIRED_ENV_VARS
): string[] {
  return names.filter((name) => {
    const value = env[name];
    return value !== undefined && value.trim() === "";
  });
}

/** Boot-time check, called from instrumentation.ts on the nodejs runtime. */
export function warnOnBlankEnvVars(): void {
  const blank = findBlankEnvVars(process.env);
  if (blank.length > 0) {
    logger.error(
      "Env vars present but BLANK — likely the Vercel sensitive-var CLI footgun; re-add with --no-sensitive and verify by re-pull (see docs/release-process.md)",
      { blank }
    );
  }
}
