import Link from "next/link";
import { GITHUB_URL } from "./closing-band";
import styles from "./aurora.module.css";

export function AuroraFooter() {
  const sep = (
    <span className={styles.sep} aria-hidden="true">
      ·
    </span>
  );
  return (
    <footer className={styles.footer}>
      © {new Date().getFullYear()} VibeCodes
      {sep}
      <Link href="/guide">Guide</Link>
      {sep}
      <Link href="/changelog">Changelog</Link>
      {sep}
      <Link href="/terms">Terms</Link>
      {sep}
      <Link href="/privacy">Privacy</Link>
      {sep}
      <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
        GitHub
      </a>
    </footer>
  );
}
