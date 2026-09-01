// End-to-end encryption of the PTY byte stream — BROWSER side (Terminal P2 —
// GA gate). This is the WebCrypto twin of terminal/shared/pty-crypto.mjs
// (Node's `crypto` module, used by the bridge) — the two MUST produce and
// consume byte-identical wire frames, since one side's FrameEncryptor talks
// to the other's FrameDecryptor over the relay. See that file's header
// comment for the full design rationale (nonce-reuse avoidance via a
// per-attach HKDF subkey, wire format, replay/reorder rejection); this file
// only restates what's needed to keep the two implementations in lockstep.
//
// WIRE FORMAT (identical to the Node module):
//   [1 byte version][16 bytes attachId][8 bytes counter BE][ciphertext+tag]
// nonce = 4 zero bytes || counter (8 bytes BE), never sent on the wire.
// AAD   = utf8(sessionId) || directionByte || attachId || counter (8 bytes BE)
//
// Uses only the browser's native WebCrypto (`crypto.subtle` + `crypto.getRandomValues`)
// — no dependency. Every method is async because SubtleCrypto's API is.

export const FRAME_VERSION = 1;
export const KEY_LEN = 32; // AES-256
export const ATTACH_ID_LEN = 16; // 128-bit
export const COUNTER_LEN = 8; // BE uint64
export const NONCE_LEN = 12; // AES-GCM native nonce size
export const TAG_LEN = 16; // AES-GCM auth tag (bytes)
export const HEADER_LEN = 1 + ATTACH_ID_LEN + COUNTER_LEN;

export type PtyDirection = "b2w" | "w2b";
export const DIRECTION_BRIDGE_TO_BROWSER: PtyDirection = "b2w";
export const DIRECTION_BROWSER_TO_BRIDGE: PtyDirection = "w2b";

const DIRECTION_BYTES: Record<PtyDirection, number> = {
  b2w: 0x01,
  w2b: 0x02,
};

// 2^64 - 1 — the largest value COUNTER_LEN (8 bytes) can hold.
const MAX_COUNTER = BigInt("0xffffffffffffffff");

export class PtyCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PtyCryptoError";
  }
}

function subtle(): SubtleCrypto {
  const c = globalThis.crypto;
  if (!c?.subtle) {
    throw new PtyCryptoError("WebCrypto (crypto.subtle) is unavailable in this environment");
  }
  return c.subtle;
}

function randomBytes(len: number): Uint8Array {
  const buf = new Uint8Array(len);
  globalThis.crypto.getRandomValues(buf);
  return buf;
}

/** Fresh random 256-bit session key (FR-1). Never persisted (FR-6). */
export function generateSessionKey(): Uint8Array {
  return randomBytes(KEY_LEN);
}

/** Fresh random 128-bit attach id, generated locally on every new WS attach (FR-4). */
export function generateAttachId(): Uint8Array {
  return randomBytes(ATTACH_ID_LEN);
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function writeUint64BE(value: bigint): Uint8Array {
  const buf = new Uint8Array(8);
  const view = new DataView(buf.buffer);
  view.setBigUint64(0, value);
  return buf;
}

function readUint64BE(bytes: Uint8Array): bigint {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getBigUint64(0);
}

/**
 * HKDF-SHA256 subkey for one (attach, direction) pair — same inputs always
 * produce the same subkey on both sides, no negotiation required.
 */
export async function deriveAttachSubkey(
  sessionKey: Uint8Array,
  attachId: Uint8Array,
  direction: PtyDirection,
): Promise<CryptoKey> {
  if (!(direction in DIRECTION_BYTES)) {
    throw new PtyCryptoError(`invalid direction: ${String(direction)}`);
  }
  if (sessionKey.length !== KEY_LEN) {
    throw new PtyCryptoError(`session key must be ${KEY_LEN} bytes`);
  }
  if (attachId.length !== ATTACH_ID_LEN) {
    throw new PtyCryptoError(`attachId must be ${ATTACH_ID_LEN} bytes`);
  }
  const info = new TextEncoder().encode(`vibecodes-terminal-pty:${direction}`);
  const ikm = await subtle().importKey("raw", sessionKey as BufferSource, "HKDF", false, ["deriveKey"]);
  return subtle().deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: attachId as BufferSource, info: info as BufferSource },
    ikm,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function buildNonce(counter: bigint): Uint8Array {
  const nonce = new Uint8Array(NONCE_LEN);
  nonce.set(writeUint64BE(counter), NONCE_LEN - COUNTER_LEN);
  return nonce;
}

function buildAad(sessionId: string, direction: PtyDirection, attachId: Uint8Array, counter: bigint): Uint8Array {
  return concatBytes(
    new TextEncoder().encode(sessionId),
    new Uint8Array([DIRECTION_BYTES[direction]]),
    attachId,
    writeUint64BE(counter),
  );
}

/** Encrypts one direction's PTY-data frames for the lifetime of a single WS attach. */
export class FrameEncryptor {
  private readonly direction: PtyDirection;
  private readonly sessionId: string;
  private readonly attachId: Uint8Array;
  private readonly sessionKey: Uint8Array;
  private subkey: CryptoKey | null = null;
  private counter = BigInt(0);

  constructor(sessionKey: Uint8Array, direction: PtyDirection, sessionId: string, attachId: Uint8Array = generateAttachId()) {
    if (!(direction in DIRECTION_BYTES)) throw new PtyCryptoError(`invalid direction: ${String(direction)}`);
    if (!sessionId) throw new PtyCryptoError("sessionId is required");
    this.sessionKey = sessionKey;
    this.direction = direction;
    this.sessionId = sessionId;
    this.attachId = attachId;
  }

  private async ensureSubkey(): Promise<CryptoKey> {
    if (!this.subkey) this.subkey = await deriveAttachSubkey(this.sessionKey, this.attachId, this.direction);
    return this.subkey;
  }

  /** @returns the full wire frame */
  async encrypt(plaintext: Uint8Array): Promise<Uint8Array> {
    if (this.counter > MAX_COUNTER) {
      throw new PtyCryptoError("frame counter exhausted — attach must be rekeyed");
    }
    const counter = this.counter;
    this.counter += BigInt(1);
    const subkey = await this.ensureSubkey();
    const nonce = buildNonce(counter);
    const aad = buildAad(this.sessionId, this.direction, this.attachId, counter);
    const ciphertext = new Uint8Array(
      await subtle().encrypt({ name: "AES-GCM", iv: nonce as BufferSource, additionalData: aad as BufferSource, tagLength: TAG_LEN * 8 }, subkey, plaintext as BufferSource),
    );
    return concatBytes(new Uint8Array([FRAME_VERSION]), this.attachId, writeUint64BE(counter), ciphertext);
  }
}

/** Decrypts one direction's PTY-data frames for the lifetime of a single WS attach. */
export class FrameDecryptor {
  private readonly sessionKey: Uint8Array;
  private readonly direction: PtyDirection;
  private readonly sessionId: string;
  private pinnedAttachId: Uint8Array | null = null;
  private subkey: CryptoKey | null = null;
  private expectedCounter = BigInt(0);

  constructor(sessionKey: Uint8Array, direction: PtyDirection, sessionId: string) {
    if (!(direction in DIRECTION_BYTES)) throw new PtyCryptoError(`invalid direction: ${String(direction)}`);
    if (!sessionId) throw new PtyCryptoError("sessionId is required");
    this.sessionKey = sessionKey;
    this.direction = direction;
    this.sessionId = sessionId;
  }

  /** @returns plaintext — throws PtyCryptoError on any failure (fail closed, FR-5) */
  async decrypt(frame: Uint8Array): Promise<Uint8Array> {
    if (frame.length < HEADER_LEN + TAG_LEN) throw new PtyCryptoError("frame too short");
    if (frame[0] !== FRAME_VERSION) throw new PtyCryptoError(`unsupported frame version: ${frame[0]}`);

    const attachId = frame.subarray(1, 1 + ATTACH_ID_LEN);
    const counter = readUint64BE(frame.subarray(1 + ATTACH_ID_LEN, HEADER_LEN));
    const ciphertext = frame.subarray(HEADER_LEN);

    if (this.pinnedAttachId === null) {
      this.pinnedAttachId = attachId.slice();
      this.subkey = await deriveAttachSubkey(this.sessionKey, this.pinnedAttachId, this.direction);
      this.expectedCounter = BigInt(0);
    } else if (!timingSafeEqual(attachId, this.pinnedAttachId)) {
      throw new PtyCryptoError("attachId mismatch — stale or foreign attach");
    }

    if (counter !== this.expectedCounter) {
      throw new PtyCryptoError(`out-of-order or replayed frame: expected counter ${this.expectedCounter}, got ${counter}`);
    }

    const nonce = buildNonce(counter);
    const aad = buildAad(this.sessionId, this.direction, this.pinnedAttachId, counter);
    let plaintext: ArrayBuffer;
    try {
      plaintext = await subtle().decrypt(
        { name: "AES-GCM", iv: nonce as BufferSource, additionalData: aad as BufferSource, tagLength: TAG_LEN * 8 },
        this.subkey as CryptoKey,
        ciphertext as BufferSource,
      );
    } catch {
      throw new PtyCryptoError("AEAD verification failed — tampered, replayed, or wrong key");
    }
    this.expectedCounter += BigInt(1);
    return new Uint8Array(plaintext);
  }
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
