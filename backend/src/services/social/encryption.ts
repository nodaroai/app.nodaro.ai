/**
 * Social OAuth token encryption — a thin shim over the instance cipher.
 *
 * The envelope (base64(iv || tag || ciphertext), AES-256-GCM) and the key
 * source (SOCIAL_ENCRYPTION_KEY) are unchanged, so every token stored before
 * lib/instance-cipher.ts existed still decrypts. New code should import
 * encryptSecret/decryptSecret directly; these names stay for the callers in
 * services/social/* and the OAuth routes.
 */
import { decryptSecret, encryptSecret } from "../../lib/instance-cipher.js"

export function encryptToken(plaintext: string): string {
  return encryptSecret(plaintext)
}

export function decryptToken(encoded: string): string {
  return decryptSecret(encoded)
}
