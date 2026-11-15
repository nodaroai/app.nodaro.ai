import { describe, it, expect } from "vitest"
import {
  DEFAULT_REQUEST_IMAGE_LIMIT,
  IMAGE_GEN_PROVIDERS,
  MAX_REQUEST_IMAGE_LIMIT,
  hasOwnRequestImageLimit,
  refusesImagesOverLimitOn,
} from "@nodaro/shared/models"
import { structuredReferenceListLimit } from "../image-input-limit.js"

/**
 * How many `connectedReferences` / `referenceOrder` entries one image request
 * may carry (decided 2026-11-15): the largest limit any model has when every
 * model it runs refuses a request over its own limit, the default limit,
 * exactly as before, otherwise.
 */
describe("structuredReferenceListLimit", () => {
  it.each([
    "gpt-image-2-6-flare",
    "gpt-image-2-6-sunburst",
    "minimax-h3-image",
    "seedream-5-5",
    "flux-3-klein",
    "gpt-image-2-6-flare-i2i",
    "seedream-5-5-i2i",
  ])("%s, a model with a request image limit of its own: the largest limit any model has", (model) => {
    expect(structuredReferenceListLimit([model])).toBe(MAX_REQUEST_IMAGE_LIMIT)
  })

  it.each(["nano-banana-pro", "gpt-image-2", "gpt-image-2-5-flare", "flux-2-pro"])(
    "%s, a model held to the default limit: the default limit",
    (model) => {
      expect(structuredReferenceListLimit([model])).toBe(DEFAULT_REQUEST_IMAGE_LIMIT)
    },
  )

  it("several models: the largest limit only when every one has a limit of its own", () => {
    expect(structuredReferenceListLimit(["gpt-image-2-6-flare", "seedream-5-5"])).toBe(MAX_REQUEST_IMAGE_LIMIT)
    expect(structuredReferenceListLimit(["gpt-image-2-6-flare", "nano-banana-pro"])).toBe(DEFAULT_REQUEST_IMAGE_LIMIT)
  })

  it("no model, or one that is not named: the default limit", () => {
    expect(structuredReferenceListLimit([])).toBe(DEFAULT_REQUEST_IMAGE_LIMIT)
    expect(structuredReferenceListLimit([undefined])).toBe(DEFAULT_REQUEST_IMAGE_LIMIT)
  })

  // The rule reads `refusesImagesOverLimitOn(…, "request")`, the gate the
  // handler's count and `oversizedImageArraysProblem` read; on every image
  // model today it is exactly "has a request image limit of its own".
  it("follows exactly the models with a request image limit of its own", () => {
    for (const model of IMAGE_GEN_PROVIDERS) {
      expect(refusesImagesOverLimitOn(model, "request"), model).toBe(hasOwnRequestImageLimit(model))
      expect(structuredReferenceListLimit([model]), model).toBe(
        hasOwnRequestImageLimit(model) ? MAX_REQUEST_IMAGE_LIMIT : DEFAULT_REQUEST_IMAGE_LIMIT,
      )
    }
  })
})
