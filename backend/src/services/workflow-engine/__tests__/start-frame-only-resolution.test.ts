import { describe, it, expect } from "vitest"
import { resolveNodeInputs } from "../input-resolver.js"
import { buildPayload } from "../payload-builder.js"
import type { SimpleNode, SimpleEdge, NodeExecutionState } from "../types.js"

/**
 * Grok Imagine Video 1.5 takes a start frame only at 1080p (decided 2026-11-12:
 * refuse up front). The workflow run refuses such a node in `buildPayload` —
 * which node-executor runs before the reservation, deleting the pending row on
 * a throw — with the same sentence as `/v1/generate-video` and the editor's
 * Run. These run the REAL input resolver, then `buildPayload`, so the frames
 * judged are the ones the run would send.
 */
const START = "https://cdn.example/start.png"
const END = "https://cdn.example/end.png"
const MID = (n: number) => `https://cdn.example/mid-${n}.png`
const SENTENCE =
  "Grok Imagine Video 1.5 takes a start frame only at 1080p: no end frame, loop or in-between frames. " +
  "Choose 720p, or remove the end frame and the in-between frames. Nothing was charged."

interface Wiring {
  type: "generate-video" | "image-to-video"
  resolution?: string
  duration?: number
  start?: boolean
  /** The end frame's picture: END, or START for a loop. */
  end?: string
  refs?: number
}

function run(w: Wiring) {
  const refHandle = w.type === "generate-video" ? "imageReferences" : "references"
  const target: SimpleNode = {
    id: "v",
    type: w.type,
    data: { label: "Video", provider: "grok-imagine-video-1.5", prompt: "she walks to the window", resolution: w.resolution, duration: w.duration ?? 8 },
  }
  const nodes: SimpleNode[] = [target]
  const edges: SimpleEdge[] = []
  const states: Record<string, NodeExecutionState> = {}
  const upload = (id: string, url: string, targetHandle: string) => {
    nodes.push({ id, type: "upload-image", data: { label: id, imageUrl: url } })
    states[id] = { status: "completed", output: { imageUrl: url } }
    edges.push({ id: `${id}->v`, source: id, target: "v", sourceHandle: null, targetHandle })
  }
  if (w.start) upload("start", START, "startFrame")
  if (w.end) upload("end", w.end, "endFrame")
  for (let i = 1; i <= (w.refs ?? 0); i++) upload(`m${i}`, MID(i), refHandle)
  const inputs = resolveNodeInputs(target, edges, states, nodes)
  return () => buildPayload(target, "job-1", inputs, undefined, { nodes, edges, nodeStates: states })
}

describe("workflow run: Grok Imagine Video 1.5 takes a start frame only at 1080p", () => {
  for (const type of ["generate-video", "image-to-video"] as const) {
    const refusals: Array<[string, Partial<Wiring>]> = [
      ["an end frame", { end: END }],
      ["a loop", { end: START }],
      ["in-between frames", { refs: 2 }],
      ["an end frame and in-between frames", { end: END, refs: 2 }],
    ]
    for (const [what, wiring] of refusals) {
      it(`${type}: refuses ${what} at 1080p before the reservation, with the route's sentence`, () => {
        expect(run({ type, resolution: "1080p", start: true, ...wiring })).toThrow(SENTENCE)
      })
      it(`${type}: runs ${what} at 720p and 480p`, () => {
        for (const resolution of ["720p", "480p"]) {
          const result = run({ type, resolution, start: true, ...wiring })()
          expect(result.payload.resolution).toBe(resolution)
        }
      })
    }

    it(`${type}: runs a lone start frame at 1080p`, () => {
      const result = run({ type, resolution: "1080p", start: true })()
      expect(result.payload.imageUrl).toBe(START)
      expect(result.payload.resolution).toBe("1080p")
    })

    it(`${type}: runs at 1080p when a 1-second clip's cap drops every in-between frame`, () => {
      const result = run({ type, resolution: "1080p", duration: 1, start: true, refs: 3 })()
      expect(result.payload.resolution).toBe("1080p")
    })

    it(`${type}: refuses at 1080p when a 2-second clip keeps one in-between frame`, () => {
      expect(run({ type, resolution: "1080p", duration: 2, start: true, refs: 3 })).toThrow(SENTENCE)
    })
  }

  it("generate-video: a lone end frame moves into the start slot, a start-only run that runs at 1080p", () => {
    const result = run({ type: "generate-video", resolution: "1080p", end: END })()
    expect(result.payload.imageUrl).toBe(END)
    expect(result.payload.endFrameUrl).toBeUndefined()
    expect(result.payload.resolution).toBe("1080p")
  })
})
