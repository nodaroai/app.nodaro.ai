import { describe, it, expect } from "vitest"

import {
  STUDIO_TAKE_VOICE_KEYS,
  stripStudioDraftSettings,
  stripStudioDraftWorkflow,
  stripStudioTakeVoiceRecords,
} from "../studio-transient.js"

/**
 * A finished take's VOICE RECORD is the owner's (studio ruling T42): the plan
 * the clip was recast with — the OWNER's voice ids — and the Voice control's
 * mode. It rides the canvas node's `data.generatedResults` rows, not
 * `settings.studio`, so a settings-only strip never reaches it. A reader who
 * may look but not edit loses it; the owner and an edit collaborator keep it.
 *
 * The bin carries the same things again, deleted (T11 / T42 on the bin): a
 * deleted empty slot, a deleted take with its record, a deleted scene whose
 * one-scene graph holds both.
 */

const PLAN = { orderedVoices: [{ voiceId: "voice-owner-abi", voiceName: "Abi" }], settings: { stability: 0.5 } }

/** A studio clip node whose two takes carry the record, beside a still node that never does. */
function nodes(): Array<Record<string, unknown>> {
  return [
    { id: "generate-image-s1", type: "generate-image", position: { x: 0, y: 0 },
      data: { prompt: "a lighthouse", generatedResults: [{ url: "https://r2/a.png", prompt: "a lighthouse" }] } },
    { id: "generate-video-s1", type: "generate-video", position: { x: 0, y: 0 },
      data: { prompt: "Abi speaks", provider: "seedance-2", activeResultIndex: 1, generatedResults: [
        { url: "https://r2/a.mp4", prompt: "Abi speaks", revoiceTo: PLAN, voiceMode: "character" },
        { url: "https://r2/b.mp4", prompt: "Abi whispers", voiceMode: "off", name: "Quiet" },
      ] } },
  ]
}

const rowsOf = (list: unknown) =>
  (list as Array<{ data?: { generatedResults?: Array<Record<string, unknown>> } }>)
    .flatMap((node) => node.data?.generatedResults ?? [])

describe("stripStudioTakeVoiceRecords — a take's voice record is the owner's (T42)", () => {
  it("drops every result row's plan and mode and keeps the rest of the take", () => {
    const stored = nodes()
    const out = stripStudioTakeVoiceRecords(stored)
    expect(JSON.stringify(out)).not.toContain("voice-owner-abi")
    expect(JSON.stringify(out)).not.toContain("voiceMode")
    expect(rowsOf(out)).toEqual([
      { url: "https://r2/a.png", prompt: "a lighthouse" },
      { url: "https://r2/a.mp4", prompt: "Abi speaks" },
      { url: "https://r2/b.mp4", prompt: "Abi whispers", name: "Quiet" },
    ])
    // The node itself — everything beside its result rows — is untouched.
    const clip = (out as typeof stored)[1]!
    expect(clip).toMatchObject({ id: "generate-video-s1", type: "generate-video" })
    expect(clip.data).toMatchObject({ prompt: "Abi speaks", provider: "seedance-2", activeResultIndex: 1 })
    // Copy-on-write: the stored rows keep the record, and a node with nothing
    // to drop is the SAME node.
    expect(JSON.stringify(stored)).toContain("voice-owner-abi")
    expect((out as typeof stored)[0]).toBe(stored[0])
  })

  it("walks every node, not only a clip node: the keys are what matters, not the type", () => {
    const odd = [{ id: "n1", type: "some-future-node", data: { generatedResults: [{ url: "u", voiceMode: "auto" }] } }]
    expect(rowsOf(stripStudioTakeVoiceRecords(odd))).toEqual([{ url: "u" }])
  })

  it("hands back the SAME array when no row carries either key", () => {
    const plain = [{ id: "n1", data: { generatedResults: [{ url: "u" }] } }, { id: "n2", data: {} }]
    expect(stripStudioTakeVoiceRecords(plain)).toBe(plain)
  })

  it("lets anything that is not node-shaped ride through — it runs on whatever is in the column", () => {
    expect(stripStudioTakeVoiceRecords(null)).toBeNull()
    expect(stripStudioTakeVoiceRecords(undefined)).toBeUndefined()
    const junk = { nodes: "not a list" }
    expect(stripStudioTakeVoiceRecords(junk)).toBe(junk)
    const mixed = [null, 7, "x", [], { data: null }, { data: { generatedResults: "nope" } },
      { data: { generatedResults: [null, 3, { url: "u", revoiceTo: PLAN }] } }]
    const out = stripStudioTakeVoiceRecords(mixed) as unknown[]
    expect(out.slice(0, 6)).toEqual(mixed.slice(0, 6))
    expect((out[6] as { data: { generatedResults: unknown[] } }).data.generatedResults).toEqual([null, 3, { url: "u" }])
  })

  it("leaves the scene's RECIPE voice mode and the clip-level revoiced voice alone — T42 is results only", () => {
    const settings = { studio: { version: 3, shots: [
      { id: "s1", recipe: { directing: { prompt: "p", voiceMode: "character" } }, revoicedVoiceId: "v-1" },
    ] } }
    expect(stripStudioDraftSettings(settings)).toBe(settings)
  })
})

/** The owner's bin, one entry of each kind that can carry the owner's drafts. */
function bin(): Array<Record<string, unknown>> {
  return [
    // A deleted EMPTY slot — an unsubmitted draft, whole.
    { kind: "slot", id: "t-slot", shotId: "s1", index: 0, deletedAt: "2026-10-01T10:00:00.000Z",
      stage: "still", slot: { id: "slot-1", inputs: { prompt: "an unsent idea" } } },
    // A deleted take with its record.
    { kind: "clip", id: "t-clip", shotId: "s1", index: 0, deletedAt: "2026-10-01T10:00:00.000Z",
      clipBase: { nodeId: "generate-video-s1" },
      result: { url: "https://r2/c.mp4", prompt: "Abi sings", revoiceTo: PLAN, voiceMode: "character" } },
    // A legacy entry with no kind reads as a clip.
    { id: "t-legacy", shotId: "s1", index: 1, deletedAt: "2026-10-01T10:00:00.000Z",
      result: { url: "https://r2/d.mp4", voiceMode: "auto" } },
    // A deleted SCENE: a one-scene production graph, its take's record on the
    // graph's nodes and its slots and run on the graph's scene entry.
    { kind: "shot", id: "t-shot", shotId: "s2", index: 1, deletedAt: "2026-10-01T10:00:00.000Z",
      graph: { nodes: nodes(), edges: [], settings: { studio: { version: 3, shots: [
        { id: "s2", clipSlots: [{ id: "slot-9", inputs: { prompt: "an unsent move" } }],
          pendingStills: [{ jobId: "job-7", startedAt: 1, slotId: "slot-9", prompt: "an unsent run" }] },
      ] } } } },
    // A deleted still and keyframe carry neither, and ride through.
    { kind: "still", id: "t-still", shotId: "s1", index: 0, deletedAt: "2026-10-01T10:00:00.000Z",
      stillBase: { nodeId: "generate-image-s1" }, result: { url: "https://r2/e.png" } },
    { kind: "keyframe", id: "t-key", index: 0, deletedAt: "2026-10-01T10:00:00.000Z", keyframe: { id: "k1" } },
  ]
}

const trashOf = (settings: unknown) =>
  (settings as { studio: { trash: Array<Record<string, unknown>> } }).studio.trash

describe("stripStudioDraftSettings — the bin keeps what was deleted, without the owner's drafts in it", () => {
  it("drops a deleted empty slot whole (T11)", () => {
    const out = trashOf(stripStudioDraftSettings({ studio: { version: 3, trash: bin() } }))
    expect(out.map((entry) => entry.id)).toEqual(["t-clip", "t-legacy", "t-shot", "t-still", "t-key"])
    expect(JSON.stringify(out)).not.toContain("an unsent idea")
  })

  it("keeps a deleted take and drops its voice record — a legacy no-kind entry too (T42)", () => {
    const out = trashOf(stripStudioDraftSettings({ studio: { version: 3, trash: bin() } }))
    expect(out.find((entry) => entry.id === "t-clip")!.result).toEqual({ url: "https://r2/c.mp4", prompt: "Abi sings" })
    expect(out.find((entry) => entry.id === "t-legacy")!.result).toEqual({ url: "https://r2/d.mp4" })
  })

  it("gives a deleted scene what a live production gets: no take record on its nodes, no slot or run on its scene", () => {
    const out = trashOf(stripStudioDraftSettings({ studio: { version: 3, trash: bin() } }))
    const graph = out.find((entry) => entry.id === "t-shot")!.graph as { nodes: unknown; settings: unknown }
    expect(JSON.stringify(graph)).not.toContain("voice-owner-abi")
    expect(JSON.stringify(graph)).not.toContain("an unsent")
    expect(rowsOf(graph.nodes)).toHaveLength(3)
    expect(graph.settings).toEqual({ studio: { version: 3, shots: [{ id: "s2" }] } })
  })

  it("rides a deleted still and keyframe through as they are", () => {
    const stored = bin()
    const out = trashOf(stripStudioDraftSettings({ studio: { version: 3, trash: stored } }))
    expect(out.find((entry) => entry.id === "t-still")).toBe(stored[4])
    expect(out.find((entry) => entry.id === "t-key")).toBe(stored[5])
  })

  it("is copy-on-write, and the SAME settings back when neither a scene nor the bin carries any of it", () => {
    const stored = { studio: { version: 3, trash: bin() } }
    stripStudioDraftSettings(stored)
    expect(JSON.stringify(stored)).toContain("voice-owner-abi")
    expect(JSON.stringify(stored)).toContain("an unsent idea")
    const clean = { studio: { version: 3, shots: [{ id: "s1" }], trash: [bin()[4], bin()[5], { id: "t-1" }] } }
    expect(stripStudioDraftSettings(clean)).toBe(clean)
    // A bin that is not a list rides through.
    const odd = { studio: { version: 3, trash: "nope" } }
    expect(stripStudioDraftSettings(odd)).toBe(odd)
  })
})

describe("stripStudioDraftWorkflow — the one strip every `view` door applies", () => {
  it("strips the take records off the nodes AND the drafts off the settings, and keeps the rest of the row", () => {
    const row = { id: "wf-1", name: "Film", edges: [{ id: "e1" }], nodes: nodes(), settings: { studio: { version: 3,
      shots: [{ id: "s1", stillSlots: [{ id: "slot-1", inputs: { prompt: "an unsent idea" } }] }], trash: bin() } } }
    const out = stripStudioDraftWorkflow(row)
    expect(JSON.stringify(out)).not.toContain("voice-owner-abi")
    expect(JSON.stringify(out)).not.toContain("an unsent")
    expect(out).toMatchObject({ id: "wf-1", name: "Film", edges: [{ id: "e1" }] })
    expect(rowsOf(out.nodes)).toHaveLength(3)
    // Copy-on-write.
    expect(JSON.stringify(row)).toContain("voice-owner-abi")
  })

  it("strips either half alone", () => {
    const voiced = { nodes: nodes(), settings: { studio: { version: 3 } } }
    const out = stripStudioDraftWorkflow(voiced)
    expect(JSON.stringify(out.nodes)).not.toContain("voice-owner-abi")
    expect(out.settings).toBe(voiced.settings)
    const drafted = { nodes: [], settings: { studio: { version: 3, shots: [{ id: "s1", clipSlots: [] }] } } }
    const out2 = stripStudioDraftWorkflow(drafted)
    expect(out2.nodes).toBe(drafted.nodes)
    expect(out2.settings).toEqual({ studio: { version: 3, shots: [{ id: "s1" }] } })
  })

  it("hands back the SAME row when there is nothing of the owner's on it", () => {
    const plain = { nodes: [{ id: "n1", data: {} }], settings: { foo: 1 } }
    expect(stripStudioDraftWorkflow(plain)).toBe(plain)
    const bare: { name: string; settings?: unknown } = { name: "no graph read" }
    expect(stripStudioDraftWorkflow(bare)).toBe(bare)
  })
})

describe("the take list", () => {
  it("names the two keys — the studio codec's own `READER_PRIVATE_TAKE_KEYS` holds the same two", () => {
    expect([...STUDIO_TAKE_VOICE_KEYS]).toEqual(["revoiceTo", "voiceMode"])
  })
})
