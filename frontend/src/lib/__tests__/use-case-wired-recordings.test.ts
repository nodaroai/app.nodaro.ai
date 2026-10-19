/**
 * A use-case node's wired recordings, as its panel lists them and the store
 * keeps their settings: keyed by the id each wire was DRAWN from (a Teleport
 * Receive's own id — what `mediaOrder` is saved under, and what both engines
 * map to the run's ids, carriedNodeSettings), each judged by what it CARRIES
 * (the node feeding the Send). Raw store edges and the panel's carried edges
 * read alike.
 */
import { describe, expect, it, vi } from "vitest"

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }) }))

import { bypassTeleports } from "@nodaro/render-rules"
import { usecaseWiredRecordings } from "@/lib/use-case-wired-recordings"
import { usecaseWiredMediaKind } from "@/lib/use-case-audio-lock"
import { usecaseCamerasGraph } from "@/lib/use-case-cameras-invariant"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

const n = (id: string, type: string, data: Record<string, unknown> = {}) => ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as unknown as WorkflowNode
const e = (id: string, source: string, sourceHandle: string, target: string, targetHandle: string, data?: Record<string, unknown>) =>
  ({ id, source, sourceHandle, target, targetHandle, ...(data ? { data } : {}) }) as unknown as WorkflowEdge

/** A sound recording sent through a Teleport pair into Recordings, beside a camera wired directly. */
function graph(tighten: Record<string, unknown> = {}) {
  const nodes = [n("mic", "upload-audio"), n("send", "teleport-send"), n("recv", "teleport-receive"), n("cam", "upload-video"), n("t", "tighten-episode", tighten)]
  const edges = [
    e("e1", "mic", "audio", "send", "in"),
    e("tp", "send", "out", "recv", "in", { teleporter: true }),
    e("e2", "recv", "out", "t", "media"),
    e("e3", "cam", "video", "t", "media"),
  ]
  return { nodes, edges }
}

describe("through a Teleport pair", () => {
  it("the recording is keyed by the Receive it was drawn from and judged by what it carries — raw or carried edges alike", () => {
    const { nodes, edges } = graph()
    const t = { id: "t", type: "tighten-episode" as const, data: {} }
    const raw = usecaseWiredRecordings(t, nodes, edges).recordings
    expect(raw).toEqual([{ nodeId: "recv", kind: "audio" }, { nodeId: "cam", kind: "video" }])
    expect(usecaseWiredRecordings(t, nodes, bypassTeleports(nodes, edges)).recordings).toEqual(raw)
  })
  it("the order saved under the Receive's id orders it, in the panel and in the store's lock alike", () => {
    const { nodes, edges } = graph({ mediaOrder: ["cam", "recv"] })
    const t = { id: "t", type: "tighten-episode" as const, data: { mediaOrder: ["cam", "recv"] } }
    expect(usecaseWiredRecordings(t, nodes, bypassTeleports(nodes, edges)).recordings.map((r) => r.nodeId)).toEqual(["cam", "recv"])
    // A viewer whose run reads the first recording: the camera, so no lock — on raw and carried edges.
    expect(usecaseWiredMediaKind("t", nodes, edges)).toBe("video")
    expect(usecaseWiredMediaKind("t", nodes, bypassTeleports(nodes, edges))).toBe("video")
    const soundFirst = graph()
    expect(usecaseWiredMediaKind("t", soundFirst.nodes, soundFirst.edges)).toBe("audio")
  })
  it("the store's invariant keeps the Receive in mediaOrder and clears a wide on the sound it carries", () => {
    const { nodes, edges } = graph({ mediaOrder: ["cam", "recv"], cameras: { wide: 2 } })
    const r = usecaseCamerasGraph(nodes, edges)
    expect(r.nodes.find((x) => x.id === "t")!.data).toMatchObject({ mediaOrder: ["cam", "recv"], cameras: { wide: null } })
  })
  it("a Master audio through a pair from the node a recording comes from is that camera's own track", () => {
    const nodes = [n("split", "split-media"), n("send", "teleport-send"), n("recv", "teleport-receive"), n("t", "tighten-episode")]
    const edges = [
      e("e1", "split", "audio", "send", "in"),
      e("tp", "send", "out", "recv", "in", { teleporter: true }),
      e("e2", "recv", "out", "t", "masterAudio"),
      e("e3", "split", "video", "t", "media"),
    ]
    expect(usecaseWiredRecordings({ id: "t", type: "tighten-episode", data: {} }, nodes, edges).masterId).toBeUndefined()
  })
})
