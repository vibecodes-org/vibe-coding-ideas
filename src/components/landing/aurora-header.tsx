import Link from "next/link";
import styles from "./aurora.module.css";

export function AuroraHeader() {
  return (
    <nav className={styles.nav} aria-label="Main">
      <div className={styles.wrap}>
        <Link className={styles.brand} href="/">
          <span className={styles.mark} aria-hidden="true" />
          VibeCodes
        </Link>
        <div className={styles.links}>
          <a href="#how">How it works</a>
          <Link href="/guide">Guide</Link>
          <Link href="/changelog">Changelog</Link>
        </div>
        <div className={styles.right}>
          <Link className={styles.login} href="/login">
            Log in
          </Link>
          <Link className={styles.ctaSm} href="/signup">
            Start free
          </Link>
        </div>
      </div>
    </nav>
  );
}
