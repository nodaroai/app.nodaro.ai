/** A one-off clone's consent is per person: a server-signed record (decided 2026-11-13). */
import { describe, expect, it } from "vitest"
import { replicaConsentIsFor, signReplicaConsent } from "../voice-clone-consent.js"

const REPLICA = { sourceAudioUrl: "https://media.example/s.wav", consentAudioUrl: "https://media.example/c.wav" }
const A = "00000000-0000-4000-8000-0000000000a1"
const B = "00000000-0000-4000-8000-0000000000b2"

describe("replicaConsentIsFor", () => {
  it("is true only for the user it was issued to, over exactly those recordings", () => {
    const record = signReplicaConsent(A, REPLICA)
    expect(record.userId).toBe(A)
    expect(replicaConsentIsFor(record, A, REPLICA)).toBe(true)
    expect(replicaConsentIsFor(record, B, REPLICA)).toBe(false)
    expect(replicaConsentIsFor(record, A, { ...REPLICA, consentAudioUrl: "https://media.example/other.wav" })).toBe(false)
    expect(replicaConsentIsFor(record, undefined, REPLICA)).toBe(false)
  })

  it("a client's own writing is never a tick: a bare true, a record naming another user, a bad signature", () => {
    const record = signReplicaConsent(A, REPLICA)
    for (const forged of [true, { userId: B, signature: record.signature }, { userId: A, signature: "00" }, { userId: A }, null, "yes"]) {
      expect(replicaConsentIsFor(forged, typeof forged === "object" && forged && "userId" in forged ? (forged as { userId: string }).userId : A, REPLICA), JSON.stringify(forged)).toBe(false)
    }
  })

  it("frames each signed part with its length: links that would join to the same bytes sign differently", () => {
    const a = signReplicaConsent("u1", { sourceAudioUrl: "https://x/a\nhttps://x/b", consentAudioUrl: "https://x/c" })
    const b = signReplicaConsent("u1", { sourceAudioUrl: "https://x/a", consentAudioUrl: "https://x/b\nhttps://x/c" })
    expect(a.signature).not.toBe(b.signature)
  })
})
