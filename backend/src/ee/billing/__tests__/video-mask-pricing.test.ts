import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { resolve } from "node:path"
import { usdToCredits, videoMaskCreditIds, VIDEO_MASK_LIMITS, VIDEO_MASK_PROVIDERS, maskCompositeUnits } from "@nodaro/shared"
import { STATIC_CREDIT_COSTS } from "../credits.js"
import { falCostUsd } from "../../../providers/fal/pricing.js"
import { SAM3_VIDEO_MODELS } from "../../../providers/fal/sam3-video.js"
import { VIDEO_MASK_CHUNK_FRAMES, planMaskChunks } from "../../../providers/video/video-mask.js"

/** What fal bills for `frames`, sent the way the worker sends them: one request per chunk. */
const chunkedCost = (priceId: string, frames: number) =>
  planMaskChunks(frames, VIDEO_MASK_CHUNK_FRAMES).reduce((sum, c) => sum + falCostUsd(priceId, { frames: c.frames })!, 0)

const ROOT = resolve(__dirname, "../../../../..")

describe("Video Mask pricing — static rows, migration, docs and the fal rate agree", () => {
  it("each row is its model's provider cost at the bucket's top length (30 fps basis, billed per chunk), in base credits", () => {
    for (const provider of VIDEO_MASK_PROVIDERS) {
      for (const id of videoMaskCreditIds(provider)) {
        const sec = Number(/:(\d+)s$/.exec(id)![1])
        const usd = chunkedCost(SAM3_VIDEO_MODELS[provider].priceId, sec * VIDEO_MASK_LIMITS.FPS_BASIS)
        expect(STATIC_CREDIT_COSTS[id], id).toBe(usdToCredits(usd))
      }
    }
  })

  it("the bare id is the most expensive row (an upper bound)", () => {
    const all = VIDEO_MASK_PROVIDERS.flatMap((p) => videoMaskCreditIds(p)).map((id) => STATIC_CREDIT_COSTS[id]!)
    expect(STATIC_CREDIT_COSTS["video-mask"]).toBe(Math.max(...all))
  })

  it("the migrations bring every row to the static price (an insert, or the update of the shipped value)", () => {
    const dir = resolve(ROOT, "supabase/migrations")
    const sql = readdirSync(dir).filter((f) => /^(499|501)_/.test(f)).map((f) => readFileSync(resolve(dir, f), "utf8")).join("\n")
    for (const id of VIDEO_MASK_PROVIDERS.flatMap((p) => videoMaskCreditIds(p))) {
      expect(sql, id).toContain(`('${id}', ${STATIC_CREDIT_COSTS[id]})`)
    }
    expect(sql).toContain(`SET credit_cost = ${STATIC_CREDIT_COSTS["video-mask"]} WHERE model_identifier = 'video-mask'`)
    expect(sql).toContain(`SET credit_cost = ${STATIC_CREDIT_COSTS["mask-composite"]} WHERE model_identifier = 'mask-composite'`)
  })

  it("the node doc's price table names every row, each figure tied to its row (docs-charged-prices.test.ts holds it to the charged price)", () => {
    const doc = readFileSync(resolve(ROOT, "docs/nodes/ai-video/video-mask.md"), "utf8")
    for (const id of VIDEO_MASK_PROVIDERS.flatMap((p) => videoMaskCreditIds(p))) {
      const esc = id.replace(".", "\\.")
      expect(doc, id).toMatch(new RegExp(`\\| \`${esc}\` \\| \\d+<!-- credits: ${esc} --> \\|`))
    }
    const composite = readFileSync(resolve(ROOT, "docs/nodes/processing-video/mask-composite.md"), "utf8")
    expect(composite).toMatch(/credits<!-- credits-rate: mask-composite --> per started 5 seconds of the result\*\*/)
    for (const [sec, label] of [[3, "3 s"], [10, "10 s"], [61, "61 s"], [300, "5 minutes"]] as const) {
      const units = maskCompositeUnits(sec)
      const at = units === 1 ? "mask-composite" : `mask-composite@${units}`
      expect(composite, label).toMatch(new RegExp(`\\| ${label} \\| ${units} \\| \\d+<!-- credits: ${at} --> \\|`))
    }
  })
})
