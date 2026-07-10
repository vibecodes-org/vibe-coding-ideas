"use client";

import { Paperclip, Info, AlertTriangle } from "lucide-react";
import type { EnhanceAttachmentUsage } from "@/lib/attachment-context";

/**
 * The "receipt" shown in the enhance result phase telling the author which
 * attached files the AI actually read. Two modes: a quiet neutral receipt
 * (≥1 file read) and an amber warning banner (files attached, none read).
 *
 * Data arrives via the `X-Attachment-Usage` response header on /api/ai/enhance
 * (see `encodeAttachmentUsageHeader`). Parsing is defensive: a missing or
 * malformed header renders nothing and never breaks the enhance result. When
 * the header degraded to the counts-only fallback (very long unicode
 * filenames), we still render an honest — if less detailed — receipt.
 */

type OmissionReason = EnhanceAttachmentUsage["omitted"][number]["reason"];

export type ParsedAttachmentUsage =
  | { kind: "full"; usage: EnhanceAttachmentUsage }
  | { kind: "counts"; usedCount: number; omittedCount: number };

const KNOWN_REASONS: ReadonlySet<string> = new Set([
  "too_large",
  "unsupported_type",
  "over_budget",
  "read_error",
]);

/** User-facing text for why a file was skipped. */
export function omissionReasonText(name: string, reason: OmissionReason): string {
  switch (reason) {
    case "too_large":
      return "over the 1 MB size limit";
    case "over_budget":
      return "skipped to stay within the combined reading limit";
    case "read_error":
      return "couldn't be read";
    case "unsupported_type": {
      const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
      return ext === "svg" ? "SVG files can't be read" : "images can't be read";
    }
    default:
      return "couldn't be read";
  }
}

/**
 * Parse the `X-Attachment-Usage` header value (URI-encoded JSON). Returns null
 * for anything we can't confidently render — the receipt is enrichment, never
 * a dependency, so a bad header must degrade to "show nothing".
 */
export function parseAttachmentUsageHeader(
  headerValue: string | null | undefined
): ParsedAttachmentUsage | null {
  if (!headerValue) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(decodeURIComponent(headerValue));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;

  // Counts-only fallback shape.
  if ("usedCount" in raw || "omittedCount" in raw) {
    const usedCount = Number((raw as { usedCount?: unknown }).usedCount) || 0;
    const omittedCount = Number((raw as { omittedCount?: unknown }).omittedCount) || 0;
    if (usedCount === 0 && omittedCount === 0) return null;
    return { kind: "counts", usedCount, omittedCount };
  }

  const usedRaw = (raw as { used?: unknown }).used;
  const omittedRaw = (raw as { omitted?: unknown }).omitted;
  if (!Array.isArray(usedRaw) || !Array.isArray(omittedRaw)) return null;

  const used = usedRaw
    .filter((u): u is Record<string, unknown> => !!u && typeof u === "object")
    .map((u) => ({
      id: String(u.id ?? ""),
      name: String(u.name ?? ""),
      truncated: u.truncated === true,
    }))
    .filter((u) => u.name);

  const omitted = omittedRaw
    .filter((o): o is Record<string, unknown> => !!o && typeof o === "object")
    .map((o) => ({
      id: String(o.id ?? ""),
      name: String(o.name ?? ""),
      // Unknown/garbage reasons degrade to the safe "couldn't be read" copy.
      reason: (KNOWN_REASONS.has(String(o.reason)) ? o.reason : "read_error") as OmissionReason,
    }))
    .filter((o) => o.name);

  if (used.length === 0 && omitted.length === 0) return null;
  return { kind: "full", usage: { used, omitted } };
}

function FileName({ children, muted }: { children: string; muted?: boolean }) {
  return (
    <span
      title={children}
      className={`font-mono text-[11px] break-all ${
        muted ? "text-muted-foreground" : "font-medium text-foreground"
      }`}
    >
      {children}
    </span>
  );
}

/** Neutral receipt: ≥1 file was read. */
function NeutralReceipt({ usage }: { usage: EnhanceAttachmentUsage }) {
  const { used, omitted } = usage;
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
      <div className="flex min-w-0 items-start gap-2">
        <Paperclip className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/60" />
        <span className="min-w-0 break-words">
          Considered {used.length} attached file{used.length === 1 ? "" : "s"}:{" "}
          {used.map((f, i) => (
            <span key={f.id || f.name}>
              {i > 0 && ", "}
              <FileName>{f.name}</FileName>
              {f.truncated && (
                <span className="text-muted-foreground/70"> (shortened to fit the reading limit)</span>
              )}
            </span>
          ))}
        </span>
      </div>
      {omitted.map((f) => (
        <div key={f.id || f.name} className="flex min-w-0 items-start gap-2">
          <Info className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/60" />
          <span className="min-w-0 break-words text-muted-foreground/80">
            Not read: <FileName muted>{f.name}</FileName> — {omissionReasonText(f.name, f.reason)}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Join a list of nodes with ", " and a final "and" (Oxford-style for 3+). */
function joinWithAnd(items: React.ReactNode[]): React.ReactNode[] {
  if (items.length <= 1) return items;
  const out: React.ReactNode[] = [];
  items.forEach((item, i) => {
    if (i > 0) {
      if (items.length === 2) out.push(" and ");
      else out.push(i === items.length - 1 ? ", and " : ", ");
    }
    out.push(<span key={i}>{item}</span>);
  });
  return out;
}

/** Amber warning: files were attached but none could be used. */
function AllOmittedWarning({
  omitted,
  hadAnswers,
}: {
  omitted: EnhanceAttachmentUsage["omitted"];
  hadAnswers: boolean;
}) {
  const usedClause = hadAnswers
    ? "used your description and answers only"
    : "used your description only";
  const n = omitted.length;

  let body: React.ReactNode;
  if (n === 1) {
    const f = omitted[0];
    body = (
      <>
        <FileName>{f.name}</FileName> was skipped ({omissionReasonText(f.name, f.reason)}). This
        enhancement {usedClause}.
      </>
    );
  } else {
    const prefix = n === 2 ? "Both attachments were skipped: " : `All ${n} attachments were skipped: `;
    const fragments = omitted.map((f) => (
      <>
        <FileName>{f.name}</FileName> ({omissionReasonText(f.name, f.reason)})
      </>
    ));
    body = (
      <>
        {prefix}
        {joinWithAnd(fragments)}. This enhancement {usedClause}.
      </>
    );
  }

  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400"
    >
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div className="min-w-0">
        <div className="font-semibold">Your attached files weren&apos;t used</div>
        <div className="mt-0.5 break-words text-amber-600/90 dark:text-amber-400/85">{body}</div>
      </div>
    </div>
  );
}

export function AttachmentUsageLine({
  usage,
  hadAnswers,
}: {
  usage: ParsedAttachmentUsage | null;
  hadAnswers: boolean;
}) {
  if (!usage) return null;

  if (usage.kind === "counts") {
    // Degraded (filenames dropped to keep the header small) — still honest.
    if (usage.usedCount === 0 && usage.omittedCount > 0) {
      const usedClause = hadAnswers
        ? "used your description and answers only"
        : "used your description only";
      return (
        <div
          role="status"
          className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div className="min-w-0">
            <div className="font-semibold">Your attached files weren&apos;t used</div>
            <div className="mt-0.5 text-amber-600/90 dark:text-amber-400/85">
              {usage.omittedCount} attached file{usage.omittedCount === 1 ? "" : "s"} could not be
              read. This enhancement {usedClause}.
            </div>
          </div>
        </div>
      );
    }
    if (usage.usedCount > 0) {
      return (
        <div className="flex items-start gap-2 rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          <Paperclip className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/60" />
          <span>
            Considered {usage.usedCount} attached file{usage.usedCount === 1 ? "" : "s"}
            {usage.omittedCount > 0
              ? `; ${usage.omittedCount} skipped`
              : ""}
            .
          </span>
        </div>
      );
    }
    return null;
  }

  const { used, omitted } = usage.usage;
  const allOmitted = used.length === 0 && omitted.length > 0;

  if (allOmitted) return <AllOmittedWarning omitted={omitted} hadAnswers={hadAnswers} />;
  if (used.length > 0) return <NeutralReceipt usage={usage.usage} />;
  return null;
}
