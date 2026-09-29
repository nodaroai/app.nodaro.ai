/**
 * A Motion node wired into a video node's Settings input adds its clause to the
 * prompt (it sets no field). Mirrors the editor's collector
 * (frontend cinematography-hints.ts), which asks the same `isSettingsHintEdge`.
 */
import { describe, it, expect } from "vitest"
import { buildPayload } from "../payload-builder.js"
import type { SimpleNode, SimpleEdge } from "../types.js"

const node = (id: string, type: string, data: Record<string, unknown> = {}): SimpleNode => ({ id, type, data })
const wire = (source: string, target: string, targetHandle = "settings"): SimpleEdge =>
  ({ id: `${source}->${target}`, source, target, sourceHandle: null, targetHandle }) as SimpleEdge

const promptOf = (consumer: SimpleNode, nodes: SimpleNode[], edges: SimpleEdge[]): string =>
  buildPayload(consumer, "job-1", {}, undefined, { nodes, edges, nodeStates: {} }).payload.prompt as string

describe("payload-builder: Motion in the Settings input", () => {
  const video = node("v", "generate-video", { prompt: "a lighthouse at dusk", provider: "seedance-2" })
  const dynamic = node("m1", "motion", { label: "Motion", motion: "dynamic" })
  const subtle = node("m2", "motion", { label: "Calm", motion: "subtle" })

  it("adds the Motion clause to a video prompt", () => {
    expect(promptOf(video, [video, dynamic], [wire("m1", "v")])).toMatch(/dynamic, energetic motion/)
  })

  it("follows the Inject Look switch", () => {
    const off = { ...video, data: { ...video.data, injectLook: false } }
    expect(promptOf(off, [off, dynamic], [wire("m1", "v")])).not.toMatch(/energetic motion/)
  })

  it("uses only the last Motion wired, as the chips show", () => {
    const prompt = promptOf(video, [video, dynamic, subtle], [wire("m1", "v"), wire("m2", "v")])
    expect(prompt).toMatch(/subtle, gentle motion/)
    expect(prompt).not.toMatch(/energetic motion/)
  })

  it("adds nothing through a handle that is not the Settings input", () => {
    expect(promptOf(video, [video, dynamic], [wire("m1", "v", "assets")])).not.toMatch(/energetic motion/)
  })
})
