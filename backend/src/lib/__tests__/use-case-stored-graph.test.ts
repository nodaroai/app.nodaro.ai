/**
 * The gate a stored use-case snapshot passes before a continuation reads it
 * (`isStoredInlineGraph`), as widened for result kinds: a P1 snapshot (no
 * `kind`) still passes; an unknown kind, a format list with no format, and a
 * wire whose data is anything but exactly `{ outputMode: "each" }` do not.
 */
import { describe, it, expect } from "vitest"
import { TIGHTEN_EPISODE_DEFAULTS, buildTightenEpisodeGraph, isStoredInlineGraph, toStoredInlineGraph } from "@nodaro/render-rules"

type Snapshot = { readonly outputMap: Readonly<Record<string, unknown>>; readonly edges: ReadonlyArray<Record<string, unknown>>; readonly [k: string]: unknown }
const stored = (): Snapshot =>
  JSON.parse(JSON.stringify(toStoredInlineGraph(buildTightenEpisodeGraph(TIGHTEN_EPISODE_DEFAULTS, { media: { url: "https://r2/ep.mp4", kind: "video" } }), TIGHTEN_EPISODE_DEFAULTS)))
const withMap = (patch: Record<string, unknown>) => {
  const s = stored()
  return { ...s, outputMap: { ...s.outputMap, ...patch } }
}
const withFirstEdgeData = (data: unknown) => {
  const s = stored()
  return { ...s, edges: s.edges.map((e, i) => (i === 0 ? { ...e, data } : e)) }
}

describe("isStoredInlineGraph: the widened gate", () => {
  it("a P1 snapshot (its output map names no kind) passes", () => {
    const s = stored()
    expect(s.outputMap).not.toHaveProperty("kind")
    expect(isStoredInlineGraph(s)).toBe(true)
  })
  it("each known kind passes with the fields it needs", () => {
    const s = stored()
    const { media, preview, renderNodeId, json, transcript, planNodeId } = s.outputMap
    expect(isStoredInlineGraph(withMap({ kind: "episode" }))).toBe(true)
    expect(isStoredInlineGraph(withMap({ kind: "clips" }))).toBe(true)
    expect(isStoredInlineGraph({ ...s, outputMap: { kind: "formats", formats: [{ format: "9:16", ref: media }], preview, renderNodeId, json, transcript, planNodeId } })).toBe(true)
    expect(isStoredInlineGraph({ ...s, outputMap: { kind: "chapters", json, transcript, planNodeId } })).toBe(true)
  })
  it("an unknown output-map kind fails", () => {
    expect(isStoredInlineGraph(withMap({ kind: "podcast" }))).toBe(false)
  })
  it("a format list with no format fails (a Trailer always delivers at least one)", () => {
    const s = stored()
    const { preview, renderNodeId, json, transcript, planNodeId } = s.outputMap
    expect(isStoredInlineGraph({ ...s, outputMap: { kind: "formats", formats: [], preview, renderNodeId, json, transcript, planNodeId } })).toBe(false)
  })
  it("a rendering kind without its render fails", () => {
    expect(isStoredInlineGraph(withMap({ kind: "clips", renderNodeId: undefined }))).toBe(false)
  })
  it("a multicam run's Audio Sync and Speaker Map refs, when present, are well-formed", () => {
    const ref = { nodeId: "uc-sync", handle: "json" }
    expect(isStoredInlineGraph(withMap({ multicam: { sync: ref, map: { nodeId: "uc-map", handle: "json" } } }))).toBe(true)
    expect(isStoredInlineGraph(withMap({ multicam: { sync: ref } }))).toBe(true)
    expect(isStoredInlineGraph(withMap({ multicam: {} }))).toBe(true)
    expect(isStoredInlineGraph(withMap({ multicam: { map: "x" } }))).toBe(false)
    expect(isStoredInlineGraph(withMap({ multicam: "x" }))).toBe(false)
    expect(isStoredInlineGraph(withMap({ multicam: [ref] }))).toBe(false)
  })
  it("a one-recording build names no multicam refs", () => {
    expect(stored().outputMap).not.toHaveProperty("multicam")
  })
  it("a wire's data is absent or exactly an Each mode", () => {
    expect(isStoredInlineGraph(withFirstEdgeData({ outputMode: "each" }))).toBe(true)
    expect(isStoredInlineGraph(withFirstEdgeData({ outputMode: "last" }))).toBe(false)
    expect(isStoredInlineGraph(withFirstEdgeData({ outputMode: "each", extra: 1 }))).toBe(false)
    expect(isStoredInlineGraph(withFirstEdgeData({}))).toBe(false)
  })
})
