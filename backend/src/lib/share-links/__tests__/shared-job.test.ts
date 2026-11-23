/**
 * One job as a share link shows it (lib/share-links/shared-job.ts): which jobs
 * may be shown, and that what is shown never carries the owner, a charge, an
 * error, a vendor, an address in the settings or an id.
 */
import { describe, it, expect } from "vitest"
import { mediaOf, shareRefusalOf, sharedModelOf, toSharedJob, type ShareJobRow } from "../shared-job.js"

const OWNER = "00000000-0000-4000-8000-000000000001"
const UUID = "3f2b8a4c-1d2e-4f5a-8b6c-7d8e9f0a1b2c"

function job(over: Partial<ShareJobRow> = {}): ShareJobRow {
  return {
    id: "00000000-0000-4000-8000-0000000000a1",
    user_id: OWNER,
    status: "completed",
    job_type: "generate-image",
    created_at: "2026-11-19T10:00:00.000Z",
    parent_job_id: null,
    restricted_at: null,
    force_private: null,
    deleted_at: null,
    title: "Red car",
    input_data: {
      type: "generate-image",
      userId: OWNER,
      jobId: "00000000-0000-4000-8000-0000000000a1",
      usageLogId: UUID,
      sessionId: UUID,
      origin: "create-image",
      prompt: "a red car, expanded by the app",
      userPrompt: "a red car",
      negativePrompt: "blur",
      provider: "nano-banana-pro",
      resolvedModel: "nano-banana-pro",
      aspectRatio: "16:9",
      resolution: "2K",
      referenceImageUrls: ["https://cdn.example/uploads/ref.png"],
      webhookUrl: "https://hooks.example/done",
      creditsHeld: 8,
    },
    output_data: { imageUrl: "https://cdn.example/images/a1.png", width: 1920, height: 1080, __checkpoint: { secret: 1 } },
    ...over,
  }
}

describe("shareRefusalOf", () => {
  it("a finished result with media may be shared", () => {
    expect(shareRefusalOf(job())).toBeNull()
  })

  it.each([
    ["restricted", { restricted_at: "2026-11-19T11:00:00Z" }],
    ["not_completed", { status: "processing" }],
    ["not_completed", { status: "failed" }],
    ["private_output", { force_private: true }],
    ["private_output", { input_data: { type: "generate-image", prompt: "x", forcePrivate: true } }],
    ["private_output", { input_data: { type: "generate-image", prompt: "x", force_private: true } }],
    ["content_filtered", { input_data: { type: "generate-image", prompt: "a NSFW scene" } }],
    ["content_filtered", { input_data: { type: "text-to-speech", text: "erotic story" } }],
    ["content_filtered", { title: "porn edit" }],
    ["no_media", { output_data: { text: "hello" } }],
    ["no_media", { output_data: { imageUrl: "not-an-address" } }],
    ["no_media", { output_data: null }],
  ] as const)("refuses %s", (reason, over) => {
    expect(shareRefusalOf(job(over as Partial<ShareJobRow>))).toBe(reason)
  })
})

describe("mediaOf", () => {
  it("prefers the video, then the image, then the sound, and lists several", () => {
    expect(mediaOf({ videoUrl: "https://c/v.mp4", imageUrl: "https://c/i.png" })).toEqual({ kind: "video", url: "https://c/v.mp4", urls: ["https://c/v.mp4"] })
    expect(mediaOf({ imageUrls: ["https://c/1.png", "https://c/2.png"] })).toEqual({
      kind: "image",
      url: "https://c/1.png",
      urls: ["https://c/1.png", "https://c/2.png"],
    })
    expect(mediaOf({ audioUrl: "https://c/a.mp3" })?.kind).toBe("audio")
  })

  it("never a signed address", () => {
    expect(mediaOf({ imageUrl: "https://bucket/x.png?X-Amz-Signature=1" })).toBeNull()
  })
})

describe("sharedModelOf", () => {
  it("names the model by its public catalog name", () => {
    expect(sharedModelOf({ provider: "nano-banana-pro" })).toEqual({ id: "nano-banana-pro", name: "Nano Banana Pro" })
    expect(sharedModelOf({ resolvedModel: "gpt-image", provider: "openai" })).toEqual({ id: "gpt-image", name: "GPT Image 1.5" })
  })

  it("names no model when the id is a vendor or route, or not in the public catalog", () => {
    expect(sharedModelOf({ provider: "elevenlabs" })).toBeNull()
    expect(sharedModelOf({ provider: "kie" })).toBeNull()
    expect(sharedModelOf({})).toBeNull()
  })

  it("names a Video Remake run's engine by its public name, never the internal one", () => {
    expect(sharedModelOf({ type: "cast-swap", engine: "kling-4" })).toEqual({ id: "nodaro-pulse", name: "Nodaro Pulse" })
    expect(sharedModelOf({ type: "cast-swap" })).toEqual({ id: "nodaro-prism", name: "Nodaro Prism" })
  })
})

/** Every key, at every depth. */
function keysOf(value: unknown, out: string[] = []): string[] {
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.push(k)
      keysOf(v, out)
    }
  }
  return out
}

describe("toSharedJob", () => {
  it("shows the result, the prompt as written, the model and the settings", () => {
    const shared = toSharedJob(job(), { allowCopy: false })
    expect(shared).toEqual({
      id: "00000000-0000-4000-8000-0000000000a1",
      type: "generate-image",
      mediaKind: "image",
      outputUrl: "https://cdn.example/images/a1.png",
      width: 1920,
      height: 1080,
      title: "Red car",
      toolName: "Image Generation",
      // No cover of the owner's and no provider art on a picture.
      coverUrl: null,
      createdAt: "2026-11-19T10:00:00.000Z",
      prompt: "a red car",
      displayPrompt: "a red car",
      negativePrompt: "blur",
      model: { id: "nano-banana-pro", name: "Nano Banana Pro" },
      settings: { aspectRatio: "16:9", resolution: "2K" },
    })
  })

  it("never carries the owner, a charge, an error, a vendor, a server-only key or a private address", () => {
    const shared = toSharedJob(
      job({ output_data: { imageUrl: "https://cdn.example/images/a1.png", unscoredUrl: "https://private/x", __plugin: 1 } }),
      { allowCopy: true },
    )
    const keys = keysOf(shared)
    for (const forbidden of ["user_id", "userId", "credits", "creditsHeld", "error_message", "error_detail", "provider", "resolvedModel", "webhookUrl", "usageLogId", "sessionId", "unscoredUrl"]) {
      expect(keys, forbidden).not.toContain(forbidden)
    }
    expect(JSON.stringify(shared)).not.toContain(OWNER)
    expect(JSON.stringify(shared)).not.toContain("hooks.example")
    expect(JSON.stringify(shared)).not.toContain(UUID)
  })

  it("a song's own title: of the take the link shows, else the job's first take; never a filtered one", () => {
    const song = (output: Record<string, unknown>) =>
      toSharedJob(job({ input_data: { type: "suno-mashup", prompt: "blend" }, output_data: output }), { allowCopy: false })
    const tracks = [
      { audioUrl: "https://cdn.example/audios/a.mp3", title: "  First  " },
      { audioUrl: "https://cdn.example/audios/b.mp3", title: "Second" },
    ]
    expect(song({ audioUrl: "https://cdn.example/audios/a.mp3", sunoTracks: tracks })).toMatchObject({ songTitle: "First", toolName: "Song Mashup" })
    expect(song({ audioUrl: "https://cdn.example/audios/a.mp3", sunoTitle: "Only title" })?.songTitle).toBe("Only title")
    expect(song({ audioUrl: "https://cdn.example/audios/a.mp3" })?.songTitle).toBeUndefined()
    // A picture never has one; a tool with no public name has no tool name.
    expect(toSharedJob(job({ output_data: { imageUrl: "https://cdn.example/images/a1.png", sunoTitle: "x" } }), { allowCopy: false })?.songTitle).toBeUndefined()
    expect(toSharedJob(job({ input_data: { type: "some-plugin-type" } }), { allowCopy: false })?.toolName).toBeNull()
  })

  it("reads the prompt as a person does, from the pills' names, and keeps the prompt as sent", () => {
    const shared = toSharedJob(
      job({
        input_data: {
          type: "generate-image",
          userPrompt: "@maya:1 in @image-1:2:background",
          connectedReferences: [
            { id: "c1", defaultName: "Maya", source: "wired-character", characterSlug: "maya", url: "https://cdn.example/uploads/maya.png" },
            { id: "c2", defaultName: "Image 1", source: "manual", url: "https://cdn.example/uploads/bg.png" },
          ],
        },
      }),
      { allowCopy: false },
    )
    expect(shared?.prompt).toBe("@maya:1 in @image-1:2:background")
    expect(shared?.displayPrompt).toBe("@Maya in @Image 1")
    // The names only: never a reference's address in the display text or the settings.
    expect(JSON.stringify(shared)).not.toContain("uploads/")
  })

  it("hands out the reference files only when the link allows copying", () => {
    expect(toSharedJob(job(), { allowCopy: false })?.references).toBeUndefined()
    expect(toSharedJob(job(), { allowCopy: true })?.references).toEqual([{ url: "https://cdn.example/uploads/ref.png", kind: "image" }])
    // A reference the caller found restricted is left out.
    expect(toSharedJob(job(), { allowCopy: true, withoutReference: () => true })?.references).toEqual([])
  })

  it("a trend run shows its trend and no prompt, settings or references", () => {
    const shared = toSharedJob(
      job({
        input_data: {
          type: "cast-swap",
          engine: "seedance-2-5",
          trend: { id: UUID, slug: "office-dance", version: 3, name: "Office Dance" },
          prompt: "the platform's own wording",
          promptParts: { a: "secret" },
          resolution: "720p",
          roles: [{ images: ["https://cdn.example/uploads/me.png"] }],
        },
        output_data: { videoUrl: "https://cdn.example/videos/r.mp4", durationSec: 8 },
      }),
      { allowCopy: true },
    )
    expect(shared).toMatchObject({
      type: "cast-swap",
      mediaKind: "video",
      durationSec: 8,
      prompt: null,
      displayPrompt: null,
      settings: {},
      model: { id: "nodaro-prism", name: "Nodaro Prism" },
      trend: { slug: "office-dance", name: "Office Dance" },
    })
    expect(shared?.references).toBeUndefined()
    expect(JSON.stringify(shared)).not.toContain("seedance")
    expect(JSON.stringify(shared)).not.toContain("secret")
  })

  it("a speech job's text is its prompt, and leaves the settings", () => {
    const shared = toSharedJob(
      job({ input_data: { type: "text-to-speech", text: "Hello there", voice: "aria" }, output_data: { audioUrl: "https://cdn.example/audios/s.mp3", durationSec: 2.5 } }),
      { allowCopy: false },
    )
    expect(shared).toMatchObject({ mediaKind: "audio", prompt: "Hello there", durationSec: 2.5, settings: { voice: "aria" } })
  })

  it("several images are listed, and no size is claimed for a partial one", () => {
    const shared = toSharedJob(
      job({ output_data: { imageUrls: ["https://cdn.example/images/1.png", "https://cdn.example/images/2.png"], width: 512 } }),
      { allowCopy: false },
    )
    expect(shared?.outputUrls).toEqual(["https://cdn.example/images/1.png", "https://cdn.example/images/2.png"])
    expect(shared?.width).toBeUndefined()
  })
})
