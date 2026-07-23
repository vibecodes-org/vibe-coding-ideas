import { describe, expect, it } from "vitest";
import { classifyRepoAccess } from "./github-verify";

describe("classifyRepoAccess", () => {
  it("V1 — no connection short-circuits to no_connection regardless of any other field", () => {
    expect(classifyRepoAccess({ hasConnection: false })).toBe("no_connection");
    // Even if a status/error somehow got set, absence of a connection wins —
    // this is the case where no GitHub API call is made at all.
    expect(classifyRepoAccess({ hasConnection: false, httpStatus: 200, isPrivate: false })).toBe(
      "no_connection"
    );
    expect(classifyRepoAccess({ hasConnection: false, error: true })).toBe("no_connection");
  });

  it("V2 — 200 + public repo → ok_public", () => {
    expect(classifyRepoAccess({ hasConnection: true, httpStatus: 200, isPrivate: false })).toBe(
      "ok_public"
    );
  });

  it("V3 — 200 + private repo → ok_private", () => {
    expect(classifyRepoAccess({ hasConnection: true, httpStatus: 200, isPrivate: true })).toBe(
      "ok_private"
    );
  });

  it("V4 — 404 → not_found_or_no_access (the ambiguous case: typo or private+invisible)", () => {
    expect(classifyRepoAccess({ hasConnection: true, httpStatus: 404 })).toBe(
      "not_found_or_no_access"
    );
  });

  it("404-ambiguity: identical mapping whether or not isPrivate happens to be set on a 404", () => {
    // isPrivate is only meaningful on a 200 response; a 404 never carries repo
    // data, so any isPrivate value must be ignored and the result unchanged.
    expect(classifyRepoAccess({ hasConnection: true, httpStatus: 404, isPrivate: true })).toBe(
      "not_found_or_no_access"
    );
    expect(classifyRepoAccess({ hasConnection: true, httpStatus: 404, isPrivate: false })).toBe(
      "not_found_or_no_access"
    );
  });

  it("V6 — 403 (rate-limit / secondary rate limit) → unreachable, never treated as access-denied", () => {
    expect(classifyRepoAccess({ hasConnection: true, httpStatus: 403 })).toBe("unreachable");
  });

  it("V6 — 5xx (GitHub down) → unreachable", () => {
    expect(classifyRepoAccess({ hasConnection: true, httpStatus: 500 })).toBe("unreachable");
    expect(classifyRepoAccess({ hasConnection: true, httpStatus: 503 })).toBe("unreachable");
  });

  it("V6 — network error / timeout / abort → unreachable", () => {
    expect(classifyRepoAccess({ hasConnection: true, error: true })).toBe("unreachable");
    // Even if a stray httpStatus were present alongside an error flag, the
    // error takes precedence — it means the request itself failed.
    expect(classifyRepoAccess({ hasConnection: true, error: true, httpStatus: 200 })).toBe(
      "unreachable"
    );
  });

  it("degrades unmapped/unexpected HTTP statuses to unreachable rather than throwing", () => {
    expect(classifyRepoAccess({ hasConnection: true, httpStatus: 418 })).toBe("unreachable");
    expect(classifyRepoAccess({ hasConnection: true, httpStatus: undefined })).toBe("unreachable");
  });
});
