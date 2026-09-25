import { describe, expect, it } from "vitest";
import { mintHelperToken, mintSessionTokens } from "../../../terminal/shared/session-token.mjs";

// Task b563f4da (QA re-test): the browser launch-cap tests
// (launch-claude-code.guide-bootstrap.test.ts, prompt-budget.test.ts) model
// BOTH the bridge token and the helper token as 283 chars. Real minted tokens
// differ (bridge ~294, helper ~255), but the PAIR must stay within the modelled
// 566 total or those tests' "the helper token always rides under 2700" claim
// stops describing production. If a token format change grows either token,
// this fails first — re-measure the cap (MAX_LAUNCH_URL_LENGTH) then.
const MODELLED_TOKEN_LENGTH = 283;

describe("real launch-link token lengths vs the cap tests' model", () => {
  it("bridge + helper tokens fit the 2 × 283 the cap tests assume", async () => {
    const sub = "5f0c1a1e-1234-4abc-8def-0123456789ab";
    const secret = "s".repeat(64);
    const tokens = await mintSessionTokens({
      sub,
      idea: "10a56f30-da8b-46a6-b989-646496d2dc12",
      secret,
    });
    const helperToken = await mintHelperToken({ sub, secret });
    // Both ride in the URL unescaped (base64url + dots) — encoded length = raw.
    expect(encodeURIComponent(tokens.bridge)).toBe(tokens.bridge);
    expect(encodeURIComponent(helperToken)).toBe(helperToken);
    expect(tokens.bridge.length + helperToken.length).toBeLessThanOrEqual(2 * MODELLED_TOKEN_LENGTH);
  });
});
