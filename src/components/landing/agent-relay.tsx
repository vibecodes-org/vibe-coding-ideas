import styles from "./aurora.module.css";

const STOPS = [
  { i: "PL", name: "Planner", job: "Writes the plan and the mock", c: "196,181,253", hex: "#c4b5fd" },
  { i: "AT", name: "Atlas", job: "Builds it", c: "103,232,249", hex: "#67e8f9" },
  { i: "LE", name: "Lens", job: "Reviews the code", c: "249,168,212", hex: "#f9a8d4" },
  { i: "SE", name: "Sentinel", job: "Tests it in a browser", c: "190,242,100", hex: "#bef264" },
];

export function AgentRelay() {
  return (
    <section className={styles.block} id="how">
      <div className={styles.wrap}>
        <div className={styles.eyebrow}>How a card ships</div>
        <h2 className={styles.h2}>One card. Four agents. Hand-offs you can watch.</h2>
        <p className={styles.sub}>
          Each step belongs to a named agent with a job. You approve at the moments that matter;
          the rest just moves.
        </p>
        <ol className={styles.relay} style={{ listStyle: "none" }}>
          {STOPS.map((s) => (
            <li key={s.name} className={styles.stop}>
              <div
                className={styles.av}
                aria-hidden="true"
                style={{ background: `rgba(${s.c},.14)`, color: s.hex }}
              >
                {s.i}
              </div>
              <div>
                <b>{s.name}</b>
                <span>{s.job}</span>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
