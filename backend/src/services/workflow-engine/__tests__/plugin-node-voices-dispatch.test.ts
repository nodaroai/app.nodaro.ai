/**
 * The voice lock on the PLUGIN-DISPATCHED path: a workflow run sends a
 * plugin-served speech node (Voice Changer Pro) straight to the plugin's
 * handler, past the plugin's own route and its voice check. So the engine
 * reads the node's voices ahead of the build with the reader the plugin
 * declares (`nodeVoices()`), on the node as the build sees it, and only under
 * a lock: with no lock nothing is read, and no other node type is read.
 *
 * What the builder then does with them (judge, or refuse when nothing was
 * read) is pinned in `payload-builder-speech-and-deny.test.ts`; that the
 * executor hands them on, in `node-executor-voice-lock.test.ts`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { PLUGIN_SPEECH_NODE_TYPES, nodeAsBuilt, pluginVoicesTheBuildDispatches } from "../dispatched-voices.js"
import { setPluginNodeVoiceReaders, _resetPluginNodeVoiceReadersForTests } from "../../../lib/private-plugins/node-voices-registry.js"
import { _resetPluginNodeVoicesSourceForTests } from "../../../lib/private-plugins/plugin-node-voices.js"
import { __resetSurfaceProfileCacheForTests } from "../../../lib/surface-profile.js"
import type { PluginNodeVoiceReader } from "../../../lib/private-plugins/types.js"
import type { SimpleNode } from "../types.js"

const vcpNode = (data: Record<string, unknown> = {}): SimpleNode => ({
  id: "vcp-1",
  type: "voice-changer-pro",
  data: { label: "Recast", audioUrl: "https://example.com/a.mp3", orderedVoices: [{ voiceId: "LibVoice000000000001" }, null], ...data },
})

function lock(genders: string[]) {
  process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ voice: { allowedGenders: genders } })
  __resetSurfaceProfileCacheForTests()
}

function declare(readers: Record<string, PluginNodeVoiceReader>) {
  setPluginNodeVoiceReaders(new Map(Object.entries(readers)))
}

beforeEach(() => {
  _resetPluginNodeVoiceReadersForTests()
  _resetPluginNodeVoicesSourceForTests()
})

afterEach(() => {
  delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
})

describe("pluginVoicesTheBuildDispatches", () => {
  it("names Voice Changer Pro as a plugin-served node that speaks", () => {
    expect([...PLUGIN_SPEECH_NODE_TYPES]).toEqual(["voice-changer-pro"])
  })

  it("with no lock: reads nothing, even with a reader declared", async () => {
    const reader = vi.fn(() => ["LibVoice000000000001"])
    declare({ "voice-changer-pro": reader })

    expect(await pluginVoicesTheBuildDispatches(vcpNode(), {})).toBeUndefined()
    expect(reader).not.toHaveBeenCalled()
  })

  it("under a lock: the reader the plugin declares, on the node as the build sees it", async () => {
    lock(["male"])
    const reader = vi.fn<PluginNodeVoiceReader>((data) =>
      ((data.orderedVoices ?? []) as Array<{ voiceId: string } | null>).flatMap((v) => (v ? [v.voiceId] : [])))
    declare({ "voice-changer-pro": reader })
    const node = vcpNode()
    const inputs = { audioUrl: "https://example.com/wired.mp3" }

    expect(await pluginVoicesTheBuildDispatches(node, inputs)).toEqual(["LibVoice000000000001"])
    expect(reader).toHaveBeenCalledTimes(1)
    expect(reader.mock.calls[0]![0]).toEqual(nodeAsBuilt(node, []).data)
    expect(reader.mock.calls[0]![1]).toEqual(inputs)
  })

  it("under a lock: undefined when the plugin declares no reader for the node (the builder then refuses it)", async () => {
    lock(["male"])
    declare({ "some-other-node": () => ["LibVoice000000000001"] })

    expect(await pluginVoicesTheBuildDispatches(vcpNode(), {})).toBeUndefined()
  })

  it("under a lock: an empty list when the reader finds no named voice — distinct from no reader", async () => {
    lock(["male"])
    declare({ "voice-changer-pro": () => [] })

    expect(await pluginVoicesTheBuildDispatches(vcpNode({ orderedVoices: [null] }), {})).toEqual([])
  })

  it("never reads a node type that is not a plugin-served speech node", async () => {
    lock(["male"])
    const reader = vi.fn(() => ["Daniel"])
    declare({ "voice-changer": reader, "generate-video-pro": reader })

    for (const type of ["voice-changer", "text-to-speech", "generate-video-pro"]) {
      expect(await pluginVoicesTheBuildDispatches({ id: "n", type, data: {} }, {})).toBeUndefined()
    }
    expect(reader).not.toHaveBeenCalled()
  })

  it("a reader that fails throws: a server error, never an allow", async () => {
    lock(["male"])
    declare({
      "voice-changer-pro": () => {
        throw new Error("reader bug")
      },
    })

    await expect(pluginVoicesTheBuildDispatches(vcpNode(), {})).rejects.toThrow("reader bug")
  })
})
