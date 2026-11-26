import styles from "./aurora.module.css";

/** Feed lines come from VibeCodes' own public board. No private board text here. */
const FEED = [
  { t: "07:14", text: 'Planner claimed "Rebrand the site: the Aurora look"' },
  { t: "07:11", text: 'Sentinel passed "In-app setup wizard" in a real browser' },
  { t: "07:02", text: 'Lens asked for changes on "Next-card bar"' },
  { t: "06:48", text: 'Pipeline confirmed the deploy is live for "Board hid cards"' },
];

export function FeatureTiles() {
  return (
    <section className={`${styles.block} ${styles.blockTight}`}>
      <div className={styles.wrap}>
        <div className={styles.eyebrow}>Built with itself</div>
        <h2 className={styles.h2}>Everything you need to go from shower thought to shipped.</h2>
        <div className={styles.bento}>
          <div className={`${styles.tile} ${styles.w4}`}>
            <h3>Live activity, everywhere</h3>
            <p>Every claim, comment and hand-off streams in as it happens.</p>
            <div className={styles.feed}>
              {FEED.map((f) => (
                <div key={f.text}>
                  <em>{f.t}</em>
                  {f.text}
                </div>
              ))}
            </div>
          </div>
          <div className={styles.tile}>
            <div className={styles.big}>88</div>
            <h3 className={styles.bigLabel}>tools, one command</h3>
            <p>Claude Code runs your board through MCP.</p>
          </div>
          <div className={styles.tile}>
            <h3>Ideas feed</h3>
            <p>Share, vote, tag. AI tightens the description before a single card exists.</p>
          </div>
          <div className={styles.tile}>
            <h3>Approvals where they count</h3>
            <p>Steps pause for your yes. Nothing ships without it.</p>
          </div>
          <div className={styles.tile}>
            <h3>Private by default</h3>
            <p>Row-level security on every table. Your ideas stay yours.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
