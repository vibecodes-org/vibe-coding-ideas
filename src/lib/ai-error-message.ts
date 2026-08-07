/**
 * Map an AI/SDK error to a user-facing message that is safe to RETURN from a
 * Server Action.
 *
 * Next.js prod builds mask the message of every Error thrown from a Server
 * Action ("An error occurred in the Server Components render… digest omitted"),
 * so throwing loses the real diagnostic. AI actions in `src/actions/ai.ts`
 * instead return `{ error: aiErrorMessage(err) }` as data, which the client
 * can `toast.error()` verbatim.
 *
 * Provider/SDK messages are passed through deliberately — they carry the
 * diagnostic gold ("credit balance is too low", "No object generated:
 * response did not match schema.") that would otherwise be flattened into one
 * generic toast. The message is sanitised: API keys are redacted, length is
 * capped, and stack traces are never included (only `err.message` is read).
 */

const ANTHROPIC_KEY_PATTERN = /sk-ant-[A-Za-z0-9-]+/g;
const MAX_MESSAGE_LENGTH = 300;

export const AI_TIMEOUT_MESSAGE =
  "The AI request timed out. Please try again — the service may be under heavy load.";
export const AI_FALLBACK_MESSAGE = "An unexpected AI error occurred";

export function aiErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return AI_FALLBACK_MESSAGE;

  if (err.name === "TimeoutError" || err.name === "AbortError") {
    return AI_TIMEOUT_MESSAGE;
  }

  const message = err.message?.trim();
  if (!message) return AI_FALLBACK_MESSAGE;

  const redacted = message.replace(ANTHROPIC_KEY_PATTERN, "[redacted]");
  return redacted.length > MAX_MESSAGE_LENGTH
    ? `${redacted.slice(0, MAX_MESSAGE_LENGTH - 1)}…`
    : redacted;
}
