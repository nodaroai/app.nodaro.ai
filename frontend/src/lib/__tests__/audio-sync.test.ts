/**
 * Audio Sync's editor rules (lib/audio-sync.ts): the price row a wired graph
 * names, the order a run sends, and the reference it measures against. The
 * backend mirror is `backend/src/lib/audio-sync-credit-id.ts` + the
 * payload-builder case, pinned by `ee/billing/__tests__/audio-sync-credits.test.ts`
 * with the SAME cases, so the two lanes cannot drift apart silently.
 */
import { describe, it, expect } from "vitest"
import {
  audioSyncCreditId,
  audioSyncWiredSourceCount,
  effectiveAudioSyncReference,
  orderAudioSyncSources,
} from "../audio-sync"
import { isValidWorkflowConnection } from "../connection-validation"
import { TARGET_HANDLE_ACCEPTS } from "../target-handle-registry"
import { JSON_PRODUCER_TYPES } from "../data-handles"

const SYNC = "sync"
const into = (source: string, targetHandle: string | null = "sources") => ({ source, target: SYNC, targetHandle })

describe("audioSyncCreditId — `audio-sync:<n>src`, clamped into 2..6", () => {
  it("names the row for each wired count", () => {
    expect([2, 3, 4, 5, 6].map(audioSyncCreditId)).toEqual([
      "audio-sync:2src", "audio-sync:3src", "audio-sync:4src", "audio-sync:5src", "audio-sync:6src",
    ])
  })

  it("under two quotes the 2-source row (the cheapest real run); over six the 6-source row", () => {
    expect(audioSyncCreditId(0)).toBe("audio-sync:2src")
    expect(audioSyncCreditId(1)).toBe("audio-sync:2src")
    expect(audioSyncCreditId(9)).toBe("audio-sync:6src")
  })

  it("an unknown count (no graph context) quotes the ceiling — never under-quote", () => {
    expect(audioSyncCreditId(undefined)).toBe("audio-sync:6src")
    expect(audioSyncCreditId(Number.NaN)).toBe("audio-sync:6src")
  })
})

describe("audioSyncWiredSourceCount", () => {
  it("counts distinct upstream nodes on THIS node's `sources` handle only", () => {
    const edges = [
      into("mic"),
      into("camA"),
      into("camA"), // a second wire from the same recording is still one recording
      into("other", "json"), // not the sources handle
      { source: "x", target: "elsewhere", targetHandle: "sources" },
    ]
    expect(audioSyncWiredSourceCount(SYNC, edges)).toBe(2)
  })

  it("is unknown without graph context", () => {
    expect(audioSyncWiredSourceCount(SYNC, undefined)).toBeUndefined()
    expect(audioSyncWiredSourceCount(undefined, [into("mic")])).toBeUndefined()
  })
})

describe("orderAudioSyncSources — the order a run sends (mirrors the payload builder)", () => {
  const wired = [{ nodeId: "mic", url: "m" }, { nodeId: "camA", url: "a" }, { nodeId: "camB", url: "b" }]

  it("wire order when no sourceOrder is set", () => {
    expect(orderAudioSyncSources(wired, undefined).map((r) => r.nodeId)).toEqual(["mic", "camA", "camB"])
  })

  it("sourceOrder first, then the rest in wire order; stale ids ignored", () => {
    expect(orderAudioSyncSources(wired, ["camB", "gone", "mic"]).map((r) => r.nodeId)).toEqual(["camB", "mic", "camA"])
  })

  it("one row per upstream node", () => {
    expect(orderAudioSyncSources([...wired, { nodeId: "mic", url: "m2" }], undefined).map((r) => r.url)).toEqual(["m", "a", "b"])
  })
})

describe("effectiveAudioSyncReference", () => {
  it("keeps a reference that is still wired; drops one that is not (→ the first source)", () => {
    expect(effectiveAudioSyncReference("camA", ["mic", "camA"])).toBe("camA")
    expect(effectiveAudioSyncReference("gone", ["mic", "camA"])).toBeUndefined()
    expect(effectiveAudioSyncReference(undefined, ["mic"])).toBeUndefined()
  })
})

describe("audio-sync handles", () => {
  const connect = (sourceType: string, targetHandle: string) =>
    isValidWorkflowConnection(
      { source: "up", target: SYNC, sourceHandle: null, targetHandle },
      (id) => (id === "up" ? sourceType : id === SYNC ? "audio-sync" : undefined),
    )

  it("`sources` takes audio AND video producers, and nothing on any other handle", () => {
    expect(connect("upload-audio", "sources")).toBe(true)
    expect(connect("upload-video", "sources")).toBe(true)
    expect(connect("upload-image", "sources")).toBe(false)
    expect(connect("upload-audio", "in")).toBe(false)
  })

  it("the source-direction popover sees the same `sources` target", () => {
    const entries = TARGET_HANDLE_ACCEPTS["audio-sync"] ?? []
    expect(entries.map((e) => e.handleId)).toEqual(["sources"])
    expect(entries[0]!.accepts("upload-audio")).toBe(true)
    expect(entries[0]!.accepts("upload-video")).toBe(true)
  })

  it("its `json` output is a data producer (feeds json/data consumers)", () => {
    expect(JSON_PRODUCER_TYPES.has("audio-sync")).toBe(true)
  })
})
