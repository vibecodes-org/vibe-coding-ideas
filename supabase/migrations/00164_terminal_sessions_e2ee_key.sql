-- Terminal P2 (end-to-end encryption of the PTY stream) — FR-1/FR-6.
--
-- Holds the session's E2EE key for the session's whole registered lifetime,
-- so ANY of the owner's authenticated browser tabs/devices can decrypt a
-- live session, and a bridge process that relaunches for the same sid (e.g.
-- the helper was quit and the user reconnects) can fetch the SAME key again.
-- The browser leg gets its copy directly in the mint AND reattach routes'
-- JSON responses (HTTPS, app→browser). The bridge leg has no equivalent
-- authenticated app→bridge channel today, so it fetches it via a direct
-- HTTPS call (src/app/api/terminal/session/key/route.ts) authenticated with
-- the bridge's own session token — never through the relay. Delivery is
-- gated only on the row being active/unexpired, never on "not yet read" —
-- the column is cleared to null only when the session itself ends
-- (session/end, session/closed, session-reap.ts's reap function), with the
-- registry TTL (~4h, session-registry.ts) as the backstop even if an
-- explicit clear is missed.
--
-- Base64-encoded 256-bit key. Nullable — a session predates this feature, or
-- has already ended, or E2EE negotiation never got this far.
ALTER TABLE public.terminal_sessions
  ADD COLUMN e2ee_session_key text NULL;

COMMENT ON COLUMN public.terminal_sessions.e2ee_session_key IS
  'Base64 256-bit PTY-stream session key. Persists for the session''s registered lifetime (any owner-authenticated leg can fetch it — mint, reattach, or the bridge''s /api/terminal/session/key); cleared to null only when the session ends (end/closed/reap).';
