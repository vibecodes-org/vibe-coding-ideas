import Link from "next/link";
import styles from "./aurora.module.css";

export const GITHUB_URL = "https://github.com/vibecodes-org/vibe-coding-ideas";

export function ClosingBand() {
  return (
    <div className={styles.wrap}>
      <div className={styles.closing}>
        <h2 className={styles.h2}>Got an idea? Hand it to the team.</h2>
        <p className={styles.sub}>Start free. No credit card needed.</p>
        <div className={styles.ctas}>
          <Link className={`${styles.btn} ${styles.primary}`} href="/signup">
            Get started free →
          </Link>
          <a
            className={`${styles.btn} ${styles.ghost}`}
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            View on GitHub
          </a>
        </div>
      </div>
    </div>
  );
}
