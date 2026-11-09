/**
 * WHO reads the voices a workflow run of a plugin-served node will speak in
 * (the voice lock's input for a node the engine dispatches straight to a
 * plugin's handler). The reader is the plugin's own (`nodeVoices()`):
 *
 *   - a process that loaded the plugins runs it;
 *   - the standalone orchestrator loads none, so it asks this container's API
 *     through the source it registered at boot;
 *   - neither: no reader, which the engine refuses under a lock.
 *
 * A reader or an API answer that is not a list of voice ids, and a source
 * that fails, THROW — a server error, never an allow.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import {
  readDeclaredNodeVoices,
  readPluginNodeVoices,
  setPluginNodeVoicesSource,
  _resetPluginNodeVoicesSourceForTests,
  type PluginNodeVoicesDeps,
} from "../plugin-node-voices.js"
import type { PluginNodeVoiceReader } from "../types.js"

const slotVoices: PluginNodeVoiceReader = (data) =>
  ((data.slots ?? []) as Array<string | null>).filter((v): v is string => typeof v === "string")

function deps(readers: Record<string, PluginNodeVoiceReader> = {}, loaded = true): PluginNodeVoicesDeps {
  return { readersLoaded: () => loaded, readerOf: (type) => readers[type] }
}

beforeEach(() => _resetPluginNodeVoicesSourceForTests())

describe("a process that loaded the plugins", () => {
  it("runs the reader the plugin declares for the type, with the node's data and inputs", async () => {
    const reader = vi.fn(slotVoices)
    const voices = await readPluginNodeVoices("speaker-node", { slots: ["VoiceA", null, "VoiceB"] }, { audioUrl: "https://x/a.mp3" }, deps({ "speaker-node": reader }))

    expect(voices).toEqual(["VoiceA", "VoiceB"])
    expect(reader).toHaveBeenCalledWith({ slots: ["VoiceA", null, "VoiceB"] }, { audioUrl: "https://x/a.mp3" })
  })

  it("answers null when no reader is declared for the type", async () => {
    expect(await readPluginNodeVoices("speaker-node", { slots: ["VoiceA"] }, {}, deps({}))).toBeNull()
  })

  it("never asks the API, even with a source registered", async () => {
    const source = vi.fn(async () => ["FromApi"])
    setPluginNodeVoicesSource(source)
    expect(await readPluginNodeVoices("speaker-node", { slots: ["VoiceA"] }, {}, deps({ "speaker-node": slotVoices }))).toEqual(["VoiceA"])
    expect(source).not.toHaveBeenCalled()
  })

  it("hands the reader JSON copies, so a reader can never change the node the engine builds", async () => {
    const data = { slots: ["VoiceA"], nested: { kept: true }, dropped: undefined }
    const inputs = { audioUrl: "https://x/a.mp3" }
    const seen: unknown[] = []
    const mutating: PluginNodeVoiceReader = (d, i) => {
      // What it was handed, before it writes to it: the JSON form (no undefined
      // keys, as the API would receive it), never the caller's own objects.
      seen.push({ hadDropped: "dropped" in d, slots: [...(d.slots as string[])], sameData: d === data, sameInputs: i === inputs, inputs: { ...i } })
      ;(d as Record<string, unknown>).slots = ["Hijacked"]
      ;((d as { nested: Record<string, unknown> }).nested).kept = false
      return []
    }
    await readPluginNodeVoices("speaker-node", data, inputs, deps({ "speaker-node": mutating }))

    expect(seen).toEqual([{ hadDropped: false, slots: ["VoiceA"], sameData: false, sameInputs: false, inputs }])
    expect(data).toEqual({ slots: ["VoiceA"], nested: { kept: true }, dropped: undefined })
  })

  it("throws when the reader throws", async () => {
    const broken: PluginNodeVoiceReader = () => {
      throw new Error("reader bug")
    }
    await expect(readPluginNodeVoices("speaker-node", {}, {}, deps({ "speaker-node": broken }))).rejects.toThrow("reader bug")
  })

  it("throws when the reader answers anything but a list of strings", async () => {
    for (const answer of [undefined, null, "VoiceA", { voices: ["VoiceA"] }, ["VoiceA", 7], [null]]) {
      const odd = (() => answer) as unknown as PluginNodeVoiceReader
      await expect(readPluginNodeVoices("speaker-node", {}, {}, deps({ "speaker-node": odd }))).rejects.toThrow(/speaker-node/)
    }
  })

  it("keeps empty strings for the judge to skip (a default voice is the policy's own)", async () => {
    const withDefault: PluginNodeVoiceReader = () => ["", "VoiceA"]
    expect(await readPluginNodeVoices("speaker-node", {}, {}, deps({ "speaker-node": withDefault }))).toEqual(["", "VoiceA"])
  })
})

describe("the standalone orchestrator (no plugin loaded)", () => {
  it("asks the registered source, with the node's type, data and inputs", async () => {
    const source = vi.fn(async () => ["VoiceA", "VoiceB"])
    setPluginNodeVoicesSource(source)

    const voices = await readPluginNodeVoices("speaker-node", { slots: ["VoiceA"] }, { audioUrl: "https://x/a.mp3" }, deps({}, false))

    expect(voices).toEqual(["VoiceA", "VoiceB"])
    expect(source).toHaveBeenCalledWith("speaker-node", { slots: ["VoiceA"] }, { audioUrl: "https://x/a.mp3" })
  })

  it("passes the API's null on: no reader is declared there either", async () => {
    setPluginNodeVoicesSource(async () => null)
    expect(await readPluginNodeVoices("speaker-node", {}, {}, deps({}, false))).toBeNull()
  })

  it("throws when the API cannot be asked, or answers anything but a list of strings", async () => {
    setPluginNodeVoicesSource(async () => {
      throw new Error("the API answered 500")
    })
    await expect(readPluginNodeVoices("speaker-node", {}, {}, deps({}, false))).rejects.toThrow("the API answered 500")

    setPluginNodeVoicesSource(async () => [1, 2] as unknown as string[])
    await expect(readPluginNodeVoices("speaker-node", {}, {}, deps({}, false))).rejects.toThrow(/speaker-node/)
  })

  it("with no source registered: no reader", async () => {
    expect(await readPluginNodeVoices("speaker-node", { slots: ["VoiceA"] }, {}, deps({ "speaker-node": slotVoices }, false))).toBeNull()
  })
})

describe("readDeclaredNodeVoices — what the API's route answers", () => {
  it("is the declared reader's answer, checked, or null", () => {
    expect(readDeclaredNodeVoices("speaker-node", { slots: ["VoiceA"] }, {}, deps({ "speaker-node": slotVoices }))).toEqual(["VoiceA"])
    expect(readDeclaredNodeVoices("other-node", { slots: ["VoiceA"] }, {}, deps({ "speaker-node": slotVoices }))).toBeNull()
    const odd = (() => "VoiceA") as unknown as PluginNodeVoiceReader
    expect(() => readDeclaredNodeVoices("speaker-node", {}, {}, deps({ "speaker-node": odd }))).toThrow(/speaker-node/)
  })
})
