import { describe, it, expect } from "vitest"
import { NODE_DEFINITIONS } from "../nodes"

/**
 * generative-pipeline is INTENTIONALLY a terminal node — it renders no output
 * handle. Its work is orchestrated out-of-band (POST /v1/pipelines); the
 * workflow DAG executes it as a hard no-op leaf (backend node-executor.ts
 * returns `{ output: {} }`, frontend execute-node returns ""), and the backend
 * output-extractor has no case for it. So its result cannot be routed to a
 * downstream node in a server-side run. Exposing a `final_video` source pip
 * would let the canvas accept an edge the backend can't fulfill (inverse of the
 * "cannot connect the outputs" drift bug). `outputs` MUST stay empty so
 * node-compatibility never offers it as a source → no phantom/orphan edge.
 *
 * If real chaining is ever built (the DAG waits for / reads back the pipeline
 * result), re-add the handle AND register generative-pipeline in
 * VIDEO_PRODUCER_TYPES + the backend output-extractor — and update this test.
 */
describe("generative-pipeline node definition", () => {
  const def = NODE_DEFINITIONS.find((d) => d.type === "generative-pipeline")

  it("is registered", () => {
    expect(def).toBeDefined()
  })

  it("is terminal — declares NO outputs (no output handle is rendered)", () => {
    expect(def?.outputs).toEqual([])
  })

  it("still accepts a story prompt input", () => {
    expect(def?.inputs).toContain("story_prompt")
  })
})
