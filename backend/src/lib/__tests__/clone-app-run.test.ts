/**
 * The clone check every run of someone else's graph asks (lib/clone-app-run.ts; decided 2026-11-13),
 * judged as the run itself judges it:
 * - the model is the one the run dispatches: a wired Character's voice model first, then the node's
 *   (an app's Model card override included);
 * - only nodes the run executes: not hidden, not a loop's expanded copy, inside the route it runs;
 * - the recordings are not read by the check itself (`cloneRecordingsRefusal` reads them later);
 * - a clone in a graph below the run's own that its inputs cannot reach is refused up front: on a run
 *   of someone else's graph any sub-workflow or component, on any other run a component only.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { ugcComposedKey } from "@nodaro/render-rules"

const h = vi.hoisted(() => ({
  readReplica: vi.fn(),
  composed: new Map<string, { nodes: unknown[]; edges: unknown[]; component?: boolean }>(),
}))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("../voice-replica.js", async (importOriginal) => ({ ...(await importOriginal<typeof import("../voice-replica.js")>()), readReplica: h.readReplica }))
vi.mock("../availability-viewer.js", async (importOriginal) => ({ ...(await importOriginal<typeof import("../availability-viewer.js")>()), deniedCapabilityForUser: vi.fn(async () => undefined) }))
vi.mock("../ugc-composed-graph.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ugc-composed-graph.js")>()),
  loadUgcComposedGraph: vi.fn(async () => ({ graph: h.composed, failed: false, loads: h.composed.size - 1 })),
}))

import { cloneRecordingsRefusal, cloneRunCheck, unfillableCloneRefusal } from "../clone-app-run.js"
import { signReplicaConsent } from "../voice-clone-consent.js"

const OWNER = "00000000-0000-4000-8000-0000000000a1"
const RUNNER = "00000000-0000-4000-8000-0000000000c3"
const RUNNERS = { sourceAudioUrl: "https://media.example/runner-reference.wav", consentAudioUrl: "https://media.example/runner-consent.wav" }
const TICK = signReplicaConsent(RUNNER, RUNNERS)
const EMPTIED = { sourceAudioUrl: "", consentAudioUrl: "" }
const FILLED = { tts: { replica: RUNNERS, replicaConsent: TICK } }

const tts = (id = "tts", extra: Record<string, unknown> = {}) => ({ id, type: "text-to-speech", data: { label: "Narration", provider: "gemini-3-8-flash-tts", directText: "Hi.", replica: EMPTIED, ...extra } })

beforeEach(() => {
  h.readReplica.mockReset()
  h.readReplica.mockResolvedValue({})
  h.composed = new Map()
})

describe("cloneRunCheck", () => {
  it("passes the runner's own recordings and tick, and leaves reading them to cloneRecordingsRefusal", async () => {
    const check = await cloneRunCheck([tts()], [], FILLED, undefined, OWNER, RUNNER)
    expect(check.refusal).toBeUndefined()
    expect(check.recordings).toEqual([RUNNERS])
    expect(h.readReplica).not.toHaveBeenCalled()
    expect(await cloneRecordingsRefusal(check.recordings)).toBeUndefined()
    expect(h.readReplica).toHaveBeenCalledWith(RUNNERS)
  })

  it("judges the model the run dispatches: a wired Character's voice model, an app's Model card", async () => {
    const character = { id: "char", type: "character", data: { voice: { voiceId: "Rachel", voiceType: "premade", ttsProvider: "elevenlabs-v3" } } }
    const wired = await cloneRunCheck([character, tts()], [{ source: "char", target: "tts" }], FILLED, undefined, OWNER, RUNNER)
    expect(wired.refusal?.error.code).toBe("clone_model_unsupported")
    const card = await cloneRunCheck([tts()], [], { tts: { ...FILLED.tts, provider: "elevenlabs-v3" } }, undefined, OWNER, RUNNER)
    expect(card.refusal?.error.code).toBe("clone_model_unsupported")
    // A Character with no voice hands on no model: the node's own.
    const silent = { id: "char", type: "character", data: {} }
    expect((await cloneRunCheck([silent, tts()], [{ source: "char", target: "tts" }], FILLED, undefined, OWNER, RUNNER)).refusal).toBeUndefined()
  })

  it("asks only nodes the run executes: not hidden, not an expanded copy, inside the route", async () => {
    for (const nodes of [[{ ...tts(), hidden: true }], [tts("tts", { __expandedClone: true })]]) {
      const check = await cloneRunCheck(nodes, [], undefined, undefined, OWNER, RUNNER)
      expect(check.refusal).toBeUndefined()
      expect(check.recordings).toEqual([])
    }
    expect((await cloneRunCheck([tts()], [], undefined, ["elsewhere"], OWNER, RUNNER)).refusal).toBeUndefined()
    expect((await cloneRunCheck([tts()], [], undefined, ["tts"], OWNER, RUNNER)).refusal?.error.code).toBe("clone_recordings_required")
  })
})

describe("unfillableCloneRefusal", () => {
  const root = ugcComposedKey([])
  const component = { id: "comp", type: "component", data: { appSlug: "voice-part" } }
  const sub = { id: "sub", type: "sub-workflow", data: { workflowId: "wf-2" } }

  it("a component holding a clone: refused on any run", async () => {
    h.composed = new Map([[root, { nodes: [component], edges: [] }], [ugcComposedKey(["comp"]), { nodes: [tts()], edges: [], component: true }]])
    for (const published of [false, true]) {
      expect((await unfillableCloneRefusal([component], [], undefined, OWNER, { published }))?.error.code, String(published)).toBe("clone_not_fillable")
    }
  })

  it("a sub-workflow holding a clone: refused on a run of someone else's graph, not on the owner's own run", async () => {
    h.composed = new Map([[root, { nodes: [sub], edges: [] }], [ugcComposedKey(["sub"]), { nodes: [tts()], edges: [] }]])
    expect(await unfillableCloneRefusal([sub], [], undefined, OWNER, { published: false })).toBeUndefined()
    expect((await unfillableCloneRefusal([sub], [], undefined, OWNER, { published: true }))?.error.code).toBe("clone_not_fillable")
  })

  it("a component the run does not execute: frozen, hidden, or outside its route", async () => {
    const frozen = { ...component, data: { ...component.data, skipped: true } }
    h.composed = new Map([[root, { nodes: [frozen], edges: [] }], [ugcComposedKey(["comp"]), { nodes: [tts()], edges: [], component: true }]])
    expect(await unfillableCloneRefusal([frozen], [], undefined, OWNER, { published: false })).toBeUndefined()
    expect(await unfillableCloneRefusal([{ ...component, hidden: true } as never], [], undefined, OWNER, { published: false })).toBeUndefined()
    h.composed = new Map([[root, { nodes: [component], edges: [] }], [ugcComposedKey(["comp"]), { nodes: [tts()], edges: [], component: true }]])
    expect(await unfillableCloneRefusal([component], [], ["other"], OWNER, { published: false })).toBeUndefined()
  })
})
