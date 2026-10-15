/**
 * Webhook signing secrets: generated here, stored only sealed.
 *
 * Signing needs the raw secret, so it is ENCRYPTED, never hashed, with the
 * scheme `plugin-account-secrets.ts` uses (instance-cipher.ts ::
 * boundCipher):
 *   - one AES-256-GCM subkey per environment (HKDF of the instance key,
 *     `webhook_endpoints:v1:<runtime env>`): staging and production share one
 *     database, and each environment opens only the endpoints it created;
 *   - the envelope is bound to its row (GCM associated data = endpoint id,
 *     owner, environment), so a ciphertext copied onto another endpoint or
 *     owner does not open.
 *
 * The plaintext leaves the server twice only: in the response that creates
 * the endpoint and in the one that rotates its secret. It is never logged.
 */
import { randomBytes } from "node:crypto"
import { boundCipher } from "../instance-cipher.js"

export const SECRET_PREFIX = "whsec_"

/** `whsec_` + 32 random bytes, base64url (43 characters). */
export function generateSigningSecret(): string {
  return SECRET_PREFIX + randomBytes(32).toString("base64url")
}

/** The row an envelope is bound to. */
export interface SecretBinding {
  endpointId: string
  userId: string
  runtimeEnv: string
}

function cipherFor(runtimeEnv: string) {
  return boundCipher(`webhook_endpoints:v1:${runtimeEnv}`)
}

function aad(binding: SecretBinding): string {
  return JSON.stringify([binding.endpointId, binding.userId, binding.runtimeEnv])
}

/** Throws `EncryptionKeyMissingError` when the install has no instance key. */
export function sealSigningSecret(secret: string, binding: SecretBinding): string {
  return cipherFor(binding.runtimeEnv).encrypt(secret, aad(binding))
}

/** Throws when the envelope does not open for this row in this environment. */
export function openSigningSecret(sealed: string, binding: SecretBinding): string {
  return cipherFor(binding.runtimeEnv).decrypt(sealed, aad(binding))
}
