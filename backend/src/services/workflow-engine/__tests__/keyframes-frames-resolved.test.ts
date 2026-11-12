import { describe, it, expect } from "vitest"
import { resolveNodeInputs } from "../input-resolver.js"
import { buildPayload } from "../payload-builder.js"
import type { SimpleNode, SimpleEdge, NodeExecutionState } from "../types.js"
import { buildGrokVideo15Request } from "../../../providers/kie/grok-video-15.js"

/**
 * On a keyframes model (Grok Imagine Video 1.5, Kling 4.0 Keyframes) the
 * in-between frames are exactly what is wired into the node's Image
 * References, in order (decided 2026-11-11). A wired asset — a Location on the
 * Assets handle here — lands in the resolver's reference list by source type,
 * so these run the REAL input resolver and then `buildPayload`, the workflow
 * run's two steps, rather than hand-built resolved inputs.
 */
const START = "https://cdn.example/start.png"
const END = "https://cdn.example/end.png"
const LOCATION = "https://cdn.example/old-library.png"
const MID = (n: number) => `https://cdn.example/mid-${n}.png`

interface Wiring {
  type?: "generate-video" | "image-to-video" | "text-to-video"
  provider: string
  data?: Record<string, unknown>
  start?: boolean
  end?: boolean
  location?: boolean
  refs?: number
}

function graph(w: Wiring) {
  const type = w.type ?? "generate-video"
  const refHandle = type === "generate-video" ? "imageReferences" : "references"
  const target: SimpleNode = { id: "v", type, data: { label: "Video", provider: w.provider, prompt: "she walks to the window", ...w.data } }
  const nodes: SimpleNode[] = [target]
  const edges: SimpleEdge[] = []
  const states: Record<string, NodeExecutionState> = {}
  const upload = (id: string, url: string, targetHandle: string) => {
    nodes.push({ id, type: "upload-image", data: { label: id, imageUrl: url } })
    states[id] = { status: "completed", output: { imageUrl: url } }
    edges.push({ id: `${id}->v`, source: id, target: "v", sourceHandle: null, targetHandle })
  }
  if (w.start) upload("start", START, "startFrame")
  if (w.end) upload("end", END, "endFrame")
  if (w.location) {
    nodes.push({ id: "loc", type: "location", data: { label: "Old Library", locationName: "Old Library", sourceImageUrl: LOCATION } })
    states.loc = { status: "completed", output: { imageUrl: LOCATION } }
    edges.push({ id: "loc->v", source: "loc", target: "v", sourceHandle: "locationRef", targetHandle: "assets" })
  }
  for (let i = 1; i <= (w.refs ?? 0); i++) upload(`m${i}`, MID(i), refHandle)
  return { target, nodes, edges, states }
}

/** The workflow run: resolve the node's inputs, then build its job payload. */
function run(w: Wiring) {
  const g = graph(w)
  const inputs = resolveNodeInputs(g.target, g.edges, g.states, g.nodes)
  return { inputs, result: buildPayload(g.target, "job-1", inputs, undefined, { nodes: g.nodes, edges: g.edges, nodeStates: g.states }) }
}

const carriesLocation = (payload: Record<string, unknown>) =>
  payload.imageUrl === LOCATION || payload.endFrameUrl === LOCATION || ((payload.referenceImageUrls as string[] | undefined) ?? []).includes(LOCATION)

describe("keyframes models take only the Image References as in-between frames (workflow run)", () => {
  it("the resolver keeps the Image References apart from the wired asset", () => {
    const { inputs } = run({ provider: "grok-imagine-video-1.5", start: true, location: true, refs: 2 })
    expect(inputs.referenceImageUrls).toEqual(expect.arrayContaining([LOCATION, MID(1), MID(2)]))
    expect(inputs.imageReferenceHandleUrls).toEqual([MID(1), MID(2)])
  })

  for (const provider of ["grok-imagine-video-1.5", "kling-4-keyframes"]) {
    for (const type of ["generate-video", "image-to-video"] as const) {
      it(`${provider} (${type}): start + Location asset + 1 reference sends only the reference`, () => {
        const { result } = run({ type, provider, start: true, location: true, refs: 1 })
        expect(result.payload.imageUrl).toBe(START)
        expect(result.payload.referenceImageUrls).toEqual([MID(1)])
        expect(carriesLocation(result.payload)).toBe(false)
      })
    }

    it(`${provider}: a stored reference order still orders the frames, and the asset stays out`, () => {
      const { result } = run({ provider, start: true, location: true, refs: 3, data: { referenceImageOrder: ["m3", "m1", "m2"] } })
      expect(result.payload.referenceImageUrls).toEqual([MID(3), MID(1), MID(2)])
      expect(carriesLocation(result.payload)).toBe(false)
    })
  }

  it("kling-4-keyframes (text-to-video node): in-between frames alone, the asset stays out", () => {
    const { result } = run({ type: "text-to-video", provider: "kling-4-keyframes", location: true, refs: 2 })
    expect(result.payload.referenceImageUrls).toEqual([MID(1), MID(2)])
    expect(carriesLocation(result.payload)).toBe(false)
  })

  it("Grok at 5 s: start + end + asset + 4 references sends the 4 references, and the runner keeps all 4", () => {
    const { result } = run({ provider: "grok-imagine-video-1.5", data: { duration: 5 }, start: true, end: true, location: true, refs: 4 })
    expect(result.payload.imageUrl).toBe(START)
    expect(result.payload.endFrameUrl).toBe(END)
    expect(result.payload.referenceImageUrls).toEqual([MID(1), MID(2), MID(3), MID(4)])
    const body = buildGrokVideo15Request({
      prompt: String(result.payload.prompt),
      durationSec: Number(result.payload.duration),
      startFrameUrl: result.payload.imageUrl as string,
      endFrameUrl: result.payload.endFrameUrl as string,
      inBetweenFrameUrls: result.payload.referenceImageUrls as string[],
    })
    expect(body.notes).toEqual([])
    expect(body.input.keyframes).toEqual([1, 2, 3, 4].map((i) => ({ url: MID(i), timestamp_s: i })))
  })

  it("Grok: an asset alone (no start frame, no references) is refused with the start-frame sentence", () => {
    expect(() => run({ provider: "grok-imagine-video-1.5", location: true })).toThrow(/grok-imagine-video-1\.5 requires an input image.*\(it needs a start frame\)/)
    try {
      run({ provider: "grok-imagine-video-1.5", location: true })
    } catch (e) {
      expect(String((e as Error).message)).not.toContain("in-between frames")
    }
  })

  it("a wired Character on a keyframes model adds its identity text, never its image", () => {
    const g = graph({ provider: "grok-imagine-video-1.5", start: true, refs: 1 })
    const MAYA = "https://cdn.example/maya.png"
    g.nodes.push({ id: "maya", type: "character", data: { label: "Maya", characterName: "Maya", defaultAssetUrl: MAYA, canonicalDescription: "Short silver hair, green coat" } })
    g.states.maya = { status: "completed", output: { imageUrl: MAYA } }
    g.edges.push({ id: "maya->v", source: "maya", target: "v", sourceHandle: "characterRef", targetHandle: "assets" })
    const inputs = resolveNodeInputs(g.target, g.edges, g.states, g.nodes)
    const { payload } = buildPayload(g.target, "job-1", inputs, undefined, { nodes: g.nodes, edges: g.edges, nodeStates: g.states })
    expect(payload.referenceImageUrls).toEqual([MID(1)])
    expect(payload.imageUrl).toBe(START)
    expect(String(payload.prompt)).toContain("Maya — Short silver hair, green coat")
    expect(JSON.stringify(payload)).not.toContain(MAYA)
  })

  for (const provider of ["grok-i2v", "kling-3.0", "seedance-2"]) {
    it(`${provider} (not a keyframes model) still receives the asset's image`, () => {
      const { result } = run({ provider, start: true, location: true, refs: 1 })
      expect(carriesLocation(result.payload)).toBe(true)
    })
  }
})

// ---------------------------------------------------------------------------
// A keyframes model seats no character: production renders the HYBRID
// reference format (`backendHybridRoles()` is true everywhere but
// NODE_ENV=test), whose seated character would read "the person from
// @image_N" — a picture the run never sends. Both formats must give the
// character's name and description and no image number at all.
// ---------------------------------------------------------------------------
const MAYA = "https://cdn.example/maya.png"
const PANEL = (n: number) => `https://cdn.example/sheet-panel-${n}.png`

/** Run `fn` with the backend's reference format as production renders it ("hybrid") or as tests default ("legacy"). */
function inFormat<T>(format: "legacy" | "hybrid", fn: () => T): T {
  const prevEnv = process.env.NODE_ENV
  const prevFmt = process.env.IMAGE_REFERENCE_FORMAT
  if (format === "hybrid") {
    process.env.NODE_ENV = "development"
    delete process.env.IMAGE_REFERENCE_FORMAT
  }
  try {
    return fn()
  } finally {
    process.env.NODE_ENV = prevEnv
    if (prevFmt === undefined) delete process.env.IMAGE_REFERENCE_FORMAT
    else process.env.IMAGE_REFERENCE_FORMAT = prevFmt
  }
}

/** `graph()` plus a wired Character (Maya) and, optionally, a Reference Sheet whose panels feed Image References. */
function castRun(w: Wiring & { sheetPanels?: number }) {
  const g = graph(w)
  g.nodes.push({ id: "maya", type: "character", data: { label: "Maya", characterName: "Maya", defaultAssetUrl: MAYA, canonicalDescription: "Short silver hair, green coat" } })
  g.states.maya = { status: "completed", output: { imageUrl: MAYA } }
  g.edges.push({ id: "maya->v", source: "maya", target: "v", sourceHandle: "characterRef", targetHandle: "assets" })
  if (w.sheetPanels) {
    const panelUrls = Array.from({ length: w.sheetPanels }, (_, i) => PANEL(i + 1))
    g.nodes.push({ id: "sheet", type: "reference-sheet", data: { label: "Sheet", panelUrls } })
    g.states.sheet = { status: "completed", output: { imageUrl: "https://cdn.example/sheet.png", panelUrls } }
    g.edges.push({ id: "sheet->v", source: "sheet", target: "v", sourceHandle: "panels", targetHandle: "imageReferences" })
  }
  const inputs = resolveNodeInputs(g.target, g.edges, g.states, g.nodes)
  return buildPayload(g.target, "job-1", inputs, undefined, { nodes: g.nodes, edges: g.edges, nodeStates: g.states }).payload
}

describe("keyframes models: a wired character takes no image number (workflow run)", () => {
  for (const provider of ["grok-imagine-video-1.5", "kling-4-keyframes"]) {
    for (const format of ["legacy", "hybrid"] as const) {
      it(`${provider} (${format}): start + 2 Image References + a Character → the 2 frames, and the character's name and description`, () => {
        const payload = inFormat(format, () => castRun({ provider, start: true, refs: 2 }))
        expect(payload.imageUrl).toBe(START)
        expect(payload.referenceImageUrls).toEqual([MID(1), MID(2)])
        const prompt = String(payload.prompt)
        expect(prompt).toContain("Maya — Short silver hair, green coat.")
        expect(prompt).not.toMatch(/@image/)
        expect(prompt).not.toContain("from @")
        expect(JSON.stringify(payload)).not.toContain(MAYA)
      })

      it(`${provider} (${format}): a mention of the character reads as its name`, () => {
        const payload = inFormat(format, () => castRun({ provider, start: true, refs: 2, data: { prompt: "@maya:1 walks to the window" } }))
        const prompt = String(payload.prompt)
        expect(prompt).toContain("Maya walks to the window")
        expect(prompt).not.toMatch(/@maya|@image/)
        expect(payload.referenceImageUrls).toEqual([MID(1), MID(2)])
      })

      it(`${provider} (${format}): a Reference Sheet edge feeding two frames plus a Character → the two panels, no image number for the character`, () => {
        const payload = inFormat(format, () => castRun({ provider, start: true, sheetPanels: 2 }))
        expect(payload.referenceImageUrls).toEqual([PANEL(1), PANEL(2)])
        const prompt = String(payload.prompt)
        expect(prompt).toContain("Maya — Short silver hair, green coat.")
        expect(prompt).not.toMatch(/@image/)
        expect(JSON.stringify(payload)).not.toContain(MAYA)
      })
    }
  }

  it("seedance-2 (not a keyframes model, hybrid) still seats the character after the references", () => {
    const payload = inFormat("hybrid", () => castRun({ provider: "seedance-2", start: true, refs: 2 }))
    expect(payload.referenceImageUrls).toEqual(expect.arrayContaining([MID(1), MID(2), MAYA]))
    expect(String(payload.prompt)).toMatch(/from @image_3/)
  })
})
