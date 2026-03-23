import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// We need to re-import logger fresh per test to pick up env var changes,
// so we use dynamic import with vi.resetModules().
let logger: typeof import("./logger").logger;

async function loadLogger() {
  const mod = await import("./logger");
  return mod.logger;
}

describe("logger", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-21T12:00:00.000Z"));
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("routes error to console.error", async () => {
    process.env.LOG_LEVEL = "debug";
    logger = await loadLogger();

    logger.error("something broke", { userId: "abc" });

    expect(console.error).toHaveBeenCalledOnce();
    const output = JSON.parse(
      (console.error as ReturnType<typeof vi.fn>).mock.calls[0][0]
    );
    expect(output.level).toBe("error");
    expect(output.message).toBe("something broke");
    expect(output.context).toEqual({ userId: "abc" });
  });

  it("routes warn to console.warn", async () => {
    process.env.LOG_LEVEL = "debug";
    logger = await loadLogger();

    logger.warn("degraded");

    expect(console.warn).toHaveBeenCalledOnce();
    const output = JSON.parse(
      (console.warn as ReturnType<typeof vi.fn>).mock.calls[0][0]
    );
    expect(output.level).toBe("warn");
  });

  it("routes info to console.log (Vercel compatibility)", async () => {
    process.env.LOG_LEVEL = "debug";
    logger = await loadLogger();

    logger.info("started");

    expect(console.log).toHaveBeenCalledOnce();
    const output = JSON.parse(
      (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0]
    );
    expect(output.level).toBe("info");
  });

  it("routes debug to console.log (Vercel compatibility)", async () => {
    process.env.LOG_LEVEL = "debug";
    logger = await loadLogger();

    logger.debug("cache miss");

    expect(console.log).toHaveBeenCalledTimes(1);
    const output = JSON.parse(
      (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0]
    );
    expect(output.level).toBe("debug");
  });

  it("suppresses levels below the configured threshold", async () => {
    process.env.LOG_LEVEL = "error";
    logger = await loadLogger();

    logger.warn("should not appear");
    logger.info("should not appear");
    logger.debug("should not appear");

    expect(console.warn).not.toHaveBeenCalled();
    expect(console.log).not.toHaveBeenCalled();

    logger.error("should appear");
    expect(console.error).toHaveBeenCalledOnce();
  });

  it("defaults to warn in production", async () => {
    delete process.env.LOG_LEVEL;
    process.env.NODE_ENV = "production";
    logger = await loadLogger();

    logger.info("suppressed");
    logger.debug("suppressed");
    expect(console.log).not.toHaveBeenCalled();

    logger.warn("visible");
    logger.error("visible");
    expect(console.warn).toHaveBeenCalledOnce();
    expect(console.error).toHaveBeenCalledOnce();
  });

  it("defaults to debug in development", async () => {
    delete process.env.LOG_LEVEL;
    process.env.NODE_ENV = "development";
    logger = await loadLogger();

    logger.debug("visible in dev");
    expect(console.log).toHaveBeenCalledOnce();
  });

  it("omits context key when not provided", async () => {
    process.env.LOG_LEVEL = "debug";
    logger = await loadLogger();

    logger.error("no context");

    const output = JSON.parse(
      (console.error as ReturnType<typeof vi.fn>).mock.calls[0][0]
    );
    expect(output).not.toHaveProperty("context");
    expect(output.level).toBe("error");
    expect(output.message).toBe("no context");
    expect(output.timestamp).toBeDefined();
  });

  it("outputs valid ISO 8601 timestamp", async () => {
    process.env.LOG_LEVEL = "debug";
    logger = await loadLogger();

    logger.error("test");

    const output = JSON.parse(
      (console.error as ReturnType<typeof vi.fn>).mock.calls[0][0]
    );
    expect(output.timestamp).toBe("2026-03-21T12:00:00.000Z");
    expect(new Date(output.timestamp).toISOString()).toBe(output.timestamp);
  });

  it("LOG_LEVEL env var overrides NODE_ENV default", async () => {
    process.env.NODE_ENV = "production";
    process.env.LOG_LEVEL = "debug";
    logger = await loadLogger();

    logger.debug("should appear despite production");
    expect(console.log).toHaveBeenCalledOnce();
  });
});
