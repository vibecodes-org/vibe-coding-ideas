// API-equivalent prices for turning a workflow step's token counts into money
// (card ba37039b). USD per million tokens, Anthropic first-party API rates as
// listed in the Claude API reference on 15 Oct 2026. The report shows what
// the tokens would cost at these rates, whether the session actually ran on a
// subscription or an API key.
//
// To change a price, edit this table: costs are worked out when the report is
// read, never stored, so a change applies to every past step at once.

export interface ModelPrice {
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
}

/** Cache writes are 1.25x (5 minutes) and 2x (1 hour) of input on every model. */
function price(input: number, output: number, cacheRead: number): ModelPrice {
  return { input, output, cacheWrite5m: input * 1.25, cacheWrite1h: input * 2, cacheRead };
}

export const MODEL_PRICES: Record<string, ModelPrice> = {
  // Cache reads are 0.1x input, except Fable 5.1 / Mythos 5.1 (0.025x) and Opus 5.5 (0.05x).
  "claude-fable-5-1": price(10, 50, 0.25),
  "claude-mythos-5-1": price(10, 50, 0.25),
  "claude-fable-5": price(10, 50, 1),
  "claude-mythos-5": price(10, 50, 1),
  "claude-opus-5-5": price(4, 20, 0.2),
  "claude-opus-5": price(5, 25, 0.5),
  "claude-opus-4-8": price(5, 25, 0.5),
  "claude-opus-4-7": price(5, 25, 0.5),
  "claude-opus-4-6": price(5, 25, 0.5),
  "claude-sonnet-5-5": price(2, 10, 0.2),
  "claude-sonnet-5": price(2, 10, 0.2),
  "claude-sonnet-4-6": price(3, 15, 0.3),
  "claude-haiku-5-5": price(0.1, 0.5, 0.01),
  // Haiku 5.5 charges more for a call whose prompt is over 100K tokens; the
  // usage command reports those calls under this "+long" name.
  "claude-haiku-5-5+long": price(0.5, 2.5, 0.05),
  "claude-haiku-4-5": price(1, 5, 0.1),
};

/**
 * The price-table key for a model name as a transcript or a person writes it:
 * drops a provider prefix ("anthropic.", "us.anthropic."), a "[1m]" context
 * marker and a date suffix ("-20251101", "@20251101"). Null when the model
 * isn't in the table.
 */
export function priceKey(model: string): string | null {
  let m = model.trim().toLowerCase();
  const long = m.endsWith("+long");
  if (long) m = m.slice(0, -"+long".length);
  m = m.replace(/^(?:[a-z]{2,4}\.)?anthropic\./, "").replace(/\[1m\]$/, "").replace(/[-@]\d{8}$/, "");
  const key = long ? `${m}+long` : m;
  return key in MODEL_PRICES ? key : null;
}

export interface ModelUsage {
  model: string;
  calls?: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_5m_tokens: number;
  cache_write_1h_tokens: number;
}

/** USD for one model's usage, or null when the model has no known price. */
export function usageCost(usage: ModelUsage): number | null {
  const key = priceKey(usage.model);
  if (!key) return null;
  const p = MODEL_PRICES[key];
  return (
    (usage.input_tokens * p.input +
      usage.output_tokens * p.output +
      usage.cache_write_5m_tokens * p.cacheWrite5m +
      usage.cache_write_1h_tokens * p.cacheWrite1h +
      usage.cache_read_tokens * p.cacheRead) /
    1_000_000
  );
}
