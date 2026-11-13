// @vitest-environment node
import { describe, it, expect } from "vitest"
import {
  APP_CLONE_INPUT_TYPE,
  appCloneInputFilled,
  appCloneInputId,
  appCloneInputNode,
  appCloneNodes,
  appCloneTargetId,
  appClonesReady,
  appDialogueCloneLabels,
  appRunNodeIds,
  withSpeakerClone,
} from "../app-clone-inputs"

/**
 * A published app's one-off voice clone is the runner's input (decided
 * 2026-11-13): which nodes ask for it, follows the server's `sentClones`.
 */

const EMPTIED = { sourceAudioUrl: "", consentAudioUrl: "" }
const MINE = { sourceAudioUrl: "https://cdn.example/me.wav", consentAudioUrl: "https://cdn.example/consent.wav" }
const OWN = { userId: "u1", signature: "sig-u1" }

const tts = (id: string, data: Record<string, unknown>) => ({ id, type: "text-to-speech", data: { label: `TTS ${id}`, ...data } })
const dialogue = (id: string, data: Record<string, unknown>) => ({ id, type: "text-to-dialogue", data: { label: `Dialogue ${id}`, ...data } })

describe("the clone nodes of an app (as it ships, emptied)", () => {
  it("a Text to Speech node holding a clone, emptied or not; none without one", () => {
    const nodes = [tts("A", { replica: EMPTIED }), tts("B", { voiceId: "Kore" }), { id: "C", type: "text-prompt", data: {} }]
    expect(appCloneNodes(nodes, {}).map((n) => n.id)).toEqual(["A"])
  })

  it("a dialogue's cloned speaker counts only when a line speaks with it (dialogue, else script)", () => {
    const used = dialogue("D", { dialogue: [{ text: "Hi", voice: "Me" }], speakers: [{ voice: "Me", replica: EMPTIED }] })
    const unused = dialogue("E", { dialogue: [{ text: "Hi", voice: "Kore" }], speakers: [{ voice: "Me", replica: EMPTIED }] })
    const script = dialogue("F", { script: [{ text: "Hi", voice: "Me" }], speakers: [{ voice: "Me", replica: EMPTIED }] })
    const directionOnly = dialogue("G", { dialogue: [{ text: "Hi", voice: "Kore" }], speakers: [{ voice: "Kore", pace: "slow" }] })
    expect(appCloneNodes([used, unused, script, directionOnly], {}).map((n) => n.id)).toEqual(["D", "F"])
    expect(appDialogueCloneLabels(used.data)).toEqual(["Me"])
  })

  it("judges the node as the run reads it: the runner's values over what ships", () => {
    const node = dialogue("D", { dialogue: [{ text: "Hi", voice: "Kore" }], speakers: [{ voice: "Me", replica: EMPTIED }] })
    expect(appCloneNodes([node], {})).toEqual([])
    // An exposed script whose line the runner moves onto the clone: now it is sent.
    expect(appCloneNodes([node], { D: { dialogue: [{ text: "Hi", voice: "Me" }] } }).map((n) => n.id)).toEqual(["D"])
  })

  it("a loop's expanded copy is not a node of its own", () => {
    expect(appCloneNodes([tts("A__iter_1", { replica: EMPTIED, __expandedClone: true })], {})).toEqual([])
  })

  it("only nodes the run executes: a hidden node, or one outside the app's baked route, asks for nothing (the server's check)", () => {
    expect(appCloneNodes([{ ...tts("A", { replica: EMPTIED }), hidden: true }], {})).toEqual([])
    expect(appCloneNodes([tts("A", { replica: EMPTIED })], {}, new Set(["B"]))).toEqual([])
    expect(appCloneNodes([tts("A", { replica: EMPTIED })], {}, new Set(["A"])).map((n) => n.id)).toEqual(["A"])
    expect(appClonesReady([tts("A", { replica: EMPTIED })], {}, "u1", new Set(["B"]))).toBe(true)
    // No baked route (or the whole workflow): every node.
    expect(appRunNodeIds([tts("A", {})], [], { runTarget: "workflow" })).toBeUndefined()
    expect(appRunNodeIds([tts("A", {})], [], null)).toBeUndefined()
  })
})

describe("Run waits for the runner's own recordings and tick", () => {
  const nodes = [tts("A", { replica: EMPTIED })]

  it("not until both recordings are in and the consent is the runner's own", () => {
    expect(appClonesReady(nodes, {}, "u1")).toBe(false)
    expect(appClonesReady(nodes, { A: { replica: MINE } }, "u1")).toBe(false)
    expect(appClonesReady(nodes, { A: { replica: MINE, replicaConsent: { userId: "someone", signature: "s" } } }, "u1")).toBe(false)
    expect(appClonesReady(nodes, { A: { replica: MINE, replicaConsent: OWN } }, "u1")).toBe(true)
    expect(appClonesReady(nodes, { A: { replica: MINE, replicaConsent: OWN } }, undefined)).toBe(false)
  })

  it("a dialogue's clones a line uses, each; a clone no line uses is not waited on", () => {
    const d = dialogue("D", {
      dialogue: [{ text: "Hi", voice: "Me" }, { text: "Yo", voice: "Kore" }],
      speakers: [{ voice: "Me", replica: EMPTIED }, { voice: "Kore", pace: "slow" }, { voice: "Spare", replica: EMPTIED }],
    })
    const filled = withSpeakerClone((d.data as Record<string, unknown>).speakers, "Me", { replica: MINE, replicaConsent: OWN })
    expect(appClonesReady([d], {}, "u1")).toBe(false)
    expect(appClonesReady([d], { D: { speakers: filled } }, "u1")).toBe(true)
  })

  it("an app with no clone never waits", () => {
    expect(appClonesReady([tts("B", { voiceId: "Kore" })], {}, undefined)).toBe(true)
  })
})

describe("the synthetic card node", () => {
  it("has an id of its own that leads back to its clone node, and carries the node as it ships", () => {
    const node = appCloneInputNode(tts("A", { replica: EMPTIED }), "Your voice")
    expect(node.id).toBe(appCloneInputId("A"))
    expect(node.type).toBe(APP_CLONE_INPUT_TYPE)
    expect(appCloneTargetId(node.id)).toBe("A")
    expect(appCloneTargetId("A")).toBeUndefined()
    expect((node.data as Record<string, unknown>).label).toBe("Your voice")
    expect((node.data as Record<string, unknown>).cloneNodeData).toMatchObject({ replica: EMPTIED })
  })

  it("the composer's chip reads filled once every clone has both recordings and a consent record", () => {
    const node = appCloneInputNode(tts("A", { replica: EMPTIED }), "Your voice")
    expect(appCloneInputFilled(node, {})).toBe(false)
    expect(appCloneInputFilled(node, { A: { replica: MINE } })).toBe(false)
    expect(appCloneInputFilled(node, { A: { replica: MINE, replicaConsent: OWN } })).toBe(true)
  })
})

describe("a dialogue's speakers, written whole", () => {
  it("patches the one clone and keeps every other speaker as it was; a cleared consent leaves the entry", () => {
    const speakers = [{ voice: "Me", replica: EMPTIED }, { voice: "Kore", pace: "slow" }]
    const filled = withSpeakerClone(speakers, "Me", { replica: MINE, replicaConsent: OWN })
    expect(filled).toEqual([{ voice: "Me", replica: MINE, replicaConsent: OWN }, { voice: "Kore", pace: "slow" }])
    expect(filled[1]).toBe(speakers[1])
    expect(withSpeakerClone(filled, "Me", { replicaConsent: undefined })).toEqual([{ voice: "Me", replica: MINE }, { voice: "Kore", pace: "slow" }])
  })
})
