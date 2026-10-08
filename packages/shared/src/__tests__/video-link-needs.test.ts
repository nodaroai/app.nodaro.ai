import { describe, it, expect } from "vitest"
import {
  AUTO_DOWNLOAD_MAX_SEC,
  VIDEO_LINK_AUDIO_CONSUMER_TYPES,
  VIDEO_LINK_TOLERANT_CONSUMER_TYPES,
  YOUTUBE_MAX_HEIGHT,
  videoLinkNeedOf,
  videoLinkRunNeeds,
} from "../video-link.js"

const YT = "https://www.youtube.com/watch?v=aqz-KE-bpKQ"
const link = (id: string, data: Record<string, unknown> = { youtubeUrl: YT }) => ({ id, type: "youtube-video", data })
const node = (id: string, type: string, data: Record<string, unknown> = {}) => ({ id, type, data })
const edge = (source: string, target: string) => ({ source, target })

describe("what a Video URL node must fetch for the nodes that read it", () => {
  it("the audio readers are a subset of the consumers that never read the video file", () => {
    for (const type of VIDEO_LINK_AUDIO_CONSUMER_TYPES) expect(VIDEO_LINK_TOLERANT_CONSUMER_TYPES.has(type)).toBe(true)
    expect([...VIDEO_LINK_AUDIO_CONSUMER_TYPES].sort()).toEqual(["suno-cover", "transcribe"])
  })

  it("a node that watches the video needs the file; audio readers alone need the track; link readers alone need nothing", () => {
    expect(videoLinkNeedOf(["video-to-video"])).toBe("file")
    expect(videoLinkNeedOf(["transcribe", "video-to-video"])).toBe("file")
    expect(videoLinkNeedOf(["transcribe"])).toBe("audio")
    expect(videoLinkNeedOf(["suno-cover", "content-recipe"])).toBe("audio")
    expect(videoLinkNeedOf(["dubbing", "content-recipe"])).toBe("none")
    expect(videoLinkNeedOf([])).toBe("none")
  })

  it("the card's and the server's constants are the same numbers the editor used", () => {
    expect(AUTO_DOWNLOAD_MAX_SEC).toBe(240)
    expect(YOUTUBE_MAX_HEIGHT).toBe(1080)
  })
})

describe("videoLinkRunNeeds — one reading of the graph for the editor's gate, the card and the server", () => {
  it("reads each Video URL node's consumers inside the run, at any depth upstream of the scope", () => {
    const nodes = [link("src"), node("pass", "trim-video"), node("run", "video-to-video")]
    const edges = [edge("src", "pass"), edge("pass", "run")]
    expect(videoLinkRunNeeds(["run"], nodes, edges).get("src")).toBe("file")
  })

  it("Transcribe alone is audio-only; add a node that watches the video and it is the file", () => {
    const nodes = [link("src"), node("tx", "transcribe"), node("va", "video-analysis")]
    expect(videoLinkRunNeeds(["tx"], nodes, [edge("src", "tx")]).get("src")).toBe("audio")
    expect(videoLinkRunNeeds(["tx", "va"], nodes, [edge("src", "tx"), edge("src", "va")]).get("src")).toBe("file")
  })

  it("a link that feeds nothing in the run is absent from the answer", () => {
    const nodes = [link("unused"), link("other"), node("run", "video-to-video"), node("elsewhere", "video-to-video")]
    const needs = videoLinkRunNeeds(["run"], nodes, [edge("other", "elsewhere")])
    expect(needs.has("unused")).toBe(false)
    expect(needs.has("other")).toBe(false)
  })

  it("skipped nodes are not part of the run and pull nothing in", () => {
    const nodes = [link("src"), node("run", "video-to-video", { skipped: true })]
    expect(videoLinkRunNeeds(["run"], nodes, [edge("src", "run")]).size).toBe(0)
  })

  it("a null scope is the whole graph (the app runner's view)", () => {
    const nodes = [link("src"), node("tx", "transcribe"), node("dub", "dubbing")]
    expect(videoLinkRunNeeds(null, nodes, [edge("src", "tx"), edge("src", "dub")]).get("src")).toBe("audio")
    expect(videoLinkRunNeeds(null, [link("src"), node("dub", "dubbing")], [edge("src", "dub")]).get("src")).toBe("none")
  })
})
