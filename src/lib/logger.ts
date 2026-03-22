/**
 * Structured logging module.
 *
 * Outputs JSON to the appropriate console method with configurable log levels.
 * Compatible with both server and client components (uses NODE_ENV for defaults).
 *
 * Usage:
 *   import { logger } from "@/lib/logger";
 *   logger.error("Failed to send email", { userId, error: err.message });
 */

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 } as const;

type LogLevel = keyof typeof LEVELS;

function getLevel(): LogLevel {
  // LOG_LEVEL env var takes precedence (server-side only)
  const envLevel =
    typeof process !== "undefined" ? process.env?.LOG_LEVEL : undefined;
  if (envLevel && envLevel in LEVELS) return envLevel as LogLevel;

  // Default: warn in production, debug in development
  const nodeEnv =
    typeof process !== "undefined" ? process.env?.NODE_ENV : undefined;
  return nodeEnv === "production" ? "warn" : "debug";
}

function emit(
  level: LogLevel,
  message: string,
  context?: Record<string, unknown>
): void {
  if (LEVELS[level] > LEVELS[getLevel()]) return;

  const entry: Record<string, unknown> = { level, message };
  if (context !== undefined) entry.context = context;
  entry.timestamp = new Date().toISOString();

  console[level](JSON.stringify(entry));
}

export const logger = {
  error: (message: string, context?: Record<string, unknown>) =>
    emit("error", message, context),
  warn: (message: string, context?: Record<string, unknown>) =>
    emit("warn", message, context),
  info: (message: string, context?: Record<string, unknown>) =>
    emit("info", message, context),
  debug: (message: string, context?: Record<string, unknown>) =>
    emit("debug", message, context),
};
