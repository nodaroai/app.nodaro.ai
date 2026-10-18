/**
 * buildPayload: video generation (node direction on video paths, the
 * image-required guard, Gemini Omni, Wan 3).
 *
 * Merged from 4 test files (CI test de-duplication, plan §5.7 B) so the
 * workflow-engine module graph loads once instead of 4 times. Each original
 * file is one top-level describe named after it, with its own helpers, setup
 * and teardown; test names and assertions are unchanged.
 */
import { describe, it, expect } from "vitest"
import { buildPayload } from "../payload-builder.js"
import type { SimpleNode, SimpleEdge, ResolvedInputs } from "../types.js"
import { getCameraMotionPromptHint, getCameraMotionTerm, getStylePromptHint } from "@nodaro/prompts/pickers"
import { renderStructuredFields } from "@nodaro/prompts/prompt-builder"
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import { PRICING_DEFAULT_RESOLUTION } from "@nodaro/shared/models"
import { buildVideoCreditModelIdentifier } from "@nodaro/shared/credits"

describe("payload-builder-video-node-direction.test.ts", () => {
  /**
   * THE KEYSTONE for "the canvas VIDEO executors honor node-data
   * direction/structured" (P4b) — the exact mirror of
   * `payload-builder-node-direction.test.ts` on the still side.
   *
   * The orchestrator now narrow-reads a video node's stored `data.direction` /
   * `data.structured` and folds them ONCE, inside `composeVideoPrompt`, via the
   * shared `composeVideoPromptText`. What must be pinned HERE rather than in the
   * composer's own suite is the CALLER level: the fold is opted into per case,
   * and the generate-video family has FOUR exits through this builder —
   * `generate-video` in its t2v and i2v modes, `generate-video`'s LTX early
   * return (which composes no graph hints at all), plus the two legacy standalone
   * cases the frontend re-types onto. A fold wired into only some of them is the
   * whole failure mode.
   *
   * THE BYTE-IDENTITY HALF matters as much as the fold: Studio has been STORING
   * these ids on emitted video nodes while nothing read them, so every already
   * saved production must keep its exact prompt until it actually carries a
   * direction. The trailing-newline fixtures are what fail the instant a caller
   * takes the join branch unconditionally.
   *
   * Real catalog ids throughout — every `get*` hint helper returns `""` on a
   * miss, so a made-up id would make the fold assertions vacuously pass.
   *
   * Helpers mirror `payload-builder-node-direction.test.ts`.
   */

  function node(id: string, type: string, data: Record<string, unknown> = {}): SimpleNode {
    return { id, type, data }
  }

  function edge(
    source: string,
    target: string,
    sourceHandle?: string | null,
    targetHandle?: string | null,
  ): SimpleEdge {
    return {
      id: `${source}->${target}`,
      source,
      target,
      sourceHandle: sourceHandle ?? null,
      targetHandle: targetHandle ?? null,
    }
  }

  const jobId = "job-1"
  /** A ref-capable provider, so no case takes a degenerate strip path. */
  const PROVIDER = "seedance-2"
  const CAMERA_MOTION = "handheld" // MOTION dimension → compact term
  const STYLE = "cinematic" // LOOK dimension → full clause

  /** A start frame flips `generate-video` onto its i2v mode; without one it is t2v. */
  const WITH_START_FRAME: ResolvedInputs = { startFrameUrl: "https://r2/frame.png" }

  function promptFor(
    type: string,
    data: Record<string, unknown>,
    opts: { inputs?: ResolvedInputs; nodes?: SimpleNode[]; edges?: SimpleEdge[] } = {},
  ): string | undefined {
    const target = node("vid-1", type, { provider: PROVIDER, ...data })
    const nodes = [...(opts.nodes ?? []), target]
    const edges = opts.edges ?? []
    return buildPayload(target, jobId, opts.inputs ?? {}, undefined, {
      nodes,
      edges,
      nodeStates: {},
    }).payload.prompt as string | undefined
  }

  function occurrences(haystack: string, needle: string): number {
    if (needle.length === 0) return 0
    let count = 0
    let from = 0
    for (;;) {
      const at = haystack.indexOf(needle, from)
      if (at === -1) return count
      count += 1
      from = at + needle.length
    }
  }

  /**
   * Every builder exit that folds, as `[name, run]`. Table-driven so a new video
   * fold site is added HERE (one row) rather than by copying a describe block —
   * and so the byte-identity half is asserted over the identical set as the fold
   * half, which is the pairing that catches a half-wired case.
   */
  const FOLD_SITES: ReadonlyArray<
    readonly [string, (data: Record<string, unknown>) => string | undefined]
  > = [
    ["generate-video (t2v mode)", (d) => promptFor("generate-video", d)],
    [
      "generate-video (i2v mode)",
      (d) => promptFor("generate-video", d, { inputs: WITH_START_FRAME }),
    ],
    [
      "generate-video (LTX early return)",
      (d) => promptFor("generate-video", { ...d, provider: "ltx-2.3-pro" }),
    ],
    ["image-to-video (legacy standalone)", (d) => promptFor("image-to-video", d)],
    ["text-to-video (legacy standalone)", (d) => promptFor("text-to-video", d)],
  ]

  describe("payload-builder video: no stored direction/structured is byte-identical", () => {
    // THE parity guarantee, stated as EQUALITY AGAINST THE NO-KEY BASELINE plus a
    // literal pin — not as an untrimmed-passthrough claim. Four of the five exits
    // run the composed body through the video prompt policy, which normalizes
    // whitespace before the payload is built (pre-existing, unrelated to this
    // leg), so only the LTX exit could ever satisfy an untrimmed assertion here.
    // The composer's own untrimmed no-op contract is pinned where it is
    // observable: `packages/prompts/src/__tests__/assemble-video-input.test.ts`.
    const JUNK: ReadonlyArray<Record<string, unknown>> = [
      { direction: "nope" },
      { direction: [] },
      { direction: { cameraMotion: 5 } },
      { direction: {} },
      { direction: { cameraMotion: "" } },
      { direction: { __not_a_dimension__: "x" } },
      { structured: "nope" },
      { structured: {} },
      { structured: { person: { age: "drop table" } } },
    ]

    for (const [site, run] of FOLD_SITES) {
      it(`${site}: a direction-less node still yields its exact prompt`, () => {
        expect(run({ prompt: "a knight rides at dusk" })).toBe("a knight rides at dusk")
      })

      it(`${site}: an empty / junk direction or structured takes the no-op branch`, () => {
        // A trailing newline (common from an upstream LLM prompt node) is the
        // body that diverges the instant a caller takes the join branch
        // unconditionally instead of the composer's exact no-op branch.
        const body = "a knight rides at dusk\n"
        const baseline = run({ prompt: body })
        expect(baseline).toContain("a knight rides at dusk")
        for (const data of JUNK) {
          expect(run({ prompt: body, ...data }), JSON.stringify(data)).toBe(baseline)
        }
      })

      it(`${site}: a prompt-less node is unchanged too`, () => {
        const baseline = run({})
        for (const data of JUNK) {
          expect(run(data), JSON.stringify(data)).toBe(baseline)
        }
      })
    }
  })

  describe("payload-builder video: stored direction folds into the prompt", () => {
    const motionTerm = getCameraMotionTerm(CAMERA_MOTION)
    const styleHint = getStylePromptHint(STYLE)

    it("has non-empty oracle hints (guards against vacuous assertions)", () => {
      expect(motionTerm.length).toBeGreaterThan(0)
      expect(styleHint.length).toBeGreaterThan(0)
      // The verbosity split is the whole point of `VIDEO_HINT_MODE_DEFAULT`: a
      // motion dimension must render the COMPACT term here, not its full clause.
      expect(getCameraMotionPromptHint(CAMERA_MOTION)).not.toBe(motionTerm)
    })

    for (const [site, run] of FOLD_SITES) {
      it(`${site}: folds a motion id as its compact term, exactly once`, () => {
        const prompt = run({ prompt: "a knight rides at dusk", direction: { cameraMotion: CAMERA_MOTION } })!
        expect(prompt).toBe(`a knight rides at dusk. ${motionTerm}`)
        expect(occurrences(prompt, motionTerm)).toBe(1)
      })

      it(`${site}: folds a look id as its full clause, into the [style] section`, () => {
        expect(run({ prompt: "a knight rides at dusk", direction: { style: STYLE } })).toBe(
          `a knight rides at dusk\n\n[style]:\n${styleHint}`,
        )
      })

      it(`${site}: accepts an array of ids (the multi-pick shape)`, () => {
        expect(run({ prompt: "a knight", direction: { cameraMotion: [CAMERA_MOTION] } })).toBe(
          `a knight. ${motionTerm}`,
        )
      })

      it(`${site}: assembles a prompt from direction alone (the orchestrator never throws)`, () => {
        // No prose to separate from: the section is the whole prompt, and it must
        // not open on the blank line that would normally precede it.
        expect(run({ direction: { style: STYLE } })).toBe(`[style]:\n${styleHint}`)
      })

      it(`${site}: appends the rendered structured fragment exactly once`, () => {
        const structured = { person: { age: 34, gender: "woman" as const } }
        const fragment = renderStructuredFields(structured)
        expect(fragment.length).toBeGreaterThan(0)
        const prompt = run({ prompt: "a portrait", structured })!
        expect(prompt).toBe(`a portrait. ${fragment}`)
        expect(occurrences(prompt, fragment)).toBe(1)
      })

      it(`${site}: folds direction BEFORE structured, both exactly once`, () => {
        const structured = { mood: "brooding" }
        const prompt = run({
          prompt: "a portrait",
          direction: { cameraMotion: CAMERA_MOTION },
          structured,
        })
        expect(prompt).toBe(`a portrait. ${motionTerm}. ${renderStructuredFields(structured)}`)
      })
    }
  })

  describe("payload-builder video: stored ids are ADDITIVE to the graph composition", () => {
    const motionTerm = getCameraMotionTerm(CAMERA_MOTION)

    it("lands AFTER a wired cinematography hint — no precedence, no dedupe", () => {
      // A wired picker folds into the body inside `composeVideoPrompt`; the
      // stored ids fold after it. Exactly today's semantics for two wired picker
      // nodes of one family — and the same ordering the still side pins.
      const personNode = node("cine-1", "person", {
        label: "Person",
        preText: "a weathered fisherman",
      })
      const prompt = promptFor(
        "generate-video",
        { prompt: "walking the pier", direction: { cameraMotion: CAMERA_MOTION } },
        { nodes: [personNode], edges: [edge("cine-1", "vid-1", null, "look")] },
      )!
      expect(prompt).toContain("a weathered fisherman")
      expect(prompt).toContain(motionTerm)
      expect(prompt.indexOf(motionTerm)).toBeGreaterThan(prompt.indexOf("a weathered fisherman"))
    })

    it("folds BEFORE @-mention resolution, so identity directives still wrap it", () => {
      // The fold must land on the prompt BODY, before `resolveVideoPromptMentions`
      // frames it — folding afterwards would push the look description past the
      // identity directives (the bug this channel exists to fix).
      const kira = node("char-1", "character", {
        label: "Kira",
        characterName: "Kira",
        sourceImageUrl: "https://r2/kira-source.png",
        canonicalDescription: "young woman, brown eyes",
        defaultAssetUrl: "https://r2/kira-portrait.png",
      })
      const prompt = promptFor(
        "generate-video",
        { prompt: "@kira walks away", direction: { cameraMotion: CAMERA_MOTION } },
        { nodes: [kira], edges: [edge("char-1", "vid-1", null, "imageReferences")] },
      )!
      expect(prompt).toContain(motionTerm)
      expect(occurrences(prompt, motionTerm)).toBe(1)
      // The resolver's own framing is still present and still wraps the body.
      expect(prompt).toContain("Kira")
    })
  })
})

describe("payload-builder-image-required.test.ts", () => {
  /**
   * i2v-only provider guard in the unified `generate-video` payload-builder case.
   *
   * Providers without a t2v mode (VIDEO_PROVIDERS_REQUIRING_IMAGE — kling-3-omni,
   * kling-master, happyhorse-ref2v, …) must fail fast with a clear message when
   * the node dispatches to the text-to-video path (no start-frame image wired),
   * mirroring the /v1/text-to-video route's "image_required" 400 — instead of
   * enqueueing a job that dies at provider lookup. On the t2v path, reference
   * images alone do NOT satisfy the requirement. Two shapes never reach that
   * path with refs wired, because the shared mode resolution routes them to i2v
   * first: a split-id model whose ONLY ref-capable twin is the i2v one (Grok
   * Imagine 1, #861), and a single-id i2v-only model whose catalog declares the
   * `reference-to-video` capability (Vidu Q4, HappyHorse Ref2V — their provider
   * runs from references alone). kling-3-omni declares no such capability (it
   * has no dispatch path), so its refs-only run is still refused.
   */
  function gv(provider: string, data: Record<string, unknown> = {}): SimpleNode {
    return {
      id: "gv-1",
      type: "generate-video",
      data: { provider, prompt: "a cinematic shot", duration: 5, ...data },
    }
  }

  const JOB_ID = "job-img-required-1"
  const ctx = (n: SimpleNode) => ({ nodes: [n], edges: [], nodeStates: {} })

  describe("generate-video i2v-only provider guard", () => {
    it("refuses a linked segment even when ordinary upstream images are available", () => {
      const n = gv("wan-3", { sequenceBinding: { startKeyframeId: "A", endKeyframeId: "B" } })
      expect(() => buildPayload(n, JOB_ID, { startFrameUrl: "https://media.test/latest.png" }, undefined, ctx(n)))
        .toThrow(expect.objectContaining({ code: "sequence_execution_required" }))
    })

    it("throws a clear image-required error for kling-3-omni with no image wired", () => {
      const n = gv("kling-3-omni")
      expect(() => buildPayload(n, JOB_ID, {}, undefined, ctx(n)))
        .toThrow(/kling-3-omni requires an input image/)
    })

    it("reference images alone do not satisfy the start-frame requirement", () => {
      const n = gv("kling-3-omni")
      const inputs: ResolvedInputs = {
        referenceImageUrls: ["https://cdn.example/ref-1.png"],
      }
      expect(() => buildPayload(n, JOB_ID, inputs, undefined, ctx(n)))
        .toThrow(/kling-3-omni requires an input image/)
    })

    for (const provider of ["vidu-q4", "happyhorse-ref2v"]) {
      it(`routes ${provider} with reference images and NO start frame to image-to-video, refs forwarded`, () => {
        // The provider runs from references alone (catalog `reference-to-video`),
        // so a references-only run is never refused as "image required".
        const n = gv(provider)
        const inputs: ResolvedInputs = { referenceImageUrls: ["https://cdn.example/ref-1.png", "https://cdn.example/ref-2.png"] }
        const result = buildPayload(n, JOB_ID, inputs, undefined, ctx(n))
        expect(result.jobName).toBe("image-to-video")
        expect(result.payload.provider).toBe(provider)
        expect(result.payload.imageUrl).toBeUndefined()
        expect(result.payload.referenceImageUrls).toEqual(["https://cdn.example/ref-1.png", "https://cdn.example/ref-2.png"])
      })

      it(`still refuses ${provider} with nothing wired`, () => {
        const n = gv(provider)
        expect(() => buildPayload(n, JOB_ID, {}, undefined, ctx(n))).toThrow(new RegExp(`${provider} requires an input image`))
      })
    }

    it("dispatches kling-3-omni to image-to-video when a start frame is wired (refs forwarded)", () => {
      const n = gv("kling-3-omni")
      const inputs: ResolvedInputs = {
        startFrameUrl: "https://cdn.example/start.png",
        referenceImageUrls: ["https://cdn.example/ref-1.png"],
      }
      const result = buildPayload(n, JOB_ID, inputs, undefined, ctx(n))
      expect(result.jobName).toBe("image-to-video")
      expect(result.payload.imageUrl).toBe("https://cdn.example/start.png")
      expect(result.payload.referenceImageUrls).toEqual(["https://cdn.example/ref-1.png"])
    })

    it("remaps happyhorse-i2v to its t2v twin instead of failing when run without an image", () => {
      const n = gv("happyhorse-i2v")
      const result = buildPayload(n, JOB_ID, {}, undefined, ctx(n))
      expect(result.jobName).toBe("text-to-video")
      expect(result.payload.provider).toBe("happyhorse")
    })

    it("routes Grok Imagine 1 with reference images and NO start frame to image-to-video, refs forwarded (#861)", () => {
      // The t2v twin (`grok`) has no image parameter at all, so refs wired
      // without a start frame used to be silently dropped on the t2v path.
      for (const stored of ["grok-i2v", "grok"]) {
        const n = gv(stored)
        const inputs: ResolvedInputs = {
          referenceImageUrls: ["https://cdn.example/ref-1.png", "https://cdn.example/ref-2.png"],
        }
        const result = buildPayload(n, JOB_ID, inputs, undefined, ctx(n))
        expect(result.jobName).toBe("image-to-video")
        expect(result.payload.provider).toBe("grok-i2v")
        expect(result.payload.imageUrl).toBeUndefined()
        expect(result.payload.referenceImageUrls).toEqual(["https://cdn.example/ref-1.png", "https://cdn.example/ref-2.png"])
        // Billing-neutral: the t2v id already priced off the i2v table
        // (T2V_CREDIT_OVERRIDES), so the re-route changes no charge.
        expect(result.modelIdentifier).toMatch(/^grok-i2v/)
      }
    })

    it("keeps Grok Imagine 1 on the t2v path when nothing is wired", () => {
      const result = buildPayload(gv("grok-i2v"), JOB_ID, {}, undefined, ctx(gv("grok-i2v")))
      expect(result.jobName).toBe("text-to-video")
      expect(result.payload.provider).toBe("grok")
    })

    it("keeps gemini-omni-video on the t2v path with reference images forwarded", () => {
      const n = gv("gemini-omni-video")
      const inputs: ResolvedInputs = {
        referenceImageUrls: ["https://cdn.example/ref-1.png"],
      }
      const result = buildPayload(n, JOB_ID, inputs, undefined, ctx(n))
      expect(result.jobName).toBe("text-to-video")
      expect(result.payload.referenceImageUrls).toEqual(["https://cdn.example/ref-1.png"])
    })
  })
})

describe("payload-builder.gemini.test.ts", () => {
  /**
   * Gemini Omni family dispatch in the unified `generate-video` payload-builder case.
   *
   * Tests:
   * 1. A connected source video (referenceVideoUrls) routes through the
   *    image-to-video worker path (effectiveMode = "image-to-video") — for EVERY
   *    member of the family, not just the id the branch was written for.
   * 2. videoTrimStart / videoTrimEnd are threaded into the payload.
   */
  function node(id: string, type: string, data: Record<string, unknown> = {}): SimpleNode {
    return { id, type, data }
  }

  function gv(provider: string, data: Record<string, unknown> = {}): SimpleNode {
    return node("gv-1", "generate-video", {
      provider,
      prompt: "edit this video to look cinematic",
      duration: 8,
      ...data,
    })
  }

  const JOB_ID = "job-gemini-1"

  describe("Gemini Omni Video dispatch in generate-video", () => {
    it("routes through image-to-video path when a reference video is connected", () => {
      const n = gv("gemini-omni-video")
      const inputs: ResolvedInputs = {
        referenceVideoUrls: ["https://cdn.example/source.mp4"],
      }
      const result = buildPayload(n, JOB_ID, inputs, undefined, { nodes: [n], edges: [], nodeStates: {} })
      expect(result.jobName).toBe("image-to-video")
    })

    it("threads videoTrimStart and videoTrimEnd into the payload", () => {
      const n = gv("gemini-omni-video", { videoTrimStart: 1, videoTrimEnd: 9 })
      const inputs: ResolvedInputs = {
        referenceVideoUrls: ["https://cdn.example/source.mp4"],
      }
      const result = buildPayload(n, JOB_ID, inputs, undefined, { nodes: [n], edges: [], nodeStates: {} })
      expect(result.payload.videoTrimStart).toBe(1)
      expect(result.payload.videoTrimEnd).toBe(9)
    })

    it("uses text-to-video path when no reference video is connected (normal T2V)", () => {
      const n = gv("gemini-omni-video")
      const inputs: ResolvedInputs = {}
      const result = buildPayload(n, JOB_ID, inputs, undefined, { nodes: [n], edges: [], nodeStates: {} })
      expect(result.jobName).toBe("text-to-video")
      // No trim fields on the node → absent in payload
      expect(result.payload.videoTrimStart).toBeUndefined()
      expect(result.payload.videoTrimEnd).toBeUndefined()
    })

    it("non-gemini provider with video ref uses text-to-video path (no effectiveMode override)", () => {
      // e.g. kling with a referenceVideoUrl should NOT be forced to image-to-video
      // unless it also has a start frame — the effectiveMode only diverges for gemini.
      const n = gv("kling")
      const inputs: ResolvedInputs = {
        referenceVideoUrls: ["https://cdn.example/ref.mp4"],
      }
      const result = buildPayload(n, JOB_ID, inputs, undefined, { nodes: [n], edges: [], nodeStates: {} })
      // No startFrame → mode = text-to-video, effectiveMode stays text-to-video
      expect(result.jobName).toBe("text-to-video")
    })

    it("routes gemini-omni-flash through the same V2V path (family predicate, not a literal)", () => {
      // The V2V swap is keyed off isGeminiOmniProvider, so a new Omni SKU
      // inherits it. A literal `=== "gemini-omni-video"` here would enqueue the
      // t2v handler for flash and build the credit identifier with nodeType
      // "text-to-video" instead of the i2v-category :vref row.
      const n = gv("gemini-omni-flash")
      const inputs: ResolvedInputs = {
        referenceVideoUrls: ["https://cdn.example/source.mp4"],
      }
      const result = buildPayload(n, JOB_ID, inputs, undefined, { nodes: [n], edges: [], nodeStates: {} })
      expect(result.jobName).toBe("image-to-video")
      expect(result.modelIdentifier).toBe("gemini-omni-flash:vref")
    })

    it("gemini-omni-flash with no source video stays on the t2v path", () => {
      const n = gv("gemini-omni-flash")
      const result = buildPayload(n, JOB_ID, {}, undefined, { nodes: [n], edges: [], nodeStates: {} })
      expect(result.jobName).toBe("text-to-video")
      expect(result.modelIdentifier).toBe("gemini-omni-flash:8")
    })

    it("includes referenceVideoUrls in the payload", () => {
      const n = gv("gemini-omni-video")
      const inputs: ResolvedInputs = {
        referenceVideoUrls: ["https://cdn.example/source.mp4"],
      }
      const result = buildPayload(n, JOB_ID, inputs, undefined, { nodes: [n], edges: [], nodeStates: {} })
      expect(result.payload.referenceVideoUrls).toEqual(["https://cdn.example/source.mp4"])
    })
  })
})

describe("payload-builder.wan3.test.ts", () => {
  /**
   * Wan 3.0 / Wan 3.0 Prime UI-default fills in the payload builder.
   *
   * The Wan config panel RENDERS `adaptive` + 720p defaults without persisting
   * them to node data, so an untouched node submits aspectRatio / resolution
   * undefined. The builder fills them so the enqueued job row (and the
   * /v1/jobs echo) states what actually renders.
   *
   * The load-bearing assertion is the RESOLUTION: Wan's catalog `resolutions`
   * are ascending (`["480p","720p","1080p"]`), so an `opts[0]` / `resolutions[0]`
   * fill would write 480p — while `runWan3` renders 720P and the credit
   * identifier bills the 720p tier. The fill must therefore come from
   * PRICING_DEFAULT_RESOLUTION, the same declaration billing reads.
   */
  const JOB_ID = "job-wan3-1"
  const WAN = ["wan-3", "wan-3-prime"] as const

  function n(type: string, provider: string, data: Record<string, unknown> = {}): SimpleNode {
    return { id: "wan-1", type, data: { provider, prompt: "a slow dolly across a rainy street", ...data } }
  }

  function build(node: SimpleNode, inputs: ResolvedInputs = {}) {
    return buildPayload(node, JOB_ID, inputs, undefined, { nodes: [node], edges: [], nodeStates: {} })
  }

  describe("Wan 3.0 payload-builder defaults", () => {
    it("the catalog list is ascending, so index 0 is NOT the billed default", () => {
      // Guards the reason this fill exists at all: if someone ever reorders the
      // catalog to smuggle the default in via position, this fails loudly rather
      // than the fill silently agreeing with a wrong number.
      for (const p of WAN) {
        expect(MODEL_CATALOG[p]?.resolutions?.[0], p).toBe("480p")
        expect(PRICING_DEFAULT_RESOLUTION[p], p).toBe("720p")
      }
    })

    for (const p of WAN) {
      it(`${p}: generate-video fills adaptive + the DECLARED 720p default`, () => {
        const r = build(n("generate-video", p))
        expect(r.payload.aspectRatio).toBe("adaptive")
        expect(r.payload.resolution).toBe("720p")
      })

      it(`${p}: the filled resolution is the tier the reservation bills`, () => {
        const r = build(n("generate-video", p))
        // Same composite whether the request states 720p or omits it entirely —
        // render == billed for an intent-less run.
        expect(r.modelIdentifier).toBe(
          buildVideoCreditModelIdentifier(p, undefined, undefined, "text-to-video", undefined, undefined, undefined),
        )
        expect(r.modelIdentifier).toContain(":720p")
      })

      it(`${p}: an explicit node value always wins over the fill`, () => {
        const r = build(n("generate-video", p, { aspectRatio: "9:16", resolution: "1080p", duration: 8 }))
        expect(r.payload.aspectRatio).toBe("9:16")
        expect(r.payload.resolution).toBe("1080p")
      })

      it(`${p}: the legacy standalone t2v / i2v nodes fill the same values`, () => {
        const t2v = build(n("text-to-video", p))
        expect(t2v.payload.aspectRatio).toBe("adaptive")
        expect(t2v.payload.resolution).toBe("720p")

        const i2v = build(n("image-to-video", p), { imageUrl: "https://cdn.example/first.png" })
        expect(i2v.payload.aspectRatio).toBe("adaptive")
        expect(i2v.payload.resolution).toBe("720p")
      })
    }

    it("providers with no declared default keep their historical fill", () => {
      // seedance-2 has no PRICING_DEFAULT_RESOLUTION row, so it must still get
      // its first catalog tier — the wan branch cannot reprice anything live.
      const r = build(n("generate-video", "seedance-2"))
      expect(r.payload.aspectRatio).toBe("adaptive")
      expect(r.payload.resolution).toBe(MODEL_CATALOG["seedance-2"]?.resolutions?.[0])
      // ...and a provider outside both families gets no fill at all.
      const kling = build(n("generate-video", "kling"))
      expect(kling.payload.aspectRatio).toBeUndefined()
      expect(kling.payload.resolution).toBeUndefined()
    })
  })
})

describe("payload-builder.vidu-q4.test.ts", () => {
  /**
   * Vidu Q4 in the DAG payload builder.
   *
   * - Its catalog `resolutions` are ascending (540p first) while it renders and
   *   bills 720p by default, so an untouched node must be filled with the
   *   DECLARED 720p default and 5s — never index 0.
   * - It has no text-to-video mode: a run with nothing wired fails with the
   *   image-required message before any jobs row exists.
   * - Its reference endpoint needs a prompt and an image: an empty prompt (or
   *   reference audio with no image) is refused HERE, before the reservation,
   *   rather than by the provider after it.
   */
  const JOB_ID = "job-vidu-1"
  const START = "https://cdn.example/start.png"

  function n(type: string, data: Record<string, unknown> = {}): SimpleNode {
    return { id: "vidu-1", type, data: { provider: "vidu-q4", prompt: "the astronaut waves", ...data } }
  }

  function build(node: SimpleNode, inputs: ResolvedInputs = {}) {
    return buildPayload(node, JOB_ID, inputs, undefined, { nodes: [node], edges: [], nodeStates: {} })
  }

  describe("Vidu Q4 payload-builder", () => {
    it("generate-video with a start frame runs image-to-video at the declared 5s / 720p defaults", () => {
      const r = build(n("generate-video"), { startFrameUrl: START })
      expect(r.jobName).toBe("image-to-video")
      expect(r.payload.provider).toBe("vidu-q4")
      expect(r.payload.resolution).toBe("720p")
      expect(r.modelIdentifier).toBe("vidu-q4:5s:720p")
      expect(r.modelIdentifier).toBe(buildVideoCreditModelIdentifier("vidu-q4", undefined, undefined, "image-to-video"))
    })

    it("an explicit node value wins, and an uppercase 4K bills the 4k row", () => {
      const r = build(n("generate-video", { resolution: "4K", duration: 12 }), { startFrameUrl: START })
      expect(r.payload.resolution).toBe("4k")
      expect(r.modelIdentifier).toBe("vidu-q4:12s:4k")
    })

    it("a start frame plus references stays one job on the same ladder (no -ref dimension)", () => {
      const r = build(n("generate-video", { resolution: "1080p", duration: 6 }), {
        startFrameUrl: START,
        referenceImageUrls: ["https://cdn.example/r1.png"],
        referenceAudioUrls: ["https://cdn.example/voice.mp3"],
      })
      expect(r.jobName).toBe("image-to-video")
      expect(r.payload.imageUrl).toBe(START)
      expect(r.payload.referenceImageUrls).toEqual(["https://cdn.example/r1.png"])
      expect(r.payload.referenceAudioUrls).toEqual(["https://cdn.example/voice.mp3"])
      expect(r.modelIdentifier).toBe("vidu-q4:6s:1080p")
    })

    it("nothing wired is the image-required refusal (no text-to-video mode)", () => {
      expect(() => build(n("generate-video"))).toThrow(/image|frame/i)
    })

    it("references with an EMPTY prompt are refused before any job exists", () => {
      expect(() =>
        build(n("generate-video", { prompt: "" }), {
          startFrameUrl: START,
          referenceImageUrls: ["https://cdn.example/r1.png"],
        }),
      ).toThrow(/needs a prompt/)
    })

    it("a frame-only run with an empty prompt is legal (the prompt is optional there)", () => {
      const r = build(n("generate-video", { prompt: "" }), { startFrameUrl: START })
      expect(r.jobName).toBe("image-to-video")
    })

    it("reference audio with no image anywhere is refused", () => {
      expect(() =>
        build(n("image-to-video"), { referenceAudioUrls: ["https://cdn.example/voice.mp3"] }),
      ).toThrow(/needs a start frame or at least one reference image/)
    })
  })
})
