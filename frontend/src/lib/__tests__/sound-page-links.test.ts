// @vitest-environment node
// A link to where a video is, used as the sound of Transcribe, Suno Cover or
// Suno Upload Extend, comes in through a Video URL node (its track). Given to
// one of them directly it would be an import with no box: the editor stops the
// run on it. Only what the editor can read before the run is judged.
import { describe, expect, it } from "vitest"
import { findSoundPageLink, isSoundPageLink, videoLinkTrackInto } from "../sound-page-links"

const PAGE = "https://www.youtube.com/watch?v=abc"
const FILE = "https://cdn.example.com/song.mp3"

const node = (id: string, type: string, data: Record<string, unknown> = {}) => ({ id, type, data: { label: `${type} ${id}`, ...data } })

describe("findSoundPageLink", () => {
  it("stops on a node's own link to where a video is: Suno Cover's link, Transcribe's", () => {
    expect(findSoundPageLink([node("c", "suno-cover", { uploadUrl: PAGE })], [], null)).toEqual({ nodeId: "c", label: "suno-cover c" })
    expect(findSoundPageLink([node("t", "transcribe", { audioUrl: ` ${PAGE} ` })], [], null)?.nodeId).toBe("t")
    expect(findSoundPageLink([node("c", "suno-cover", { audioUrl: PAGE })], [], null)?.nodeId).toBe("c")
  })

  it("Upload Extend is the server's to answer: it takes an audio file, and the canvas wires no Video URL node into it", () => {
    expect(findSoundPageLink([node("u", "suno-upload-extend", { uploadUrl: PAGE })], [], null)).toBeNull()
  })

  it("a Video URL node wired in is the sound (its track), whatever else is mapped or set", () => {
    const link = node("v", "youtube-video", { youtubeUrl: PAGE })
    const text = node("txt", "text-prompt", { text: PAGE })
    const cover = node("c", "suno-cover", { uploadUrl: PAGE, fieldMappings: { uploadUrl: { sourceNodeId: "txt" } } })
    expect(findSoundPageLink([link, text, cover], [{ source: "v", target: "c", targetHandle: "audio" }], null)).toBeNull()
    expect(findSoundPageLink([link, node("t", "transcribe", { audioUrl: PAGE })], [{ source: "v", target: "t", targetHandle: "audio" }], null)).toBeNull()
  })

  it("a file, a host that merely names a platform, or nothing is not one", () => {
    expect(findSoundPageLink([node("c", "suno-cover", { uploadUrl: FILE })], [], null)).toBeNull()
    expect(findSoundPageLink([node("c", "suno-cover", { uploadUrl: "https://dropbox.com/s/youtube.mp3" })], [], null)).toBeNull()
    expect(findSoundPageLink([node("c", "suno-cover", {})], [], null)).toBeNull()
    expect(findSoundPageLink([node("x", "dubbing", { sourceUrl: PAGE })], [], null)).toBeNull()
  })

  it("the run reads its own link in order: the first one set is the one judged", () => {
    expect(findSoundPageLink([node("c", "suno-cover", { uploadUrl: FILE, audioUrl: PAGE })], [], null)).toBeNull()
  })

  it("something wired into its sound input is what the run takes (a file, or a Video URL node's track): its own link is not judged", () => {
    const cover = node("c", "suno-cover", { uploadUrl: PAGE })
    expect(findSoundPageLink([cover], [{ source: "a", target: "c", targetHandle: "audio" }], null)).toBeNull()
    expect(findSoundPageLink([cover], [{ source: "a", target: "c" }], null)).toBeNull()
    expect(findSoundPageLink([cover], [{ source: "p", target: "c", targetHandle: "prompt" }], null)?.nodeId).toBe("c")
  })

  it("a Text node mapped into Suno Cover's link is read; another mapped source is the run's to answer", () => {
    const text = node("txt", "text-prompt", { text: PAGE })
    const mapped = node("c", "suno-cover", { uploadUrl: FILE, fieldMappings: { uploadUrl: { sourceNodeId: "txt" } } })
    expect(findSoundPageLink([text, mapped], [], null)?.nodeId).toBe("c")
    const llm = node("llm", "llm-chat", { text: PAGE, generatedText: PAGE })
    const fromLlm = node("c", "suno-cover", { uploadUrl: PAGE, fieldMappings: { uploadUrl: { sourceNodeId: "llm" } } })
    expect(findSoundPageLink([llm, fromLlm], [], null)).toBeNull()
  })

  it("only a node about to run, on this canvas: out of the run, frozen, or a sub-workflow's node is not judged", () => {
    expect(findSoundPageLink([node("c", "suno-cover", { uploadUrl: PAGE })], [], ["other"])).toBeNull()
    expect(findSoundPageLink([node("c", "suno-cover", { uploadUrl: PAGE })], [], ["c"])?.nodeId).toBe("c")
    expect(findSoundPageLink([node("c", "suno-cover", { uploadUrl: PAGE, skipped: true })], [], null)).toBeNull()
    expect(findSoundPageLink([node("__sub_x_c", "suno-cover", { uploadUrl: PAGE })], [], null)).toBeNull()
  })

  it("names the node by its label, else its type", () => {
    expect(findSoundPageLink([{ id: "c", type: "suno-cover", data: { uploadUrl: PAGE } }], [], null)?.label).toBe("suno-cover")
  })
})

describe("videoLinkTrackInto", () => {
  it("is the track a wired Video URL node fetched, and nothing from any other source", () => {
    const link = node("v", "youtube-video", { youtubeUrl: PAGE, downloadedAudioUrl: ` ${FILE} ` })
    expect(videoLinkTrackInto("t", [link], [{ source: "v", target: "t" }])).toBe(FILE)
    expect(videoLinkTrackInto("t", [link], [{ source: "v", target: "other" }])).toBeUndefined()
    expect(videoLinkTrackInto("t", [node("v", "youtube-video", { youtubeUrl: PAGE })], [{ source: "v", target: "t" }])).toBeUndefined()
    expect(videoLinkTrackInto("t", [node("a", "upload-audio", { downloadedAudioUrl: FILE })], [{ source: "a", target: "t" }])).toBeUndefined()
  })
})

describe("isSoundPageLink", () => {
  it("is a link to where a video is, and never a file or nothing", () => {
    expect(isSoundPageLink(PAGE)).toBe(true)
    expect(isSoundPageLink(FILE)).toBe(false)
    expect(isSoundPageLink("")).toBe(false)
  })
})
