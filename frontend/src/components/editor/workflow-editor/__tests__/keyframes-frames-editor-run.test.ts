import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * The editor's Run on a keyframes model (Grok Imagine Video 1.5, Kling 4.0
 * Keyframes): the in-between frames are exactly what is wired into the node's
 * Image References, in order (decided 2026-11-11). A wired asset — a Location
 * on the Assets handle here — lands in the resolver's reference list by source
 * type, so this runs the REAL input resolver (node-input-resolver.ts) and
 * execution graph, and stubs only the store and the API call.
 */
// Production renders the HYBRID reference format (the module constant is
// "legacy" under test); a getter lets one file run both.
const refFormat = vi.hoisted(() => ({ value: "legacy" as "legacy" | "hybrid" }))
vi.mock("@/lib/image-reference-format", () => ({
  get IMAGE_REFERENCE_FORMAT() {
    return refFormat.value
  },
}))

const mockRunVideoGeneration = vi.fn()
const mockRunTextToVideoGeneration = vi.fn()
const mockToastError = vi.fn()
let mockNodes: any[] = []
let mockEdges: any[] = []

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: {
    getState: () => ({
      updateNodeData: vi.fn(),
      nodes: mockNodes,
      edges: mockEdges,
      characterDefinitions: [],
      userPromptTemplates: {},
      flowPromptTemplates: {},
    }),
  },
}))

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: (...a: unknown[]) => mockToastError(...a), success: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}))

vi.mock("../node-executors", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../node-executors")>()),
  runVideoGeneration: (...args: unknown[]) => mockRunVideoGeneration(...args),
  runTextToVideoGeneration: (...args: unknown[]) => mockRunTextToVideoGeneration(...args),
}))

import { executeNode } from "../execute-node"

const START = "https://cdn.example/start.png"
const END = "https://cdn.example/end.png"
const LOCATION = "https://cdn.example/old-library.png"
const MID = (n: number) => `https://cdn.example/mid-${n}.png`
/** runVideoGeneration's positional arguments the assertions read. */
const START_ARG = 1
const END_ARG = 3
const REFS_ARG = 22

function ctx() {
  return {
    userId: "u1",
    projectId: "p1",
    trackInterval: (i: unknown) => i,
    untrackInterval: vi.fn(),
    save: vi.fn(),
    setIsRunning: vi.fn(),
    isWorkflowStale: () => false,
    isStorageError: () => false,
    setShowStorageExceeded: vi.fn(),
    setStorageExceededData: vi.fn(),
    setShowInsufficientCredits: vi.fn(),
  } as any
}

function wire(w: { provider: string; data?: Record<string, unknown>; start?: boolean; end?: boolean; location?: boolean; refs?: number }) {
  const node = { id: "v", type: "generate-video", position: { x: 0, y: 0 }, data: { label: "Video", provider: w.provider, prompt: "she walks to the window", ...w.data } }
  const nodes: any[] = [node]
  const edges: any[] = []
  const upload = (id: string, url: string, targetHandle: string) => {
    nodes.push({ id, type: "upload-image", position: { x: 0, y: 0 }, data: { label: id, url } })
    edges.push({ id: `${id}->v`, source: id, target: "v", sourceHandle: null, targetHandle })
  }
  if (w.start) upload("start", START, "startFrame")
  if (w.end) upload("end", END, "endFrame")
  if (w.location) {
    nodes.push({ id: "loc", type: "location", position: { x: 0, y: 0 }, data: { label: "Old Library", locationName: "Old Library", sourceImageUrl: LOCATION } })
    edges.push({ id: "loc->v", source: "loc", target: "v", sourceHandle: "locationRef", targetHandle: "assets" })
  }
  for (let i = 1; i <= (w.refs ?? 0); i++) upload(`m${i}`, MID(i), "imageReferences")
  mockNodes = nodes
  mockEdges = edges
  return node
}

const sent = () => mockRunVideoGeneration.mock.calls[0] as unknown[]
const carriesLocation = (args: unknown[]) => JSON.stringify(args).includes(LOCATION)

beforeEach(() => {
  vi.clearAllMocks()
  refFormat.value = "legacy"
  mockRunVideoGeneration.mockResolvedValue(undefined)
  mockRunTextToVideoGeneration.mockResolvedValue(undefined)
})

describe("editor Run: a keyframes model takes only the Image References as in-between frames", () => {
  for (const provider of ["grok-imagine-video-1.5", "kling-4-keyframes"]) {
    it(`${provider}: start + Location asset + 1 reference sends only the reference`, async () => {
      await executeNode(wire({ provider, start: true, location: true, refs: 1 }) as any, ctx())
      expect(mockRunVideoGeneration).toHaveBeenCalledTimes(1)
      expect(sent()[START_ARG]).toBe(START)
      expect(sent()[REFS_ARG]).toEqual([MID(1)])
      expect(carriesLocation(sent())).toBe(false)
    })

    it(`${provider}: a stored reference order still orders the frames`, async () => {
      await executeNode(wire({ provider, start: true, location: true, refs: 3, data: { referenceImageOrder: ["m3", "m1", "m2"] } }) as any, ctx())
      expect(sent()[REFS_ARG]).toEqual([MID(3), MID(1), MID(2)])
      expect(carriesLocation(sent())).toBe(false)
    })
  }

  it("Grok at 5 s: start + end + asset + 4 references sends the 4 references", async () => {
    await executeNode(wire({ provider: "grok-imagine-video-1.5", data: { duration: 5 }, start: true, end: true, location: true, refs: 4 }) as any, ctx())
    expect(sent()[START_ARG]).toBe(START)
    expect(sent()[END_ARG]).toBe(END)
    expect(sent()[REFS_ARG]).toEqual([MID(1), MID(2), MID(3), MID(4)])
    expect(carriesLocation(sent())).toBe(false)
  })

  it("Grok: an asset alone is not run as an image-to-video job (no start frame, no in-between frames)", async () => {
    await executeNode(wire({ provider: "grok-imagine-video-1.5", location: true }) as any, ctx()).catch(() => undefined)
    // With no start frame and no Image References the run takes the
    // text-to-video lane, whose image gate refuses this model; nothing sends
    // the asset as a frame.
    expect(mockRunVideoGeneration).not.toHaveBeenCalled()
    for (const call of mockRunTextToVideoGeneration.mock.calls) expect(JSON.stringify(call)).not.toContain(LOCATION)
  })

  for (const provider of ["grok-i2v", "seedance-2"]) {
    it(`${provider} (not a keyframes model) still receives the asset's image`, async () => {
      await executeNode(wire({ provider, start: true, location: true, refs: 1 }) as any, ctx())
      expect(carriesLocation(sent())).toBe(true)
    })
  }
})

// A keyframes model seats no character: in the hybrid format a seated
// character reads "the person from @image_N" — a picture the run never sends.
// Both formats give the character's name and description, and no image number.
describe("editor Run: a keyframes model gives a wired character no image number", () => {
  const MAYA = "https://cdn.example/maya.png"
  const PANEL = (n: number) => `https://cdn.example/sheet-panel-${n}.png`
  /** runVideoGeneration's prompt argument. */
  const PROMPT_ARG = 8

  function cast(w: Parameters<typeof wire>[0] & { sheetPanels?: number }) {
    const node = wire(w)
    mockNodes.push({
      id: "maya",
      type: "character",
      position: { x: 0, y: 0 },
      data: { label: "Maya", characterName: "Maya", sourceImageUrl: MAYA, defaultAssetUrl: MAYA, canonicalDescription: "Short silver hair, green coat" },
    })
    mockEdges.push({ id: "maya->v", source: "maya", target: "v", sourceHandle: "characterRef", targetHandle: "assets" })
    if (w.sheetPanels) {
      const panelUrls = Array.from({ length: w.sheetPanels }, (_, i) => PANEL(i + 1))
      mockNodes.push({ id: "sheet", type: "reference-sheet", position: { x: 0, y: 0 }, data: { label: "Sheet", panelUrls, imageUrl: "https://cdn.example/sheet.png" } })
      mockEdges.push({ id: "sheet->v", source: "sheet", target: "v", sourceHandle: "panels", targetHandle: "imageReferences" })
    }
    return node
  }

  for (const provider of ["grok-imagine-video-1.5", "kling-4-keyframes"]) {
    for (const format of ["legacy", "hybrid"] as const) {
      it(`${provider} (${format}): start + 2 Image References + a Character → the 2 frames, and the character's name and description`, async () => {
        refFormat.value = format
        await executeNode(cast({ provider, start: true, refs: 2 }) as any, ctx())
        expect(sent()[START_ARG]).toBe(START)
        expect(sent()[REFS_ARG]).toEqual([MID(1), MID(2)])
        const prompt = String(sent()[PROMPT_ARG])
        expect(prompt).toContain("Maya — Short silver hair, green coat.")
        expect(prompt).not.toMatch(/@image/)
        expect(prompt).not.toContain("from @")
        expect(JSON.stringify(sent())).not.toContain(MAYA)
      })

      it(`${provider} (${format}): a mention of the character reads as its name`, async () => {
        refFormat.value = format
        await executeNode(cast({ provider, start: true, refs: 2, data: { prompt: "@maya:1 walks to the window" } }) as any, ctx())
        const prompt = String(sent()[PROMPT_ARG])
        expect(prompt).toContain("Maya walks to the window")
        expect(prompt).not.toMatch(/@maya|@image/)
        expect(sent()[REFS_ARG]).toEqual([MID(1), MID(2)])
      })

      it(`${provider} (${format}): a Reference Sheet edge feeding two frames plus a Character → the two panels, no image number for the character`, async () => {
        refFormat.value = format
        await executeNode(cast({ provider, start: true, sheetPanels: 2 }) as any, ctx())
        expect(sent()[REFS_ARG]).toEqual([PANEL(1), PANEL(2)])
        const prompt = String(sent()[PROMPT_ARG])
        expect(prompt).toContain("Maya — Short silver hair, green coat.")
        expect(prompt).not.toMatch(/@image/)
        expect(JSON.stringify(sent())).not.toContain(MAYA)
      })
    }
  }

  it("seedance-2 (not a keyframes model, hybrid) still seats the character after the references", async () => {
    refFormat.value = "hybrid"
    await executeNode(cast({ provider: "seedance-2", start: true, refs: 2 }) as any, ctx())
    expect(JSON.stringify(sent())).toContain(MAYA)
    expect(String(sent()[PROMPT_ARG])).toMatch(/from @image_3/)
  })
})
