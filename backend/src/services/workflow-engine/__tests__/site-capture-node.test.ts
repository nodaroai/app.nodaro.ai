/**
 * The Site Capture node on the server engine: the body it POSTs to /v1/site-capture,
 * what its job hands on (`buildNodeOutputFromJobData`), what a skipped node hands on
 * from its saved capture (`extractSavedNodeOutput`), and how a wire from each pip
 * lands on the next node. The editor reads the same shared helpers
 * (site-capture-node.ts in @nodaro/shared), so the two engines cannot disagree.
 */
import { describe, expect, it } from "vitest"
import { buildSyncHttpBody, SYNC_HTTP_NODES, SYNC_HTTP_ROUTES } from "../node-executor.js"
import { buildNodeOutputFromJobData, extractSavedNodeOutput, getPrimaryOutput } from "../output-extractor.js"
import { resolveNodeInputs } from "../input-resolver.js"
import type { NodeExecutionState, OrchestratorContext, SimpleEdge, SimpleNode } from "../types.js"

const CTX: OrchestratorContext = {
  executionId: "exec-1",
  workflowId: "wf-1",
  userId: "user-1",
  triggerType: "manual",
  billingContext: { payer: "user", userId: "user-1" },
  cancelled: false,
}

const CAPTURE = {
  pageUrl: "https://acme.io/",
  finalUrl: "https://acme.io/",
  title: "Acme",
  fullPage: { assetId: "a-full", url: "https://cdn.example/full.jpg", width: 412, height: 6000, truncated: false },
  stills: [
    { index: 0, sectionOrder: 0, label: "Hero", category: "hero", assetId: "a0", url: "https://cdn.example/0.png", width: 1082, height: 1286 },
    { index: 1, sectionOrder: 2, label: "Pricing", category: "pricing", assetId: "a1", url: "https://cdn.example/1.png", width: 1082, height: 1286 },
  ],
  sections: [],
  facts: ["$12 per month"],
  usableStills: 2,
  warnings: ["sections_below_minimum"],
  source: "local",
}
const STILLS = ["https://cdn.example/0.png", "https://cdn.example/1.png"]

const node = (id: string, type: string, data: Record<string, unknown> = {}): SimpleNode => ({ id, type, data: { label: id, ...data } })
const edge = (source: string, target: string, sourceHandle: string | undefined, targetHandle: string, data?: Record<string, unknown>): SimpleEdge =>
  ({ id: `${source}->${target}`, source, target, sourceHandle, targetHandle, data }) as SimpleEdge

describe("Site Capture — the run", () => {
  it("is a sync-HTTP node on POST /v1/site-capture (the route answers with a job id, which the run polls)", () => {
    expect(SYNC_HTTP_NODES.has("site-capture")).toBe(true)
    expect(SYNC_HTTP_ROUTES["site-capture"]).toBe("/v1/site-capture")
  })

  it("sends the typed page and the stills count clamped to the route's bounds", () => {
    const body = buildSyncHttpBody(node("sc", "site-capture", { url: " acme.io ", maxStills: 20 }), { prompt: "https://other.io" }, CTX)
    expect(body).toMatchObject({ url: "acme.io", maxStills: 8, userId: "user-1" })
  })

  it("with no typed page, captures the first web address in the wired text", () => {
    const body = buildSyncHttpBody(node("sc", "site-capture", { url: "" }), { prompt: "Our site: https://acme.io/pricing." }, CTX)
    expect(body).toMatchObject({ url: "https://acme.io/pricing", maxStills: 8 })
  })
})

describe("Site Capture — what it hands on", () => {
  it("its job: the capture on json, the first still as the image, every still in page order as its list", () => {
    expect(buildNodeOutputFromJobData(CAPTURE, "site-capture")).toEqual({ json: CAPTURE, imageUrl: STILLS[0], listResults: STILLS })
  })

  it("a skipped node: the same, read from its saved capture; nothing before it ever ran", () => {
    expect(extractSavedNodeOutput(node("sc", "site-capture", { generatedJson: CAPTURE }))).toEqual({ json: CAPTURE, imageUrl: STILLS[0], listResults: STILLS })
    expect(extractSavedNodeOutput(node("sc", "site-capture", {}))).toBeUndefined()
  })

  it("by pip: image (or no handle) is the first still, json the capture as text; any other pip is nothing", () => {
    const output = buildNodeOutputFromJobData(CAPTURE, "site-capture")
    expect(getPrimaryOutput(output, "site-capture", "image")).toBe(STILLS[0])
    expect(getPrimaryOutput(output, "site-capture", undefined)).toBe(STILLS[0])
    expect(getPrimaryOutput(output, "site-capture", "json")).toBe(JSON.stringify(CAPTURE))
    expect(getPrimaryOutput(output, "site-capture", "video")).toBeUndefined()
  })

  it("a still wired into an image input arrives as the image; the json into a text input as the prompt", () => {
    const sc = node("sc", "site-capture")
    const states: Record<string, NodeExecutionState> = { sc: { status: "completed", output: buildNodeOutputFromJobData(CAPTURE, "site-capture") } }
    const i2t = node("i2t", "image-to-text")
    expect(resolveNodeInputs(i2t, [edge("sc", "i2t", "image", "image")], states, [sc, i2t]).imageUrl).toBe(STILLS[0])
    const llm = node("llm", "llm-chat", { userInput: "" })
    expect(resolveNodeInputs(llm, [edge("sc", "llm", "json", "prompt")], states, [sc, llm]).prompt).toBe(JSON.stringify(CAPTURE))
  })

  it("a Bundle wire hands every still, in page order, to Slideshow and Image Collage; a skipped node's saved stills too", () => {
    const sc = node("sc", "site-capture", { generatedJson: CAPTURE, __listResults: STILLS })
    const live: Record<string, NodeExecutionState> = { sc: { status: "completed", output: buildNodeOutputFromJobData(CAPTURE, "site-capture") } }
    const show = node("show", "slideshow")
    expect(resolveNodeInputs(show, [edge("sc", "show", "image", "images", { outputMode: "all" })], live, [sc, show]).imageUrls).toEqual(STILLS)
    const collage = node("col", "image-collage")
    expect(resolveNodeInputs(collage, [edge("sc", "col", "image", "in", { outputMode: "all" })], live, [sc, collage]).imageUrls).toEqual(STILLS)
    const saved: Record<string, NodeExecutionState> = { sc: { status: "completed", output: extractSavedNodeOutput(sc) } }
    expect(resolveNodeInputs(show, [edge("sc", "show", "image", "images", { outputMode: "all" })], saved, [sc, show]).imageUrls).toEqual(STILLS)
  })
})
