/**
 * More references than Seedance 2.5 Flash takes (10 images / 5 videos / 5
 * audio) on a direct request — the REST routes, MCP — is refused before any
 * credits are held, with the limit named (decided 2026-11-16). The pre-check
 * runs in both video routes' chains (and so in the Video to Video edit lane,
 * which runs /v1/text-to-video's), before the credit guard.
 */
import { describe, it, expect } from "vitest"
import type { FastifyReply, FastifyRequest } from "fastify"
import { refuseVideoReferencesOverLimitPreHandler, generateVideoPricing, sentVideoReferenceCounts, assembleVideoConnectedReferences } from "../generate-video.js"
import type { ConnectedReference } from "@nodaro/shared/types"
import { trimVideoReferencesToLimits, videoReferencesOverLimitProblem } from "@nodaro/shared/models"
import { textToVideoPricing } from "../text-to-video.js"

function run(body: Record<string, unknown>) {
  const sent: { status?: number; body?: unknown } = {}
  const reply = {
    status(code: number) { sent.status = code; return reply },
    send(payload: unknown) { sent.body = payload; return reply },
  } as unknown as FastifyReply
  return refuseVideoReferencesOverLimitPreHandler({ body } as FastifyRequest, reply).then(() => sent)
}

const urls = (k: number, kind: string) => Array.from({ length: k }, (_, i) => `https://cdn.example.com/${kind}${i}`)

describe("refuseVideoReferencesOverLimitPreHandler", () => {
  it("refuses 11 reference images on Flash, naming the limit", async () => {
    const r = await run({ provider: "seedance-2-5-flash", referenceImageUrls: urls(11, "i") })
    expect(r.status).toBe(400)
    expect(r.body).toEqual({ error: { code: "too_many_references", message: "seedance-2-5-flash takes at most 10 reference images; this request sends 11. Remove 1." } })
  })

  it("refuses 6 videos or 6 audio clips on Flash, and counts a start frame among the images once a reference is sent", async () => {
    expect((await run({ provider: "seedance-2-5-flash", referenceVideoUrls: urls(6, "v") })).status).toBe(400)
    expect((await run({ provider: "seedance-2-5-flash", referenceAudioUrls: urls(6, "a") })).status).toBe(400)
    expect((await run({ provider: "seedance-2-5-flash", imageUrl: "https://cdn.example.com/f.png", referenceImageUrls: urls(10, "i") })).status).toBe(400)
  })

  it("lets a request within the caps through, and never refuses another model", async () => {
    expect((await run({ provider: "seedance-2-5-flash", referenceImageUrls: urls(10, "i"), referenceVideoUrls: urls(5, "v"), referenceAudioUrls: urls(5, "a") })).status).toBeUndefined()
    expect((await run({ provider: "seedance-2-5", referenceImageUrls: urls(30, "i") })).status).toBeUndefined()
  })

  it("runs in both video routes' pre-checks, before the audio and clip-length checks", () => {
    for (const chain of [generateVideoPricing.prechecks, textToVideoPricing.prechecks]) {
      const names = chain.map((f) => f.name)
      expect(names).toContain("refuseVideoReferencesOverLimitPreHandler")
      expect(names.indexOf("refuseVideoReferencesOverLimitPreHandler")).toBeLessThan(names.indexOf("validateSeedance2AudioPreHandler"))
    }
  })
})

const cref = (id: string, url: string, extra: Partial<ConnectedReference> = {}): ConnectedReference =>
  ({ id, url, source: "wired-image", defaultName: id, ...extra }) as ConnectedReference

describe("the over-limit pre-check counts what the request sends", () => {
  it("counts the assembled image list: 8 URLs and a character with its two extra views (3 images) is 11 — refused", async () => {
    const connectedReferences = [
      cref("kira", "https://r2/kira.png", { source: "wired-character", characterSlug: "kira", defaultName: "Kira" }),
      cref("kira-side", "https://r2/kira-side.png", { source: "wired-character", characterSlug: "kira", variantSlug: "side", isExtraRef: true }),
      cref("kira-back", "https://r2/kira-back.png", { source: "wired-character", characterSlug: "kira", variantSlug: "back", isExtraRef: true }),
    ]
    const body = { provider: "seedance-2-5-flash", prompt: "@kira walks", referenceImageUrls: urls(8, "i"), connectedReferences }
    const assembled = assembleVideoConnectedReferences({
      prompt: body.prompt, provider: body.provider, connectedReferences, baseReferenceImageUrls: body.referenceImageUrls,
      referenceVideoCount: 0, referenceAudioCount: 0, uncappedForCount: true,
    })
    expect(sentVideoReferenceCounts(body).images).toBe(assembled.referenceImageUrls!.length)
    expect(sentVideoReferenceCounts(body).images).toBe(11)
    const r = await run(body)
    expect(r.status).toBe(400)
    expect((r.body as { error: { message: string } }).error.message).toContain("sends 11")
  })

  it("drops blank and repeated entries: 10 entries with one blank and one repeat, plus a start frame, is 9 — allowed", async () => {
    const list = [...urls(8, "i"), "", "https://cdn.example.com/i0"]
    const body = { provider: "seedance-2-5-flash", imageUrl: "https://cdn.example.com/f.png", referenceImageUrls: list }
    expect(sentVideoReferenceCounts(body)).toMatchObject({ images: 8, frames: 1 })
    expect((await run(body)).status).toBeUndefined()
  })

  it("the editor's trim sends a list the pre-check never refuses (same count, blanks and repeats dropped, frames counted)", () => {
    const images = [...urls(12, "i"), "", "https://cdn.example.com/i0"]
    for (const frames of [0, 1, 2]) {
      const sent = trimVideoReferencesToLimits("seedance-2-5-flash", { images, videos: [...urls(7, "v"), ""], audio: urls(6, "a"), frames })
      const body = {
        provider: "seedance-2-5-flash",
        referenceImageUrls: sent.images, referenceVideoUrls: sent.videos, referenceAudioUrls: sent.audio,
        ...(frames >= 1 ? { imageUrl: "https://cdn.example.com/f.png" } : {}),
        ...(frames === 2 ? { endFrameUrl: "https://cdn.example.com/g.png" } : {}),
      }
      expect(videoReferencesOverLimitProblem("seedance-2-5-flash", sentVideoReferenceCounts(body)), `${frames} frames`).toBeUndefined()
    }
  })
})
