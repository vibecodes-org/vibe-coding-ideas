import { useState } from "react";
import "./App.css";

export function App() {
  const [count, setCount] = useState(0);

  return (
    <div className="app">
      <h1>Counter</h1>
      <div className="counter">
        <button onClick={() => setCount((c) => c - 1)}>-</button>
        <button
          className={`reset-btn${count !== 0 ? " visible" : ""}`}
          disabled={count === 0}
          onClick={() => setCount(0)}
        >
          reset
        </button>
        <span className="count">{count}</span>
        <button onClick={() => setCount((c) => c + 1)}>+</button>
      </div>
    </div>
  );
}
