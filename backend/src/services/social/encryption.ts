import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"
import { config } from "../../lib/config.js"

const ALGORITHM = "aes-256-gcm"
const IV_LENGTH = 12
const TAG_LENGTH = 16

let cachedKey: Buffer | null = null

function getKey(): Buffer {
  if (cachedKey) return cachedKey
  const hex = config.SOCIAL_ENCRYPTION_KEY ?? process.env.SOCIAL_ENCRYPTION_KEY
  if (!hex || hex.length !== 64) {
    throw new Error("SOCIAL_ENCRYPTION_KEY must be a 64-char hex string (32 bytes)")
  }
  cachedKey = Buffer.from(hex, "hex")
  return cachedKey
}

export function encryptToken(plaintext: string): string {
  const key = getKey()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  // Format: base64(iv + tag + ciphertext)
  return Buffer.concat([iv, tag, encrypted]).toString("base64")
}

export function decryptToken(encoded: string): string {
  const key = getKey()
  const buf = Buffer.from(encoded, "base64")
  const iv = buf.subarray(0, IV_LENGTH)
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH)
  const ciphertext = buf.subarray(IV_LENGTH + TAG_LENGTH)
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)
  return decipher.update(ciphertext) + decipher.final("utf8")
}
