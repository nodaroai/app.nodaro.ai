/**
 * Whose consent a one-off voice clone runs on (decided 2026-11-13: consent is
 * per person). A node's consent box is not plain data a client may write: it
 * is a record the SERVER issues to the person who ticks it — their user id and
 * a signature over that id and the two recordings' links, keyed by this
 * install's secret — so no client can write anyone else's consent, and a
 * changed recording voids it. A graph as anyone but its author receives it (a
 * template, a published app's snapshot, a share link) ships every clone emptied
 * and without its consent (lib/clone-recordings.ts): the runner gives their own
 * recordings and ticks their own box, and the workflow run checks the record
 * against the run's own user (`replicaConsentIsFor`).
 *
 * The key is derived from the install's `INTERNAL_ORCHESTRATOR_SECRET`: rotating that secret voids
 * every consent record issued before, and each clone must be ticked again before it runs.
 */
import { createHmac, timingSafeEqual } from "node:crypto"
import type { TtsReplica } from "@nodaro/shared/models"

/** A ticked consent box, as the server issued it. */
export interface ReplicaConsentRecord {
  readonly userId: string
  readonly signature: string
}

let key: Buffer | undefined

/** The install's key for consent records, derived from its orchestrator secret (read when first needed). */
function consentKey(): Buffer {
  if (key) return key
  const secret = process.env.INTERNAL_ORCHESTRATOR_SECRET
  if (!secret || secret.length < 32) throw new Error("a one-off clone's consent cannot be checked: INTERNAL_ORCHESTRATOR_SECRET is not set")
  key = createHmac("sha256", secret).update("nodaro:one-off-voice-clone-consent:v2").digest()
  return key
}

/** Each part with its length first, so no two different (user, links) triples sign the same bytes. */
const framed = (...parts: readonly string[]): string => parts.map((part) => `${part.length}:${part}`).join("")

function signatureFor(userId: string, replica: TtsReplica): string {
  return createHmac("sha256", consentKey()).update(framed(userId, replica.sourceAudioUrl, replica.consentAudioUrl)).digest("hex")
}

/** The record for `userId` ticking the consent of this clone's recordings. Issued only to the session's own user. */
export function signReplicaConsent(userId: string, replica: TtsReplica): ReplicaConsentRecord {
  return { userId, signature: signatureFor(userId, replica) }
}

/**
 * Whether `record` is `userId`'s consent for exactly these recordings: issued
 * by this install, to that user, over these links. Anything else — a plain
 * `true`, another person's record, a changed recording, no run user — is not.
 */
export function replicaConsentIsFor(record: unknown, userId: string | undefined, replica: TtsReplica | undefined): boolean {
  if (!userId || !replica || !record || typeof record !== "object") return false
  const { userId: owner, signature } = record as { userId?: unknown; signature?: unknown }
  if (owner !== userId || typeof signature !== "string") return false
  const expected = Buffer.from(signatureFor(userId, replica), "hex")
  const given = Buffer.from(signature, "hex")
  return given.length === expected.length && timingSafeEqual(given, expected)
}

/** What a run is told when the clone's consent is not its runner's own. */
export const ONE_OFF_CLONE_CONSENT_MESSAGE =
  "Tick the consent box beside the cloned voice's recordings yourself before running this node: a clone runs only on the consent of the person running it, never on a template's or an app's author's. In a published app, add your own two recordings and tick its consent box."
