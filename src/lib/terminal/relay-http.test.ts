import { describe, it, expect } from "vitest";
import { toHttpRelayUrl, relayHttpBaseUrl } from "./relay-http";

describe("toHttpRelayUrl", () => {
  it("converts wss:// to https://", () => {
    expect(toHttpRelayUrl("wss://vibecodes-terminal-relay.example.workers.dev")).toBe(
      "https://vibecodes-terminal-relay.example.workers.dev",
    );
  });

  it("converts ws:// to http://", () => {
    expect(toHttpRelayUrl("ws://127.0.0.1:8787")).toBe("http://127.0.0.1:8787");
  });

  it("leaves an already-http(s) url untouched", () => {
    expect(toHttpRelayUrl("https://example.com")).toBe("https://example.com");
  });
});

describe("relayHttpBaseUrl", () => {
  it("falls back to the dev default when unset", () => {
    expect(relayHttpBaseUrl(undefined)).toBe("http://127.0.0.1:8787");
  });

  it("derives from NEXT_PUBLIC_TERMINAL_RELAY_URL", () => {
    expect(relayHttpBaseUrl("wss://relay.example.com")).toBe("https://relay.example.com");
  });
});
