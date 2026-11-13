/**
 * The audio a server run of a Lip Sync plays is the audio its estimate prices
 * (decided 2026-11-13): `lipSyncAudioSourceId(…, "server")`, the rule the
 * server's estimate reads, names the node whose output the orchestrator's
 * input resolver hands the run as `audioUrl` — the last wired `audio`, else
 * the node picked in its settings.
 */
import { describe, it, expect } from "vitest"
import { lipSyncAudioSourceId } from "@nodaro/render-rules"
import { resolveNodeInputs } from "../input-resolver.js"
import type { SimpleEdge, SimpleNode } from "../types.js"

const upload = (id: string): SimpleNode => ({ id, type: "upload-audio", data: { label: id, url: `https://m.test/${id}.mp3` } })
const wire = (source: string): SimpleEdge => ({ id: `${source}->x`, source, sourceHandle: "audio", target: "x", targetHandle: "audio" })
const lipSync = (data: Record<string, unknown> = {}): SimpleNode => ({ id: "x", type: "lip-sync", data: { label: "x", provider: "kling-avatar", imageUrl: "https://m.test/face.png", ...data } })

function played(target: SimpleNode, edges: SimpleEdge[]): string | undefined {
  const nodes = [upload("a"), upload("b"), target]
  const url = resolveNodeInputs(target, edges, {}, nodes).audioUrl
  return typeof url === "string" ? url.match(/\/(\w)\.mp3$/)?.[1] : undefined
}

describe("a server run's Lip Sync plays the audio its estimate prices", () => {
  const nodes = [upload("a"), upload("b")]
  const cases: Array<[string, Record<string, unknown>, SimpleEdge[]]> = [
    ["two wired, a then b", {}, [wire("a"), wire("b")]],
    ["two wired, b then a", {}, [wire("b"), wire("a")]],
    ["one wired and another picked", { selectedAudioNodeId: "b" }, [wire("a")]],
    ["none wired, one picked", { selectedAudioNodeId: "b" }, []],
    ["one wired", {}, [wire("a")]],
  ]
  it.each(cases)("%s", (_name, data, edges) => {
    const target = lipSync(data)
    const source = lipSyncAudioSourceId(target, [...nodes, target], edges, "server")
    expect(source).toBeDefined()
    expect(played(target, edges)).toBe(source)
  })

  it("the editor's own Run plays the picked audio over a wire, so its estimate reads that one", () => {
    const target = lipSync({ selectedAudioNodeId: "b" })
    expect(lipSyncAudioSourceId(target, [...nodes, target], [wire("a")], "editor")).toBe("b")
    expect(lipSyncAudioSourceId(target, [...nodes, target], [wire("a")], "server")).toBe("a")
  })

  it("no audio node at all: nothing to read (the estimate quotes the top tier)", () => {
    const target = lipSync({ audioUrl: "https://m.test/claimed.mp3", audioDurationSec: 1 })
    expect(lipSyncAudioSourceId(target, [target], [], "server")).toBeUndefined()
    expect(lipSyncAudioSourceId(target, [target], [], "editor")).toBeUndefined()
  })
})
