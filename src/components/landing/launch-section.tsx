import styles from "./aurora.module.css";

const PANES = [
  {
    title: "Terminal setup panel is cut off",
    badge: "Claude Code",
    codex: false,
    who: { initials: "PL", color: "#c4b5fd", text: "Planner is planning" },
  },
  {
    title: "Terminal sessions survive the laptop sleeping",
    badge: "Claude Code",
    codex: false,
    who: { initials: "AT", color: "#67e8f9", text: "Atlas is building" },
  },
  {
    title: "Next-card bar",
    badge: "Codex",
    codex: true,
    who: { initials: "LE", color: "#f9a8d4", text: "Lens is reviewing" },
  },
];

export function LaunchSection() {
  return (
    <section className={styles.block} id="launch">
      <div className={styles.wrap}>
        <div className={styles.eyebrow}>
          Launch from the board<span className={styles.beta}>Beta</span>
        </div>
        <h2 className={styles.h2}>Hit Launch. Watch the cards move themselves.</h2>
        <p className={styles.sub}>
          No copy-pasting tasks into a terminal. Claude Code or Codex opens right under your cards,
          takes the next one and gets to work. You watch every line, and step in whenever you like.
        </p>
        {/* Decorative example, not working terminals: hidden from screen readers. */}
        <div className={styles.fleet} aria-hidden="true">
          <span className={`${styles.tbtn} ${styles.launch} ${styles.launchbtn}`}>
            &gt;_ Launch Claude Code <span className={styles.caret}>▾</span>
          </span>
          {PANES.map((p, i) => (
            <div key={p.title} className={styles.pane}>
              <div className={styles.ptab}>
                <span className={styles.pd} />
                <span className={styles.pt}>{p.title}</span>
                <span className={`${styles.badge} ${p.codex ? styles.cx : styles.cc}`}>{p.badge}</span>
              </div>
              <div className={`${styles.term} ${styles.seq}`}>
                {i === 0 && (
                  <>
                    <div>
                      <span className={styles.tg}>●</span> Took the <span className={styles.tv}>Plan</span> step
                    </div>
                    <div>
                      <span className={styles.tg}>●</span> Found it: the panel has a fixed height
                    </div>
                    <div>
                      <span className={styles.tg}>●</span> Wrote the plan and a mock
                    </div>
                    <div className={styles.tm}>  Waiting for your OK</div>
                  </>
                )}
                {i === 1 && (
                  <>
                    <div>
                      <span className={styles.tg}>●</span> Took the <span className={styles.tc}>Build</span> step
                    </div>
                    <div className={styles.cmdl}>npm run test</div>
                    <div className={styles.tm}>  ✓ all tests passed</div>
                    <div>
                      <span className={styles.tg}>●</span> Opened the pull request
                    </div>
                    <div>
                      <span className={styles.tg}>●</span> Writing the fix <span className={styles.caretb} />
                    </div>
                  </>
                )}
                {i === 2 && (
                  <>
                    <div>
                      <span className={styles.tg}>●</span> Took the <span className={styles.tp}>Code review</span> step
                    </div>
                    <div>
                      <span className={styles.tg}>●</span> Reading the changes
                    </div>
                    <div className={styles.tm}>  Asked for one fix, then checked it</div>
                    <div>
                      <span className={styles.tg}>●</span> Review passed. Over to Sentinel
                    </div>
                  </>
                )}
              </div>
              <div className={styles.who2}>
                <span className={styles.av} style={{ background: p.who.color }}>
                  {p.who.initials}
                </span>
                {p.who.text}
              </div>
            </div>
          ))}
        </div>
        <div className={styles.ticks}>
          <span>Runs on your own Mac or Windows PC</span>
          <span>Uses your own Claude or ChatGPT account</span>
          <span>Run several at once, and type into any of them to steer</span>
        </div>
      </div>
    </section>
  );
}
