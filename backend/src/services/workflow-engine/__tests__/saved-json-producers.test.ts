/**
 * The node types whose SAVED json the engine hands downstream — the backend
 * side of the editor's json census (A5.0).
 *
 * A node outside a "Run from here" subset, or frozen with Skip, is seeded from
 * its saved data (`extractSavedNodeOutput`), and for these types the `json` it
 * hands on is read off a field of `node.data`. That field is only ever written
 * by the editor, from the run's result — so every server run's json must reach
 * it through the editor's lanes, or the next Run from here seeds a stale value.
 *
 * The list is COMPUTED here, from the reader itself, never kept by hand: every
 * registered node type is given saved data in which every field the reader
 * reads carries a marker, and a type counts when the `json` it hands on carries
 * one. Each is then traced to the one field it comes from. The result is pinned
 * in `fixtures/saved-json-producers.json`, which the editor's census
 * (frontend `json-run-result-census.test.ts`) holds its result lanes to.
 */
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { NODE_REGISTRY } from "../../../lib/node-registry.js"
import { buildNodeOutputFromJobData, extractSavedNodeOutput } from "../output-extractor.js"
import census from "./fixtures/saved-json-producers.json"
import realRuns from "./fixtures/server-run-json-results.json"

const MARK = "saved-json-census"
const PLAIN = "plain-saved-value"
const url = (ext: string) => `https://media.example.test/${MARK}.${ext}`
const POST = { id: MARK, url: url("html"), text: MARK, platform: "tiktok", author: { handle: MARK, name: MARK }, metrics: {}, media: {}, hashtags: [], extra: {} }

/** A value for every field the saved reader reads, each carrying the marker where it can. */
const SAVED: Record<string, unknown> = {
  __injectedPortValues: { port: MARK },
  activeResultIndex: 0,
  activeVideoResultIndex: 0,
  alignmentResults: [{ word: MARK, start: 0, end: 1 }],
  approved: true,
  combinedText: MARK,
  defaultAssetUrl: url("png"),
  details: { note: MARK },
  extractedText: MARK,
  featuredIndex: 0,
  feedback: MARK,
  generatedAudioUrl: url("mp3"),
  generatedAudioUrls: [url("mp3")],
  generatedImageUrl: url("png"),
  generatedJson: { marker: MARK },
  generatedMaskUrl: url("png"),
  generatedPickerJson: { marker: MARK },
  generatedResults: [{ url: url("png"), text: MARK, timestamp: "2026-10-04T00:00:00.000Z", jobId: MARK }],
  generatedText: MARK,
  generatedVideoResults: [{ url: url("mp4"), timestamp: "2026-10-04T00:00:00.000Z", jobId: MARK }],
  generatedVideoUrl: url("mp4"),
  generatedVideoUrls: [url("mp4")],
  generatedVoiceId: MARK,
  ideaBriefs: [MARK],
  instrumentalUrl: url("mp3"),
  lastInputType: "audio",
  listResults: [MARK, MARK],
  outputResults: { out: url("png") },
  overlayVariants: [{ id: MARK, url: url("png") }],
  pickedResults: [MARK],
  plan: { marker: MARK },
  previewItems: [{ type: "text", value: MARK, visible: true }],
  processedResult: { marker: MARK },
  prompt: MARK,
  reason: MARK,
  restResults: [MARK],
  result: MARK,
  routeSnapshot: { visibleOutputPortId: MARK },
  sceneGraph: { marker: MARK },
  scenePlan: { marker: MARK },
  score: 1,
  sourceImageUrl: url("png"),
  splitResults: [MARK],
  summary: MARK,
  url: url("bin"),
  vocalUrl: url("mp3"),
}
/** A json result is an object for most producers and an array for a few (Content Ideas, Social Search, a Clips plan). */
const JSON_SHAPES: readonly unknown[] = [{ marker: MARK }, [POST]]

const unmarked = (value: unknown): unknown => JSON.parse(JSON.stringify(value).split(MARK).join(PLAIN))
const handsOnMarkedJson = (type: string, data: Record<string, unknown>): boolean => {
  let out: ReturnType<typeof extractSavedNodeOutput>
  try {
    out = extractSavedNodeOutput({ id: "n", type, data } as Parameters<typeof extractSavedNodeOutput>[0])
  } catch {
    return false
  }
  return out?.json !== undefined && JSON.stringify(out.json).includes(MARK)
}

/** type → the saved field its json is read from. */
function computeCensus(): Record<string, string> {
  const types = [...new Set(NODE_REGISTRY.map((d) => d.type))].sort()
  const found: Record<string, string> = {}
  for (const type of types) {
    for (const shape of JSON_SHAPES) {
      const saved: Record<string, unknown> = { ...SAVED, generatedJson: shape }
      if (!handsOnMarkedJson(type, saved)) continue
      const plain = Object.fromEntries(Object.entries(saved).map(([k, v]) => [k, unmarked(v)]))
      const fields = Object.keys(saved).filter((field) => handsOnMarkedJson(type, { ...plain, [field]: saved[field] }))
      if (fields.length !== 1) throw new Error(`${type}: its saved json comes from ${fields.length} fields (${fields.join(", ")})`)
      found[type] = fields[0]!
    }
  }
  return Object.fromEntries(Object.entries(found).sort(([a], [b]) => a.localeCompare(b)))
}

describe("the node types whose saved json the engine hands downstream", () => {
  it("are exactly the pinned census — a change here needs the editor to land that json (frontend lib/json-run-result.ts)", () => {
    expect(computeCensus(), "update fixtures/saved-json-producers.json, then map the run's json in the editor's result lanes").toEqual(census)
  })

  it("the census gives a value to every field the saved reader reads (so no json can come from a field it never set)", () => {
    const src = readFileSync(join(__dirname, "..", "output-extractor.ts"), "utf8")
    const start = src.indexOf("export function extractSavedNodeOutput(")
    const end = src.slice(start + 1).search(/\n(?:export )?function /)
    const body = src.slice(start, start + 1 + end)
    const read = new Set([...body.matchAll(/\bdata\.(\w+)/g), ...body.matchAll(/\bdata\[\s*["'](\w+)["']\s*\]/g)].map((m) => m[1]!))
    expect([...read].filter((field) => !(field in SAVED)), "give each a value in SAVED").toEqual([])
  })
})

describe("the real staging payloads in fixtures/server-run-json-results.json", () => {
  // A job row's output_data becomes the node output the editor is sent through
  // ONE rule (buildNodeOutputFromJobData). The editor's job lanes mirror its
  // json half (frontend lib/json-run-result.ts :: jobRunOutput); on these real
  // rows the two shapes are exactly the run's node states.
  it.each(["a50-plan", "a50-transcribe", "a50-silence", "a50-apply"] as const)("%s: the job row builds the node output the run carried", (nodeId) => {
    const node = realRuns.workflow.nodes.find((n) => n.id === nodeId)!
    const job = realRuns.jobs[nodeId] as { output_data: Record<string, unknown> }
    const state = (realRuns.fullRun.nodeStates as Record<string, { output: unknown }>)[nodeId]!
    expect(buildNodeOutputFromJobData(job.output_data, node.type)).toEqual(state.output)
  })

  it("a Clips plan's job row: the bare Edl[] on json, one JSON string per clip on listResults", () => {
    const plan = realRuns.jobs["a50-plan"].output_data as Record<string, unknown>
    const clips = [plan, plan]
    expect(buildNodeOutputFromJobData({ version: 1, clips, viaNodaroCloud: true }, "edit-plan")).toEqual({
      json: clips,
      listResults: clips.map((c) => JSON.stringify(c)),
    })
  })
})
