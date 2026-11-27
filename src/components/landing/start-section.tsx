import styles from "./aurora.module.css";

const KINDS = [
  { label: "🌐  Web app", on: true },
  { label: "📱  Mobile" },
  { label: "⚙️  API" },
  { label: "🤖  AI agent" },
  { label: "🎮  Game" },
  { label: "✨  Custom" },
];
const TEAM = ["Planner", "Full Stack", "Code Reviewer", "QA", "DevOps"];
const WORKFLOWS = ["Web Application Feature", "Bug Fix", "Infrastructure Change", "Technical Spike"];
const CARDS = [
  "Customers book a time slot",
  "Barber sees today's bookings",
  "Text reminder the day before",
  "Sign up and log in",
];

export function StartSection() {
  return (
    <section className={`${styles.block} ${styles.blockTight}`} id="start">
      <div className={styles.wrap}>
        <div className={styles.eyebrow}>No blank page</div>
        <h2 className={styles.h2}>Type one line. Get a whole project.</h2>
        <p className={styles.sub}>
          Say what you&apos;re building in a sentence. AI writes it up properly, brings in a team of
          agents with the right workflows, and fills your board with cards ready to work.
        </p>
        {/* Decorative example: hidden from screen readers. */}
        <div className={styles.flow} aria-hidden="true">
          <div className={styles.frame}>
            <div className={styles.k}>1 · You type</div>
            <h3>One line is plenty.</h3>
            <div className={styles.typed}>
              A booking app for my barber shop<span className={styles.caretb} />
            </div>
            <span className={styles.aibtn}>✦ Draft with AI</span>
            <div className={`${styles.drafted} ${styles.seq}`}>
              <i />
              <i />
              <i />
              <i />
            </div>
          </div>
          <div className={styles.arrowto}>→</div>
          <div className={styles.frame}>
            <div className={styles.k}>2 · You pick</div>
            <h3>Your team turns up ready.</h3>
            <div className={styles.kinds}>
              {KINDS.map((k) => (
                <span key={k.label} className={k.on ? styles.on : undefined}>
                  {k.label}
                </span>
              ))}
            </div>
            <div className={styles.lbl}>TEAM</div>
            <div className={`${styles.chips} ${styles.seq}`}>
              {TEAM.map((t) => (
                <span key={t}>{t}</span>
              ))}
            </div>
            <div className={styles.lbl}>WORKFLOWS</div>
            <div className={styles.chips}>
              {WORKFLOWS.map((w) => (
                <span key={w}>{w}</span>
              ))}
            </div>
          </div>
          <div className={styles.arrowto}>→</div>
          <div className={styles.frame}>
            <div className={styles.k}>3 · AI fills the board</div>
            <h3>Cards, ready to work.</h3>
            <span className={styles.aibtn} style={{ alignSelf: "flex-start" }}>
              ✦ AI Generate Tasks
            </span>
            <div className={`${styles.gcol} ${styles.seq}`}>
              {CARDS.map((c) => (
                <div key={c} className={styles.gcard}>
                  <span className={`${styles.tag} ${styles.tFeat}`}>Feature</span>
                  <b>{c}</b>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className={styles.ticks}>
          <span>Web app, mobile app, API, AI agent, game, or start from scratch</span>
          <span>Change anything later</span>
        </div>
      </div>
    </section>
  );
}
