/**
 * R49: a use-case run whose built chain holds a metered LLM step on a model
 * with no price is refused `400 llm_model_unpriced` — by its quote
 * (`POST /v1/<use-case>/estimate`) and by its run's balance check — never
 * priced at a tier row or 0. Shares the use-case route harness.
 */
import { m, makeApp, post } from "./helpers/tighten-episode-route-harness.js"
import { describe, it, expect } from "vitest"

const unpriced = () => Object.assign(new Error("unpriced"), { name: "LlmUnpricedModelError", code: "llm_model_unpriced", modelId: "claude-opus-5.5" })

describe("a use-case run on an unpriced metered LLM model", () => {
  it("the estimate answers 400 llm_model_unpriced", async () => {
    m.estimateThrows = unpriced()
    const app = await makeApp()
    const res = await app.inject({ method: "POST", url: "/v1/tighten-episode/estimate", payload: { mediaUrls: ["https://r2/ep.mp4"] } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatchObject({ code: "validation_error", reason: "llm_model_unpriced", modelId: "claude-opus-5.5" })
  })

  it("the run is refused the same way before any job row", async () => {
    m.estimateThrows = unpriced()
    const res = await post(await makeApp(), { mediaUrls: ["https://r2/ep.mp4"] })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatchObject({ reason: "llm_model_unpriced" })
    expect(m.insertJob).not.toHaveBeenCalled()
  })
})
