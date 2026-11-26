import type { ColumnCounts } from "@/lib/landing-stats";
import styles from "./aurora.module.css";

/**
 * The example board in the front-page window. Fixed on purpose: every title is a
 * real card title from VibeCodes' own public board, and nothing here is read live.
 * Never add titles from a private board; this repo and page are public.
 */

type TagKind = "bug" | "bot" | "feat" | "data";
type Worker = { initials: string; color: string; text: string; lens?: boolean };
type Card = {
  tags?: { kind: TagKind; label: string }[];
  title: string;
  meta?: string;
  /** Steps done, out of `of`. */
  progress?: { done: number; of: number };
  working?: Worker;
  shipped?: boolean;
  delay?: string;
};
type Column = { title: string; countKey: keyof ColumnCounts; swatch: string; cards: Card[] };

const TAG_CLASS: Record<TagKind, string> = {
  bug: styles.tBug,
  bot: styles.tBot,
  feat: styles.tFeat,
  data: styles.tData,
};

const COLUMNS: Column[] = [
  {
    title: "To Do",
    countKey: "todo",
    swatch: "#6b6b80",
    cards: [
      {
        tags: [{ kind: "feat", label: "Feature" }],
        title: "Onboarding: open the board straight away and write starter tasks in the background",
        meta: "No workflow yet",
      },
      {
        tags: [{ kind: "bug", label: "Bug" }],
        title: "Finished-card message offers a new tab when there is no next card",
        meta: "Bug Fix",
        progress: { done: 1, of: 3 },
      },
      {
        tags: [
          { kind: "bug", label: "Bug" },
          { kind: "bot", label: "Terminal" },
        ],
        title: "Terminal setup panel is cut off in a short window",
        meta: "Bug Fix",
        progress: { done: 0, of: 3 },
      },
    ],
  },
  {
    title: "In Progress",
    countKey: "inProgress",
    swatch: "var(--cyan)",
    cards: [
      {
        tags: [
          { kind: "bug", label: "Bug" },
          { kind: "bot", label: "Terminal" },
        ],
        title: "Terminal sessions survive the laptop sleeping: come back to the same live session",
        meta: "Bug Fix",
        progress: { done: 2, of: 3 },
        working: { initials: "AT", color: "#67e8f9", text: "Atlas is writing the fix" },
      },
      {
        tags: [
          { kind: "feat", label: "Feature" },
          { kind: "data", label: "Design" },
        ],
        title: 'Rebrand the site: the "Aurora" look',
        meta: "Feature Development",
        progress: { done: 1, of: 4 },
      },
      {
        tags: [{ kind: "feat", label: "Feature" }],
        title: "Let terminal sessions message each other: Claude to Codex, and back",
        meta: "Build in progress",
        progress: { done: 1, of: 4 },
      },
    ],
  },
  {
    title: "Verify",
    countKey: "verify",
    swatch: "var(--violet)",
    cards: [
      {
        tags: [{ kind: "feat", label: "Feature" }],
        title: "Next-card bar: the board offers the next card as soon as one finishes",
        meta: "Feature Development",
        progress: { done: 4, of: 4 },
        working: { initials: "LE", color: "#f9a8d4", text: "Lens is reviewing the code", lens: true },
        delay: "-1.4s",
      },
      {
        title: "Warn on the board when a workflow run has steps with no cost recorded",
        meta: "Bug Fix",
        progress: { done: 3, of: 3 },
      },
    ],
  },
  {
    title: "Done",
    countKey: "done",
    swatch: "var(--lime)",
    cards: [
      {
        tags: [
          { kind: "feat", label: "Feature" },
          { kind: "bot", label: "Terminal" },
        ],
        title: "In-app setup wizard: guided install and sign-in for Claude Code and Codex",
        shipped: true,
      },
      {
        tags: [{ kind: "bug", label: "Bug" }],
        title: "Board hid cards once it had more than 1,000",
        shipped: true,
      },
    ],
  },
];

const AVATARS = [
  { i: "PL", c: "#c4b5fd" },
  { i: "AT", c: "#67e8f9" },
  { i: "LE", c: "#f9a8d4" },
  { i: "SE", c: "#bef264" },
];

/** `counts` are the real column totals from the hourly live read; null (read failed) shows none. */
export function AuroraBoard({ counts }: { counts: ColumnCounts | null }) {
  return (
    <div className={styles.stage}>
      {/* Decorative example, not a working board: hidden from screen readers. */}
      <div className={styles.window} aria-hidden="true">
        <div className={styles.bar}>
          <span className={styles.d} />
          <span className={styles.d} />
          <span className={styles.d} />
          <span className={styles.url}>vibecodes.co.uk/ideas/vibecodes/board</span>
          <span className={styles.live}>
            <span className={styles.dot} />2 agents working
          </span>
        </div>
        <div className={styles.boardhead}>
          <h3>VibeCodes</h3>
          <span className={`${styles.tag} ${styles.tFin}`}>Public</span>
          <div className={styles.agents}>
            {AVATARS.map((a) => (
              <span key={a.i} className={styles.av} style={{ background: a.c }}>
                {a.i}
              </span>
            ))}
          </div>
        </div>
        <div className={styles.cols}>
          {COLUMNS.map((col) => (
            <div key={col.title} className={styles.col}>
              <h4>
                <span className={styles.sw} style={{ background: col.swatch }} />
                {col.title}
                {counts && <> <span className={styles.n}>{counts[col.countKey]}</span></>}
              </h4>
              {col.cards.map((card) => (
                <div
                  key={card.title}
                  className={`${styles.card} ${card.working ? styles.working : ""}`}
                  style={card.delay ? { animationDelay: card.delay } : undefined}
                >
                  {card.tags && (
                    <div className={styles.tags}>
                      {card.tags.map((t) => (
                        <span key={t.label} className={`${styles.tag} ${TAG_CLASS[t.kind]}`}>
                          {t.label}
                        </span>
                      ))}
                    </div>
                  )}
                  <p>{card.title}</p>
                  {card.shipped ? (
                    <div className={`${styles.meta} ${styles.shipped}`}>✓ Shipped</div>
                  ) : (
                    <div className={styles.meta}>
                      {card.meta}
                      {card.progress && (
                        <span className={styles.prog}>
                          {Array.from({ length: card.progress.of }, (_, n) => (
                            <i key={n} className={n < card.progress!.done ? styles.on : undefined} />
                          ))}
                        </span>
                      )}
                    </div>
                  )}
                  {card.working && (
                    <div className={`${styles.who} ${card.working.lens ? styles.whoLens : ""}`}>
                      <span
                        className={`${styles.av} ${styles.miniAv}`}
                        style={{ background: card.working.color }}
                      >
                        {card.working.initials}
                      </span>
                      {card.working.text}
                      {!card.working.lens && (
                        <span className={styles.typing}>
                          <i />
                          <i />
                          <i />
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
