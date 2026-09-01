import { describe, it, expect } from "vitest";
import { E2EE_COPY } from "./e2ee-copy";

/** Every user-facing string in the module, flattened for the blanket checks below. */
function allStrings(): string[] {
  const out: string[] = [];
  const visit = (v: unknown) => {
    if (typeof v === "string") out.push(v);
    else if (v && typeof v === "object") Object.values(v).forEach(visit);
  };
  visit(E2EE_COPY);
  return out;
}

describe("E2EE_COPY — design doc §6 exact strings", () => {
  it("matches the design doc's copy table verbatim", () => {
    expect(E2EE_COPY.chip.notE2ee).toBe("Not encrypted end-to-end");
    expect(E2EE_COPY.chip.notE2eeTooltip).toBe(
      "Traffic to this session is protected in transit, but the relay server can technically read it. Update the helper to close that gap.",
    );
    expect(E2EE_COPY.nudge.body).toBe(
      "This session isn’t end-to-end encrypted yet — the helper on your Mac needs an update.",
    );
    expect(E2EE_COPY.nudge.sub).toBe("Everything keeps working in the meantime; the update takes about a minute.");
    expect(E2EE_COPY.required.pill).toBe("Update needed");
    expect(E2EE_COPY.required.title).toBe("Update the helper to reconnect");
    expect(E2EE_COPY.required.body).toBe(
      "Terminal sessions are now end-to-end encrypted, and the helper on your Mac is too old to take part. Nothing was sent unprotected — we stopped before connecting.",
    );
    expect(E2EE_COPY.required.fine).toBe(
      "The update takes about a minute. Your project files and any local work are untouched.",
    );
    expect(E2EE_COPY.integrity.pill).toBe("Secure link interrupted");
    expect(E2EE_COPY.integrity.title).toBe("Secure link interrupted");
    expect(E2EE_COPY.integrity.body).toBe(
      "Some data on this session’s encrypted stream couldn’t be verified, so we stopped it rather than show you output we can’t vouch for. This is usually a network hiccup. Your agent may still be running on your machine — reconnecting starts a fresh, verified stream.",
    );
    expect(E2EE_COPY.connected.tooltip).toBe(
      "Connected · end-to-end encrypted — only this browser tab and the helper on your Mac hold the keys; the relay in between can’t read your session.",
    );
  });

  // AC-6/AC-7 (design §7's version-skew matrix): copy must never name a
  // version number, and must never claim the update "adds encryption" as a
  // dated fact — both would break the moment the app and helper deploy on
  // different schedules.
  it("AC-6/AC-7: no string names a version number", () => {
    // Catches "3.2", "v3", "2026", etc. — any digit run of length >= 1 near a
    // version-shaped context, plus the common "v<digit>" prefix.
    const versionish = /\bv\d|\b\d+\.\d+\b/i;
    for (const s of allStrings()) {
      expect(s).not.toMatch(versionish);
    }
  });

  it("AC-6/AC-7: no string claims the update 'adds encryption' as a dated fact, or names alarming/tampering language", () => {
    const forbidden = /\badds? encryption\b|\battack\b|\btampered?\b|\bsecurity breach\b/i;
    for (const s of allStrings()) {
      expect(s).not.toMatch(forbidden);
    }
  });

  // Design binding note (§4): "Never the rose Error pill or the word
  // 'attack', 'tampered', or 'security breach' in first-line copy" — the
  // mid-session integrity body must lead with the calm, network-glitch-first
  // framing even on a repeated failure (Nick's binding decision: no
  // escalation on a second consecutive failure — this is the SAME string
  // every time, there is no second/escalated variant to drift from it).
  it("integrity.body leads with the calm, non-accusatory framing (network hiccup, not tampering)", () => {
    expect(E2EE_COPY.integrity.body.toLowerCase()).toContain("network hiccup");
  });
});
