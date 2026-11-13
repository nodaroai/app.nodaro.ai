// @vitest-environment node
import { describe, it, expect } from "vitest"
import { resolveUpstreamKieTaskId } from "../upstream-kie-task-id"

/**
 * The task a task-chained node (Extend Video on VEO / Runway / Grok, Upscale
 * Video on VEO or Seedance 2.5 HD) runs against — the rule the server's
 * workflow run follows too: a WIRED generation of the model the node works on
 * first, else the node's own `kieTaskId`. An Extend or Upscale Video node
 * upstream hands on nothing (its `kieTaskId` is the task it works ON, never its
 * own generation's), and neither does a generation of another model.
 */
const gen = (id: string, provider: string, kieTaskId?: string) => ({ id, type: "generate-video", data: { provider, ...(kieTaskId ? { kieTaskId } : {}) } })
const hd = { id: "hd", type: "video-upscale", data: { provider: "seedance-2-5-hd" } }

describe("resolveUpstreamKieTaskId", () => {
  it("a wired generation of the model the node works on: its task", () => {
    const nodes = [gen("draft", "seedance-2-5", "task-draft"), gen("other", "seedance-2-5"), hd]
    const edges = [
      { source: "other", target: "hd" },
      { source: "draft", target: "hd" },
      { source: "draft", target: "elsewhere" },
    ]
    expect(resolveUpstreamKieTaskId("hd", hd.data, nodes, edges)).toBe("task-draft")
  })

  it("prefers the wired Grok generation's task over the node's own stale one (as the server does)", () => {
    const ext = { id: "x", type: "extend-video", data: { provider: "grok-extend", kieTaskId: "stale-task" } }
    expect(resolveUpstreamKieTaskId("x", ext.data, [gen("g", "grok-i2v", "task-grok"), ext], [{ source: "g", target: "x" }])).toBe("task-grok")
  })

  it("the node's own task when nothing that fits is wired", () => {
    const ext = { id: "x", type: "extend-video", data: { provider: "veo-extend", kieTaskId: "own" } }
    expect(resolveUpstreamKieTaskId("x", ext.data, [ext], [])).toBe("own")
    expect(resolveUpstreamKieTaskId("x", ext.data, [gen("k", "kling-3.0", "task-kling"), ext], [{ source: "k", target: "x" }])).toBe("own")
  })

  it("an MCP-mapped extension (only its input task) hands on nothing — not the source task it holds", () => {
    const ext1 = { id: "x1", type: "extend-video", data: { provider: "grok-extend", kieTaskId: "orig-grok-task" } }
    const ext2 = { id: "x2", type: "extend-video", data: { provider: "grok-extend" } }
    expect(resolveUpstreamKieTaskId("x2", ext2.data, [gen("g", "grok-i2v", "orig-grok-task"), ext1, ext2], [{ source: "g", target: "x1" }, { source: "x1", target: "x2" }])).toBeUndefined()
  })

  it("VEO extend → VEO extend: the second gets the FIRST extension's own output task, never the task it extended", () => {
    const ext1 = { id: "x1", type: "extend-video", data: { provider: "veo-extend", kieTaskId: "orig-veo-task", outputKieTaskId: "task-ext1" } }
    const ext2 = { id: "x2", type: "extend-video", data: { provider: "veo-extend" } }
    expect(resolveUpstreamKieTaskId("x2", ext2.data, [ext1, ext2], [{ source: "x1", target: "x2" }])).toBe("task-ext1")
    // A VEO upscale takes a VEO extension's output task too.
    const up = { id: "u", type: "video-upscale", data: { provider: "veo-1080p" } }
    expect(resolveUpstreamKieTaskId("u", up.data, [ext1, up], [{ source: "x1", target: "u" }])).toBe("task-ext1")
  })

  // A graph saved before extensions recorded their output task apart: a server run wrote an
  // extension's OWN output task into its `kieTaskId`. It is read as its output exactly when it
  // differs from what the extension's source hands it.
  it("a saved chain: an extension whose kieTaskId an old server run overwrote hands it on; one equal to its source's does not", () => {
    const ext2 = { id: "x2", type: "extend-video", data: { provider: "veo-extend" } }
    const edges = [{ source: "g", target: "x1" }, { source: "x1", target: "x2" }]
    const legacy = { id: "x1", type: "extend-video", data: { provider: "veo-extend", kieTaskId: "task-ext1-old" } }
    expect(resolveUpstreamKieTaskId("x2", ext2.data, [gen("g", "veo3.1", "task-gen"), legacy, ext2], edges)).toBe("task-ext1-old")
    const mapped = { id: "x1", type: "extend-video", data: { provider: "veo-extend", kieTaskId: "task-gen" } }
    expect(resolveUpstreamKieTaskId("x2", ext2.data, [gen("g", "veo3.1", "task-gen"), mapped, ext2], edges)).toBeUndefined()
  })

  it("wired to a source that fits but recorded no task, a node never falls back to its own old output", () => {
    // A saved extend whose kieTaskId an old server run overwrote with its own output.
    const ext = { id: "x", type: "extend-video", data: { provider: "veo-extend", kieTaskId: "task-own-old" } }
    expect(resolveUpstreamKieTaskId("x", ext.data, [gen("g", "veo3.1"), ext], [{ source: "g", target: "x" }])).toBeUndefined()
  })

  it("a Grok extension that ran hands a Grok extend nothing", () => {
    const ext1 = { id: "x1", type: "extend-video", data: { provider: "grok-extend", kieTaskId: "orig-grok-task", outputKieTaskId: "task-grok-ext" } }
    const ext2 = { id: "x2", type: "extend-video", data: { provider: "grok-extend" } }
    expect(resolveUpstreamKieTaskId("x2", ext2.data, [ext1, ext2], [{ source: "x1", target: "x2" }])).toBeUndefined()
  })

  it("an upscale upstream hands on nothing: neither the task it holds nor its own output's", () => {
    const up = { id: "u", type: "video-upscale", data: { provider: "veo-1080p", kieTaskId: "orig-veo-task", outputKieTaskId: "task-up" } }
    const ext = { id: "x", type: "extend-video", data: { provider: "veo-extend" } }
    expect(resolveUpstreamKieTaskId("x", ext.data, [up, ext], [{ source: "u", target: "x" }])).toBeUndefined()
  })

  it("a generation of another model hands on nothing: a VEO upscale wired to a Kling clip, a Grok extend wired to VEO", () => {
    const veoUp = { id: "u", type: "video-upscale", data: { provider: "veo-1080p" } }
    expect(resolveUpstreamKieTaskId("u", veoUp.data, [gen("k", "kling-3.0", "task-kling"), veoUp], [{ source: "k", target: "u" }])).toBeUndefined()
    expect(resolveUpstreamKieTaskId("u", veoUp.data, [gen("v", "veo3.1", "task-veo"), veoUp], [{ source: "v", target: "u" }])).toBe("task-veo")
    const grokExt = { id: "x", type: "extend-video", data: { provider: "grok-extend" } }
    expect(resolveUpstreamKieTaskId("x", grokExt.data, [gen("v", "veo3.1", "task-veo"), grokExt], [{ source: "v", target: "x" }])).toBeUndefined()
  })

  it("undefined when nothing upstream carries one", () => {
    expect(resolveUpstreamKieTaskId("hd", hd.data, [gen("other", "seedance-2-5"), hd], [{ source: "other", target: "hd" }])).toBeUndefined()
    expect(resolveUpstreamKieTaskId("hd", undefined, [hd], [])).toBeUndefined()
  })
})
