/**
 * buildPayload: the image nodes (collage, lever snap, inpaint, the Auto
 * aspect ratio).
 *
 * Merged from 5 test files (CI test de-duplication, plan §5.7 B) so the
 * workflow-engine module graph loads once instead of 5 times. Each original
 * file is one top-level describe named after it, with its own helpers, setup
 * and teardown; test names and assertions are unchanged.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest"
import { buildPayload, type PayloadBuildContext } from "../payload-builder.js"
import type { SimpleNode, ResolvedInputs, NodeExecutionState, SimpleEdge } from "../types.js"
import { buildCreditModelIdentifier } from "@nodaro/shared/credits"
import { FLUX_LORA_CHARACTER_MODEL_ID, IMAGE_ASPECT_RATIO_VALUES, IMAGE_GEN_PROVIDERS } from "@nodaro/shared/models"
import { CHARACTER_ASPECT_OPTIONS } from "@nodaro/shared/entities"
import { MODEL_CATALOG, autoAspectNeedsSourceImage, normalizeModelInput } from "@nodaro/shared/model-catalog"
import { SOURCE_IMAGE_NODE_TYPES, PHOTO_AUTO_ASPECT_NODE_TYPES } from "@nodaro/shared/nodes"
import { autoAspectSourceImageUrl, generateImageMayUsePhotoSize } from "../source-image.js"
import { kieImageModelSent } from "../../../providers/kie/image-edit-sibling.js"
import { serveEveryHouseModel, serveNoHouseModel } from "../../../test/house-models.js"

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

  describe("buildPayload — the upscale factor a workflow run sends", () => {
    const input = { imageUrl: "https://r2.nodaro.ai/in.png" }

    it.each(["upscale-image", "edit-image"])("%s: a Nodaro Image Upscale 8x left on Recraft sends no factor", (type) => {
      const result = buildPayload(node("u1", type, { provider: "recraft-upscale", upscaleFactor: "8" }), jobId, input)
      expect(result.payload.provider).toBe("recraft-upscale")
      expect(result.payload.upscaleFactor).toBeUndefined()
    })

    it.each(["upscale-image", "edit-image"])("%s: a Recraft node's own 1/2/4 is sent as it always was", (type) => {
      for (const f of ["1", "2", "4"]) {
        expect(buildPayload(node("u5", type, { provider: "recraft-upscale", upscaleFactor: f }), jobId, input).payload.upscaleFactor, f).toBe(f)
      }
    })

    it("an upscale-image node with no model runs as Recraft and sends no 8", () => {
      const result = buildPayload(node("u2", "upscale-image", { upscaleFactor: "8" }), jobId, input)
      expect(result.payload.provider).toBe("recraft-upscale")
      expect(result.payload.upscaleFactor).toBeUndefined()
    })

    it("Topaz sends the factor its run renders, a stale 8 as 2", () => {
      const result = buildPayload(node("u3", "upscale-image", { provider: "topaz-image-upscale", upscaleFactor: "8" }), jobId, input)
      expect(result.payload.upscaleFactor).toBe("2")
      expect(buildPayload(node("u4", "upscale-image", { provider: "topaz-image-upscale", upscaleFactor: "4" }), jobId, input).payload.upscaleFactor).toBe("4")
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
      for (const provider of IMAGE_GEN_PROVIDERS.filter((p) => autoAspectNeedsSourceImage(p, "auto") && !MODEL_CATALOG[p]!.aspectRatios!.includes("auto"))) {
        const sent = buildPayload(gen({ provider, aspectRatio: "auto" }), "job-1", {}).payload.aspectRatio
        if (sent === "auto" || sent !== todays(provider)) failures.push(`${provider} → ${String(sent)}`)
      }
      expect(failures).toEqual([])
    })

    /** GPT Image 2.6 lists "auto" but resolves it from a photo; with none, its own "auto" goes, as before. */
    it("no photo: GPT Image 2.6 is sent its own 'auto'", () => {
      for (const provider of ["gpt-image-2-6-flare", "gpt-image-2-6-sunburst"]) {
        expect(autoAspectNeedsSourceImage(provider, "auto")).toBe(true)
        expect(buildPayload(gen({ provider, aspectRatio: "auto" }), "job-1", {}).payload.aspectRatio).toBe("auto")
      }
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
      // A native auto that keeps the shape (GPT Image 2.5's edit), and
      // edit-image's default, which has no ratio lever.
      expect(autoAspectSourceImageUrl(node("modify-image", { provider: "gpt-image-2-5-flare-i2i", aspectRatio: "auto" }), inputs)).toBeUndefined()
      expect(autoAspectSourceImageUrl(node("edit-image", { aspectRatio: "auto" }), inputs)).toBeUndefined()
    })

    it("names the photo for the edit default, GPT Image 2.6, whose own auto renders square", () => {
      const inputs = { imageUrl: SOURCE }
      // The node names no model: the edit default runs it. Unset ratio is Auto.
      expect(autoAspectSourceImageUrl(node("modify-image", { aspectRatio: "auto" }), inputs)).toBe(SOURCE)
      expect(autoAspectSourceImageUrl(node("modify-image", {}), inputs)).toBe(SOURCE)
      expect(autoAspectSourceImageUrl(node("image-to-image", { provider: "gpt-image-2-6-sunburst-i2i", aspectRatio: "auto" }), inputs)).toBe(SOURCE)
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

describe("GPT Image 2.6 in a workflow run", () => {
  const SRC = "https://media.nodaro.ai/src.png"
  const node = (type: string, data: Record<string, unknown>): SimpleNode => ({ id: "n1", type, data })

  it("Generate Image counts its base", () => {
    const r = buildPayload(node("generate-image", { prompt: "a", provider: "gpt-image-2-6-flare", baseImageUrl: SRC }), "j", {}, "u")
    expect(r.modelIdentifier).toBe("gpt-image-2-6-flare-i2i:medium:1K:1ref")
  })

  it("Image to Image takes the background and prices the size it renders", () => {
    const r = buildPayload(
      node("image-to-image", { prompt: "a", provider: "gpt-image-2-6-flare-i2i", resolution: "2K", background: "transparent" }),
      "j",
      { imageUrl: SRC },
      "u",
    )
    expect(r.payload.background).toBe("transparent")
    expect(r.payload.resolution).toBe("1K")
    expect(r.modelIdentifier).toBe("gpt-image-2-6-flare-i2i:medium:1K:1ref")
  })

  it.each([
    ["face", "generate-face"],
    ["object", "generate-object"],
    ["creature", "generate-creature"],
  ])("a %s node with a source image is priced as an edit", (type, job) => {
    const withSource = buildPayload(node(type, { name: "n", description: "d", provider: "gpt-image-2-6-flare", sourceImageUrl: SRC }), "j", {}, "u")
    expect(withSource.jobName).toBe(job)
    expect(withSource.modelIdentifier).toBe("gpt-image-2-6-flare-i2i:medium:1K:1ref")
    const without = buildPayload(node(type, { name: "n", description: "d", provider: "gpt-image-2-6-flare" }), "j", {}, "u")
    expect(without.modelIdentifier).toBe("gpt-image-2-6-flare:medium:1K")
  })

  it("another model on a face node keeps its plain id", () => {
    const r = buildPayload(node("face", { name: "n", description: "d", provider: "gpt-image-2-5-flare", sourceImageUrl: SRC }), "j", {}, "u")
    expect(r.modelIdentifier).toBe("gpt-image-2-5-flare")
  })

  it.each([
    ["character", "generate-character"],
    ["location", "generate-location"],
  ])("a %s node is priced on what its job sends, not on a quality and size it never carries", (type, job) => {
    const r = buildPayload(
      node(type, { name: "n", description: "d", provider: "gpt-image-2-6-flare", quality: "auto", resolution: "4K" }),
      "j",
      {},
      "u",
    )
    expect(r.jobName).toBe(job)
    expect(r.payload.quality).toBeUndefined()
    expect(r.payload.resolution).toBeUndefined()
    expect(r.modelIdentifier).toBe("gpt-image-2-6-flare:medium:1K")
    const edited = buildPayload(
      node(type, { name: "n", description: "d", provider: "gpt-image-2-6-flare", quality: "max", sourceImageUrl: SRC }),
      "j",
      {},
      "u",
    )
    expect(edited.modelIdentifier).toBe("gpt-image-2-6-flare-i2i:medium:1K:1ref")
  })

  it("a reference board drops a quality its model does not offer, from the price and the job", () => {
    const stale = buildPayload(
      node("reference-board", { prompt: "a", boardTemplate: "t", provider: "gpt-image-2-6-flare", quality: "basic" }),
      "j",
      {},
      "u",
    )
    expect(stale.payload.quality).toBeUndefined()
    expect(stale.modelIdentifier).toBe("gpt-image-2-6-flare:medium:1K")
    const kept = buildPayload(
      node("reference-board", { prompt: "a", boardTemplate: "t", provider: "gpt-image-2-6-flare", quality: "high" }),
      "j",
      {},
      "u",
    )
    expect(kept.payload.quality).toBe("high")
    expect(kept.modelIdentifier).toBe("gpt-image-2-6-flare:high:1K")
  })
})

describe("MiniMax H3 Image in a workflow run", () => {
  const SRC = "https://media.nodaro.ai/src.png"
  const REF = "https://media.nodaro.ai/ref.png"
  const node = (type: string, data: Record<string, unknown>): SimpleNode => ({ id: "n1", type, data })

  it("Generate Image is priced by its size, 2K when none is named", () => {
    expect(buildPayload(node("generate-image", { prompt: "a", provider: "minimax-h3-image", aspectRatio: "16:9" }), "j", {}, "u").modelIdentifier)
      .toBe("minimax-h3-image:2K")
    expect(buildPayload(node("generate-image", { prompt: "a", provider: "minimax-h3-image", aspectRatio: "16:9", resolution: "4K" }), "j", {}, "u").modelIdentifier)
      .toBe("minimax-h3-image:4K")
  })

  it("Generate Image with references and a base runs the edit, priced per image sent", () => {
    const r = buildPayload(
      node("generate-image", { prompt: "a", provider: "minimax-h3-image", aspectRatio: "16:9", resolution: "4K", referenceImageUrls: [REF], baseImageUrl: SRC }),
      "j",
      {},
      "u",
    )
    expect(r.modelIdentifier).toBe("minimax-h3-image-i2i:4K:2ref")
  })

  it("Image to Image counts its source", () => {
    const r = buildPayload(node("image-to-image", { prompt: "a", provider: "minimax-h3-image-i2i", resolution: "1K" }), "j", { imageUrl: SRC }, "u")
    expect(r.modelIdentifier).toBe("minimax-h3-image-i2i:1K:1ref")
  })

  it("a face node with a source image is priced as an edit at the size it sends", () => {
    expect(buildPayload(node("face", { name: "n", description: "d", provider: "minimax-h3-image", sourceImageUrl: SRC }), "j", {}, "u").modelIdentifier)
      .toBe("minimax-h3-image-i2i:2K:1ref")
    expect(buildPayload(node("face", { name: "n", description: "d", provider: "minimax-h3-image" }), "j", {}, "u").modelIdentifier)
      .toBe("minimax-h3-image:2K")
  })

  it("a character node is priced on what its job sends, not on a size it never carries", () => {
    const r = buildPayload(node("character", { name: "n", description: "d", provider: "minimax-h3-image", resolution: "4K" }), "j", {}, "u")
    expect(r.payload.resolution).toBeUndefined()
    expect(r.modelIdentifier).toBe("minimax-h3-image:2K")
  })
})

describe("Seedream 5.5 in a workflow run", () => {
  const SRC = "https://media.nodaro.ai/src.png"
  const REF = "https://media.nodaro.ai/ref.png"
  const node = (type: string, data: Record<string, unknown>): SimpleNode => ({ id: "n1", type, data })

  it("Generate Image sends and prices its size; none is the default 2K", () => {
    const sized = buildPayload(node("generate-image", { prompt: "a red bicycle", provider: "seedream-5-5", resolution: "1.5K", aspectRatio: "16:9" }), "j", {}, "u")
    expect(sized.payload.resolution).toBe("1.5K")
    expect(sized.modelIdentifier).toBe("seedream-5-5:1.5K")
    const unset = buildPayload(node("generate-image", { prompt: "a red bicycle", provider: "seedream-5-5" }), "j", {}, "u")
    expect(unset.modelIdentifier).toBe("seedream-5-5:2K")
    // Text to image takes no auto: an unset ratio (Auto on the node) is sent as a real one.
    expect(unset.payload.aspectRatio).toBe("1:1")
  })

  it("Generate Image with a base and a reference runs and is priced as an edit of both", () => {
    const r = buildPayload(node("generate-image", { prompt: "a red bicycle", provider: "seedream-5-5", resolution: "1K", baseImageUrl: SRC, referenceImageUrls: [REF] }), "j", {}, "u")
    expect(r.payload.model).toBe("seedream-5-5-i2i")
    expect(r.modelIdentifier).toBe("seedream-5-5-i2i:1K:2ref")
  })

  it("Image to Image counts its source and moves transparent to auto in JPEG", () => {
    const r = buildPayload(
      node("image-to-image", { prompt: "make it night", provider: "seedream-5-5-i2i", resolution: "2K", background: "transparent", outputFormat: "jpeg" }),
      "j",
      { imageUrl: SRC },
      "u",
    )
    expect(r.payload.outputFormat).toBe("jpeg")
    expect(r.payload.background).toBe("auto")
    expect(r.modelIdentifier).toBe("seedream-5-5-i2i:2K:1ref")
  })

  it("a face node with a source image is priced as the edit it runs as", () => {
    const r = buildPayload(node("face", { name: "n", description: "d", provider: "seedream-5-5", sourceImageUrl: SRC }), "j", {}, "u")
    expect(r.modelIdentifier).toBe("seedream-5-5-i2i:2K:1ref")
  })

  it("a prompt shorter than the model takes is refused before any job row", () => {
    expect(() => buildPayload(node("generate-image", { prompt: "cat", provider: "seedream-5-5" }), "j", {}, "u")).toThrow(/at least 5 characters/)
    expect(() => buildPayload(node("image-to-image", { prompt: "red", provider: "seedream-5-5-i2i" }), "j", { imageUrl: SRC }, "u")).toThrow(/at least 5 characters/)
    expect(() => buildPayload(node("modify-image", { prompt: "red", provider: "seedream-5-5-i2i" }), "j", { imageUrl: SRC }, "u")).toThrow(/at least 5 characters/)
    // Another model is not held to it.
    expect(() => buildPayload(node("generate-image", { prompt: "cat", provider: "seedream-5-flash" }), "j", {}, "u")).not.toThrow()
    // Blank space is not a description: counted after trimming.
    expect(() => buildPayload(node("generate-image", { prompt: "    a", provider: "seedream-5-5" }), "j", {}, "u")).toThrow(/at least 5 characters/)
  })

  it.each(["character", "face", "object", "creature", "location"])(
    "a %s node with no name sends its description: one under 5 characters is refused before any job row",
    (type) => {
      expect(() => buildPayload(node(type, { description: "cat", provider: "seedream-5-5" }), "j", {}, "u")).toThrow(/at least 5 characters/)
      expect(() => buildPayload(node(type, { description: "  cat  ", provider: "seedream-5-5", sourceImageUrl: SRC }), "j", {}, "u")).toThrow(/at least 5 characters/)
      expect(() => buildPayload(node(type, { description: "a red bicycle", provider: "seedream-5-5" }), "j", {}, "u")).not.toThrow()
      // A name builds the prompt from a template, and another model has no minimum.
      expect(() => buildPayload(node(type, { name: "Bo", description: "cat", provider: "seedream-5-5" }), "j", {}, "u")).not.toThrow()
      expect(() => buildPayload(node(type, { description: "cat", provider: "seedream-5-flash" }), "j", {}, "u")).not.toThrow()
    },
  )

  it("a Scene sends a ratio the model lists, and its prompt is held to the minimum", () => {
    const scene = (data: Record<string, unknown>) => buildPayload(node("scene", { provider: "seedream-5-5", ...data }), "j", { prompt: "a red bicycle in the rain" }, "u")
    expect(scene({ aspectRatio: "auto" }).payload.aspectRatio).toBe("1:1")
    expect(scene({ aspectRatio: "4:5" }).payload.aspectRatio).toBe("3:4")
    expect(scene({ aspectRatio: "21:9" }).payload.aspectRatio).toBe("21:9")
    expect(scene({}).payload.aspectRatio).toBeUndefined()
    expect(() => buildPayload(node("scene", { provider: "seedream-5-5", prompt: "cat" }), "j", {}, "u")).toThrow(/at least 5 characters/)
  })

  it("a Scene with a reference snaps its ratio against the edit model the run reaches", () => {
    // With an image, Seedream 5.5 runs on its edit, which takes "auto": it goes as stored.
    const withRef = buildPayload(
      node("scene", { provider: "seedream-5-5", aspectRatio: "auto" }),
      "j",
      { prompt: "a red bicycle in the rain", referenceImageUrls: ["https://media.nodaro.ai/ref.png"] },
      "u",
    )
    expect(withRef.payload.referenceImageUrls).toEqual(["https://media.nodaro.ai/ref.png"])
    expect(withRef.payload.aspectRatio).toBe("auto")
  })
})


describe("Scene: only a strict model's ratio is checked; every other model's goes as stored", () => {
  // Every ratio the Scene panel offers (scene-config.tsx) and the surround route
  // takes, plus every ratio the routes know and "auto". GPT Image 2 renders 21:9
  // and 4:5 although its catalog list omits them, so no list is enough to move a
  // ratio: only `strictAspectRatios` (read from the provider's schema) is.
  const SCENE_PANEL_RATIOS = ["16:9", "9:16", "1:1", "4:3", "21:9", "4:5"]
  const SENDABLE = [...new Set(["auto", ...SCENE_PANEL_RATIOS, ...CHARACTER_ASPECT_OPTIONS, ...IMAGE_ASPECT_RATIO_VALUES])]
  const REF = "https://media.nodaro.ai/ref.png"
  const scene = (provider: string, aspectRatio: string, withReference: boolean) =>
    buildPayload(
      { id: "s1", type: "scene", data: { provider, aspectRatio } },
      "j",
      { prompt: "a quiet harbour at dawn", ...(withReference ? { referenceImageUrls: [REF] } : {}) },
      "u",
    ).payload.aspectRatio

  // Every catalog image model is built here, the house model included: an
  // install that serves it (one that does not refuses it before the build).
  beforeEach(() => serveEveryHouseModel())
  afterEach(() => serveNoHouseModel())

  it("covers the catalog", () => {
    expect(Object.values(MODEL_CATALOG).filter((m) => m.kind === "image" && !m.strictAspectRatios).length).toBeGreaterThan(30)
  })

  for (const m of Object.values(MODEL_CATALOG)) {
    if (m.kind !== "image" || m.strictAspectRatios) continue
    it(`${m.id}: every sendable ratio, with and without a reference`, () => {
      for (const ratio of SENDABLE) {
        expect(scene(m.id, ratio, false), `${ratio} without a reference`).toBe(ratio)
        expect(scene(m.id, ratio, true), `${ratio} with a reference`).toBe(ratio)
      }
    })
  }

  it("GPT Image 2 (the Scene's default) keeps 21:9 and 4:5", () => {
    for (const withReference of [false, true]) {
      expect(scene("gpt-image-2", "21:9", withReference)).toBe("21:9")
      expect(scene("gpt-image-2", "4:5", withReference)).toBe("4:5")
    }
  })

  it("a model the catalog does not know keeps what it was given", () => {
    expect(scene("not-a-model", "4:5", false)).toBe("4:5")
    expect(scene("not-a-model", "4:5", true)).toBe("4:5")
  })

  it("Seedream 5.5 keeps every ratio the model it reaches lists, and text to image never gets auto", () => {
    for (const withReference of [false, true]) {
      const reached = MODEL_CATALOG[kieImageModelSent("seedream-5-5", withReference ? 1 : 0)]!
      for (const ratio of reached.aspectRatios!) expect(scene("seedream-5-5", ratio, withReference), ratio).toBe(ratio)
    }
    for (const ratio of SENDABLE) expect(scene("seedream-5-5", ratio, false), ratio).not.toBe("auto")
  })

  it("FLUX 3 Klein sends a ratio the model it reaches lists, and text to image never gets auto", () => {
    for (const withReference of [false, true]) {
      const reached = MODEL_CATALOG[kieImageModelSent("flux-3-klein", withReference ? 1 : 0)]!
      for (const ratio of reached.aspectRatios!) expect(scene("flux-3-klein", ratio, withReference), ratio).toBe(ratio)
      for (const ratio of SENDABLE) expect(reached.aspectRatios, ratio).toContain(scene("flux-3-klein", ratio, withReference))
    }
    expect(scene("flux-3-klein", "auto", false)).toBe("1:1")
    expect(scene("flux-3-klein", "auto", true)).toBe("auto")
  })
})

describe("FLUX 3 Klein in a workflow run", () => {
  const SRC = "https://media.nodaro.ai/src.png"
  const REF = "https://media.nodaro.ai/ref.png"
  const node = (type: string, data: Record<string, unknown>): SimpleNode => ({ id: "n1", type, data })

  it("Generate Image is priced by its size, 1K when none is named", () => {
    for (const [resolution, id] of [[undefined, "flux-3-klein:1K"], ["1K", "flux-3-klein:1K"], ["2K", "flux-3-klein:2K"], ["4K", "flux-3-klein:4K"]] as const) {
      const r = buildPayload(node("generate-image", { prompt: "a", provider: "flux-3-klein", aspectRatio: "1:1", ...(resolution ? { resolution } : {}) }), "j", {}, "u")
      expect(r.modelIdentifier, String(resolution)).toBe(id)
    }
  })

  it("Generate Image with references runs the edit at the same size, its price unmoved by the count", () => {
    const one = buildPayload(node("generate-image", { prompt: "a", provider: "flux-3-klein", aspectRatio: "1:1", resolution: "4K", referenceImageUrls: [REF] }), "j", {}, "u")
    expect(one.modelIdentifier).toBe("flux-3-klein-i2i:4K")
    const many = buildPayload(
      node("generate-image", { prompt: "a", provider: "flux-3-klein", aspectRatio: "1:1", resolution: "4K", referenceImageUrls: [REF, REF, REF], baseImageUrl: SRC }),
      "j",
      {},
      "u",
    )
    expect(many.modelIdentifier).toBe("flux-3-klein-i2i:4K")
  })

  it("Image to Image is priced by its size", () => {
    const r = buildPayload(node("image-to-image", { prompt: "a", provider: "flux-3-klein-i2i", resolution: "2K" }), "j", { imageUrl: SRC }, "u")
    expect(r.modelIdentifier).toBe("flux-3-klein-i2i:2K")
  })

  it("a face node is priced at the size it sends, on the edit with a source image", () => {
    expect(buildPayload(node("face", { name: "n", description: "d", provider: "flux-3-klein" }), "j", {}, "u").modelIdentifier)
      .toBe("flux-3-klein:1K")
    expect(buildPayload(node("face", { name: "n", description: "d", provider: "flux-3-klein", sourceImageUrl: SRC }), "j", {}, "u").modelIdentifier)
      .toBe("flux-3-klein-i2i:1K")
  })

  it("a character node is priced on what its job sends, not on a size it never carries", () => {
    const r = buildPayload(node("character", { name: "n", description: "d", provider: "flux-3-klein", resolution: "4K" }), "j", {}, "u")
    expect(r.payload.resolution).toBeUndefined()
    expect(r.modelIdentifier).toBe("flux-3-klein:1K")
  })

  it("Generate Image with only a base image runs the edit, and is priced on it", () => {
    const r = buildPayload(node("generate-image", { prompt: "a", provider: "flux-3-klein", aspectRatio: "1:1", resolution: "2K", baseImageUrl: SRC }), "j", {}, "u")
    expect(r.modelIdentifier).toBe("flux-3-klein-i2i:2K")
  })

  const refsOf = (n: number) => Array.from({ length: n }, (_, i) => `https://media.nodaro.ai/ref-${i}.png`)

  it("Generate Image refuses an 11th image, a base image counted, before any job row", () => {
    const gen = (references: number, base: boolean) =>
      buildPayload(
        node("generate-image", { prompt: "a", provider: "flux-3-klein", aspectRatio: "1:1", ...(base ? { baseImageUrl: SRC } : {}) }),
        "j",
        { referenceImageUrls: refsOf(references) },
        "u",
      )
    expect(gen(10, false).modelIdentifier).toBe("flux-3-klein-i2i:1K")
    expect(gen(9, true).modelIdentifier).toBe("flux-3-klein-i2i:1K")
    expect(() => gen(10, true)).toThrow(/FLUX 3 Klein takes at most 10 input images, the source or base image included, and this run would send 11/)
  })

  it("Image to Image and Modify Image refuse a source with 10 more images, before any job row", () => {
    for (const type of ["image-to-image", "modify-image"]) {
      const run = (references: number) =>
        buildPayload(node(type, { prompt: "a", provider: "flux-3-klein-i2i" }), "j", { imageUrl: SRC, referenceImageUrls: refsOf(references) }, "u")
      expect(run(9).modelIdentifier, type).toBe("flux-3-klein-i2i:1K")
      expect(() => run(10), type).toThrow(/takes at most 10 input images/)
    }
  })

  it("a Scene refuses more than 10 references, before any job row", () => {
    const sceneRun = (references: number) =>
      buildPayload(
        { id: "s1", type: "scene", data: { provider: "flux-3-klein", aspectRatio: "16:9" } },
        "j",
        { prompt: "a quiet harbour at dawn", referenceImageUrls: refsOf(references) },
        "u",
      )
    expect(sceneRun(10).modelIdentifier).toBe("flux-3-klein-i2i:1K")
    expect(() => sceneRun(11)).toThrow(/takes at most 10 input images.*would send 11: remove 1/)
  })

  it("every other model's workflow run is left as it was", () => {
    const r = buildPayload(node("image-to-image", { prompt: "make it winter", provider: "seedream-5-5-i2i" }), "j", { imageUrl: SRC, referenceImageUrls: refsOf(10) }, "u")
    expect(r.modelIdentifier).toMatch(/^seedream-5-5-i2i:/)
  })
})
