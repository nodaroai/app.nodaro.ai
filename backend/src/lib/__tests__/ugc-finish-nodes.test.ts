/**
 * Which nodes are a UGC video's join, overlay and captions (`ugcFinishNodeIds`,
 * @nodaro/render-rules): the video's own by their PLACE in the chain, whatever
 * else they hold. The newer-run lanes read this membership. It is not the price
 * rule (`ugcChains`), which leaves out a join that also takes another input and an
 * overlay with layers of its own (they render anyway, so they keep their own
 * price) — membership keeps both. The URLs are placeholders.
 */
import { describe, expect, it } from "vitest"
import { UGC_FINISH_NODE_TYPES, ugcChains, ugcFinishNodeIds } from "@nodaro/render-rules"

type N = { id: string; type: string; data: Record<string, unknown> }
type E = { source: string; target: string; sourceHandle?: string | null; targetHandle: string }
const n = (id: string, type: string, data: Record<string, unknown> = {}): N => ({ id, type, data: { label: id, ...data } })
const e = (source: string, target: string, targetHandle: string, sourceHandle: string | null = null): E => ({ source, target, targetHandle, sourceHandle })

/** The template's UGC video, wired as it ships. */
function video(): { nodes: N[]; edges: E[] } {
  const nodes: N[] = [
    n("script", "ugc-script", { targetDurationSec: 15 }),
    n("creator", "ugc-creator", { source: "sampled", gender: "woman" }),
    n("clips", "ugc-clips"),
    n("clip", "ugc-clip"),
    n("cards", "ugc-cards"),
    n("join", "combine-videos", { transition: "cut" }),
    n("overlay", "video-overlay", { layers: [], layerCount: 0 }),
    n("captions", "add-captions", { style: "body" }),
  ]
  const edges: E[] = [
    e("script", "clips", "plan", "plan"), e("creator", "clips", "creator", "creator"), e("clips", "clip", "clip", "clips"),
    e("clip", "join", "in", "video-out"), e("clip", "cards", "notes", "video-out"), e("clips", "cards", "plan", "plan-out"),
    e("clips", "cards", "transcript", "transcript"), e("join", "cards", "video", "video"), e("join", "overlay", "video", "video"),
    e("cards", "overlay", "layerPlan", "layerPlan"), e("cards", "captions", "captionPlan", "captionPlan"), e("overlay", "captions", "in", "video-out"),
  ]
  return { nodes, edges }
}

const priced = (nodes: N[], edges: E[]) => ugcChains(nodes, edges).flatMap((c) => c.members.map((m) => m.id))

describe("a UGC video's finish nodes are its own by their place in the chain", () => {
  it("are its join, overlay and captions, each of a finish type", () => {
    const { nodes, edges } = video()
    const ids = ugcFinishNodeIds(nodes, edges)
    expect([...ids].sort()).toEqual(["captions", "join", "overlay"])
    for (const id of ids) expect(UGC_FINISH_NODE_TYPES.has(nodes.find((x) => x.id === id)!.type), id).toBe(true)
  })

  it("an overlay with a layer of its own (a stored logo) stays the video's; its price stays its own", () => {
    const { nodes, edges } = video()
    const withLogo = nodes.map((x) => (x.id === "overlay" ? n("overlay", "video-overlay", { layers: [{ imageUrl: "https://cdn.example/logo.png" }], layerCount: 1 }) : x))
    expect([...ugcFinishNodeIds(withLogo, edges)].sort()).toEqual(["captions", "join", "overlay"])
    expect(priced(withLogo, edges)).not.toContain("overlay")
  })

  it("an overlay with an image wired into a layer handle stays the video's; its price stays its own", () => {
    const { nodes, edges } = video()
    const wired = [...nodes, n("logo", "upload-image", { url: "https://cdn.example/logo.png" })]
    const wiredEdges = [...edges, e("logo", "overlay", "overlay", "image")]
    expect([...ugcFinishNodeIds(wired, wiredEdges)].sort()).toEqual(["captions", "join", "overlay"])
    expect(priced(wired, wiredEdges)).not.toContain("overlay")
  })

  it("a join taking an intro beside the video's clip stays the video's; its price stays its own", () => {
    const { nodes, edges } = video()
    const withIntro = [...nodes, n("intro", "upload-video", { url: "https://cdn.example/intro.mp4" })]
    const introEdges = [e("intro", "join", "in", "video"), ...edges]
    expect([...ugcFinishNodeIds(withIntro, introEdges)].sort()).toEqual(["captions", "join", "overlay"])
    expect(priced(withIntro, introEdges)).not.toContain("join")
  })

  it("a join shared by two UGC videos' clips is the video's whose UGC Cards it feeds", () => {
    const { nodes, edges } = video()
    const second = [n("clips2", "ugc-clips"), n("clip2", "ugc-clip")]
    const secondEdges = [e("clips2", "clip2", "clip", "clips"), e("clip2", "join", "in2", "video-out")]
    expect(ugcFinishNodeIds([...nodes, ...second], [...edges, ...secondEdges]).has("join")).toBe(true)
  })

  it("a node of a finish type elsewhere is not the video's: an outro after the captions, a join that feeds no UGC Cards", () => {
    const { nodes, edges } = video()
    const more = [
      ...nodes,
      n("intro", "upload-video", { url: "https://cdn.example/intro.mp4" }),
      n("outro", "combine-videos", { transition: "cut" }),
      n("loose", "combine-videos", { transition: "cut" }),
      n("plain", "video-overlay", { layers: [] }),
    ]
    const moreEdges = [
      ...edges,
      e("captions", "outro", "in", "video-out"), e("intro", "outro", "in2", "video"),
      e("clip", "loose", "in", "video-out"),
      e("loose", "plain", "video", "video"),
    ]
    expect([...ugcFinishNodeIds(more, moreEdges)].sort()).toEqual(["captions", "join", "overlay"])
  })

  it("a graph with no UGC video has none", () => {
    const nodes = [n("a", "upload-video"), n("j", "combine-videos"), n("o", "video-overlay"), n("c", "add-captions")]
    const edges = [e("a", "j", "in"), e("j", "o", "video"), e("o", "c", "in")]
    expect(ugcFinishNodeIds(nodes, edges).size).toBe(0)
  })
})

describe("a UGC Finish between the clip and the join (the video's clips, finished) keeps the chain whole", () => {
  /** The template as it ships with UGC Finish: clip → finish (clips) → join, clips' Script (sized) → finish (plan). */
  function finished(): { nodes: N[]; edges: E[] } {
    const { nodes, edges } = video()
    return {
      nodes: [...nodes, n("finish", "ugc-finish-clips")],
      edges: [
        ...edges.filter((x) => !(x.source === "clip" && x.target === "join")),
        e("clip", "finish", "clips", "video-out"), e("clips", "finish", "plan", "plan-out"), e("finish", "join", "in", "video-out"),
      ],
    }
  }
  it("the join, overlay and captions are still the video's finish nodes", () => {
    const { nodes, edges } = finished()
    expect([...ugcFinishNodeIds(nodes, edges)].sort()).toEqual(["captions", "join", "overlay"])
  })
  it("the price chain still holds the join (every wire into it is the video's), and UGC Finish as a free member", () => {
    const { nodes, edges } = finished()
    const [chain] = ugcChains(nodes, edges)
    expect(chain!.members).toContainEqual({ id: "join", part: "join" })
    expect(chain!.members).toContainEqual({ id: "finish", part: null })
    expect(priced(nodes, edges).sort()).toEqual([...priced(video().nodes, video().edges), "finish"].sort())
  })
  it("a join taking an intro beside the finished clips keeps its own price, as before", () => {
    const { nodes, edges } = finished()
    const withIntro = [...nodes, n("intro", "upload-video", { url: "https://cdn.example/intro.mp4" })]
    const introEdges = [e("intro", "join", "in", "video"), ...edges]
    expect(ugcFinishNodeIds(withIntro, introEdges).has("join")).toBe(true)
    expect(priced(withIntro, introEdges)).not.toContain("join")
  })
})
