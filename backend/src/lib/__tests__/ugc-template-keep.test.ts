/**
 * A template's kept example run, layer 1 (`ugcKeepPlan`, @nodaro/render-rules): which UGC videos of
 * a graph are proven, on the graph alone, to be one run made with an AI creator, and what each would
 * keep; and the publish strip's `keep` option, which re-admits only those display values. Read on the
 * shipped "UGC Video From Your Site" template as an author's run leaves it. The URLs are placeholders.
 */
import { describe, it, expect } from "vitest"
import { UGC_NODE_RUN_STATE_KEYS } from "@nodaro/shared"
import {
  UGC_EXAMPLE_LINES_KEY,
  UGC_TEMPLATE_KEEP_KEYS,
  UGC_TEMPLATE_NEVER_KEYS,
  stripUgcPublishState,
  ugcKeepPlan,
  ugcKeepVerdict,
  ugcStripSet,
  ugcComposedOf,
  ugcComposedKey,
} from "@nodaro/render-rules"

import { AI_IMAGE, AUTHOR_FACE, CAPTIONED, JOINED, OVERLAID, SECRET, TAKE_1, TAKE_2, ranTemplate, type Data, type E, type N } from "./ugc-template-keep-fixtures.js"

/** The graph's strip set read on itself, as the funnel's root part. */
function setsOf(nodes: N[], edges: E[]) {
  const sets = ugcStripSet(ugcComposedOf(nodes, edges))
  const root = ugcComposedKey([])
  return { strip: sets.strip.get(root)!, photo: sets.photo.get(root)!, sinks: sets.sinks?.get(root), taint: sets.taint }
}

function plan(nodes: N[], edges: E[]) {
  const s = setsOf(nodes, edges)
  return ugcKeepPlan(nodes, edges, { photo: s.photo, sinks: s.sinks })
}

describe("the keep and never lists", () => {
  it("name every UGC run-state key exactly once (a new run-state key is never shipped by accident)", () => {
    for (const [type, keys] of Object.entries(UGC_NODE_RUN_STATE_KEYS)) {
      const keep = new Set(UGC_TEMPLATE_KEEP_KEYS[type] ?? [])
      const never = new Set(UGC_TEMPLATE_NEVER_KEYS[type] ?? [])
      for (const key of keys) expect(keep.has(key) !== never.has(key), `${type}.${key}`).toBe(true)
    }
  })
  it("never keep a wire, the creator record, the plan, a ticket, a quote or the kept switch", () => {
    for (const [type, keys] of Object.entries(UGC_TEMPLATE_KEEP_KEYS)) {
      for (const banned of ["ugcOutputs", "keepResult", "candidates", "quote", "photoUrl", "rerender"]) expect(keys, `${type}`).not.toContain(banned)
    }
    expect(UGC_TEMPLATE_KEEP_KEYS["ugc-creator"]).toEqual(["generatedImageUrl"])
    expect(UGC_TEMPLATE_KEEP_KEYS["ugc-script"]).toEqual([UGC_EXAMPLE_LINES_KEY])
    expect(UGC_TEMPLATE_KEEP_KEYS["ugc-clips"]).toEqual([])
  })
})

describe("ugcKeepPlan: an AI creator's run is proven on the graph", () => {
  it("keeps the display values, and nothing a run reads", async () => {
    const { nodes, edges } = await ranTemplate()
    const { chains } = plan(nodes, edges)
    expect(chains).toHaveLength(1)
    const [c] = chains
    expect(c!.proven).toBe(true)
    expect(c!.claims).toEqual({
      creatorImage: AI_IMAGE,
      takes: [TAKE_1, TAKE_2],
      finishes: [
        { nodeId: "join", part: "join", url: JOINED },
        { nodeId: "overlay", part: "overlay", url: OVERLAID },
        { nodeId: "captions", part: "captions", url: CAPTIONED },
      ],
    })
    const v = c!.values!
    expect(v.get("creator")).toEqual({ generatedImageUrl: AI_IMAGE })
    expect(v.get("script")).toEqual({ [UGC_EXAMPLE_LINES_KEY]: ["Hook line.", "Beat one.", "Closer line."] })
    expect(v.has("clips")).toBe(false)
    expect(v.get("clip")).toEqual({
      generatedVideoUrl: TAKE_1,
      generatedResults: [{ url: TAKE_1 }, { url: TAKE_2 }],
      activeResultIndex: 0,
      __listResults: [TAKE_1, TAKE_2],
      __listResultMeta: [{ durationSec: 7.5 }, { durationSec: 6 }],
    })
    expect(v.get("join")).toEqual({ generatedVideoUrl: JOINED, generatedResults: [{ url: JOINED }], activeResultIndex: 0 })
    expect(v.get("cards")).toEqual({ result: { layerPlan: "{\"layers\":[]}", captionPlan: "{\"words\":[]}", report: "Notes text." } })
    expect(JSON.stringify([...v.values()])).not.toContain(SECRET)
    expect(JSON.stringify([...v.values()])).not.toContain("jobId")
    expect(ugcKeepVerdict(chains)).toEqual({ included: true })
  })

  it("a graph with no UGC video keeps nothing", () => {
    expect(ugcKeepVerdict(ugcKeepPlan([{ id: "a", type: "text-prompt", data: {} }], []).chains)).toEqual({ included: false, reason: "no_ugc_video" })
  })
})

describe("ugcKeepPlan: anything but a proven AI-creator run keeps nothing (fail closed)", () => {
  const cases: Array<[string, Record<string, Data>, string]> = [
    ["a My photo creator", { creator: { source: "photo" } }, "photo_run"],
    ["a run made from the photo, the creator switched back to AI after it (stale kind)", { creator: { result: { v: 1, kind: "photo", identityImages: [AI_IMAGE] } } }, "photo_run"],
    ["a Character creator", { creator: { result: { v: 1, kind: "character", identityImages: [AI_IMAGE] } } }, "unverified"],
    ["an unknown kind", { creator: { result: { v: 1, kind: "other", identityImages: [AI_IMAGE] } } }, "unverified"],
    ["a record with no kind", { creator: { result: { v: 1, identityImages: [AI_IMAGE] } } }, "unverified"],
    ["an image that is not the record's", { creator: { generatedImageUrl: "https://cdn.example/images/other.png" } }, "unverified"],
    ["a pick still pending", { creator: { candidates: [{ imageUrl: AI_IMAGE, record: {} }] } }, "no_results"],
    ["no creator image", { creator: { generatedImageUrl: undefined } }, "no_results"],
    ["no creator record", { creator: { result: undefined } }, "no_results"],
    ["a clip with no take", { clip: { __listResults: [], generatedVideoUrl: undefined, generatedResults: [] } }, "no_results"],
    ["the author's photo kept on the creator (any source)", { creator: { photoUrl: AI_IMAGE } }, "photo_run"],
    ["a take that is the author's photo upload", { photo: { url: TAKE_1 } }, "photo_run"],
  ]
  it.each(cases)("%s", async (_name, patch, reason) => {
    const { nodes, edges } = await ranTemplate(patch)
    const { chains } = plan(nodes, edges)
    expect(chains[0]!.proven).toBe(false)
    expect(chains[0]!.reason).toBe(reason)
    expect(chains[0]!.values).toBeUndefined()
  })

  it("a video fed from a sub-workflow is not proven", async () => {
    const { nodes, edges } = await ranTemplate()
    const withSub = [...nodes, { id: "sub", type: "sub-workflow", data: { workflowId: "w" } }]
    const { chains } = plan(withSub, [...edges, { source: "sub", target: "creator", targetHandle: "pickers", sourceHandle: "out" }])
    expect(chains[0]!.reason).toBe("unverified")
  })

  it("a join that also takes another video is not proven", async () => {
    const { nodes, edges } = await ranTemplate()
    const extra = [...nodes, { id: "other", type: "upload-video", data: { url: "https://cdn.example/videos/x.mp4" } }]
    const { chains } = plan(extra, [...edges, { source: "other", target: "join", targetHandle: "in", sourceHandle: "video" }])
    expect(chains[0]!.reason).toBe("unverified")
  })
})

describe("stripUgcPublishState with keep: only the granted display values come back", () => {
  it("re-admits exactly the plan's values on top of the emptied node; the photo upload stays empty", async () => {
    const { nodes, edges } = await ranTemplate({ photo: { url: AUTHOR_FACE, assetId: "asset-face" } })
    const s = setsOf(nodes, edges)
    const { chains } = ugcKeepPlan(nodes, edges, { photo: s.photo, sinks: s.sinks })
    const keep = chains[0]!.values!
    const out = stripUgcPublishState(nodes, edges, { ...s, keep })
    const byId = new Map(out.map((n) => [n.id, n.data as Data]))
    expect(byId.get("creator")!.generatedImageUrl).toBe(AI_IMAGE)
    expect(byId.get("creator")!.keepResult).toBe(false)
    expect(byId.get("creator")!.result).toBeUndefined()
    expect(byId.get("script")!.result).toBeUndefined()
    expect(byId.get("script")![UGC_EXAMPLE_LINES_KEY]).toEqual(["Hook line.", "Beat one.", "Closer line."])
    expect(byId.get("clips")!.__listResults).toBeUndefined()
    expect(byId.get("captions")!.generatedVideoUrl).toBe(CAPTIONED)
    const shipped = JSON.stringify(out)
    expect(shipped).not.toContain(SECRET)
    expect(shipped).not.toContain(AUTHOR_FACE)
    expect(shipped).not.toContain("asset-face")
    expect(shipped).not.toContain("jobId")
  })

  it("without keep the output is today's, byte for byte", async () => {
    const { nodes, edges } = await ranTemplate()
    expect(stripUgcPublishState(nodes, edges, { keep: new Map() })).toEqual(stripUgcPublishState(nodes, edges))
  })

  it("a key a type may not keep throws", async () => {
    const { nodes, edges } = await ranTemplate()
    expect(() => stripUgcPublishState(nodes, edges, { keep: new Map([["creator", { result: { kind: "sampled" } }]]) })).toThrow(/may not keep/)
    expect(() => stripUgcPublishState(nodes, edges, { keep: new Map([["clips", { __listResults: [SECRET] }]]) })).toThrow(/may not keep/)
  })

  it("nothing is ever kept on the photo path, whatever a caller passes", async () => {
    const { nodes, edges } = await ranTemplate({ photo: { url: AUTHOR_FACE } })
    // "Your photo" is an upload, not a keepable type: even a forged grant for it would throw, never ship.
    expect(() => stripUgcPublishState(nodes, edges, { keep: new Map([["photo", { url: AUTHOR_FACE }]]) })).not.toThrow()
    const out = stripUgcPublishState(nodes, edges, { keep: new Map([["photo", { url: AUTHOR_FACE }]]) })
    expect(JSON.stringify(out)).not.toContain(AUTHOR_FACE)
  })
})

describe("the example lines are never configuration", () => {
  it("are a UGC Script run result (the same key as UGC_EXAMPLE_LINES_KEY)", async () => {
    const { isRunResultKey } = await import("@nodaro/render-rules")
    expect(isRunResultKey(UGC_EXAMPLE_LINES_KEY, "ugc-script")).toBe(true)
  })
  it("a publish without keep (an app, a share link, a cloner's own publish) strips them", async () => {
    const { nodes, edges } = await ranTemplate({ script: { [UGC_EXAMPLE_LINES_KEY]: ["An example line."] } })
    expect(JSON.stringify(stripUgcPublishState(nodes, edges))).not.toContain("An example line.")
  })
})
