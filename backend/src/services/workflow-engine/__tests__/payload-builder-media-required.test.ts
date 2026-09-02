/**
 * B3 (spec §7, audit §7 "B3"). The DAG engine enqueued ffmpeg nodes with an
 * `undefined` media URL (`resolvedInputs.videoUrl || data.videoUrl`, both
 * absent), reserved credits, and died at ffmpeg with "Invalid URL" — the two
 * 2026-08-18 merge-video-audio rows. The frontend single-node path already
 * refuses this (execute-node.ts:6073-6085), so it is a parity gap. Failing at
 * build time also fails BEFORE the credit reservation (node-executor.ts
 * deletes the placeholder job row on a buildPayload throw, :1310-1330; the
 * reservation happens after, :1404-1456).
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"
import { buildPayload, REQUIRED_MEDIA_INPUTS, assertRequiredMediaInputs } from "../payload-builder.js"
import type { SimpleNode, ResolvedInputs } from "../types.js"

/** Measured on frontend/src/components/editor/workflow-editor/execute-node.ts
 *  @ origin/dev d7815542 with the window+regex in the last test below. Bump it
 *  ONLY together with a new table row or a justified PARITY_EXEMPT entry. */
const FRONTEND_MEDIA_REFUSAL_COUNT = 79

const JOB = "job-media-required"
const ctx = (n: SimpleNode) => ({ nodes: [n], edges: [], nodeStates: {} })
const node = (type: string, data: Record<string, unknown> = {}): SimpleNode =>
  ({ id: `${type}-1`, type, data: { label: "My Node", ...data } })

describe("required media inputs", () => {
  it("refuses merge-video-audio with no video upstream", () => {
    const n = node("merge-video-audio")
    expect(() => buildPayload(n, JOB, { audioUrl: "https://cdn.example/a.mp3" }, undefined, ctx(n)))
      .toThrow(/video_required/)
  })

  it("names the node in the message so the run panel is actionable", () => {
    const n = node("merge-video-audio")
    expect(() => buildPayload(n, JOB, { audioUrl: "https://cdn.example/a.mp3" }, undefined, ctx(n)))
      .toThrow(/My Node/)
  })

  it("accepts merge-video-audio when the video comes from node data rather than upstream", () => {
    const n = node("merge-video-audio", { videoUrl: "https://cdn.example/v.mp4" })
    expect(() => buildPayload(n, JOB, { audioUrl: "https://cdn.example/a.mp3" }, undefined, ctx(n)))
      .not.toThrow(/video_required/)
  })

  it("refuses upscale-image and remove-background with no image (they had no fallback at all)", () => {
    for (const t of ["upscale-image", "remove-background"]) {
      const n = node(t)
      expect(() => buildPayload(n, JOB, {} as ResolvedInputs, undefined, ctx(n))).toThrow(/image_required/)
    }
  })

  it("accepts an either/or input when only one side is wired", () => {
    // trim-audio takes videoUrl OR audioUrl (payload-builder.ts's trim-audio case).
    const n = node("trim-audio")
    expect(() => buildPayload(n, JOB, { audioUrl: "https://cdn.example/a.mp3" }, undefined, ctx(n)))
      .not.toThrow(/required/)
  })

  it("an empty-string resolved input falls through to the node's own URL", () => {
    // M-12a: `||` semantics, matching every case this guard mirrors.
    const n = node("merge-video-audio", { videoUrl: "https://cdn.example/v.mp4" })
    expect(() => buildPayload(n, JOB, { videoUrl: "" } as ResolvedInputs, undefined, ctx(n)))
      .not.toThrow(/video_required/)
  })

  it("carries a coded error so callers can branch without string matching", () => {
    const n = node("merge-video-audio")
    try {
      buildPayload(n, JOB, {} as ResolvedInputs, undefined, ctx(n))
      throw new Error("expected a throw")
    } catch (err) {
      expect((err as { code?: string }).code).toBe("video_required")
    }
  })

  it("is satisfied by a non-empty ARRAY input (the accumulate lanes)", () => {
    // combine-videos / image-collage / mix-audio resolve arrays, not scalars.
    const n = node("combine-videos")
    expect(() => buildPayload(n, JOB, { videoUrls: ["https://cdn.example/v.mp4"] }, undefined, ctx(n)))
      .not.toThrow(/video_required/)
    const empty = node("combine-videos")
    expect(() => buildPayload(empty, JOB, { videoUrls: [] }, undefined, ctx(empty)))
      .toThrow(/video_required/)
  })

  it("covers the non-media alternative so a YouTube-only run still passes", () => {
    // video-analysis: `data.youtubeUrl` is a first-class source (M-12b).
    const n = node("video-analysis", { youtubeUrl: "https://youtu.be/abc" })
    expect(() => assertRequiredMediaInputs("video-analysis", {}, n.data)).not.toThrow()
    expect(() => assertRequiredMediaInputs("video-analysis", {}, node("video-analysis").data)).toThrow(/video_required/)
  })

  it("leaves untabled node types alone", () => {
    expect(() => assertRequiredMediaInputs("generate-image", {}, node("generate-image").data)).not.toThrow()
  })

  it("every table row is well-formed (single entry or AND-list)", () => {
    for (const [type, req] of Object.entries(REQUIRED_MEDIA_INPUTS)) {
      const entries = Array.isArray(req) ? req : [req]
      expect(entries.length, `${type} needs at least one requirement`).toBeGreaterThan(0)
      for (const entry of entries) {
        expect(entry.anyOf.length, `${type} needs at least one key`).toBeGreaterThan(0)
        expect(["video", "audio", "image"]).toContain(entry.kind)
        expect(entry.noun.length, `${type} needs a human noun`).toBeGreaterThan(2)
      }
    }
  })

  // --- AND semantics: both halves of a two-input media node are required ---
  // The frontend refuses each half separately, so the DAG must too. Every case
  // below wires the FIRST half and asserts the SECOND is still demanded.
  it("refuses merge-video-audio when the video is wired but no audio is", () => {
    const n = node("merge-video-audio", { videoUrl: "https://cdn.example/v.mp4" })
    expect(() => buildPayload(n, JOB, {} as ResolvedInputs, undefined, ctx(n)))
      .toThrow(/audio_required.*My Node/)
  })

  it("accepts merge-video-audio when the audio arrives as audioSources", () => {
    const n = node("merge-video-audio", { videoUrl: "https://cdn.example/v.mp4" })
    const inputs = { audioSources: [{ url: "https://cdn.example/a.mp3", sourceNodeId: "s1" }] } as ResolvedInputs
    expect(() => buildPayload(n, JOB, inputs, undefined, ctx(n))).not.toThrow()
  })

  it("refuses still-to-video when the still is wired but no audio is", () => {
    const n = node("still-to-video")
    expect(() => buildPayload(n, JOB, { imageUrl: "https://cdn.example/i.png" }, undefined, ctx(n)))
      .toThrow(/audio_required.*My Node/)
  })

  it("refuses speech-to-video when the image is wired but no audio is", () => {
    const n = node("speech-to-video")
    expect(() => buildPayload(n, JOB, { imageUrl: "https://cdn.example/i.png" }, undefined, ctx(n)))
      .toThrow(/audio_required.*My Node/)
  })

  it("refuses motion-transfer when the character image is wired but no motion video is", () => {
    const n = node("motion-transfer")
    expect(() => buildPayload(n, JOB, { imageUrl: "https://cdn.example/i.png" }, undefined, ctx(n)))
      .toThrow(/video_required.*My Node/)
  })

  it("refuses lip-sync when the portrait is wired but no audio track is", () => {
    const n = node("lip-sync", { provider: "kling-avatar" })
    expect(() => buildPayload(n, JOB, { imageUrl: "https://cdn.example/i.png" }, undefined, ctx(n)))
      .toThrow(/audio_required.*My Node/)
  })

  it("the second-half refusal carries its own code, not the first half's", () => {
    const n = node("motion-transfer")
    try {
      buildPayload(n, JOB, { imageUrl: "https://cdn.example/i.png" }, undefined, ctx(n))
      throw new Error("expected a throw")
    } catch (err) {
      expect((err as { code?: string }).code).toBe("video_required")
    }
  })

  it("face-swap stays single-entry — its face half reads only data.faceImageUrl", () => {
    // Wiring an image into the orange handle sets resolvedInputs.imageUrl, which
    // the case never reads. An AND entry on it would refuse that graph while the
    // payload would still ship `undefined` — the audit-dag wiring gap, ticketed
    // separately. The video half is guarded; the face half deliberately is not.
    const n = node("face-swap")
    expect(() => buildPayload(n, JOB, { videoUrl: "https://cdn.example/v.mp4" }, undefined, ctx(n)))
      .not.toThrow()
  })

  it("covers every frontend-guarded media node (parity ratchet)", () => {
    // Step 1's WIDE grep over origin/dev
    // (frontend/src/components/editor/workflow-editor/execute-node.ts @ d7815542):
    // every node whose single-node run is REFUSED when a required image / video /
    // audio input is missing. Line numbers are that file's.
    const FE_GUARDED = [
      "edit-image",              // :1450 no input image found
      "image-to-image",          // :1542 no input image found
      "modify-image",            // :1695 no input image found
      "upscale-image",           // :1817 no input image found
      "remove-background",       // :1839 no input image found
      "edit-video-pro",          // :2212 Connect a video to edit
      "image-to-video",          // :2454 no start frame image found
      "video-to-video",          // :2551 no source video found
      "switchx",                 // :2633 no source video found
      "audio-isolation",         // :2968 no audio input found
      "audio-separation",        // :2988 no audio input found
      "voice-changer",           // :3062 no audio or video input found
      "voice-changer-pro",       // :3137 no audio or video input
      "dubbing",                 // :3241 no audio or video input found (or set a source link)
      "forced-alignment",        // :3400 no audio input found
      "video-analysis",          // :3515 connect a video or set a YouTube URL
      "video-audit",             // :3642 connect a video to audit
      "suno-cover",              // :3819 no source audio URL found
      "suno-mashup",             // :4081 connect two audio sources for mashup
      "suno-upload-extend",      // :4252 no audio input found
      "transcribe",              // :4284 no audio/video input found
      "image-to-text",           // :4482 no image input found
      "describe-to-picker",      // :4539 no image input found
      "llm-chat",                // :4602 connect a reference image (template mode)
      "lip-sync",                // :4839 no image or video input found / :4843 no audio track
      "speech-to-video",         // :4942 no image input / :4946 no audio track
      "ai-avatar",               // :5027 no audio found / :5036 no source image found
      "motion-transfer",         // :5171 no character image / :5177 no motion video
      "video-upscale",           // :5228 no video input found
      "extend-video",            // :5256/:5283 no upstream video
      "video-retake",            // :5369 no upstream video
      "video-sfx",               // :5509 no video connected
      "face-swap",               // :5718 no face image / :5722 no video connected
      "generate-mask",           // :5739 no image connected
      "image-collage",           // :5907 need at least 2 image inputs
      "combine-videos",          // :6002 need at least 2 video inputs
      "assemble-narrated-video", // :6034 need at least 1 video input
      "merge-video-audio",       // :6078 no video input / :6084 no audio input
      "trim-audio",              // :6125 no video input
      "extract-audio",           // :6150 no video input
      "remove-audio",            // :6166 no video input
      "split-media",             // :6184 no video or audio input found
      "trim-video",              // :6287 no video input
      "extract-frame",           // :6332 no video input
      "transcode-video",         // :6354 no video input
      "manual-edit",             // :6396/:6405 no input assets connected
      "speed-ramp",              // :6422 no video input
      "loop-video",              // :6445 no video input
      "gif-to-video",            // :6479 no GIF — wire an image or upload one
      "fade-video",              // :6505 no video input
      "still-to-video",          // :6533 no image input / :6537 no audio input
      "slideshow",               // :6567 needs at least 2 images
      "resize-video",            // :6611 no video input
      "social-media-format",     // :6636 no media input
      "audio-fx",                // :6670 no audio input
      "adjust-volume",           // :6698 no audio or video input
      "add-captions",            // :6730 no video input
      "mix-audio",               // :6780 need at least 2 audio inputs
      "combine-audio",           // :6818 need at least 1 audio input
      "video-composer",          // :6844 no media assets connected
      "after-effects",           // :6895 no video input connected
      "lottie-overlay",          // :6972 no video input connected
      "render-video",            // :7295 no media assets connected
    ]
    // Nodes whose frontend refusal CANNOT be mirrored by a media-only table row
    // without refusing graphs that run today (M-12b), or whose refusal already
    // exists elsewhere on the DAG path. A bare row for any of these would turn a
    // regression-guard into a regression.
    const PARITY_EXEMPT: Record<string, string> = {
      "edit-image":
        "the main image is assembled inside the case from ordered upstream images, @-mention refs and uploads — no single resolvedInputs key stands for it",
      "image-to-image":
        "same multi-lane main-image assembly as edit-image; a bare imageUrl row would refuse mention-sourced runs",
      "modify-image":
        "same multi-lane main-image assembly as edit-image (and the nano-banana-edit arm resolves its own image)",
      "image-to-video":
        "the start frame comes from startFrameUrl / imageUrl / mention refs, and the i2v-only requirement already throws its own coded error (payload-builder-image-required.test.ts)",
      "video-audit":
        "the case already throws its own node-specific video_required (payload-builder.ts, pinned by payload-builder-video-audit.test.ts) — a table row would duplicate it",
      "suno-cover":
        "the case already throws its own node-specific audio_required over uploadUrl/audioUrl (pinned by payload-builder.test.ts)",
      "suno-upload-extend":
        "the case already throws its own node-specific audio_required (pinned by payload-builder.test.ts)",
      "transcribe":
        "an upstream youtube-video node's downloadedAudioUrl satisfies it through a graph lookup inside the case, so an absent audioUrl/videoUrl is legal",
      "ai-avatar":
        "the requirement is MODE-dependent (Text vs Audio, avatar vs image source) and the case runs its own payload validator that throws before the reservation",
      "render-video":
        "media assets come from collectMediaAssetsForRender's graph traversal (or a stored scene plan), not from a resolvedInputs key",
      "manual-edit":
        "a Category-5 skip node — node-executor never calls buildPayload for it",
      "image-to-text":
        "a Category-2 sync-HTTP node — dispatched to /v1/image-to-text/describe, whose route Zod guards the input; buildPayload is never called",
      "describe-to-picker":
        "a Category-2 sync-HTTP node — dispatched to /v1/describe-to-picker, guarded by that route's Zod",
      "llm-chat":
        "a Category-2 sync-HTTP node — dispatched to /v1/llm-chat/generate; the reference-image refusal is template-mode-only anyway",
      "video-composer":
        "a Category-2 sync-HTTP node — dispatched to /v1/scene-graph/generate, guarded by that route's Zod",
      "after-effects":
        "a Category-2 sync-HTTP node — dispatched to /v1/after-effects/generate, guarded by that route's Zod",
      "lottie-overlay":
        "a Category-2 sync-HTTP node — dispatched to /v1/lottie-overlay/generate, guarded by that route's Zod",
    }
    for (const t of FE_GUARDED) {
      if (t in PARITY_EXEMPT) continue
      expect(Object.keys(REQUIRED_MEDIA_INPUTS), `${t} is guarded by the frontend but has no table row`).toContain(t)
    }
    // The exemption list must justify itself, not just shrink the ratchet.
    for (const reason of Object.values(PARITY_EXEMPT)) expect(reason.length).toBeGreaterThan(10)
    // …and it must not drift into naming nodes the frontend never guards.
    for (const t of Object.keys(PARITY_EXEMPT)) expect(FE_GUARDED).toContain(t)
  })

  /**
   * FE_GUARDED above is a hand-maintained snapshot: it fails when coverage is
   * REMOVED, but nothing makes it notice a guard the frontend gains later. This
   * pins the count instead. Reading a frontend source by relative path at test
   * time is the established pattern (lib/__tests__/node-registry-sync.test.ts).
   *
   * The window+regex is a TRIPWIRE, not a classifier: it over-matches slightly
   * (a "no prompt — … or connect a cinematography source" refusal trips the
   * `connect a` arm) and under-matches the `need at least N` cardinality
   * guards. That is fine — any movement in the number forces a human back to
   * this file, which is the whole job.
   */
  it("pins the frontend's media-refusal count so a NEW guard fails the build", () => {
    // backend/src/services/workflow-engine/__tests__/ → up 5 → repo root
    const REPO_ROOT = join(__dirname, "..", "..", "..", "..", "..")
    const src = readFileSync(
      join(REPO_ROOT, "frontend/src/components/editor/workflow-editor/execute-node.ts"),
      "utf8",
    )
    const lines = src.split("\n")
    const MEDIA_REFUSAL = /no .*(image|video|audio|media|GIF)|connect (a|two|at least)/i
    let count = 0
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].includes('Node "${')) continue
      // 3-line window: the refusal's message often wraps onto its own line.
      const window = lines.slice(Math.max(0, i - 1), i + 2).join("\n")
      if (MEDIA_REFUSAL.test(window)) count++
    }
    expect(
      count,
      "a new frontend media guard appeared — add a REQUIRED_MEDIA_INPUTS row or a PARITY_EXEMPT entry",
    ).toBe(FRONTEND_MEDIA_REFUSAL_COUNT)
  })
})
