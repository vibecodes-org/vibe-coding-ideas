import styles from "./aurora.module.css";

const AGENTS = [
  { initials: "PL", color: "#c4b5fd", name: "Planner", job: "Plans it, mocks it", added: true },
  { initials: "AT", color: "#67e8f9", name: "Atlas", job: "Full stack engineer", added: true },
  { initials: "LE", color: "#f9a8d4", name: "Lens", job: "Code reviewer", added: true },
  { initials: "SE", color: "#bef264", name: "Sentinel", job: "QA engineer", added: false },
  { initials: "PI", color: "#fcd34d", name: "Pipeline", job: "DevOps engineer", added: false },
];

const STEPS = [
  { initials: "AT", color: "#67e8f9", text: "Find the cause and fix it" },
  { initials: "LE", color: "#f9a8d4", text: "Review the code" },
  { initials: "SE", color: "#bef264", text: "Test it and sum up", waits: true },
];

export function TeamSection() {
  return (
    <section className={`${styles.block} ${styles.blockTight}`} id="team">
      <div className={styles.wrap}>
        <div className={styles.eyebrow}>Your team, your rules</div>
        <h2 className={styles.h2}>Hire a whole dev team in one click.</h2>
        <p className={styles.sub}>
          Start with a ready-made crew: a planner, a builder, a code reviewer, a tester and a DevOps
          engineer. Then make them yours. Rename them, rewrite their jobs, invent new ones, and
          decide every step a card goes through.
        </p>
        {/* Decorative example: hidden from screen readers. */}
        <div className={styles.split} aria-hidden="true">
          <div className={styles.panel}>
            <div className={styles.k}>The agent library</div>
            <div className={styles.lib}>
              {AGENTS.map((a) => (
                <div key={a.name} className={styles.agent}>
                  <span className={styles.av} style={{ background: a.color }}>
                    {a.initials}
                  </span>
                  <div>
                    <b>{a.name}</b>
                    <span className={styles.j}>{a.job}</span>
                  </div>
                  <span className={`${styles.add} ${a.added ? styles.done : ""}`}>
                    {a.added ? "Added ✓" : "Add"}
                  </span>
                </div>
              ))}
              <div className={`${styles.agent} ${styles.own}`}>
                <span className={styles.av}>+</span>
                <div>
                  <b>Your own agent</b>
                  <span className={styles.j}>Any name, any job</span>
                </div>
              </div>
            </div>
          </div>
          <div className={styles.panel}>
            <div className={styles.k}>A workflow you design</div>
            <div className={styles.wfname}>
              Bug Fix<span className={styles.edit}>Edit steps</span>
            </div>
            <div className={styles.wfbox}>
              {STEPS.map((s) => (
                <div key={s.text} className={styles.wfrow}>
                  <i style={{ background: s.color }}>{s.initials}</i>
                  {s.text}
                  {s.waits && <span className={styles.lock}>🔒 waits for you</span>}
                </div>
              ))}
              <div className={`${styles.wfrow} ${styles.wfghost}`}>
                <i
                  style={{
                    background: "transparent",
                    border: "1px dashed var(--line-2)",
                    color: "var(--ink-2)",
                  }}
                >
                  +
                </i>
                Add a step
              </div>
            </div>
            <div className={styles.rule}>
              <span className={`${styles.tag} ${styles.tBug}`}>Bug</span>
              <span style={{ color: "var(--ink-3)" }}>label on a card → runs</span>
              <b style={{ color: "var(--ink)" }}>Bug Fix</b> automatically
            </div>
          </div>
        </div>
        <div className={styles.ticks}>
          <span>Add agents from the library</span>
          <span>Copy ones other people have shared</span>
          <span>Or write your own</span>
        </div>
      </div>
    </section>
  );
}
