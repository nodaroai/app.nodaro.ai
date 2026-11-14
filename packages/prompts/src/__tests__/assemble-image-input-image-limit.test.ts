/**
 * `assembleImageInput` and a model's image limit.
 *
 * A model that refuses a run over its image limit (`refusesImagesOverLimit`:
 * FLUX 3 Klein, decided 2026-11-12) is never trimmed: every reference the run
 * attaches is sent, so the route, the workflow run and the editor's request
 * refuse the count the run would really send. Every other model keeps the
 * attach-priority trim to its reference limit, as before.
 */
import { describe, it, expect } from "vitest"
import { assembleImageInput } from "../assemble-image-input.js"
import { imageReferenceLimit, refusesImagesOverLimit } from "@nodaro/shared/models"
import type { ConnectedReference } from "@nodaro/shared/types"

const FORMATS = ["legacy", "hybrid"] as const

/** Prompt-mention images, as a client's pills send them: each one named in the prompt. */
const pills = (n: number): ConnectedReference[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `pill-${i + 1}`,
    defaultName: `Pill ${i + 1}`,
    source: "manual" as const,
    url: `https://cdn.test/pill-${i + 1}.png`,
  }))
const mentioning = (refs: readonly ConnectedReference[]) =>
  `a still life with ${refs.map((_, i) => `@pill-${i + 1}:1`).join(", ")}`
const flat = (n: number) => Array.from({ length: n }, (_, i) => `https://cdn.test/own-${i + 1}.png`)

const sent = (provider: string, refs: ConnectedReference[], referenceFormat: (typeof FORMATS)[number], extra: string[] = []) =>
  assembleImageInput({
    userPrompt: mentioning(refs),
    provider,
    connectedReferences: refs,
    referenceFormat,
    ...(extra.length > 0 ? { extraReferenceImageUrls: extra } : {}),
  })

describe("a model that refuses images over its limit is never trimmed", () => {
  it("FLUX 3 Klein sends all 11 pills, so the run is refused at 11, not run at 10", () => {
    expect(refusesImagesOverLimit("flux-3-klein")).toBe(true)
    for (const format of FORMATS) {
      const refs = pills(11)
      const result = sent("flux-3-klein", refs, format)
      expect(result.referenceImageUrls, format).toEqual(refs.map((r) => r.url))
    }
  })

  it("the 11th mention binds its image instead of standing as plain text", () => {
    const result = sent("flux-3-klein", pills(11), "hybrid")
    expect(result.prompt).not.toContain("@pill-11:1")
  })

  it("FLUX 3 Klein sends all 10 of 10 pills", () => {
    for (const format of FORMATS) {
      expect(sent("flux-3-klein", pills(10), format).referenceImageUrls, format).toHaveLength(10)
    }
  })

  it("counts flat references and pills together, with nothing left out", () => {
    for (const format of FORMATS) {
      const result = sent("flux-3-klein", pills(7), format, flat(4))
      expect(result.referenceImageUrls, format).toHaveLength(11)
      expect(result.referenceImageUrls?.slice(0, 4), format).toEqual(flat(4))
    }
  })

  it("counts what attaches: a character's unmentioned variants are not sent, so they do not count", () => {
    const kira: ConnectedReference[] = [
      { id: "k", defaultName: "Kira", source: "wired-character", url: "https://cdn.test/kira.png", characterSlug: "kira" },
      ...Array.from({ length: 12 }, (_, i) => ({
        id: `k${i}`,
        defaultName: `Kira / look ${i}`,
        source: "wired-character" as const,
        url: `https://cdn.test/kira-${i}.png`,
        characterSlug: "kira",
        variantSlug: `look-${i}`,
      })),
    ]
    for (const format of FORMATS) {
      const result = assembleImageInput({ userPrompt: "a portrait in the rain", provider: "flux-3-klein", connectedReferences: kira, referenceFormat: format })
      expect(result.referenceImageUrls, format).toEqual(["https://cdn.test/kira.png"])
    }
  })

  it("a moodboard still fills no seat past the limit: the caller's own references are all kept", () => {
    const result = assembleImageInput({
      userPrompt: mentioning(pills(11)),
      provider: "flux-3-klein",
      connectedReferences: pills(11),
      styleReferences: [{ url: "https://cdn.test/mood-1.png" }],
    })
    expect(result.referenceImageUrls).toHaveLength(11)
    expect(result.styleReferencesSent).toBe(0)
  })
})

describe("every other model keeps its trim to the reference limit", () => {
  it("Seedream 5.5 keeps its own rule: 12 pills send the first 10", () => {
    expect(refusesImagesOverLimit("seedream-5-5")).toBe(false)
    for (const format of FORMATS) {
      expect(sent("seedream-5-5", pills(12), format).referenceImageUrls, format).toEqual(pills(10).map((r) => r.url))
    }
  })

  it("a model with no request limit of its own is unchanged (Nano Banana Pro: 9 pills send 8)", () => {
    expect(imageReferenceLimit("nano-banana-pro")).toBe(8)
    for (const format of FORMATS) {
      expect(sent("nano-banana-pro", pills(9), format).referenceImageUrls, format).toHaveLength(8)
    }
  })
})
