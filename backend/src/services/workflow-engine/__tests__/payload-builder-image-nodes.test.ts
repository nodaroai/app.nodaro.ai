/**
 * buildPayload: the image nodes (collage, lever snap, inpaint, the Auto
 * aspect ratio).
 *
 * Merged from 5 test files (CI test de-duplication, plan §5.7 B) so the
 * workflow-engine module graph loads once instead of 5 times. Each original
 * file is one top-level describe named after it, with its own helpers, setup
 * and teardown; test names and assertions are unchanged.
 */
import { describe, it, expect, vi, afterEach } from "vitest"
import { buildPayload, type PayloadBuildContext } from "../payload-builder.js"
import type { SimpleNode, ResolvedInputs, NodeExecutionState, SimpleEdge } from "../types.js"
import { buildCreditModelIdentifier } from "@nodaro/shared/credits"
import { FLUX_LORA_CHARACTER_MODEL_ID, IMAGE_GEN_PROVIDERS } from "@nodaro/shared/models"
import { MODEL_CATALOG, autoAspectNeedsSourceImage, normalizeModelInput } from "@nodaro/shared/model-catalog"
import { SOURCE_IMAGE_NODE_TYPES, PHOTO_AUTO_ASPECT_NODE_TYPES } from "@nodaro/shared/nodes"
import { autoAspectSourceImageUrl, generateImageMayUsePhotoSize } from "../source-image.js"

describe("payload-builder-image-collage.test.ts", () => {
  /**
   * Payload-builder tests for the `image-collage` ordering + size-hint seam.
   *
   * The config panel's Connected Images list persists a user ordering as
   * `data.imageOrder` (SOURCE NODE IDS — the `in` handle's parallel order
   * field) and per-input size hints as `data.imageSizeBySource`. buildPayload
   * aligns both to the accumulated wire order via
   * `resolvedInputs.imageUrlsWithSourceIds`. Unlike combine-videos' clipOrder,
   * ONE collage source can contribute SEVERAL images (a List) — a listed
   * source moves ALL its entries as a contiguous block. These tests pin that
   * contract (mirrored in frontend execute-node.ts).
   */
  function node(id: string, data: Record<string, unknown> = {}): SimpleNode {
    return { id, type: "image-collage", data }
  }

  const A1 = "https://media.nodaro.ai/a1.png"
  const B1 = "https://media.nodaro.ai/b1.png"
  const L1 = "https://media.nodaro.ai/l1.png"
  const L2 = "https://media.nodaro.ai/l2.png"

  /** Two single-image producers + one List contributing two images. */
  const WIRE = {
    imageUrls: [A1, L1, L2, B1],
    imageUrlsWithSourceIds: [
      { nodeId: "srcA", url: A1 },
      { nodeId: "list", url: L1 },
      { nodeId: "list", url: L2 },
      { nodeId: "srcB", url: B1 },
    ],
  }

  describe("buildPayload — image-collage ordering + size hints", () => {
    it("keeps wire order when no imageOrder is configured", () => {
      const result = buildPayload(node("c1"), "job1", { ...WIRE }, "usage1")
      expect(result.payload.imageUrls).toEqual([A1, L1, L2, B1])
      expect(result.payload.imageSizes).toBeUndefined()
    })

    it("applies imageOrder with a List source moving as ONE contiguous block", () => {
      const n = node("c1", { imageOrder: ["srcB", "list", "srcA"] })
      const result = buildPayload(n, "job1", { ...WIRE }, "usage1")
      expect(result.payload.imageUrls).toEqual([B1, L1, L2, A1])
    })

    it("appends sources missing from imageOrder in wire order", () => {
      const n = node("c1", { imageOrder: ["srcB"] })
      const result = buildPayload(n, "job1", { ...WIRE }, "usage1")
      expect(result.payload.imageUrls).toEqual([B1, A1, L1, L2])
    })

    it("size hints follow their source through the reorder", () => {
      const n = node("c1", {
        imageOrder: ["list", "srcA", "srcB"],
        imageSizeBySource: { srcA: 1, list: 3 },
      })
      const result = buildPayload(n, "job1", { ...WIRE }, "usage1")
      expect(result.payload.imageUrls).toEqual([L1, L2, A1, B1])
      // list images small (3,3), srcA big (1), srcB unset → auto (0)
      expect(result.payload.imageSizes).toEqual([3, 3, 1, 0])
    })

    it("ignores stale ids (disconnected sources) in imageOrder", () => {
      const n = node("c1", { imageOrder: ["gone", "srcB", "list", "srcA"] })
      const result = buildPayload(n, "job1", { ...WIRE }, "usage1")
      expect(result.payload.imageUrls).toEqual([B1, L1, L2, A1])
    })

    it("leaves order untouched when imageUrlsWithSourceIds is absent or misaligned", () => {
      const n = node("c1", { imageOrder: ["srcB", "srcA"] })
      const noIds = buildPayload(n, "job1", { imageUrls: [A1, B1] }, "usage1")
      expect(noIds.payload.imageUrls).toEqual([A1, B1])
      const misaligned = buildPayload(
        n,
        "job1",
        { imageUrls: [A1, B1], imageUrlsWithSourceIds: [{ nodeId: "srcA", url: A1 }] },
        "usage1",
      )
      expect(misaligned.payload.imageUrls).toEqual([A1, B1])
    })
  })

  describe("buildPayload — image-collage storyboard badges (numbered + labels)", () => {
    it("omits numbered unless explicitly true", () => {
      expect(buildPayload(node("c1"), "job1", { ...WIRE }, "usage1").payload.numbered).toBeUndefined()
      expect(
        buildPayload(node("c1", { numbered: false }), "job1", { ...WIRE }, "usage1").payload.numbered,
      ).toBeUndefined()
      expect(
        buildPayload(node("c1", { numbered: true }), "job1", { ...WIRE }, "usage1").payload.numbered,
      ).toBe(true)
    })

    it("labels follow their source through the reorder (List label duplicates onto both entries)", () => {
      const n = node("c1", {
        imageOrder: ["list", "srcA", "srcB"],
        imageLabelBySource: { srcA: "Alpha", list: "Loop", srcB: "Bravo" },
      })
      const result = buildPayload(n, "job1", { ...WIRE }, "usage1")
      expect(result.payload.imageUrls).toEqual([L1, L2, A1, B1])
      // List's "Loop" duplicates onto BOTH of its images.
      expect(result.payload.imageLabels).toEqual(["Loop", "Loop", "Alpha", "Bravo"])
    })

    it("trims, caps at 80 chars, and maps empty/whitespace to null", () => {
      const n = node("c1", {
        imageLabelBySource: { srcA: "  Spaced  ", list: "y".repeat(100), srcB: "   " },
      })
      const result = buildPayload(n, "job1", { ...WIRE }, "usage1")
      const labels = result.payload.imageLabels as (string | null)[]
      expect(labels[0]).toBe("Spaced")
      expect(labels[1]).toBe("y".repeat(80))
      expect(labels[2]).toBe("y".repeat(80))
      expect(labels[3]).toBeNull() // srcB whitespace-only → null
    })

    it("uses the raw index-aligned data.imageLabels path when there is no bySource map", () => {
      const n = node("c1", { imageLabels: ["A", "", "C", null] })
      const result = buildPayload(n, "job1", { ...WIRE }, "usage1")
      expect(result.payload.imageLabels).toEqual(["A", null, "C", null])
    })

    it("omits imageLabels entirely when every entry is empty/null", () => {
      const n = node("c1", { imageLabelBySource: { srcA: "", list: "   ", srcB: "" } })
      const result = buildPayload(n, "job1", { ...WIRE }, "usage1")
      expect(result.payload.imageLabels).toBeUndefined()
    })
  })

  describe("buildPayload — image-collage badgePosition", () => {
    it("forwards a known corner and omits anything else (route Zod is bypassed here)", () => {
      expect(buildPayload(node("c1", { badgePosition: "top-right" }), "job1", { ...WIRE }, "usage1").payload.badgePosition).toBe("top-right")
      expect(buildPayload(node("c1", { badgePosition: "top-left" }), "job1", { ...WIRE }, "usage1").payload.badgePosition).toBe("top-left")
      expect(buildPayload(node("c1"), "job1", { ...WIRE }, "usage1").payload.badgePosition).toBeUndefined()
      expect(buildPayload(node("c1", { badgePosition: "bottom-right" }), "job1", { ...WIRE }, "usage1").payload.badgePosition).toBeUndefined()
    })
  })
})

describe("payload-builder-image-lever-snap.test.ts", () => {
  /**
   * Last-mile catalog snap on the DAG image branches.
   *
   * `resolveImageGenCreditIdentifier` prices off the SNAPPED levers (the snap
   * lives inside the credit primitive — see credit-identifiers.ts). So a branch
   * that hands it RAW `data.resolution` / `data.quality` and then ALSO puts those
   * raw values in the queue payload reserves one tier and renders another, with
   * no upward true-up to correct it. `generate-image` and `image-to-image`
   * already normalize first and send the snapped pair; these tests pin the same
   * invariant for `modify-image` and `edit-image`:
   *
   *   the lever in the payload === the lever the identifier was priced on.
   *
   * They also pin that a catalog-VALID node is byte-identical to the pre-snap
   * behaviour, so the guard can never become a silent rewrite.
   */

  function node(id: string, type: string, data: Record<string, unknown> = {}): SimpleNode {
    return { id, type, data }
  }

  const jobId = "job-1"

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe("buildPayload — modify-image lever snap", () => {
    it("snaps a quality the model does not accept, and pays for the snapped one", () => {
      // gpt-image declares qualities ["medium", "high"] and ratios 1:1/3:2/2:3.
      const result = buildPayload(
        node("m1", "modify-image", { prompt: "x", provider: "gpt-image", aspectRatio: "16:9", quality: "basic" }),
        jobId,
        { imageUrl: "https://r2.nodaro.ai/in.png" },
      )
      expect(result.payload.quality).toBe("medium")
      expect(result.payload.aspectRatio).toBe("1:1")
      // "medium" is the base tier -> no composite. The payload says medium too.
      expect(result.modelIdentifier).toBe("gpt-image")
    })

    it("keeps a declared quality and its composite price (payload === priced lever)", () => {
      const result = buildPayload(
        node("m2", "modify-image", { prompt: "x", provider: "gpt-image", quality: "high" }),
        jobId,
        { imageUrl: "https://r2.nodaro.ai/in.png" },
      )
      expect(result.payload.quality).toBe("high")
      expect(result.modelIdentifier).toBe("gpt-image:high")
    })

    it("drops a resolution the model does not have instead of forwarding it", () => {
      // nano-banana has no resolution lever at all.
      const result = buildPayload(
        node("m3", "modify-image", { prompt: "x", provider: "nano-banana", resolution: "2K" }),
        jobId,
        { imageUrl: "https://r2.nodaro.ai/in.png" },
      )
      expect(result.payload.resolution).toBeUndefined()
      expect(result.modelIdentifier).toBe("nano-banana")
    })

    it("leaves a catalog-valid node's levers byte-identical", () => {
      const result = buildPayload(
        node("m4", "modify-image", { prompt: "x", provider: "nano-banana-pro", aspectRatio: "16:9", resolution: "4K" }),
        jobId,
        { imageUrl: "https://r2.nodaro.ai/in.png" },
      )
      expect(result.payload.aspectRatio).toBe("16:9")
      expect(result.payload.resolution).toBe("4K")
      expect(result.modelIdentifier).toBe("nano-banana-pro:4K")
    })

    it("snaps the nano-banana-edit sub-branch's ratio too (same case, other arm)", () => {
      const result = buildPayload(
        node("m5", "modify-image", { prompt: "x", provider: "nano-banana-edit", aspectRatio: "8:1" }),
        jobId,
        { imageUrl: "https://r2.nodaro.ai/in.png" },
      )
      // 8:1 is off-list for nano-banana-edit -> snapped to its first ratio.
      expect(result.payload.aspectRatio).toBe("1:1")
      expect(result.jobName).toBe("edit-image")
    })
  })

  describe("buildPayload — edit-image lever snap", () => {
    it("drops a ratio the upscalers do not have, leaving the price untouched", () => {
      const result = buildPayload(
        node("e1", "edit-image", { provider: "recraft-upscale", aspectRatio: "16:9", targetResolution: "4K" }),
        jobId,
        { imageUrl: "https://r2.nodaro.ai/in.png" },
      )
      expect(result.payload.aspectRatio).toBeUndefined()
      // `targetResolution` is the pricing lever here and is NOT a catalog
      // `resolutions` value — the snap must not touch it.
      expect(result.payload.targetResolution).toBe("4K")
      expect(result.modelIdentifier).toBe(
        buildCreditModelIdentifier("recraft-upscale", undefined, undefined, undefined, "4K"),
      )
      expect(result.modelIdentifier).toBe("recraft-upscale")
    })

    it("keeps a ratio nano-banana-edit declares", () => {
      const result = buildPayload(
        node("e2", "edit-image", { provider: "nano-banana-edit", prompt: "make it night", aspectRatio: "21:9" }),
        jobId,
        { imageUrl: "https://r2.nodaro.ai/in.png" },
      )
      expect(result.payload.aspectRatio).toBe("21:9")
      expect(result.modelIdentifier).toBe("nano-banana-edit")
    })
  })
})

describe("payload-builder-inpaint.test.ts", () => {
  // ---------------------------------------------------------------------------
  // Helpers (mirrors payload-builder.test.ts)
  // ---------------------------------------------------------------------------

  function node(id: string, type: string, data: Record<string, unknown> = {}): SimpleNode {
    return { id, type, data }
  }

  // ---------------------------------------------------------------------------
  // generate-image inpaint fields — must be carried through the orchestrator
  // payload identically to the single-node /v1/generate-image route so a whole
  // workflow run produces the same payload as a solo node run.
  // ---------------------------------------------------------------------------

  describe("buildPayload — generate-image inpaint fields", () => {
    const jobId = "job-1"

    it("carries baseImageUrl, maskUrl, strength, guidanceScale from node data", () => {
      const n = node("n1", "generate-image", {
        prompt: "x",
        provider: "gpt-image-2",
        baseImageUrl: "https://r2/b.png",
        maskUrl: "https://r2/m.png",
        strength: 0.6,
        guidanceScale: 8,
      })
      const result = buildPayload(n, jobId, {})
      expect(result.payload.baseImageUrl).toBe("https://r2/b.png")
      expect(result.payload.maskUrl).toBe("https://r2/m.png")
      expect(result.payload.strength).toBe(0.6)
      expect(result.payload.guidanceScale).toBe(8)
    })

    it("prefers wired resolvedInputs over node data for baseImageUrl and maskUrl", () => {
      const n = node("n1", "generate-image", {
        prompt: "x",
        baseImageUrl: "https://r2/data-base.png",
        maskUrl: "https://r2/data-mask.png",
      })
      const inputs: ResolvedInputs = {
        baseImageUrl: "https://r2/wired-base.png",
        maskUrl: "https://r2/wired-mask.png",
      }
      const result = buildPayload(n, jobId, inputs)
      expect(result.payload.baseImageUrl).toBe("https://r2/wired-base.png")
      expect(result.payload.maskUrl).toBe("https://r2/wired-mask.png")
    })

    it("leaves inpaint fields undefined when absent (non-inpaint generate)", () => {
      const n = node("n1", "generate-image", { prompt: "x" })
      const result = buildPayload(n, jobId, {})
      expect(result.payload.baseImageUrl).toBeUndefined()
      expect(result.payload.maskUrl).toBeUndefined()
      expect(result.payload.strength).toBeUndefined()
      expect(result.payload.guidanceScale).toBeUndefined()
    })
  })
})

describe("payload-builder-auto-aspect-source.test.ts", () => {
  /**
   * "auto" on a model without a native auto keeps the source photo's shape in a
   * workflow run exactly as on the image routes: node-executor reads the size of
   * the url `autoAspectSourceImageUrl` names, and every branch that sends a source
   * image normalizes with it (`PayloadBuildContext.sourceImage`).
   */

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const SOURCE = "https://cdn.example.com/source.png"
  const landscape = { width: 1920, height: 1080 }

  function node(type: string, data: Record<string, unknown>, id = "n1"): SimpleNode {
    return { id, type, data }
  }

  /** Every source-image node type, and both arms of modify-image. */
  const BRANCHES: ReadonlyArray<{ type: string; provider: string; jobName: string }> = [
    { type: "image-to-image", provider: "seedream-5-pro-i2i", jobName: "image-to-image" },
    { type: "modify-image", provider: "seedream-5-pro-i2i", jobName: "image-to-image" },
    { type: "modify-image", provider: "nano-banana-edit", jobName: "edit-image" },
    { type: "edit-image", provider: "nano-banana-edit", jobName: "edit-image" },
  ]

  describe("buildPayload — 'auto' with a source image", () => {
    it("covers every source-image node type", () => {
      expect(new Set(BRANCHES.map((b) => b.type))).toEqual(new Set(SOURCE_IMAGE_NODE_TYPES))
    })

    for (const b of BRANCHES) {
      it(`${b.type} on ${b.provider}: becomes the ratio nearest the source`, () => {
        vi.spyOn(console, "warn").mockImplementation(() => {})
        const result = buildPayload(
          node(b.type, { provider: b.provider, prompt: "make it dusk", aspectRatio: "auto" }),
          "job-1",
          { imageUrl: SOURCE },
          undefined,
          { sourceImage: landscape },
        )
        expect(result.jobName).toBe(b.jobName)
        expect(result.payload.aspectRatio).toBe("16:9")
        expect(result.payload.imageUrl).toBe(SOURCE)
      })

      it(`${b.type} on ${b.provider}: keeps today's fallback without a source size`, () => {
        vi.spyOn(console, "warn").mockImplementation(() => {})
        const result = buildPayload(
          node(b.type, { provider: b.provider, prompt: "make it dusk", aspectRatio: "auto" }),
          "job-1",
          { imageUrl: SOURCE },
        )
        expect(result.payload.aspectRatio).toBe(MODEL_CATALOG[b.provider]!.aspectRatios![0])
      })
    }

    it("never moves the price", () => {
      vi.spyOn(console, "warn").mockImplementation(() => {})
      const data = { provider: "seedream-5-pro-i2i", prompt: "x", aspectRatio: "auto", quality: "high" }
      const withSize = buildPayload(node("image-to-image", data), "job-1", { imageUrl: SOURCE }, undefined, { sourceImage: landscape })
      const without = buildPayload(node("image-to-image", data), "job-1", { imageUrl: SOURCE })
      expect(withSize.modelIdentifier).toBe(without.modelIdentifier)
      expect(withSize.modelIdentifier).toBe("seedream-5-pro-i2i:high")
    })

    it("passes a native 'auto' through untouched", () => {
      const result = buildPayload(
        node("image-to-image", { provider: "gpt-image-2-i2i", prompt: "x", aspectRatio: "auto" }),
        "job-1",
        { imageUrl: SOURCE },
        undefined,
        { sourceImage: landscape },
      )
      expect(result.payload.aspectRatio).toBe("auto")
    })

  })

  /**
   * Generate Image: the photo is the first image the build sends (the first
   * assembled reference, or the inpaint / refine base); `buildPayloadWithSourceSize`
   * reads its size and hands it in. With no photo, "auto" snaps exactly as before.
   */
  describe("buildPayload — Generate Image, 'auto' and a wired photo", () => {
    const gen = (data: Record<string, unknown>, id = "g1") => node("generate-image", { prompt: "a lighthouse", ...data }, id)
    const todays = (modelId: string) => normalizeModelInput(modelId, { aspectRatio: "auto" }).aspectRatio

    it("uses the ratio nearest the photo when its size is handed in", () => {
      vi.spyOn(console, "warn").mockImplementation(() => {})
      const result = buildPayload(gen({ provider: "seedream-5-pro", aspectRatio: "auto" }), "job-1", { referenceImageUrls: [SOURCE] }, undefined, { sourceImage: landscape })
      expect((result.payload.referenceImageUrls as string[])[0]).toBe(SOURCE)
      expect(result.payload.aspectRatio).toBe("16:9")
    })

    it("snaps exactly as before without a size", () => {
      vi.spyOn(console, "warn").mockImplementation(() => {})
      const result = buildPayload(gen({ provider: "seedream-5-pro", aspectRatio: "auto" }), "job-1", { referenceImageUrls: [SOURCE] })
      expect(result.payload.aspectRatio).toBe(MODEL_CATALOG["seedream-5-pro"]!.aspectRatios![0])
    })

    it("never moves the price", () => {
      vi.spyOn(console, "warn").mockImplementation(() => {})
      const data = { provider: "seedream-5-pro", aspectRatio: "auto", quality: "high" }
      const withSize = buildPayload(gen(data), "job-1", { referenceImageUrls: [SOURCE] }, undefined, { sourceImage: landscape })
      const without = buildPayload(gen(data), "job-1", { referenceImageUrls: [SOURCE] })
      expect(withSize.modelIdentifier).toBe(without.modelIdentifier)
    })

    /** NO PROVIDER EVER RECEIVES "auto" IT CANNOT TAKE — every Generate Image model without one. */
    it("no photo: every model without a native auto is sent today's snapped ratio", () => {
      vi.spyOn(console, "warn").mockImplementation(() => {})
      const failures: string[] = []
      for (const provider of IMAGE_GEN_PROVIDERS.filter((p) => autoAspectNeedsSourceImage(p, "auto"))) {
        const sent = buildPayload(gen({ provider, aspectRatio: "auto" }), "job-1", {}).payload.aspectRatio
        if (sent === "auto" || sent !== todays(provider)) failures.push(`${provider} → ${String(sent)}`)
      }
      expect(failures).toEqual([])
    })

    /**
     * A LoRA run swaps to the trained character model, which has no catalog
     * entry and takes no "auto". A native-auto node model keeps "auto" through
     * the snap, so the LoRA arm itself must not forward it.
     */
    describe("the LoRA arm", () => {
      const character = node("character", {
        characterName: "Kira",
        sourceImageUrl: "https://cdn.example.com/kira.png",
        loraReplicateVersion: "owner/char-kira:abc",
        loraTriggerWord: "TOK_kira",
        loraTrainingStatus: "succeeded",
      }, "c1")
      const edges: SimpleEdge[] = [{ id: "e1", source: "c1", target: "g1", sourceHandle: "character" }]
      const lora = (data: Record<string, unknown>) => {
        const g = gen(data)
        return buildPayload(g, "job-1", {}, undefined, { nodes: [character, g], edges, nodeStates: {} })
      }

      it("never sends 'auto' to the trained model", () => {
        vi.spyOn(console, "warn").mockImplementation(() => {})
        const result = lora({ provider: "gpt-image-2", aspectRatio: "auto" })
        expect(result.payload.model).toBe(FLUX_LORA_CHARACTER_MODEL_ID)
        expect(result.payload.aspectRatio).toBeUndefined()
      })

      it("sends today's snapped ratio for a model without a native auto, and any concrete ratio as is", () => {
        vi.spyOn(console, "warn").mockImplementation(() => {})
        expect(lora({ provider: "seedream-5-pro", aspectRatio: "auto" }).payload.aspectRatio).toBe(todays("seedream-5-pro"))
        expect(lora({ provider: "seedream-5-pro", aspectRatio: "16:9" }).payload.aspectRatio).toBe("16:9")
      })
    })
  })

  describe("autoAspectSourceImageUrl", () => {
    it("names the wired source image when the size will be used", () => {
      expect(
        autoAspectSourceImageUrl(node("image-to-image", { provider: "seedream-5-pro-i2i", aspectRatio: "auto" }), { imageUrl: SOURCE }),
      ).toBe(SOURCE)
      expect(
        autoAspectSourceImageUrl(node("modify-image", { provider: "nano-banana-edit", aspectRatio: "auto" }), { imageUrl: SOURCE }),
      ).toBe(SOURCE)
      // A stored image counts when nothing is wired.
      expect(
        autoAspectSourceImageUrl(node("edit-image", { provider: "nano-banana-edit", aspectRatio: "auto", imageUrl: SOURCE }), {}),
      ).toBe(SOURCE)
    })

    it("names nothing when the size would not be used", () => {
      const inputs = { imageUrl: SOURCE }
      // A native auto, a concrete ratio, a type with no source photo, no image at all.
      expect(autoAspectSourceImageUrl(node("image-to-image", { provider: "gpt-image-2-i2i", aspectRatio: "auto" }), inputs)).toBeUndefined()
      expect(autoAspectSourceImageUrl(node("image-to-image", { provider: "seedream-5-pro-i2i", aspectRatio: "16:9" }), inputs)).toBeUndefined()
      expect(autoAspectSourceImageUrl(node("generate-image", { provider: "seedream-5-pro", aspectRatio: "auto" }), inputs)).toBeUndefined()
      expect(autoAspectSourceImageUrl(node("image-to-image", { provider: "seedream-5-pro-i2i", aspectRatio: "auto" }), {})).toBeUndefined()
      // Each branch's own default model when the node names none: the edit
      // default has a native auto, and edit-image's default has no ratio lever.
      expect(autoAspectSourceImageUrl(node("modify-image", { aspectRatio: "auto" }), inputs)).toBeUndefined()
      expect(autoAspectSourceImageUrl(node("edit-image", { aspectRatio: "auto" }), inputs)).toBeUndefined()
    })

    /**
     * `connectedMediaOrder` can promote a wired reference to the main slot. The
     * size must be read from THAT image — the one the provider is sent — not from
     * whatever arrived on the `image` input.
     */
    it("follows a reorder to the image the payload sends", () => {
      const a = node("upload-image", {}, "a")
      const b = node("upload-image", {}, "b")
      const states: Record<string, NodeExecutionState> = {
        a: { status: "completed", output: { imageUrl: "https://cdn.example.com/a.png" } },
        b: { status: "completed", output: { imageUrl: "https://cdn.example.com/b.png" } },
      }
      const edges: SimpleEdge[] = [
        { id: "e1", source: "a", target: "t", targetHandle: "image" },
        { id: "e2", source: "b", target: "t", targetHandle: "image" },
      ]
      for (const b0 of BRANCHES) {
        const target = node(b0.type, { provider: b0.provider, prompt: "x", aspectRatio: "auto", connectedMediaOrder: ["b", "a"] }, "t")
        const inputs = { imageUrl: "https://cdn.example.com/a.png", referenceImageUrls: ["https://cdn.example.com/b.png"] }
        const ctx: PayloadBuildContext = { nodes: [a, b, target], edges, nodeStates: states }
        const url = autoAspectSourceImageUrl(target, inputs, ctx)
        expect(url, b0.type).toBe("https://cdn.example.com/b.png")
        vi.spyOn(console, "warn").mockImplementation(() => {})
        const result = buildPayload(target, "job-1", inputs, undefined, { ...ctx, sourceImage: landscape })
        expect(result.payload.imageUrl, b0.type).toBe(url)
      }
    })

    it("keeps each branch's reference list when the media is reordered", () => {
      const a = node("upload-image", {}, "a")
      const b = node("upload-image", {}, "b")
      const states: Record<string, NodeExecutionState> = {
        a: { status: "completed", output: { imageUrl: "https://cdn.example.com/a.png" } },
        b: { status: "completed", output: { imageUrl: "https://cdn.example.com/b.png" } },
      }
      const edges: SimpleEdge[] = [
        { id: "e1", source: "a", target: "t", targetHandle: "image" },
        { id: "e2", source: "b", target: "t", targetHandle: "image" },
      ]
      const inputs = { imageUrl: "https://cdn.example.com/a.png", referenceImageUrls: ["https://cdn.example.com/b.png"] }
      const edit = node("edit-image", { provider: "nano-banana-edit", prompt: "x", connectedMediaOrder: ["b", "a"] }, "t")
      const editResult = buildPayload(edit, "job-1", inputs, undefined, { nodes: [a, b, edit], edges, nodeStates: states })
      expect(editResult.payload.imageUrl).toBe("https://cdn.example.com/b.png")
      expect(editResult.payload.referenceImageUrls).toEqual(["https://cdn.example.com/a.png"])

      // No reorder: the edit branch sends no references of its own.
      const plain = node("edit-image", { provider: "nano-banana-edit", prompt: "x" }, "t")
      const plainResult = buildPayload(plain, "job-1", inputs, undefined, { nodes: [a, b, plain], edges, nodeStates: states })
      expect(plainResult.payload.imageUrl).toBe("https://cdn.example.com/a.png")
      expect(plainResult.payload.referenceImageUrls).toBeUndefined()
    })
  })
})

describe("payload-builder-unset-aspect-is-auto.test.ts", () => {
  /**
   * #2009 — on Generate Image and Modify Image an UNSET aspect ratio is Auto: the
   * dropdown shows Auto for it, so the run asks for "auto" too. It used to send
   * nothing, and the provider's own default (16:9 on nearly every model) drew a
   * 3:4 photo as 2752x1536.
   */

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const PHOTO = "https://cdn.example.com/portrait.jpg"
  const portrait = { width: 1536, height: 2048 }

  function node(type: string, data: Record<string, unknown>): SimpleNode {
    return { id: "n1", type, data: { label: type, prompt: "make it dusk", ...data } }
  }

  describe("an unset ratio runs as Auto on the photo-Auto nodes", () => {
    it("the photo-Auto nodes are Generate Image and Modify Image", () => {
      expect([...PHOTO_AUTO_ASPECT_NODE_TYPES].sort()).toEqual(["generate-image", "modify-image"])
    })

    it("Modify Image on a model with a native auto sends auto", () => {
      expect(MODEL_CATALOG["nano-banana-2-1"]!.aspectRatios).toContain("auto")
      const r = buildPayload(node("modify-image", { provider: "nano-banana-2-1" }), "job-1", { imageUrl: PHOTO })
      expect(r.payload.aspectRatio).toBe("auto")
    })

    it("Modify Image on a model without one keeps the photo's shape", () => {
      vi.spyOn(console, "warn").mockImplementation(() => {})
      const provider = "seedream-5-pro-i2i"
      expect(MODEL_CATALOG[provider]!.aspectRatios).not.toContain("auto")
      const n = node("modify-image", { provider })
      // The run reads the photo's size for it, as for a chosen Auto.
      expect(autoAspectSourceImageUrl(n, { imageUrl: PHOTO })).toBe(PHOTO)
      const r = buildPayload(n, "job-1", { imageUrl: PHOTO }, undefined, { sourceImage: portrait })
      expect(r.payload.aspectRatio).toBe("3:4")
    })

    it("the nano-banana-edit arm of Modify Image asks for auto too", () => {
      vi.spyOn(console, "warn").mockImplementation(() => {})
      const n = node("modify-image", { provider: "nano-banana-edit" })
      const r = buildPayload(n, "job-1", { imageUrl: PHOTO }, undefined, { sourceImage: portrait })
      expect(r.jobName).toBe("edit-image")
      expect(r.payload.aspectRatio).toBe("3:4")
    })

    it("Generate Image with no ratio sends auto on a model that lists it", () => {
      const r = buildPayload(node("generate-image", { provider: "nano-banana-2-1" }), "job-1", {})
      expect(r.payload.aspectRatio).toBe("auto")
    })

    it("Generate Image with no ratio and no photo sends the ratio its dropdown shows for Auto without one", () => {
      vi.spyOn(console, "warn").mockImplementation(() => {})
      const provider = "nano-banana-2"
      const r = buildPayload(node("generate-image", { provider }), "job-1", {})
      expect(r.payload.aspectRatio).toBe(MODEL_CATALOG[provider]!.aspectRatios![0])
      expect(generateImageMayUsePhotoSize(node("generate-image", { provider }))).toBe(true)
    })

    it("a chosen ratio is sent as chosen", () => {
      const r = buildPayload(node("modify-image", { provider: "nano-banana-2-1", aspectRatio: "9:16" }), "job-1", { imageUrl: PHOTO })
      expect(r.payload.aspectRatio).toBe("9:16")
    })

    it("other image nodes keep an unset ratio unset", () => {
      const r = buildPayload(node("image-to-image", { provider: "nano-banana-2-1" }), "job-1", { imageUrl: PHOTO })
      expect(r.payload.aspectRatio).toBeUndefined()
    })
  })
})
