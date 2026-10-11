import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { resolve } from "node:path"
import { usdToCredits, videoMaskCreditIds, VIDEO_MASK_LIMITS } from "@nodaro/shared"
import { STATIC_CREDIT_COSTS } from "../credits.js"
import { falCostUsd } from "../../../providers/fal/pricing.js"

const ROOT = resolve(__dirname, "../../../../..")

describe("Video Mask pricing — static rows, migration, docs and the fal rate agree", () => {
  it("each row is the provider cost of its bucket's top length at the 30 fps basis, in base credits", () => {
    for (const id of videoMaskCreditIds()) {
      const sec = Number(/:(\d+)s$/.exec(id)![1])
      const usd = falCostUsd("sam-3-video", { frames: sec * VIDEO_MASK_LIMITS.FPS_BASIS })!
      expect(STATIC_CREDIT_COSTS[id], id).toBe(usdToCredits(usd))
    }
  })

  it("the bare id is the ceiling row", () => {
    expect(STATIC_CREDIT_COSTS["video-mask"]).toBe(STATIC_CREDIT_COSTS[videoMaskCreditIds().at(-1)!])
  })

  it("the migration seeds every row at the static price, and Mask Composite at its flat price", () => {
    const dir = resolve(ROOT, "supabase/migrations")
    const sql = readdirSync(dir).filter((f) => f.includes("video_mask_mask_composite_pricing")).map((f) => readFileSync(resolve(dir, f), "utf8")).join("\n")
    for (const id of [...videoMaskCreditIds(), "video-mask", "mask-composite"]) {
      expect(sql, id).toContain(`('${id}', ${STATIC_CREDIT_COSTS[id]})`)
    }
  })

  it("the node doc's price table lists the static credits, row for row", () => {
    const doc = readFileSync(resolve(ROOT, "docs/nodes/ai-video/video-mask.md"), "utf8")
    for (const id of videoMaskCreditIds()) {
      expect(doc, id).toMatch(new RegExp(`\\| \`${id}\` \\| ${STATIC_CREDIT_COSTS[id]} \\|`))
    }
    const composite = readFileSync(resolve(ROOT, "docs/nodes/processing-video/mask-composite.md"), "utf8")
    expect(composite).toContain(`**${STATIC_CREDIT_COSTS["mask-composite"]} credits per run**`)
  })
})
