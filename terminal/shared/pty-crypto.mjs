// End-to-end encryption of the PTY byte stream (Terminal P2 — GA gate).
//
// This module is the ONE definition of the AEAD frame format used to encrypt
// every BINARY WebSocket frame carrying PTY data, in both directions:
//   bridge  -> relay -> browser   (direction "b2w", PTY output)
//   browser -> relay -> bridge    (direction "w2b", keystrokes)
//
// The relay (terminal/relay/) never sees this module and never needs to —
// FR-3 requires it stay a dumb byte forwarder. This module is imported by the
// BRIDGE (Node) directly. The BROWSER side is a separate WebCrypto-based
// implementation (src/lib/terminal/pty-crypto.ts) that MUST produce/consume
// the exact same wire format — see the "WIRE FORMAT" block below, which is
// the shared spec both implementations follow.
//
// ── THE #1 RISK: NONCE REUSE ────────────────────────────────────────────
// AES-GCM catastrophically fails (full plaintext-recovery + forgery) if the
// same (key, nonce) pair is ever used twice. A session's key lives for the
// whole session AND survives reattach (FR-4/FR-6), so nonce uniqueness must
// hold not just within one WebSocket connection but across every reconnect a
// session goes through. Two independent random values would only make
// collision *unlikely*; this module makes it IMPOSSIBLE by construction:
//
//   1. Every fresh attach (new WebSocket connection, either leg) generates a
//      new random 128-bit `attachId` locally — no negotiation needed, it
//      travels in-band as a plaintext frame-header field (it needs no
//      secrecy, only uniqueness).
//   2. A per-attach, per-direction SUBKEY is derived from the session key via
//      HKDF-SHA256(ikm=sessionKey, salt=attachId, info=direction). Two
//      attaches therefore never share an encryption key, even if (by some
//      cosmic coincidence) they picked the same nonce — 128 bits of salt
//      makes an attachId collision practically impossible long before a
//      session's real-world lifetime could produce one.
//   3. WITHIN one attach, the nonce is built from a per-direction counter
//      that starts at 0 and increments by exactly 1 per frame — deterministic
//      and exhaustively non-repeating for the life of that subkey.
//
// This is the "derive a fresh subkey per attach via HKDF" option FR-4 offers
// (as opposed to resetting a shared counter across reconnects, which is far
// easier to get wrong). Documented choice: per-attach HKDF subkeys.
//
// ── WIRE FORMAT ──────────────────────────────────────────────────────────
// Every encrypted BINARY frame:
//
//   [1 byte version][16 bytes attachId][8 bytes counter BE][ciphertext+tag]
//
// `nonce` (12 bytes, AES-GCM's native size) is NOT transmitted — it is
// reconstructed by both sides as `4 zero bytes || counter (8 bytes BE)`,
// saving 12 bytes/frame. It's safe to omit because the counter is already on
// the wire and the subkey (tied to attachId) is what actually guarantees
// uniqueness, not the nonce's unpredictability.
//
// Associated data (authenticated, not encrypted) binds:
//   sessionId (utf8) || directionByte || attachId || counter (8 bytes BE)
// binding session id + direction + counter/attachId exactly as FR-2 requires
// — this is what makes a frame reflected into the other direction, or
// replayed/reordered into a different (or the same, later) attach, fail
// AEAD verification instead of silently decrypting.
//
// ── REPLAY / REORDER REJECTION ──────────────────────────────────────────
// A FrameDecryptor is pinned to exactly one (sessionId, expected direction)
// pair and, on its first successfully-verified frame, to that frame's
// attachId. Every subsequent frame must carry that SAME attachId and the
// EXACT next counter value (last + 1) — a repeat, a skip, or a different
// attachId is rejected before decryption is even attempted. Callers create a
// fresh FrameDecryptor per WebSocket attach (mirroring the fresh
// FrameEncryptor + attachId the peer generates for that same attach), so a
// frame captured from an earlier attach can never verify against a later
// one's decryptor.
//
// Fails closed: every error path throws PtyCryptoError. Callers MUST treat
// any thrown error as fatal for the session (FR-5: never write undecryptable
// bytes to the PTY or to xterm; terminate the session distinctly instead of
// silently dropping or downgrading).

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

export const FRAME_VERSION = 1;
export const KEY_LEN = 32; // AES-256
export const ATTACH_ID_LEN = 16; // 128-bit
export const COUNTER_LEN = 8; // BE uint64 (practically never wraps)
export const NONCE_LEN = 12; // AES-GCM native nonce size
export const TAG_LEN = 16; // AES-GCM auth tag
export const HEADER_LEN = 1 + ATTACH_ID_LEN + COUNTER_LEN; // version + attachId + counter

/** Direction tags — also the AAD's directionByte (kept as a stable numeric wire value). */
export const DIRECTION_BRIDGE_TO_BROWSER = "b2w";
export const DIRECTION_BROWSER_TO_BRIDGE = "w2b";
const DIRECTION_BYTES = { [DIRECTION_BRIDGE_TO_BROWSER]: 0x01, [DIRECTION_BROWSER_TO_BRIDGE]: 0x02 };

export class PtyCryptoError extends Error {
  constructor(message) {
    super(message);
    this.name = "PtyCryptoError";
  }
}

function assertDirection(direction) {
  if (!Object.prototype.hasOwnProperty.call(DIRECTION_BYTES, direction)) {
    throw new PtyCryptoError(`invalid direction: ${String(direction)}`);
  }
}

/** Fresh random 256-bit session key (FR-1). Never persisted. */
export function generateSessionKey() {
  return randomBytes(KEY_LEN);
}

/** Fresh random 128-bit attach id, generated locally on every new WS attach (FR-4). */
export function generateAttachId() {
  return randomBytes(ATTACH_ID_LEN);
}

/**
 * HKDF-SHA256 subkey for one (attach, direction) pair. Same inputs always
 * produce the same subkey on both sides — no negotiation, just shared math.
 * @param {Buffer} sessionKey
 * @param {Buffer} attachId
 * @param {"b2w"|"w2b"} direction
 * @returns {Buffer}
 */
export function deriveAttachSubkey(sessionKey, attachId, direction) {
  assertDirection(direction);
  if (!Buffer.isBuffer(sessionKey) || sessionKey.length !== KEY_LEN) {
    throw new PtyCryptoError(`session key must be ${KEY_LEN} bytes`);
  }
  if (!Buffer.isBuffer(attachId) || attachId.length !== ATTACH_ID_LEN) {
    throw new PtyCryptoError(`attachId must be ${ATTACH_ID_LEN} bytes`);
  }
  const info = Buffer.from(`vibecodes-terminal-pty:${direction}`, "utf8");
  const out = hkdfSync("sha256", sessionKey, attachId, info, KEY_LEN);
  return Buffer.from(out);
}

function buildNonce(counter) {
  const nonce = Buffer.alloc(NONCE_LEN);
  nonce.writeBigUInt64BE(counter, NONCE_LEN - COUNTER_LEN);
  return nonce;
}

function buildAad(sessionId, direction, attachId, counter) {
  const counterBuf = Buffer.alloc(COUNTER_LEN);
  counterBuf.writeBigUInt64BE(counter);
  return Buffer.concat([
    Buffer.from(sessionId, "utf8"),
    Buffer.from([DIRECTION_BYTES[direction]]),
    attachId,
    counterBuf,
  ]);
}

/** Encrypts one direction's PTY-data frames for the lifetime of a single WS attach. */
export class FrameEncryptor {
  /**
   * @param {Buffer} sessionKey
   * @param {"b2w"|"w2b"} direction — the direction THIS side sends on
   * @param {string} sessionId
   * @param {Buffer} [attachId] — defaults to a fresh random id
   */
  constructor(sessionKey, direction, sessionId, attachId = generateAttachId()) {
    assertDirection(direction);
    if (typeof sessionId !== "string" || sessionId.length === 0) {
      throw new PtyCryptoError("sessionId is required");
    }
    this.direction = direction;
    this.sessionId = sessionId;
    this.attachId = attachId;
    this.subkey = deriveAttachSubkey(sessionKey, attachId, direction);
    this.counter = 0n;
  }

  /** @param {Buffer} plaintext @returns {Buffer} the full wire frame */
  encrypt(plaintext) {
    if (this.counter > 0xffffffffffffffffn) {
      throw new PtyCryptoError("frame counter exhausted — attach must be rekeyed");
    }
    const counter = this.counter;
    this.counter += 1n;
    const nonce = buildNonce(counter);
    const aad = buildAad(this.sessionId, this.direction, this.attachId, counter);
    const cipher = createCipheriv("aes-256-gcm", this.subkey, nonce);
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    const counterBuf = Buffer.alloc(COUNTER_LEN);
    counterBuf.writeBigUInt64BE(counter);
    return Buffer.concat([Buffer.from([FRAME_VERSION]), this.attachId, counterBuf, ciphertext, tag]);
  }
}

/**
 * How many superseded attachIds a decryptor remembers, so a replayed frame 0
 * of an attach it has already moved past is rejected instead of re-pinned.
 */
export const RECENT_ATTACH_IDS_MAX = 8;

/**
 * Decrypts one direction's PTY-data frames. Follows the PEER's attaches: the
 * sender starts a fresh attachId + counter 0 on every (re)connect of its own
 * AND whenever the relay reports the pair whole again (peer-reattached), so a
 * one-sided reconnect — browser tab wakes and re-links while the bridge keeps
 * running, or vice versa — must not be fatal (incident 1–2 Sep 2026: the old
 * "pin once, reject everything else" rule turned every such reconnect into a
 * frozen terminal and, on the next keystroke, a killed claude).
 *
 * Rules (per direction, per frame) — mirrored byte-for-byte in
 * src/lib/terminal/pty-crypto.ts:
 *   - same attachId as pinned → counters must be strictly sequential (a gap or
 *     repeat is a replay/reorder → throws).
 *   - a NEW attachId at counter 0 → the peer rekeyed: verify under the new
 *     subkey, then re-pin. A counter-0 frame for an attachId this decryptor has
 *     ALREADY moved past is a replay → throws.
 *   - any other attachId at counter > 0 → an in-flight frame from a superseded
 *     attach (sent before the peer learned we re-attached). Dropped: `null`.
 *     Callers must treat `null` as "nothing to write", never as an error.
 *   - AEAD failure (tamper / wrong key / wrong session or direction) → throws.
 *     Fail closed, exactly as before.
 */
export class FrameDecryptor {
  /**
   * @param {Buffer} sessionKey
   * @param {"b2w"|"w2b"} direction — the direction the PEER sends on (what we expect to receive)
   * @param {string} sessionId
   */
  constructor(sessionKey, direction, sessionId) {
    assertDirection(direction);
    if (typeof sessionId !== "string" || sessionId.length === 0) {
      throw new PtyCryptoError("sessionId is required");
    }
    this.sessionKey = sessionKey;
    this.direction = direction;
    this.sessionId = sessionId;
    /** @type {Buffer|null} the peer's CURRENT attach (re-pinned on each rekey) */
    this.pinnedAttachId = null;
    this.subkey = null;
    this.expectedCounter = 0n;
    /** @type {Buffer[]} superseded attachIds, newest last (bounded) */
    this.recentAttachIds = [];
  }

  /** @param {Buffer} attachId */
  isRecentAttachId(attachId) {
    return this.recentAttachIds.some((seen) => timingSafeEqual(seen, attachId));
  }

  /** @param {Buffer} attachId */
  rememberAttachId(attachId) {
    this.recentAttachIds.push(Buffer.from(attachId));
    if (this.recentAttachIds.length > RECENT_ATTACH_IDS_MAX) this.recentAttachIds.shift();
  }

  /**
   * @param {Buffer} frame
   * @returns {Buffer|null} plaintext, or `null` when the frame belongs to a
   *   superseded attach and was dropped — throws PtyCryptoError on any real failure
   */
  decrypt(frame) {
    if (!Buffer.isBuffer(frame) || frame.length < HEADER_LEN + TAG_LEN) {
      throw new PtyCryptoError("frame too short");
    }
    if (frame[0] !== FRAME_VERSION) {
      throw new PtyCryptoError(`unsupported frame version: ${frame[0]}`);
    }
    const attachId = frame.subarray(1, 1 + ATTACH_ID_LEN);
    const counter = frame.readBigUInt64BE(1 + ATTACH_ID_LEN);
    const body = frame.subarray(HEADER_LEN);
    const ciphertext = body.subarray(0, body.length - TAG_LEN);
    const tag = body.subarray(body.length - TAG_LEN);

    const samePin = this.pinnedAttachId !== null && timingSafeEqual(attachId, this.pinnedAttachId);
    let subkey;
    let rekeying = false;
    if (samePin) {
      if (counter !== this.expectedCounter) {
        throw new PtyCryptoError(
          `out-of-order or replayed frame: expected counter ${this.expectedCounter}, got ${counter}`,
        );
      }
      subkey = this.subkey;
    } else if (counter === 0n) {
      if (this.isRecentAttachId(attachId)) {
        throw new PtyCryptoError("replayed frame from a superseded attach");
      }
      subkey = deriveAttachSubkey(this.sessionKey, Buffer.from(attachId), this.direction);
      rekeying = true;
    } else {
      // In-flight frame from an attach whose start we never saw (or have moved
      // past). Not an attack — the peer had not yet learned we re-attached.
      return null;
    }

    const nonce = buildNonce(counter);
    const aad = buildAad(this.sessionId, this.direction, attachId, counter);
    const decipher = createDecipheriv("aes-256-gcm", subkey, nonce);
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    let plaintext;
    try {
      plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch {
      // Tampered ciphertext, wrong key/subkey, or wrong AAD (wrong session/
      // direction) — GCM auth failed. Fail closed; do not advance state.
      throw new PtyCryptoError("AEAD verification failed — tampered, replayed, or wrong key");
    }
    // Only commit state once verification actually succeeded.
    if (rekeying) {
      if (this.pinnedAttachId !== null) this.rememberAttachId(this.pinnedAttachId);
      this.pinnedAttachId = Buffer.from(attachId);
      this.subkey = subkey;
      this.expectedCounter = 0n;
    }
    this.expectedCounter += 1n;
    return plaintext;
  }
}
