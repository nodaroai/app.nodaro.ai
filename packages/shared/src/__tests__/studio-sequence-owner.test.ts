import { describe, it, expect } from "vitest"

import {
  STUDIO_SEQUENCE_PLANNING_KEYS,
  STUDIO_SEQUENCE_UNIT_REVIEW_KEYS,
  STUDIO_TAKE_SEQUENCE_KEYS,
  stripStudioDraftSettings,
  stripStudioDraftWorkflow,
  stripStudioTakeVoiceRecords,
  stripStudioTransientSettings,
} from "../studio-transient.js"

/**
 * A LINKED (keyframe / sequence) production's sequence planning state is the
 * owner's (studio ruling T87). The studio codec's own view withholds it from
 * every reader who is not the owner (`toProductionView`, `includeOwnerState:
 * false`); these strips withhold, from the stored row, the parts the codec's
 * reader can do without:
 *
 * - `sequenceEndpoints` on a take's result row (a canvas node's
 *   `data.generatedResults`);
 * - `settings.studio.sequenceRecommendations`;
 * - `continuationAcceptance` on each sequence take's units.
 *
 * Everything else of a take — `sequenceGenerationPolicies`, a take's `policy`
 * and `compilation`, the unit video nodes' `sequenceUnitResults` — stays,
 * because the codec refuses to read a production with takes without it.
 */

const NOW = "2026-09-08T12:00:00.000Z"
const PIN = (keyframeId: string, key: string) => ({ keyframeId, planRevision: 1, resultKey: key, jobId: key,
  assetId: key, contentHash: "a".repeat(64), width: 10, height: 10 })
/** A linked clip's submitted endpoint pins. */
const PINS = { sequenceId: "zoom", sequenceRevision: 1, start: PIN("A", "frame-private-a"), end: PIN("B", "frame-private-b") }
const POLICY = { conditioning: "video-continue", clipLength: "max", boundaryPolicy: "outer-frames",
  lockedBoundaryKeyframeIds: [], provider: "wan-3", resolution: "480p", aspectRatio: "16:9", referenceAssetIds: [] }
const COMPILATION = { compilerVersion: "c1", capabilityFingerprint: "exact", renderPlanHash: "plan-1", ready: true, issues: [],
  units: [{ id: "zoom:u0", coverage: [{ shotId: "AB", fromSec: 0, toSec: 4 }], outputDurationSec: 4, generationDurationSec: 4,
    conditioning: "start-end", startKeyframeId: "A", endKeyframeId: "B", guidanceOnlyKeyframeIds: [], reused: false, prerequisites: [] }] }
const REVIEW = { resultKey: "result0", acceptedBy: "owner-actor-private", acceptedAt: NOW,
  review: { composition: true, motion: true, subjects: true, continuity: true } }
const RECOMMENDATION = { id: "rec-1", createdAt: NOW, sequenceId: "zoom", authoringHash: "h1", capabilityFingerprint: "exact",
  priorityHash: "p1", recommendation: { policy: POLICY, reasons: ["a private director reason"], assumptions: [] },
  provenance: { source: "director", jobId: "job-private", analysisRevision: "rev-1", llmModel: "model-x" } }

/** A linked scene's clip node (its take carries the pins) and one unit video node of a take. */
function linkedNodes(): Array<Record<string, unknown>> {
  return [
    { id: "clip-AB", type: "generate-video", position: { x: 0, y: 0 }, data: { prompt: "Approach",
      sequenceBinding: { sequenceId: "zoom", startKeyframeId: "A", endKeyframeId: "B", continuity: "continuous" },
      generatedResults: [{ url: "https://r2/clip.mp4", jobId: "clip-1", sequenceEndpoints: PINS }] } },
    { id: "owner0", type: "generate-video", position: { x: 680, y: 0 }, data: { sequenceUnitId: "zoom:u0",
      sequenceUnitResults: [{ url: "https://r2/unit0.mp4", requestHash: "request-0",
        pin: { unitId: "zoom:u0", resultKey: "result0", jobId: "result0", assetId: "asset-0", contentHash: "hash-0", durationSec: 4 } }],
      generatedVideoUrl: "https://r2/unit0.mp4", generatedResults: [{ videoUrl: "https://r2/unit0.mp4", jobId: "result0" }] } },
  ]
}

/** `settings.studio` of a linked production with a take, as the codec writes it. */
function linkedStudio(): Record<string, unknown> {
  return {
    version: 3,
    shots: [{ id: "AB", sequenceBinding: { sequenceId: "zoom", startKeyframeId: "A", endKeyframeId: "B", continuity: "continuous" } }],
    requiredCapabilities: ["studio-dependent-frames-v1", "studio-sequence-takes-v1"],
    keyframes: [{ imageNodeId: "frame-A", plan: { id: "A", label: "A", revision: 1, frame: { prompt: "A" }, requirements: [] } }],
    sequences: [{ id: "zoom", name: "Zoom", revision: 1, construction: "nested-zoom", shotIds: ["AB"] }],
    sequenceGenerationPolicies: { zoom: POLICY },
    sequenceTakes: [{ id: "take1", sequenceId: "zoom", authoringHash: "h1", revision: 2, createdAt: NOW, policy: POLICY,
      compilation: COMPILATION, units: [{ unitId: "zoom:u0", videoNodeId: "owner0", selectedResultKey: "result0",
        continuationAcceptance: REVIEW }] }],
    sequenceUnitVideos: [{ videoNodeId: "owner0", unitId: "zoom:u0" }],
    selectedSequenceTakeIds: { zoom: "take1" },
    sequenceRecommendations: [RECOMMENDATION],
  }
}

/** What a reader who is not the owner keeps of {@link linkedStudio}: everything the codec's reader requires. */
function readerStudio(): Record<string, unknown> {
  const { sequenceRecommendations: _recommendations, ...studio } = linkedStudio()
  return { ...studio, sequenceTakes: [{ id: "take1", sequenceId: "zoom", authoringHash: "h1", revision: 2, createdAt: NOW,
    policy: POLICY, compilation: COMPILATION, units: [{ unitId: "zoom:u0", videoNodeId: "owner0", selectedResultKey: "result0" }] }] }
}

const rowsOf = (list: unknown) =>
  (list as Array<{ data?: { generatedResults?: Array<Record<string, unknown>> } }>)
    .flatMap((node) => node.data?.generatedResults ?? [])
const studioOf = (settings: unknown) => (settings as { studio: Record<string, unknown> }).studio
const PRIVATE = ["frame-private-a", "a private director reason", "job-private", "owner-actor-private"]

describe("the T87 lists", () => {
  it("name the owner-only sequence keys at each of their three levels", () => {
    expect([...STUDIO_TAKE_SEQUENCE_KEYS]).toEqual(["sequenceEndpoints"])
    expect([...STUDIO_SEQUENCE_PLANNING_KEYS]).toEqual(["sequenceRecommendations"])
    expect([...STUDIO_SEQUENCE_UNIT_REVIEW_KEYS]).toEqual(["continuationAcceptance"])
  })
})

describe("stripStudioTakeVoiceRecords — a take's sequence pins are the owner's (T87)", () => {
  it("drops the pins off a linked clip's take and leaves the unit video node, which the codec reads, alone", () => {
    const stored = linkedNodes()
    const out = stripStudioTakeVoiceRecords(stored) as typeof stored
    expect(JSON.stringify(out)).not.toContain("sequenceEndpoints")
    expect(rowsOf([out[0]])).toEqual([{ url: "https://r2/clip.mp4", jobId: "clip-1" }])
    expect(out[0]!.data).toMatchObject({ prompt: "Approach", sequenceBinding: { sequenceId: "zoom" } })
    expect(out[1]).toBe(stored[1])
    // Copy-on-write.
    expect(JSON.stringify(stored)).toContain("frame-private-a")
  })

  it("drops the pins and the voice record together off one row", () => {
    const both = [{ id: "n1", data: { generatedResults: [{ url: "u", voiceMode: "auto", sequenceEndpoints: PINS }] } }]
    expect(rowsOf(stripStudioTakeVoiceRecords(both))).toEqual([{ url: "u" }])
  })
})

describe.each([
  ["stripStudioDraftSettings (the `view` doors)", stripStudioDraftSettings],
  ["stripStudioTransientSettings (the public share read of an ordinary production)", stripStudioTransientSettings],
] as const)("%s — a linked production's sequence planning is the owner's (T87)", (_name, strip) => {
  it("drops the recommendations and every take unit's review, and keeps what the codec's reader requires", () => {
    const stored = { studio: linkedStudio() }
    const out = strip(stored)
    expect(studioOf(out)).toEqual(readerStudio())
    for (const secret of PRIVATE.slice(1)) expect(JSON.stringify(out)).not.toContain(secret)
    // Copy-on-write: the stored row keeps all of it.
    expect(stored).toEqual({ studio: linkedStudio() })
  })

  it("hands back the SAME settings when a linked production carries none of it", () => {
    const clean = { studio: readerStudio() }
    expect(strip(clean)).toBe(clean)
  })

  it("keeps a take that has no review as the very same take", () => {
    const studio = linkedStudio()
    const reviewed = studio.sequenceTakes as Array<Record<string, unknown>>
    const unreviewed = { ...reviewed[0]!, id: "take0", units: [{ unitId: "zoom:u0", videoNodeId: "owner0" }] }
    const out = studioOf(strip({ studio: { ...studio, sequenceTakes: [unreviewed, reviewed[0]] } }))
    expect((out.sequenceTakes as unknown[])[0]).toBe(unreviewed)
  })

  it("lets a take list it cannot read ride through", () => {
    const odd = [null, 7, "x", { id: "t" }, { id: "t2", units: "nope" }, { id: "t3", units: [null, 4, { unitId: "u", continuationAcceptance: REVIEW }] }]
    const out = studioOf(strip({ studio: { version: 3, sequenceTakes: odd } }))
    const takes = out.sequenceTakes as unknown[]
    expect(takes.slice(0, 5)).toEqual(odd.slice(0, 5))
    expect((takes[5] as { units: unknown[] }).units).toEqual([null, 4, { unitId: "u" }])
    const notAList = { studio: { version: 3, sequenceTakes: "nope" } }
    expect(strip(notAList)).toBe(notAList)
  })
})

describe("stripStudioDraftSettings — the bin keeps a deleted linked scene, without the owner's sequence planning", () => {
  /** A deleted take with its pins, and a deleted linked scene: its graph is a one-scene linked production. */
  const bin = () => [
    { kind: "clip", id: "t-clip", shotId: "AB", index: 0, deletedAt: NOW, clipBase: { nodeId: "clip-AB" },
      result: { url: "https://r2/old.mp4", jobId: "clip-0", sequenceEndpoints: PINS } },
    { kind: "shot", id: "t-shot", shotId: "AB", index: 0, deletedAt: NOW,
      graph: { nodes: linkedNodes(), edges: [], settings: { studio: linkedStudio() } } },
  ]

  it("drops a deleted take's pins and a deleted scene's planning, and keeps the rest of both", () => {
    const stored = { studio: { version: 3, trash: bin() } }
    const trash = studioOf(stripStudioDraftSettings(stored)).trash as Array<Record<string, unknown>>
    expect(trash.map((entry) => entry.id)).toEqual(["t-clip", "t-shot"])
    expect(trash[0]!.result).toEqual({ url: "https://r2/old.mp4", jobId: "clip-0" })
    const graph = trash[1]!.graph as { nodes: unknown; settings: unknown }
    for (const secret of PRIVATE) expect(JSON.stringify(graph)).not.toContain(secret)
    expect(studioOf(graph.settings)).toEqual(readerStudio())
    expect(rowsOf(graph.nodes)).toHaveLength(2)
    // Copy-on-write.
    expect(JSON.stringify(stored)).toContain("owner-actor-private")
  })
})

describe("stripStudioDraftWorkflow — the one strip every `view` door applies", () => {
  it("strips the pins off the nodes AND the planning off the settings, and keeps the rest of the row", () => {
    const row = { id: "wf-1", name: "Film", edges: [{ id: "e1" }], nodes: linkedNodes(), settings: { studio: linkedStudio() } }
    const out = stripStudioDraftWorkflow(row)
    for (const secret of PRIVATE) expect(JSON.stringify(out)).not.toContain(secret)
    expect(out).toMatchObject({ id: "wf-1", name: "Film", edges: [{ id: "e1" }] })
    expect(studioOf(out.settings)).toEqual(readerStudio())
    expect((out.nodes as unknown[])[1]).toBe(row.nodes[1])
    // Copy-on-write.
    expect(JSON.stringify(row)).toContain("frame-private-a")
  })

  it("hands back the SAME row when a linked production carries none of it", () => {
    const plain = { nodes: [linkedNodes()[1]], settings: { studio: readerStudio() } }
    expect(stripStudioDraftWorkflow(plain)).toBe(plain)
  })
})
