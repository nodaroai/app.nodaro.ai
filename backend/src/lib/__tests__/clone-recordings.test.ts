/**
 * A one-off voice clone's recordings are the runner's own (decided 2026-11-13): a graph as anyone but
 * its author receives it ships every clone emptied and without its consent, through the one publish
 * funnel, so the author's recordings and consent never reach a published snapshot, a template, a
 * share link or anyone else's run.
 */
import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))

import { withoutCloneRecordings, cloneDataWithoutRecordings } from "../clone-recordings.js"
import { ugcPublishedGraph } from "../ugc-composed-graph.js"
import { signReplicaConsent } from "../voice-clone-consent.js"

const AUTHOR = "00000000-0000-4000-8000-0000000000a1"
const LINKS = { sourceAudioUrl: "https://media.example/author-reference.wav", consentAudioUrl: "https://media.example/author-consent.wav" }
const RECORD = signReplicaConsent(AUTHOR, LINKS)
const EMPTIED = { sourceAudioUrl: "", consentAudioUrl: "" }

const TAKE = "https://media.example/author-voice-take.mp3"
const tts = { id: "tts", type: "text-to-speech", data: { label: "Narration", provider: "gemini-3-8-flash-tts", directText: "Hi.", replica: LINKS, replicaConsent: RECORD, generatedAudioUrl: TAKE, generatedResults: [{ url: TAKE }], activeResultIndex: 0 } }
const dialogue = {
  id: "dlg",
  type: "text-to-dialogue",
  data: {
    label: "Talk",
    provider: "gemini-3-8-flash-tts",
    dialogue: [{ text: "Hello.", voice: "Me" }, { text: "Hi.", voice: "Kore" }],
    speakers: [{ voice: "Me", replica: LINKS, replicaConsent: RECORD }, { voice: "Kore", styleDirection: "warm" }],
  },
}
const plain = { id: "txt", type: "text-prompt", data: { text: "keep me" } }

describe("withoutCloneRecordings", () => {
  it("empties a Text to Speech clone and drops its consent, keeping everything else (its results too, unless asked)", () => {
    const [out] = withoutCloneRecordings([tts])
    expect(out!.data).toEqual({ label: "Narration", provider: "gemini-3-8-flash-tts", directText: "Hi.", replica: EMPTIED, generatedAudioUrl: TAKE, generatedResults: [{ url: TAKE }], activeResultIndex: 0 })
    const [shipped] = withoutCloneRecordings([tts], { outputs: true })
    expect(shipped!.data).toEqual({ label: "Narration", provider: "gemini-3-8-flash-tts", directText: "Hi.", replica: EMPTIED })
  })

  it("drops the earlier results of a clone node only: another node keeps its own", () => {
    const other = { id: "t3", type: "text-to-speech", data: { provider: "elevenlabs-v3", generatedAudioUrl: "https://media.example/stock.mp3" } }
    const [out] = withoutCloneRecordings([other], { outputs: true })
    expect(out).toBe(other)
  })

  it("empties each cloned dialogue speaker and drops its consent; other speakers and lines stay", () => {
    const [out] = withoutCloneRecordings([dialogue])
    expect(out!.data.speakers).toEqual([{ voice: "Me", replica: EMPTIED }, { voice: "Kore", styleDirection: "warm" }])
    expect(out!.data.dialogue).toEqual(dialogue.data.dialogue)
  })

  it("leaves a node with no clone as it is (the same object)", () => {
    const noClone = { id: "t2", type: "text-to-speech", data: { provider: "elevenlabs-v3", voiceId: "Rachel" } }
    const out = withoutCloneRecordings([plain, noClone])
    expect(out[0]).toBe(plain)
    expect(out[1]).toBe(noClone)
  })

  it("drops a stray consent record on a node with no clone", () => {
    expect(cloneDataWithoutRecordings("text-to-speech", { replicaConsent: RECORD, voiceId: "x" })).toEqual({ voiceId: "x" })
  })
})

describe("the publish funnel (ugcPublishedGraph) ships no author's recordings or consent", () => {
  it("not in the shipped nodes, the priced nodes, or a component's exposed default", async () => {
    const published = await ugcPublishedGraph([tts, dialogue, plain], [], AUTHOR)
    for (const nodes of [published.nodes, published.pricedNodes]) {
      const text = JSON.stringify(nodes)
      expect(text).not.toContain(TAKE)
      expect(text).not.toContain(LINKS.sourceAudioUrl)
      expect(text).not.toContain(LINKS.consentAudioUrl)
      expect(text).not.toContain(RECORD.signature)
    }
    expect(published.shippedValue("tts", "replica", LINKS)).toEqual(EMPTIED)
    expect(published.shippedValue("tts", "replicaConsent", RECORD)).toBeUndefined()
    expect(JSON.stringify(published.shippedValue("dlg", "speakers", dialogue.data.speakers))).not.toContain(LINKS.sourceAudioUrl)
    expect(published.shippedValue("txt", "text", "keep me")).toBe("keep me")
  })
})
