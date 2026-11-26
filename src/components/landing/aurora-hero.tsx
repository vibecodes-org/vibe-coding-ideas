import Link from "next/link";
import type { LandingStats } from "@/lib/landing-stats";
import { CopyCommand } from "./copy-command";
import { AuroraBoard } from "./aurora-board";
import styles from "./aurora.module.css";

// Always the production address: this is the command a visitor should run.
export const INSTALL_COMMAND =
  "claude mcp add -s user --transport http vibecodes https://vibecodes.co.uk/api/mcp";

function liveLine(stats: LandingStats | null) {
  if (!stats) return "AI agents ship cards on our own board, live";
  return `${stats.agents} AI agents have shipped ${stats.cards} cards on our own board`;
}

export function AuroraHero({ stats }: { stats: LandingStats | null }) {
  return (
    <section className={styles.hero}>
      <div className={styles.glows} aria-hidden="true">
        <span className={styles.a1} />
        <span className={styles.a2} />
        <span className={styles.a3} />
      </div>
      <div className={styles.floor} aria-hidden="true" />
      <div className={styles.wrap}>
        <span className={styles.chip}>
          <b>Live</b> {liveLine(stats)}
        </span>
        <h1 className={styles.h1}>
          Your ideas, built by a <span className={styles.grad}>team of AI agents</span>
        </h1>
        <p className={styles.lede}>
          Drop an idea. VibeCodes turns it into a board, hands each card to a named agent, and
          walks it through plan, build, review and test until it ships.
        </p>
        <div className={styles.ctas}>
          <Link className={`${styles.btn} ${styles.primary}`} href="/signup">
            Get started free →
          </Link>
          <a className={`${styles.btn} ${styles.ghost}`} href="#how">
            Watch a card ship
          </a>
        </div>
        <CopyCommand command={INSTALL_COMMAND} />
        <AuroraBoard />
      </div>
    </section>
  );
}
