import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"
import { config } from "./config.js"

/**
 * The instance cipher — one AES-256-GCM key for every secret the server keeps
 * FOR ITSELF: social OAuth tokens (services/social/*), operator-supplied
 * provider keys (lib/provider-credentials.ts), anything next.
 *
 * Key source, in order: NODARO_ENCRYPTION_KEY, then SOCIAL_ENCRYPTION_KEY
 * (the older name — accepted forever so no existing install re-encrypts).
 * Both are 64-char hex (32 bytes). On the community compose stack start.sh
 * generates NODARO_ENCRYPTION_KEY once and persists it to the app-data
 * volume; managed deployments (Cloud/business on Railway) MUST set it
 * explicitly and never auto-generate — a key that changes across deploys
 * turns every stored secret into noise (see docs/deployment.md).
 *
 * Envelope: base64(iv[12] || gcm-tag[16] || ciphertext) — unchanged from the
 * social helper, so rows written before this module existed still open.
 */

const ALGORITHM = "aes-256-gcm"
const IV_LENGTH = 12
const TAG_LENGTH = 16

export type EncryptionKeySource = "NODARO_ENCRYPTION_KEY" | "SOCIAL_ENCRYPTION_KEY"

export class EncryptionKeyMissingError extends Error {
  constructor() {
    super(
      "No instance encryption key: set NODARO_ENCRYPTION_KEY (64-char hex, e.g. `openssl rand -hex 32`). " +
        "The community compose stack generates one on first boot; managed deployments must set it.",
    )
    this.name = "EncryptionKeyMissingError"
  }
}

let cached: { key: Buffer; source: EncryptionKeySource } | null = null

function resolve(): { key: Buffer; source: EncryptionKeySource } {
  if (cached) return cached
  const candidates: Array<[EncryptionKeySource, string | undefined]> = [
    // `||` on purpose: config defaults these to "" — empty means unset.
    ["NODARO_ENCRYPTION_KEY", config.NODARO_ENCRYPTION_KEY || process.env.NODARO_ENCRYPTION_KEY],
    ["SOCIAL_ENCRYPTION_KEY", config.SOCIAL_ENCRYPTION_KEY || process.env.SOCIAL_ENCRYPTION_KEY],
  ]
  const hit = candidates.find(([, v]) => typeof v === "string" && v.length > 0)
  if (!hit) throw new EncryptionKeyMissingError()
  const [source, hex] = hit
  if (!/^[0-9a-fA-F]{64}$/.test(hex!)) {
    throw new Error(`${source} must be a 64-char hex string (32 bytes)`)
  }
  cached = { key: Buffer.from(hex!, "hex"), source }
  return cached
}

/** Which variable supplies the key, or null when none does. Never throws. */
export function encryptionKeySource(): EncryptionKeySource | null {
  try {
    return resolve().source
  } catch {
    return null
  }
}

export function encryptSecret(plaintext: string): string {
  const { key } = resolve()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, encrypted]).toString("base64")
}

export function decryptSecret(encoded: string): string {
  const { key } = resolve()
  const buf = Buffer.from(encoded, "base64")
  const iv = buf.subarray(0, IV_LENGTH)
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH)
  const ciphertext = buf.subarray(IV_LENGTH + TAG_LENGTH)
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)
  return decipher.update(ciphertext, undefined, "utf8") + decipher.final("utf8")
}

/** Tests swap the key between cases; production never calls this. */
export function resetInstanceCipherForTests(): void {
  cached = null
}
