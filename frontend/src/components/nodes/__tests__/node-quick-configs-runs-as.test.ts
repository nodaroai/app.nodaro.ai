import { describe, it, expect } from "vitest"
import { getQuickConfigs } from "../node-quick-configs"
import { IMAGE_MODEL_ROLE_DEFAULTS } from "@nodaro/shared"

/**
 * A node with no stored provider runs on its executor's fallback model. The
 * strip used to show the list's FIRST entry instead — a fresh Video to Video
 * node read "Seedance 2.5 Edit" while it ran (and priced) Wan, so the Seedance
 * Draft lever never appeared and picking Seedance "again" looked like a no-op.
 * Each `runsAs` mirrors the fallback in backend payload-builder.ts and the
 * node's config panel.
 */
const RUNS_AS: Record<string, string> = {
  "video-to-video": "wan",
  "lip-sync": "kling-avatar",
  "extend-video": "veo-extend",
  "modify-image": IMAGE_MODEL_ROLE_DEFAULTS.edit,
}

const providerOf = (type: string) => getQuickConfigs(type).find((c) => c.field === "provider")!
const optionValues = (type: string) => {
  const opts = providerOf(type).options
  return (typeof opts === "function" ? opts({}) : opts).map((o) => o.value)
}

describe("provider strip controls show the model an unset node runs", () => {
  for (const [type, model] of Object.entries(RUNS_AS)) {
    it(`${type}: unset provider reads as ${model}`, () => {
      expect(providerOf(type).defaultValue).toBe(model)
      expect(optionValues(type)).toContain(model)
    })
  }

  it("every provider control's defaultValue is one of its options", () => {
    for (const type of ["video-to-video", "lip-sync", "extend-video", "modify-image", "upscale-image", "motion-transfer"]) {
      const c = providerOf(type)
      if (c.defaultValue !== undefined) expect(optionValues(type)).toContain(c.defaultValue)
    }
  })
})
