// @test-watches frontend/src/components/editor/workflow-editor/execute-node.ts frontend/src/nodes/** frontend/src/lib/i18n/en.ts
// @test-watches frontend/src/components/editor/workflow-editor/types.ts
/**
 * buildPayload: the checks that read the editor's sources (required media
 * inputs, the EXECUTABLE_TYPES registry walk).
 *
 * Merged from 2 test files (CI test de-duplication, plan §5.7 B) so the
 * workflow-engine module graph loads once instead of 2 times. Each original
 * file is one top-level describe named after it, with its own helpers, setup
 * and teardown; test names and assertions are unchanged.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"
import { buildPayload, REQUIRED_MEDIA_INPUTS, assertRequiredMediaInputs } from "../payload-builder.js"
import type { SimpleNode, ResolvedInputs } from "../types.js"

describe("payload-builder-media-required.test.ts", () => {
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
  /** Measured on frontend/src/components/editor/workflow-editor/execute-node.ts
   *  @ origin/dev d7815542 with the window+regex in the last test below. Bump it
   *  ONLY together with a new table row or a justified PARITY_EXEMPT entry. */
  const FRONTEND_MEDIA_REFUSAL_COUNT = 96 // +1 video-upscale seedance-2-5-hd: no Seedance draft task upstream ("Connect a Seedance 2.5 node with Draft on" — the server refuses the same build-time, table row video-upscale already covers it via kieTaskId); +1 video-depth: no video input found (table row video-depth); +1 pitch-tempo (no audio or video input; table row pitch-tempo); +4 video-mask (no video) and mask-composite (no foreground / background / mask video) — table rows video-mask + mask-composite; +1 video-analysis: a Social Search post with no video ("this post has no video to analyze" — the server refuses it too, before any reserve: video-analysis-post-probe post_has_no_video; table row video-analysis); +2 camera-switch ("connect an edit" / "connect a transcript" — JSON-input guards over-matching "connect a", exempt below); recounted, same guards: the refusals moved into the i18n dictionary and are now read from there, not from a 3-line source window (which over-matched 2 neighbouring lines); +1 video-overlay: base video (table row); +2 image-overlay: base image (table row) + overlay layers (the case throws its own); +1 silence-detect (audio/video source, table row); +1 apply-edl (the "connect an EDL" guard over-matches "connect a"; JSON-input guard, exempt below); +1 edit-plan (the "connect a transcript" guard over-matches "connect a"; JSON-input guard, exempt below); +1 audio-sync ("connect at least 2 recordings" — a source-COUNT guard, exempt below); +2 content-recipe / content-ideas ("connect a Video Analysis, a post or some text" / "connect at least one Content Recipe" — text-input guards over-matching "connect a", exempt below)

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

    // ABSENT is not the only way an input fails. A non-empty value that is not a
    // URL (a Text node wired into videoUrl, a field mapping pointing at the wrong
    // output) passed the emptiness test and died inside safeFetch as a bare
    // "Invalid URL" — after the reservation, and, because mergeVideoAudio wraps
    // its impl in runPostProcessing, tagged post-delivery so the refund guard
    // skipped. That is the 2026-09-04 merge-video-audio report.
    it("refuses a media input that is not a URL, and names the value", () => {
      const n = node("merge-video-audio")
      expect(() =>
        buildPayload(n, JOB, { videoUrl: "Scene 3 — the wide shot", audioUrl: "https://cdn.example/a.mp3" }, undefined, ctx(n)),
      ).toThrow(/video_required.*not a media URL.*Scene 3/)
    })

    it("refuses a resolved audio LIST whose entry carries a non-URL", () => {
      const n = node("merge-video-audio")
      expect(() =>
        buildPayload(
          n,
          JOB,
          { videoUrl: "https://cdn.example/v.mp4", audioSources: [{ url: "not-a-url", sourceNodeId: "n2" }] } as unknown as ResolvedInputs,
          undefined,
          ctx(n),
        ),
      ).toThrow(/audio_required.*not a media URL/)
    })

    // The verdict can only change WHICH refusal a doomed node gets — never refuse
    // a node that has something usable. Here `videoUrl` is junk but the node's own
    // data carries a real one, which is what the case reads.
    it("still runs when a usable value exists alongside the junk", () => {
      const n = node("merge-video-audio", { videoUrl: "https://cdn.example/v.mp4" })
      const result = buildPayload(n, JOB, { audioUrl: "https://cdn.example/a.mp3" }, undefined, ctx(n))
      expect(result.jobName).toBe("merge-video-audio")
    })

    // The `*WithSourceIds` lists are `{ nodeId, url }` — read by url like any
    // other list. A real one must still satisfy its requirement on its own (it is
    // often the ONLY key present, the plain `*Urls` twin being absent).
    it("accepts a *WithSourceIds list as the only media source", () => {
      const n = node("combine-videos")
      const result = buildPayload(
        n,
        JOB,
        { videoUrlsWithSourceIds: [{ nodeId: "a", url: "https://cdn.example/1.mp4" }, { nodeId: "b", url: "https://cdn.example/2.mp4" }] } as unknown as ResolvedInputs,
        undefined,
        ctx(n),
      )
      expect(result.jobName).toBe("combine-videos")
    })

    // A list whose entries carry no `url` at all is a shape this guard cannot
    // read — it must TRUST it, exactly as the old emptiness test did, rather than
    // refuse a graph on a shape it does not understand.
    it("trusts a list entry whose shape carries no url", () => {
      const n = node("combine-videos")
      const result = buildPayload(
        n,
        JOB,
        { videoUrlsWithSourceIds: [{ nodeId: "a", somethingElse: 1 }] } as unknown as ResolvedInputs,
        undefined,
        ctx(n),
      )
      expect(result.jobName).toBe("combine-videos")
    })

    // The table's non-media alternatives are NOT urls and must stay untouched.
    it("accepts an upstream VEO task id for extend-video (no URL involved)", () => {
      const n = node("extend-video", { kieTaskId: "veo-task-123" })
      const result = buildPayload(n, JOB, {}, undefined, ctx(n))
      expect(result.jobName).toBe("extend-video")
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

    it("video-analysis: a post's link wired into its video input is a source too, and the refusal names it", () => {
      const empty = node("video-analysis").data
      expect(() => assertRequiredMediaInputs("video-analysis", { videoPageUrl: "https://youtu.be/abc" }, empty)).not.toThrow()
      expect(() => assertRequiredMediaInputs("video-analysis", {}, empty)).toThrow(/a link to a post's video/)
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

    describe("video-upscale: the VEO providers need a VEO task, not a URL", () => {
      // 2026-09-09: an uploaded clip wired into a node set to "VEO 1080p" passed the
      // media table (videoUrl present), got a job row + reservation, then died at the
      // route's Zod ("VEO upscale requires kieTaskId"). The refusal has to name the
      // way out — switch to Topaz — because the node card used to say "Topaz" for
      // every provider, so the user had no idea VEO was selected.
      const v = "https://cdn.example/uploaded.mp4"
      for (const provider of ["veo-1080p", "veo-4k"]) {
        it(`refuses ${provider} with only a video URL, before any job row exists`, () => {
          const n = node("video-upscale", { provider })
          try {
            buildPayload(n, JOB, { videoUrl: v }, undefined, ctx(n))
            throw new Error("expected a throw")
          } catch (err) {
            expect((err as { code?: string }).code).toBe("video_required")
            expect((err as Error).message).toMatch(/My Node/)
            expect((err as Error).message).toMatch(/Topaz/)
          }
        })
      }

      it("accepts a VEO provider when the upstream VEO task id is resolved", () => {
        const n = node("video-upscale", { provider: "veo-1080p" })
        const built = buildPayload(n, JOB, { kieTaskId: "kie-task-1" } as unknown as ResolvedInputs, undefined, ctx(n))
        expect(built.payload).toMatchObject({ provider: "veo-1080p", kieTaskId: "kie-task-1" })
      })

      it("accepts a VEO provider when the task id is stamped on the node data", () => {
        const n = node("video-upscale", { provider: "veo-4k", kieTaskId: "kie-task-2" })
        expect(() => buildPayload(n, JOB, { videoUrl: v }, undefined, ctx(n))).not.toThrow()
      })

      it("refuses Seedance 2.5 HD (from draft) with only a video URL, naming the fix", () => {
        const n = node("video-upscale", { provider: "seedance-2-5-hd" })
        try {
          buildPayload(n, JOB, { videoUrl: v }, undefined, ctx(n))
          throw new Error("expected a throw")
        } catch (err) {
          expect((err as { code?: string }).code).toBe("video_required")
          expect((err as Error).message).toMatch(/Seedance 2.5 draft/)
          expect((err as Error).message).toMatch(/Topaz/)
        }
      })

      it("accepts Seedance 2.5 HD when the upstream draft's task id is resolved", () => {
        const n = node("video-upscale", { provider: "seedance-2-5-hd" })
        const built = buildPayload(n, JOB, { kieTaskId: "task-draft" } as unknown as ResolvedInputs, undefined, ctx(n))
        expect(built.payload).toMatchObject({ provider: "seedance-2-5-hd", kieTaskId: "task-draft" })
        // The exact per-length row is stamped by node-executor from the source draft.
        expect(built.modelIdentifier).toBe("seedance-2-5-hd")
      })

      it("Topaz keeps taking a plain video URL", () => {
        const n = node("video-upscale", { provider: "topaz", upscaleFactor: "2" })
        const built = buildPayload(n, JOB, { videoUrl: v }, undefined, ctx(n))
        expect(built.payload).toMatchObject({ provider: "topaz", videoUrl: v })
      })
    })

    it("face-swap needs both halves — a face image and a video — and ships the wired face", () => {
      // The face now has its own lane (the resolver routes the `face` handle into
      // resolvedInputs.faceImageUrl), so a missing face is refused before any job
      // is created instead of crashing at the provider.
      const n = node("face-swap")
      const video = "https://cdn.example/v.mp4"
      const face = "https://cdn.example/f.png"
      expect(() => buildPayload(n, JOB, { videoUrl: video }, undefined, ctx(n))).toThrow(/image_required/)
      expect(() => buildPayload(n, JOB, { faceImageUrl: face }, undefined, ctx(n))).toThrow(/video_required/)
      const built = buildPayload(n, JOB, { videoUrl: video, faceImageUrl: face }, undefined, ctx(n))
      expect(built.payload).toMatchObject({ faceImageUrl: face, videoUrl: video })
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
        "video-depth",             // no video input found
        "extend-video",            // :5256/:5283 no upstream video
        "video-retake",            // :5369 no upstream video
        "video-sfx",               // :5509 no video connected
        "face-swap",               // :5718 no face image / :5722 no video connected
        "generate-mask",           // :5739 no image connected
        "image-collage",           // :5907 need at least 2 image inputs
        "image-overlay",           // no base image connected + no overlay image connected
        "video-overlay",           // no base video connected (the layer refusals speak the shared validator's codes)
        "combine-videos",          // :6002 need at least 2 video inputs
        "apply-edl",               // "connect an EDL to the EDL input" — a json-input guard, not media (exempt below)
        "edit-plan",               // "connect a transcript to the Transcript input" — a json-input guard, not media (exempt below)
        "camera-switch",           // "connect an edit" / "connect a transcript" — json-input guards, not media (exempt below)
        "assemble-narrated-video", // :6034 need at least 1 video input
        "merge-video-audio",       // :6078 no video input / :6084 no audio input
        "trim-audio",              // :6125 no video input
        "extract-audio",           // :6150 no video input
        "silence-detect",          // connect an audio or video source
        "audio-sync",              // connect at least 2 recordings to the "Sources" input (source-COUNT guard, exempt below)
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
        "video-mask",              // no video to segment
        "mask-composite",          // no foreground / background / mask video
        "still-to-video",          // :6533 no image input / :6537 no audio input
        "slideshow",               // :6567 needs at least 2 images
        "resize-video",            // :6611 no video input
        "social-media-format",     // :6636 no media input
        "audio-fx",                // :6670 no audio input
        "adjust-volume",           // :6698 no audio or video input
        "pitch-tempo",             // no audio or video input
        "add-captions",            // :6730 no video input
        "mix-audio",               // :6780 need at least 2 audio inputs
        "combine-audio",           // :6818 need at least 1 audio input
        "video-composer",          // :6844 no media assets connected
        "after-effects",           // :6895 no video input connected
        "lottie-overlay",          // :6972 no video input connected
        "render-video",            // :7295 no media assets connected
        "content-recipe",          // connect a Video Analysis, a post or some text (text-input guard, exempt below)
        "content-ideas",           // connect at least one Content Recipe (text-input guard, exempt below)
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
        "apply-edl":
          "the frontend refusal is 'connect an EDL' — a JSON-input guard, not a media one (its media resolves from EdlSource.url inside the EDL). The backend enforces parity by building + validating the effective EDL in the payload-builder case (validateEffectiveEdl throws before the reservation), so a media-only REQUIRED_MEDIA_INPUTS row would be wrong.",
        "edit-plan":
          "the counted refusal is 'connect a transcript' — a JSON-input guard, not a media one (edit-plan reads the transcript, never pixels). buildPayload DOES enforce parity: its edit-plan case throws for BOTH an unresolved transcript AND empty sources before the reserve (mirroring the two frontend refusals). A REQUIRED_MEDIA_INPUTS row would still be wrong because the PRIMARY guard is the JSON transcript, and the media guard is a source-COUNT (min 1), not a specific typed-URL slot that table models.",
        "content-recipe":
          "the refusal is about its MATERIAL — text or an analysis JSON on the `in` wire — never a media URL (the `link` wire is a citation, not media). buildPayload enforces parity: its content-recipe case throws for empty material before the reserve (pinned by content-recipe-ideas.test.ts).",
        "content-ideas":
          "the refusal is a recipe-COUNT guard over text folded from the `recipes` wire, not a media slot. buildPayload enforces parity: its content-ideas case throws when no recipe arrived, before the reserve (pinned by content-recipe-ideas.test.ts).",
        "camera-switch":
          "both counted refusals are JSON-input guards — 'connect an edit (EDL)' and 'connect a transcript' — never a media URL (its cameras resolve from EdlSource.url inside the EDL). buildPayload enforces parity: its camera-switch case throws for a missing edit, a missing transcript and a transcript with no speaker labels, before the reserve (pinned by camera-switch-dag.test.ts).",
        "audio-sync":
          "the guard is a source-COUNT (2..6 recordings on one `sources` handle, each kept with its node id), not a typed-URL slot the table models. buildPayload DOES enforce parity: its audio-sync case throws for fewer than 2 or more than 6 wired recordings, and for any source that is not a fetchable media URL, before the reserve (pinned by ee/billing/__tests__/audio-sync-credits.test.ts).",
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
     * Each refusal is a `nodeRunError(<label>, "<key>")` call whose English
     * lives in the frontend dictionary, so the regex runs on that text. It is a
     * TRIPWIRE, not a classifier: it over-matches slightly (a "no prompt — … or
     * connect a cinematography source" refusal trips the `connect a` arm) and
     * under-matches the `need at least N` cardinality guards. That is fine — any
     * movement in the number forces a human back to this file, which is the
     * whole job.
     */
    it("pins the frontend's media-refusal count so a NEW guard fails the build", () => {
      // backend/src/services/workflow-engine/__tests__/ → up 5 → repo root
      const REPO_ROOT = join(__dirname, "..", "..", "..", "..", "..")
      // execute-node.ts, plus every node unit's own executor (frontend/src/nodes/<type>/exec.ts),
      // where a unit's media guard now lives (kit.nodeRunError).
      const unitsDir = join(REPO_ROOT, "frontend/src/nodes")
      const unitExecs = readdirSync(unitsDir)
        .filter((n) => !n.startsWith("_") && existsSync(join(unitsDir, n, "exec.ts")))
        .map((n) => readFileSync(join(unitsDir, n, "exec.ts"), "utf8"))
      const src = [
        readFileSync(join(REPO_ROOT, "frontend/src/components/editor/workflow-editor/execute-node.ts"), "utf8"),
        ...unitExecs,
      ].join("\n")
      const dictionary = readFileSync(join(REPO_ROOT, "frontend/src/lib/i18n/en.ts"), "utf8")
      const englishOf = (key: string): string | undefined =>
        dictionary.match(new RegExp(`^\\s*"${key.replace(/\./g, "\\.")}":\\s*"((?:[^"\\\\]|\\\\.)*)"`, "m"))?.[1]
      const MEDIA_REFUSAL = /no .*(image|video|audio|media|GIF)|connect (a|two|at least)/i
      let count = 0
      for (const call of src.matchAll(/nodeRunError\([\s\S]*?"(nodeRun\.[A-Za-z0-9]+)"/g)) {
        const english = englishOf(call[1])
        expect(english, `${call[1]} is not in the frontend dictionary`).toBeDefined()
        if (MEDIA_REFUSAL.test(english ?? "")) count++
      }
      expect(
        count,
        "a new frontend media guard appeared — add a REQUIRED_MEDIA_INPUTS row or a PARITY_EXEMPT entry",
      ).toBe(FRONTEND_MEDIA_REFUSAL_COUNT)
    })
  })
})

describe("payload-builder-registry-walk.test.ts", () => {
  /**
   * L2#1 — buildPayload registry walk.
   *
   * For every type the frontend will dispatch (`EXECUTABLE_TYPES`), assert that
   * `buildPayload` either returns a payload or throws something other than
   * "Unknown node type". The "Unknown node type" error means the type is in the
   * frontend's executable set but missing from the backend's `payload-builder.ts`
   * switch — at runtime this creates a `pending` jobs row, throws inside the
   * orchestrator, and dies. The action-fx outage class.
   *
   * Some `EXECUTABLE_TYPES` entries are deliberately routed AROUND `buildPayload`
   * by the executor: inline nodes, sync-HTTP nodes, and the special-cases
   * `component` / `sub-workflow`. This test mirrors the dispatch logic in
   * `node-executor.ts::executeNode` so it exempts those types correctly. The
   * exemption sets are expected to stay in sync with `node-executor.ts` —
   * `node-executor-categorization.test.ts` (companion) verifies that.
   *
   * Pairs with L1#1 (which only checks classification, not behavior).
   */
  // REPO_ROOT: backend/src/services/workflow-engine/__tests__/ → up 5 → repo root
  const REPO_ROOT = join(__dirname, "..", "..", "..", "..", "..")
  const FRONTEND_TYPES_PATH = join(
    REPO_ROOT,
    "frontend/src/components/editor/workflow-editor/types.ts",
  )

  function extractFrontendExecutableTypes(): Set<string> {
    const source = readFileSync(FRONTEND_TYPES_PATH, "utf8")
    const match = source.match(
      // The hand-written set — composed with the node units' since §5.8 B
      // (`composeSet("EXECUTABLE_TYPES", new Set([...]), units)`); a unit is
      // executable by its unit.json execution.kind, not by this literal.
      /export const EXECUTABLE_TYPES\s*=\s*(?:composeSet\([^,]*,\s*)?new Set\(\s*\[([\s\S]*?)\]\s*\)/,
    )
    if (!match) {
      throw new Error(
        `Couldn't extract EXECUTABLE_TYPES from ${FRONTEND_TYPES_PATH}. Has the declaration syntax changed? Update extractFrontendExecutableTypes() in this test file to match.`,
      )
    }
    const body = match[1] ?? ""
    return new Set([...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]))
  }

  const FRONTEND_EXECUTABLE_TYPES = extractFrontendExecutableTypes()

  /**
   * Types that the executor routes AROUND buildPayload. Mirrors the dispatch
   * order in node-executor.ts::executeNode. Keep in sync with the constants
   * declared at the top of node-executor.ts. If a developer reclassifies a node
   * (e.g. moves something from worker-queued to inline), the corresponding
   * payload-builder switch case becomes dead — but the test on the new path
   * (sync-http-route-parity for SYNC_HTTP, inline-executor.test for INLINE)
   * picks up the slack. These exemptions are the contract between executor
   * and payload-builder.
   */
  const NON_BUILDPAYLOAD_NODES: ReadonlySet<string> = new Set([
    // INLINE_NODES (executed by inline-executor.ts, no buildPayload call)
    "combine-text",
    "split-text",
    "composite",
    "webhook-output",
    "teleport-send",
    "teleport-receive",
    "router",
    "extract-field",
    "json-process",
    "filter-list",
    "deduplicate",
    "merge-lists",
    "sort-list",
    "selector",
    // Note: "preview" is in INLINE_NODES at runtime but is NOT in EXECUTABLE_TYPES
    // — the frontend treats it as a passive display node that updates reactively
    // when upstream completes. So we don't need to exempt it (the iteration
    // source filters it out already).
    // SYNC_HTTP_NODES (executed via internal fetch)
    // Note: "ai-writer" remains a SYNC_HTTP node in node-executor.ts for
    // back-compat (legacy saved nodes migrate to llm-chat on load), but it was
    // removed from the frontend EXECUTABLE_TYPES set when the editor type was
    // merged into "Generate Text" (llm-chat). Exemptions here must mirror
    // EXECUTABLE_TYPES (see the NON_BUILDPAYLOAD_NODES integrity test below), so
    // ai-writer is intentionally absent.
    "llm-chat",
    "video-composer",
    "after-effects",
    "lottie-overlay",
    "3d-title",
    "motion-graphics",
    "image-to-text",
    "describe-to-picker",
    "suno-style-boost",
    "image-critic",
    "instagram-post",
    "tiktok-post",
    "youtube-upload",
    "linkedin-post",
    "x-post",
    "facebook-post",
    "telegram-post",
    "publish-social",
    "telegram-channel-feed",
    // Collections: both nodes answer from their route (POST /v1/collection-read,
    // /v1/collection-write) — sync-HTTP so a fan-out item is written per
    // iteration; buildPayload is never asked for them.
    "collection-read",
    "collection-write",
    // The post readers answer from their route (POST /v1/inspiration-read,
    // /v1/competitor-read) the same way.
    "inspiration-read",
    "competitor-read",
    "qa-check",
    "save-to-storage",
    "web-scrape",
    // Site Capture: POST /v1/site-capture answers with a job id the orchestrator polls.
    "site-capture",
    "meta-ads-scrape",
    "instagram-scrape",
    // UGC video: sync-HTTP to the Nodaro Cloud plugin's routes (UGC_SYNC_ROUTES in
    // ugc-sync-nodes.ts); UGC Creator and UGC Cards start their child jobs from
    // their own runners. buildPayload is never asked for them.
    "ugc-creator",
    "ugc-script",
    "ugc-clips",
    "ugc-clip",
    "ugc-cards",
    // UGC Finish: runs its finish job from its own runner (runUgcFinish), or nothing.
    "ugc-finish-clips",
    // Fan-in node — routed via sync-HTTP to POST /v1/reduce (see
    // SYNC_HTTP_NODES + SYNC_HTTP_ROUTES in node-executor.ts). The orchestrator
    // never calls buildPayload for reduce; payload-builder.ts therefore
    // has no case for it. Single-result wrap of N upstream values into 1.
    "reduce",
    // Special-case dispatch (handled by executeNode before INLINE/SYNC_HTTP)
    "component",
    "sub-workflow",
    // Generative Pipeline runs via the dedicated pipeline-orchestration queue
    // (POST /v1/pipelines), not the DAG. Treated as a no-op leaf by the DAG
    // executor in Phase 1A — see executeNode() in node-executor.ts.
    "generative-pipeline",
    // Phase 1B.2 pipeline-managed SceneNode — internal pipeline (keyframe gen
    // → animate → speech → lip_sync → combine) runs via the pipeline
    // orchestrator (Phase 1C). DAG treats it as a no-op success leaf — see
    // node-executor.ts. The legacy `case "scene"` in payload-builder.ts is
    // dead code as long as the short-circuit in node-executor.ts fires.
    "scene",
  ])

  /**
   * Sanity check on the regex extraction. If this breaks, every other test in
   * this file would silently iterate an empty set.
   */
  describe("FRONTEND_EXECUTABLE_TYPES extraction sanity", () => {
    it("found a non-trivial number of executable types (>= 50)", () => {
      expect(FRONTEND_EXECUTABLE_TYPES.size).toBeGreaterThanOrEqual(50)
    })
  })

  /**
   * The walk. For each EXECUTABLE_TYPES entry that's a worker-queued node (i.e.
   * NOT in NON_BUILDPAYLOAD_NODES), call buildPayload with a minimal fixture
   * and assert the error message is not "Unknown node type". Other errors
   * (missing required fields, invalid values) are acceptable signals that the
   * case exists and is performing input validation — those are caught by L2
   * unit tests for the specific node type.
   */
  describe("buildPayload covers every worker-queued EXECUTABLE_TYPES entry", () => {
    const workerQueuedTypes = [...FRONTEND_EXECUTABLE_TYPES].filter(
      (t) => !NON_BUILDPAYLOAD_NODES.has(t),
    )

    it("the walk has at least 30 worker-queued types to check", () => {
      // Sanity: if the exemption set ever becomes too aggressive, we'd silently
      // not cover anything. Floor protects against that drift.
      expect(workerQueuedTypes.length).toBeGreaterThanOrEqual(30)
    })

    it.each(workerQueuedTypes)(
      'buildPayload has a switch case for worker-queued type "%s"',
      (type) => {
        const node: SimpleNode = { id: "test-n1", type, data: {} }
        let errorMessage: string | undefined
        try {
          buildPayload(node, "test-job-1", {}, undefined, {
            settings: undefined,
            nodes: [],
            edges: [],
            nodeStates: {},
          })
        } catch (e) {
          errorMessage = (e as Error).message ?? String(e)
        }

        // The specific error we're trying to prevent — buildPayload's default
        // case throws this when no switch case matches. Other errors (missing
        // required field, invalid value) mean the case exists and is doing
        // input validation; those are caught by per-type unit tests, not here.
        // ?? "" handles the success case (no throw → undefined errorMessage).
        expect(
          errorMessage ?? "",
          `buildPayload threw "Unknown node type: ${type}". The frontend will dispatch this node (it's in EXECUTABLE_TYPES), the executor will route it to the worker-queued path (not inline, not sync-HTTP), but the backend buildPayload switch is missing the case. Add a "case ${JSON.stringify(type)}: { ... }" block in backend/src/services/workflow-engine/payload-builder.ts. If this type is actually meant to be inline or sync-HTTP, add it to INLINE_NODES or SYNC_HTTP_NODES in node-executor.ts AND update NON_BUILDPAYLOAD_NODES in this test file.`,
        ).not.toMatch(/Unknown node type/)
      },
    )
  })

  /**
   * Reverse direction: every entry in NON_BUILDPAYLOAD_NODES is actually in
   * FRONTEND_EXECUTABLE_TYPES. If a type was removed from EXECUTABLE_TYPES but
   * left in our exemption set here, the exemption is dead and obscures whether
   * something is genuinely worker-queued.
   */
  describe("NON_BUILDPAYLOAD_NODES integrity", () => {
    it("every exempted type is still in EXECUTABLE_TYPES", () => {
      const dead = [...NON_BUILDPAYLOAD_NODES].filter(
        (t) => !FRONTEND_EXECUTABLE_TYPES.has(t),
      )
      expect(
        dead,
        `These NON_BUILDPAYLOAD_NODES entries are no longer in EXECUTABLE_TYPES — remove them from this exemption list (they're dead): ${dead.join(", ")}`,
      ).toEqual([])
    })
  })
})
