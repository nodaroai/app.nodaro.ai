import { describe, it, expect } from "vitest"
import { resolveNodeInputs, getListInputForNode } from "../input-resolver.js"
import type { SimpleNode, SimpleEdge, NodeExecutionState } from "../types.js"

/**
 * Regression guard for backend↔shared producer-set drift.
 *
 * The backend input-resolver kept hand-maintained copies of the video/audio
 * output-routing sets and the fan-out "each" set. They drifted from the shared
 * single source of truth (@nodaro/shared producer-types):
 *   - VIDEO/AUDIO_OUTPUT_NODE_TYPES were missing face-swap / remove-audio /
 *     extract-audio → those outputs fell through to the `prompt` fallback on
 *     server-side DAG runs (downstream video/audio consumer got nothing).
 *   - DEFAULT_EACH_TYPES was missing the four list-transform types → server
 *     runs silently dropped all-but-the-first item while the canvas fanned out.
 *
 * Both sets are now derived from @nodaro/shared. These behavioural tests fail if
 * the routing/fan-out for these node types ever regresses again.
 */

function node(id: string, type: string, data: Record<string, unknown> = {}): SimpleNode {
  return { id, type, data: { label: id, ...data } }
}

function edge(
  source: string,
  target: string,
  sourceHandle?: string | null,
  targetHandle?: string | null,
  data?: Record<string, unknown>,
): SimpleEdge {
  return {
    id: `${source}->${target}`,
    source,
    target,
    sourceHandle: sourceHandle ?? null,
    targetHandle: targetHandle ?? null,
    data,
  }
}

describe("input-resolver — video/audio output routing (producer-set drift guard)", () => {
  it("routes face-swap output to the downstream videoUrl (not the prompt fallback)", () => {
    const target = node("t", "trim-video")
    const src = node("s", "face-swap")
    const states: Record<string, NodeExecutionState> = {
      s: { status: "completed", output: { videoUrl: "https://swap.mp4" } },
    }
    const result = resolveNodeInputs(target, [edge("s", "t")], states, [src, target])
    expect(result.videoUrl).toBe("https://swap.mp4")
  })

  it("routes remove-audio output to the downstream videoUrl (not the prompt fallback)", () => {
    const target = node("t", "trim-video")
    const src = node("s", "remove-audio")
    const states: Record<string, NodeExecutionState> = {
      s: { status: "completed", output: { videoUrl: "https://silent.mp4" } },
    }
    const result = resolveNodeInputs(target, [edge("s", "t")], states, [src, target])
    expect(result.videoUrl).toBe("https://silent.mp4")
  })

  it("routes extract-audio output to the downstream audio input (not the prompt fallback)", () => {
    const target = node("t", "merge-video-audio")
    const src = node("s", "extract-audio")
    const states: Record<string, NodeExecutionState> = {
      s: { status: "completed", output: { audioUrl: "https://track.mp3" } },
    }
    const result = resolveNodeInputs(target, [edge("s", "t")], states, [src, target])
    expect(result.audioSources).toBeDefined()
    expect(result.audioSources![0].url).toBe("https://track.mp3")
  })
})

describe("input-resolver — list-transform fan-out (DEFAULT_EACH_TYPES drift guard)", () => {
  for (const type of ["filter-list", "deduplicate", "merge-lists", "sort-list"]) {
    it(`fans out ${type} output per-item on a default edge`, () => {
      const target = node("g", "generate-image")
      const src = node("s", type)
      const states: Record<string, NodeExecutionState> = {
        s: { status: "completed", output: { listResults: ["a", "b", "c"] } },
      }
      const items = getListInputForNode(target, [edge("s", "g")], states, [src, target])
      expect(items).toEqual(["a", "b", "c"])
    })
  }

  it("still respects an explicit outputMode='last' edge (no fan-out)", () => {
    const target = node("g", "generate-image")
    const src = node("s", "filter-list")
    const states: Record<string, NodeExecutionState> = {
      s: { status: "completed", output: { listResults: ["a", "b", "c"] } },
    }
    const items = getListInputForNode(
      target,
      [edge("s", "g", null, null, { outputMode: "last" })],
      states,
      [src, target],
    )
    expect(items).toBeUndefined()
  })
})

// A list operator READS the whole list wired into it; run once per item it
// would see the same whole list every time and answer with its first match —
// a Filter List fed 11 stories by a Split Text handed 11 copies of story one
// downstream (2026-10-06). The planner never fans one out, whatever the wire.
describe("input-resolver — list operators are never fanned out (fan-in targets)", () => {
  const sources: Array<[string, NodeExecutionState]> = [
    ["split-text", { status: "completed", output: { text: "a", splitResults: ["a", "b", "c"], listResults: ["a", "b", "c"] } }],
    ["filter-list", { status: "completed", output: { text: "a", listResults: ["a", "b", "c"] } }],
    ["llm-chat", { status: "completed", output: { text: "c", listResults: ["a", "b", "c"] } }],
  ]
  for (const type of ["filter-list", "deduplicate", "merge-lists", "sort-list", "selector"]) {
    for (const [srcType, srcState] of sources) {
      it(`${srcType} (each) → ${type}: one run over the whole list`, () => {
        const target = node("t", type)
        const src = node("s", srcType)
        const states: Record<string, NodeExecutionState> = { s: srcState }
        const items = getListInputForNode(target, [edge("s", "t", null, "in", { outputMode: "each" })], states, [src, target])
        expect(items).toBeUndefined()
      })
    }
  }

  it("the same each wire into a generating node still fans it out", () => {
    const target = node("g", "generate-image")
    const src = node("s", "split-text")
    const states: Record<string, NodeExecutionState> = {
      s: { status: "completed", output: { text: "a", splitResults: ["a", "b", "c"], listResults: ["a", "b", "c"] } },
    }
    const items = getListInputForNode(target, [edge("s", "g", null, "prompt", { outputMode: "each" })], states, [src, target])
    expect(items).toEqual(["a", "b", "c"])
  })
})
