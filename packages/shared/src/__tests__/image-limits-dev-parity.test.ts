// @test-watches packages/shared/src/__tests__/fixtures/image-limits-dev.json
/**
 * Kling Image 4.0's input limit counts items (decided 2026-11-23) and its
 * picture lists are bounded higher; no other model's limit moves: every image
 * model recorded from dev keeps its request limit, its reference limit and
 * whether it refuses past them, and the routes' shared bounds are unchanged.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { MODEL_CATALOG } from "../model-catalog.js"
import { DEFAULT_REQUEST_IMAGE_LIMIT, MAX_REQUEST_IMAGE_LIMIT, imageReferenceLimit, refusesImagesOverLimitOn, requestImageLimit } from "../model-constants.js"

const dev = JSON.parse(readFileSync(join(__dirname, "fixtures", "image-limits-dev.json"), "utf8")) as {
  MAX_REQUEST_IMAGE_LIMIT: number
  DEFAULT_REQUEST_IMAGE_LIMIT: number
  table: Record<string, string>
}

describe("no other model's image limits move", () => {
  it("every image model recorded from dev keeps its limits", () => {
    const differ: string[] = []
    for (const [id, was] of Object.entries(dev.table)) {
      if (!MODEL_CATALOG[id]) continue
      const now = [requestImageLimit(id), imageReferenceLimit(id), refusesImagesOverLimitOn(id, "request"), refusesImagesOverLimitOn(id, "workflow")].join(" ")
      if (now !== was) differ.push(`${id}: ${was} -> ${now}`)
    }
    expect(differ).toEqual([])
  })

  it("the routes' shared bounds are unchanged", () => {
    expect(MAX_REQUEST_IMAGE_LIMIT).toBe(dev.MAX_REQUEST_IMAGE_LIMIT)
    expect(DEFAULT_REQUEST_IMAGE_LIMIT).toBe(dev.DEFAULT_REQUEST_IMAGE_LIMIT)
  })
})
