import { describe, it, expect } from "vitest"

import {
  STUDIO_KEYFRAME_NODE_TRANSIENT_KEYS,
  STUDIO_KEYFRAME_REVIEW_KEYS,
  STUDIO_KEYFRAME_TRANSIENT_KEYS,
  STUDIO_SEQUENCE_PLANNING_KEYS,
  STUDIO_SEQUENCE_POLICY_KEYS,
  STUDIO_SEQUENCE_UNIT_MANIFEST_KEYS,
  STUDIO_SEQUENCE_UNIT_REVIEW_KEYS,
  STUDIO_TAKE_SEQUENCE_KEYS,
  stripStudioDraftSettings,
  stripStudioDraftWorkflow,
  stripStudioTakeVoiceRecords,
  stripStudioTransientSettings,
} from "../studio-transient.js"

/**
 * A LINKED (keyframe / sequence) production's owner state is the owner's
 * (studio ruling T87). The studio codec's own view withholds it from every
 * reader who is not the owner (`toProductionView`, `includeOwnerState:
 * false`); these strips withhold, from the stored row, every part of it the
 * codec's reader can do without:
 *
 * - `sequenceEndpoints` on a take's result row (a canvas node's
 *   `data.generatedResults`);
 * - `requestManifest` on a unit result row (a unit video node's
 *   `data.sequenceUnitResults`);
 * - `keyframePendingImages` on a keyframe image node's `data`;
 * - `settings.studio.sequenceRecommendations`;
 * - the entries of `settings.studio.sequenceGenerationPolicies` — EMPTIED to
 *   `{}`, because the reader requires the record on a production with takes;
 * - `continuationAcceptance` on each sequence take's units;
 * - `rejections` on each keyframe entry;
 * - and, in the bin, a deleted keyframe's `pendingImages` and `rejections`.
 *
 * Everything else of a take or a frame — a take's `policy` and `compilation`,
 * a unit result's pin, url and request hash, a frame's plan, acceptance and
 * result history — stays, because the codec refuses to read a production
 * without it.
 */

const NOW = "2026-09-08T12:00:00.000Z"
const PIN = (keyframeId: string, key: string) => ({ keyframeId, planRevision: 1, resultKey: key, jobId: key,
  assetId: key, contentHash: "a".repeat(64), width: 10, height: 10 })
/** A linked clip's submitted endpoint pins. */
const PINS = { sequenceId: "zoom", sequenceRevision: 1, start: PIN("A", "frame-private-a"), end: PIN("B", "frame-private-b") }
const POLICY = { conditioning: "video-continue", clipLength: "max", boundaryPolicy: "outer-frames",
  lockedBoundaryKeyframeIds: [], provider: "wan-3", resolution: "480p", aspectRatio: "16:9", referenceAssetIds: [] }
/** The owner's CURRENT preference for the sequence: set after the take was made with {@link POLICY}. */
const PREFERENCE = { ...POLICY, provider: "preference-private" }
const COMPILATION = { compilerVersion: "c1", capabilityFingerprint: "exact", renderPlanHash: "plan-1", ready: true, issues: [],
  units: [{ id: "zoom:u0", coverage: [{ shotId: "AB", fromSec: 0, toSec: 4 }], outputDurationSec: 4, generationDurationSec: 4,
    conditioning: "start-end", startKeyframeId: "A", endKeyframeId: "B", guidanceOnlyKeyframeIds: [], reused: false, prerequisites: [] }] }
const REVIEW = { resultKey: "result0", acceptedBy: "owner-actor-private", acceptedAt: NOW,
  review: { composition: true, motion: true, subjects: true, continuity: true } }
const RECOMMENDATION = { id: "rec-1", createdAt: NOW, sequenceId: "zoom", authoringHash: "h1", capabilityFingerprint: "exact",
  priorityHash: "p1", recommendation: { policy: POLICY, reasons: ["a private director reason"], assumptions: [] },
  provenance: { source: "director", jobId: "job-private", analysisRevision: "rev-1", llmModel: "model-x" } }
/** A unit result's frozen request, as the host writes it when the result lands. */
const MANIFEST = { version: 1, coverage: [{ shotId: "AB", prompt: "a private compiled prompt" }],
  media: ["https://r2/reference-private.png"], sourceSnapshots: [{ id: "AB", clipSlots: [{ prompt: "a private unsent slot" }] }] }
const PROVENANCE = { planRevision: 1, attemptId: "attempt-1", resolvedRequestHash: "b".repeat(64), referencePins: [], descriptionPins: [] }
/** An image run in flight on keyframe A. */
const FRAME_RUN = { jobId: "frame-run-private", startedAt: 5, frame: { prompt: "a private pending frame" }, provenance: PROVENANCE }
/** The owner sent one of A's results back for revision. */
const REJECTION = { result: PIN("A", "kf-a-2"), rejectedBy: "rejector-private", rejectedAt: NOW, reason: "a private rejection reason" }
const FRAME_RESULTS = [
  { url: "https://r2/a1.png", jobId: "kf-a-1", pin: PIN("A", "kf-a-1"), provenance: PROVENANCE },
  { url: "https://r2/a2.png", jobId: "kf-a-2", pin: PIN("A", "kf-a-2"), provenance: PROVENANCE },
]

/** A linked scene's clip node; its take carries the pins. */
const clipNode = (pinned: boolean) => ({ id: "clip-AB", type: "generate-video", position: { x: 0, y: 0 }, data: { prompt: "Approach",
  sequenceBinding: { sequenceId: "zoom", startKeyframeId: "A", endKeyframeId: "B", continuity: "continuous" },
  generatedResults: [{ url: "https://r2/clip.mp4", jobId: "clip-1", ...(pinned ? { sequenceEndpoints: PINS } : {}) }] } })
/** Keyframe A's image node: its result history stays, its run in flight does not. */
const frameNode = (running: boolean) => ({ id: "frame-A", type: "generate-image", position: { x: -340, y: 0 }, data: {
  label: "A", keyframeId: "A", requiredCapabilities: ["studio-dependent-frames-v1"], generatedResults: FRAME_RESULTS,
  ...(running ? { keyframePendingImages: [FRAME_RUN] } : {}), activeResultIndex: 0 } })
/** The take's unit video node: its result row stays, the row's frozen request does not. */
const unitNode = (frozen: boolean) => ({ id: "owner0", type: "generate-video", position: { x: 680, y: 0 }, data: { sequenceUnitId: "zoom:u0",
  sequenceUnitResults: [{ url: "https://r2/unit0.mp4", requestHash: "request-0",
    pin: { unitId: "zoom:u0", resultKey: "result0", jobId: "result0", assetId: "asset-0", contentHash: "hash-0", durationSec: 4 },
    ...(frozen ? { requestManifest: MANIFEST } : {}) }],
  generatedVideoUrl: "https://r2/unit0.mp4", generatedResults: [{ videoUrl: "https://r2/unit0.mp4", jobId: "result0" }] } })

/** A linked production's nodes as the codec writes them. */
const linkedNodes = (): Array<Record<string, unknown>> => [clipNode(true), frameNode(true), unitNode(true)]
/** What a reader who is not the owner keeps of {@link linkedNodes}. */
const readerNodes = (): Array<Record<string, unknown>> => [clipNode(false), frameNode(false), unitNode(false)]

/** Keyframe A's settings entry: its plan and acceptance stay, its review record does not. */
const frameEntry = (reviewed: boolean) => ({ imageNodeId: "frame-A",
  plan: { id: "A", label: "A", revision: 1, frame: { prompt: "A" }, requirements: [] },
  acceptance: { result: PIN("A", "kf-a-1"), acceptedBy: "acceptor", acceptedAt: NOW, requirementChecks: [] },
  ...(reviewed ? { rejections: [REJECTION] } : {}) })
/** The take as the codec writes it — and, without `continuationAcceptance`, as a reader gets it. */
const take = (reviewed: boolean) => ({ id: "take1", sequenceId: "zoom", authoringHash: "h1", revision: 2, createdAt: NOW,
  policy: POLICY, compilation: COMPILATION, units: [{ unitId: "zoom:u0", videoNodeId: "owner0", selectedResultKey: "result0",
    ...(reviewed ? { continuationAcceptance: REVIEW } : {}) }] })

/** `settings.studio` of a linked production with a take, as the codec writes it. */
function linkedStudio(): Record<string, unknown> {
  return {
    version: 3,
    shots: [{ id: "AB", sequenceBinding: { sequenceId: "zoom", startKeyframeId: "A", endKeyframeId: "B", continuity: "continuous" } }],
    requiredCapabilities: ["studio-dependent-frames-v1", "studio-sequence-takes-v1"],
    keyframes: [frameEntry(true)],
    sequences: [{ id: "zoom", name: "Zoom", revision: 1, construction: "nested-zoom", shotIds: ["AB"] }],
    sequenceGenerationPolicies: { zoom: PREFERENCE },
    sequenceTakes: [take(true)],
    sequenceUnitVideos: [{ videoNodeId: "owner0", unitId: "zoom:u0" }],
    selectedSequenceTakeIds: { zoom: "take1" },
    sequenceRecommendations: [RECOMMENDATION],
  }
}

/** What a reader who is not the owner keeps of {@link linkedStudio}: everything the codec's reader requires. */
function readerStudio(): Record<string, unknown> {
  const { sequenceRecommendations: _recommendations, ...studio } = linkedStudio()
  return { ...studio, keyframes: [frameEntry(false)], sequenceGenerationPolicies: {}, sequenceTakes: [take(false)] }
}

const studioOf = (settings: unknown) => (settings as { studio: Record<string, unknown> }).studio
/** The owner's state on the nodes, and on the settings. */
const NODE_PRIVATE = ["frame-private-a", "a private compiled prompt", "reference-private", "a private unsent slot",
  "frame-run-private", "a private pending frame"]
const SETTINGS_PRIVATE = ["a private director reason", "job-private", "owner-actor-private", "preference-private",
  "rejector-private", "a private rejection reason"]

describe("the T87 lists", () => {
  it("name the owner-only keys at each of their levels", () => {
    expect([...STUDIO_TAKE_SEQUENCE_KEYS]).toEqual(["sequenceEndpoints"])
    expect([...STUDIO_SEQUENCE_UNIT_MANIFEST_KEYS]).toEqual(["requestManifest"])
    expect([...STUDIO_KEYFRAME_NODE_TRANSIENT_KEYS]).toEqual(["keyframePendingImages"])
    expect([...STUDIO_SEQUENCE_PLANNING_KEYS]).toEqual(["sequenceRecommendations"])
    expect([...STUDIO_SEQUENCE_POLICY_KEYS]).toEqual(["sequenceGenerationPolicies"])
    expect([...STUDIO_SEQUENCE_UNIT_REVIEW_KEYS]).toEqual(["continuationAcceptance"])
    expect([...STUDIO_KEYFRAME_REVIEW_KEYS]).toEqual(["rejections"])
    expect([...STUDIO_KEYFRAME_TRANSIENT_KEYS]).toEqual(["pendingImages"])
  })
})

describe("stripStudioTakeVoiceRecords — the owner's state on a linked production's nodes (T87)", () => {
  it("drops a take's pins, a unit result's frozen request and a frame's runs, and keeps everything the codec reads", () => {
    const stored = linkedNodes()
    const out = stripStudioTakeVoiceRecords(stored)
    expect(out).toEqual(readerNodes())
    for (const secret of NODE_PRIVATE) expect(JSON.stringify(out)).not.toContain(secret)
    // Copy-on-write.
    expect(stored).toEqual(linkedNodes())
  })

  it("drops the pins and the voice record together off one row", () => {
    const both = [{ id: "n1", data: { generatedResults: [{ url: "u", voiceMode: "auto", sequenceEndpoints: PINS }] } }]
    expect(stripStudioTakeVoiceRecords(both)).toEqual([{ id: "n1", data: { generatedResults: [{ url: "u" }] } }])
  })

  it("drops a frame's runs off a node that has no result rows yet", () => {
    const fresh = [{ id: "frame-B", data: { keyframeId: "B", keyframePendingImages: [FRAME_RUN] } }]
    expect(stripStudioTakeVoiceRecords(fresh)).toEqual([{ id: "frame-B", data: { keyframeId: "B" } }])
  })

  it("hands back the SAME nodes, and the same node, when none carries any of it", () => {
    const clean = readerNodes()
    expect(stripStudioTakeVoiceRecords(clean)).toBe(clean)
    const mixed = [clipNode(true), frameNode(false), unitNode(false)]
    const out = stripStudioTakeVoiceRecords(mixed) as unknown[]
    expect(out[1]).toBe(mixed[1])
    expect(out[2]).toBe(mixed[2])
  })

  it("lets unit results it cannot read ride through", () => {
    const odd = [{ id: "u", data: { sequenceUnitResults: "nope" } },
      { id: "v", data: { sequenceUnitResults: [null, 4, { url: "u", requestManifest: MANIFEST }] } }]
    const out = stripStudioTakeVoiceRecords(odd) as typeof odd
    expect(out[0]).toBe(odd[0])
    expect(out[1]!.data.sequenceUnitResults).toEqual([null, 4, { url: "u" }])
  })
})

describe.each([
  ["stripStudioDraftSettings (the `view` doors)", stripStudioDraftSettings],
  ["stripStudioTransientSettings (the public share read of an ordinary production)", stripStudioTransientSettings],
] as const)("%s — a linked production's owner state is the owner's (T87)", (_name, strip) => {
  it("drops the recommendations, the reviews and the rejections, empties the preferences, and keeps what the codec's reader requires", () => {
    const stored = { studio: linkedStudio() }
    const out = strip(stored)
    expect(studioOf(out)).toEqual(readerStudio())
    for (const secret of SETTINGS_PRIVATE) expect(JSON.stringify(out)).not.toContain(secret)
    // The take keeps the policy it was made with; only the owner's newer preference goes.
    expect((studioOf(out).sequenceTakes as Array<{ policy: unknown }>)[0]!.policy).toEqual(POLICY)
    // Copy-on-write: the stored row keeps all of it.
    expect(stored).toEqual({ studio: linkedStudio() })
  })

  it("hands back the SAME settings when a linked production carries none of it", () => {
    const clean = { studio: readerStudio() }
    expect(strip(clean)).toBe(clean)
  })

  it("empties the preferences but never adds them, and lets a value it cannot read ride through", () => {
    // The codec's reader takes the key alone for take state: a production
    // without it must not gain it.
    const { sequenceGenerationPolicies: _preferences, ...without } = linkedStudio()
    expect(studioOf(strip({ studio: without }))).not.toHaveProperty("sequenceGenerationPolicies")
    for (const odd of ["nope", 7, null, ["zoom"]]) {
      const stored = { studio: { version: 3, sequenceGenerationPolicies: odd } }
      expect(strip(stored)).toBe(stored)
    }
  })

  it("keeps a take that has no review, and a frame that has no rejections, as the very same entries", () => {
    const studio = linkedStudio()
    const reviewed = (studio.sequenceTakes as Array<Record<string, unknown>>)[0]!
    const unreviewed = { ...reviewed, id: "take0", units: [{ unitId: "zoom:u0", videoNodeId: "owner0" }] }
    const unrejected = { imageNodeId: "frame-B", plan: { id: "B", label: "B", revision: 1, frame: { prompt: "B" }, requirements: [] } }
    const out = studioOf(strip({ studio: { ...studio, sequenceTakes: [unreviewed, reviewed],
      keyframes: [unrejected, ...(studio.keyframes as unknown[])] } }))
    expect((out.sequenceTakes as unknown[])[0]).toBe(unreviewed)
    expect((out.keyframes as unknown[])[0]).toBe(unrejected)
    expect((out.keyframes as unknown[])[1]).toEqual(frameEntry(false))
  })

  it("lets a take or a frame list it cannot read ride through", () => {
    const odd = [null, 7, "x", { id: "t" }, { id: "t2", units: "nope" }, { id: "t3", units: [null, 4, { unitId: "u", continuationAcceptance: REVIEW }] }]
    const frames = [null, 7, "x", { imageNodeId: "f" }, { imageNodeId: "g", rejections: [REJECTION] }]
    const out = studioOf(strip({ studio: { version: 3, sequenceTakes: odd, keyframes: frames } }))
    const takes = out.sequenceTakes as unknown[]
    expect(takes.slice(0, 5)).toEqual(odd.slice(0, 5))
    expect((takes[5] as { units: unknown[] }).units).toEqual([null, 4, { unitId: "u" }])
    expect(out.keyframes).toEqual([null, 7, "x", { imageNodeId: "f" }, { imageNodeId: "g" }])
    const notAList = { studio: { version: 3, sequenceTakes: "nope", keyframes: "nope" } }
    expect(strip(notAList)).toBe(notAList)
  })
})

describe("stripStudioDraftSettings — the bin keeps the owner's deleted work, without the owner's state in it", () => {
  /** A deleted take with its pins, a deleted frame with a run in flight and a review, and a deleted linked scene. */
  const bin = () => [
    { kind: "clip", id: "t-clip", shotId: "AB", index: 0, deletedAt: NOW, clipBase: { nodeId: "clip-AB" },
      result: { url: "https://r2/old.mp4", jobId: "clip-0", sequenceEndpoints: PINS } },
    { kind: "keyframe", id: "t-frame", index: 1, deletedAt: NOW,
      keyframe: { ...frameEntry(true), results: FRAME_RESULTS, pendingImages: [FRAME_RUN] } },
    { kind: "shot", id: "t-shot", shotId: "AB", index: 0, deletedAt: NOW,
      graph: { nodes: linkedNodes(), edges: [], settings: { studio: linkedStudio() } } },
  ]

  it("drops a deleted take's pins, a deleted frame's runs and review, and a deleted scene's owner state, and keeps the rest of each", () => {
    const stored = { studio: { version: 3, trash: bin() } }
    const trash = studioOf(stripStudioDraftSettings(stored)).trash as Array<Record<string, unknown>>
    expect(trash.map((entry) => entry.id)).toEqual(["t-clip", "t-frame", "t-shot"])
    expect(trash[0]!.result).toEqual({ url: "https://r2/old.mp4", jobId: "clip-0" })
    expect(trash[1]!.keyframe).toEqual({ ...frameEntry(false), results: FRAME_RESULTS })
    const graph = trash[2]!.graph as { nodes: unknown; settings: unknown }
    expect(graph.nodes).toEqual(readerNodes())
    expect(studioOf(graph.settings)).toEqual(readerStudio())
    for (const secret of [...NODE_PRIVATE, ...SETTINGS_PRIVATE]) expect(JSON.stringify(trash)).not.toContain(secret)
    // Copy-on-write.
    expect(stored).toEqual({ studio: { version: 3, trash: bin() } })
  })

  it("keeps a deleted frame that carries neither as the very same bin", () => {
    const quiet = { kind: "keyframe", id: "t-frame", index: 0, deletedAt: NOW, keyframe: { ...frameEntry(false), results: FRAME_RESULTS } }
    const stored = { studio: { version: 3, trash: [quiet] } }
    expect(stripStudioDraftSettings(stored)).toBe(stored)
  })
})

describe("stripStudioDraftWorkflow — the one strip every `view` door applies", () => {
  it("strips the owner's state off the nodes AND the settings, and keeps the rest of the row", () => {
    const row = { id: "wf-1", name: "Film", edges: [{ id: "e1" }], nodes: linkedNodes(), settings: { studio: linkedStudio() } }
    const out = stripStudioDraftWorkflow(row)
    for (const secret of [...NODE_PRIVATE, ...SETTINGS_PRIVATE]) expect(JSON.stringify(out)).not.toContain(secret)
    expect(out).toMatchObject({ id: "wf-1", name: "Film", edges: [{ id: "e1" }] })
    expect(out.nodes).toEqual(readerNodes())
    expect(studioOf(out.settings)).toEqual(readerStudio())
    // Copy-on-write.
    expect(row.nodes).toEqual(linkedNodes())
    expect(row.settings).toEqual({ studio: linkedStudio() })
  })

  it("hands back the SAME row when a linked production carries none of it", () => {
    const plain = { nodes: readerNodes(), settings: { studio: readerStudio() } }
    expect(stripStudioDraftWorkflow(plain)).toBe(plain)
  })
})
