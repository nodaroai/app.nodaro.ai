// The content rights box as the page holds it: ticked per node and link, in
// this session only; and the confirmations a run request carries for the links
// it will fetch the sound of — made when Run is pressed, for that run alone.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, act } from "@testing-library/react"

const { confirmLink, DeclarationChangedError } = vi.hoisted(() => ({
  confirmLink: vi.fn(),
  DeclarationChangedError: class DeclarationChangedError extends Error {},
}))
vi.mock("@/lib/content-rights", () => ({ confirmLink: (...a: unknown[]) => confirmLink(...a), DeclarationChangedError }))

import {
  clearVideoLinkRights,
  isVideoLinkRightsTicked,
  tickVideoLinkRights,
  untickVideoLinkRights,
  useVideoLinkRightsTicked,
  useVideoLinkRightsVersion,
  withVideoLinkRightsConfirmations,
} from "../video-link-rights"

const YT = "https://www.youtube.com/watch?v=aqz-KE-bpKQ"
const TIKTOK = "https://www.tiktok.com/@someone/video/7676964064458738952"
const FILE = "https://cdn.example.com/ep-12.mp4"

beforeEach(() => {
  vi.clearAllMocks()
  clearVideoLinkRights()
  confirmLink.mockImplementation(async (link: string) => ({ id: `conf-${link.slice(-4)}`, declarationVersion: 1, expiresAt: "2099-01-01T00:00:00.000Z" }))
})

describe("the box", () => {
  it("is ticked for one link on one node; another link, or a file link, is not ticked", () => {
    tickVideoLinkRights("v1", ` ${YT} `)
    expect(isVideoLinkRightsTicked("v1", YT)).toBe(true)
    expect(isVideoLinkRightsTicked("v1", TIKTOK)).toBe(false)
    expect(isVideoLinkRightsTicked("v2", YT)).toBe(false)
    tickVideoLinkRights("v1", FILE)
    expect(isVideoLinkRightsTicked("v1", FILE)).toBe(false)
    expect(isVideoLinkRightsTicked("v1", YT)).toBe(false)
  })

  it("unticks, and clears for everyone, telling the hook", () => {
    const { result } = renderHook(() => useVideoLinkRightsTicked("v1", YT))
    expect(result.current).toBe(false)
    act(() => tickVideoLinkRights("v1", YT))
    expect(result.current).toBe(true)
    act(() => untickVideoLinkRights("v1"))
    expect(result.current).toBe(false)
    act(() => tickVideoLinkRights("v1", YT))
    act(() => clearVideoLinkRights())
    expect(result.current).toBe(false)
  })
})

describe("withVideoLinkRightsConfirmations — what a run request carries", () => {
  const link = (id: string, data: Record<string, unknown>) => ({ id, type: "youtube-video", data })
  const reader = (id: string, type: string) => ({ id, type, data: {} })
  const edge = (source: string, target: string) => ({ source, target })

  it("confirms a ticked link whose sound the run fetches, for this run, as the node's rightsConfirmationId", async () => {
    tickVideoLinkRights("src", TIKTOK)
    const out = await withVideoLinkRightsConfirmations([link("src", { youtubeUrl: "" }), reader("tr", "transcribe")], [edge("src", "tr")], { src: { youtubeUrl: TIKTOK } })
    expect(confirmLink).toHaveBeenCalledWith(TIKTOK)
    expect(out).toEqual({ src: { youtubeUrl: TIKTOK, rightsConfirmationId: "conf-8952" } })
  })

  it("confirms a saved link too, when its track is not stored, and leaves other overrides alone", async () => {
    tickVideoLinkRights("src", YT)
    const out = await withVideoLinkRightsConfirmations([link("src", { youtubeUrl: YT }), reader("tr", "transcribe")], [edge("src", "tr")], { other: { text: "x" } })
    expect(out).toEqual({ other: { text: "x" }, src: { rightsConfirmationId: "conf-bpKQ" } })
  })

  it("nothing for an unticked link, a stored track, a link the page downloads, a page-address reader, or a file link", async () => {
    tickVideoLinkRights("watched", TIKTOK)
    tickVideoLinkRights("tracked", YT)
    tickVideoLinkRights("cited", TIKTOK)
    tickVideoLinkRights("direct", FILE)
    const nodes = [
      link("unticked", { youtubeUrl: TIKTOK }),
      link("tracked", { youtubeUrl: YT, downloadedAudioUrl: "https://cdn.nodaro.ai/audios/a.mp3" }),
      link("watched", { youtubeUrl: TIKTOK }),
      link("cited", { youtubeUrl: TIKTOK }),
      link("direct", { youtubeUrl: FILE }),
      reader("tr", "transcribe"),
      reader("va", "video-analysis"),
      reader("rec", "content-recipe"),
    ]
    const edges = [edge("unticked", "tr"), edge("tracked", "tr"), edge("watched", "va"), edge("cited", "rec"), edge("direct", "tr")]
    expect(await withVideoLinkRightsConfirmations(nodes, edges, undefined)).toBeUndefined()
    expect(confirmLink).not.toHaveBeenCalled()
  })

  it("a stored track for the SAVED link does not cover a link the request swapped in", async () => {
    tickVideoLinkRights("src", TIKTOK)
    const out = await withVideoLinkRightsConfirmations(
      [link("src", { youtubeUrl: YT, downloadedAudioUrl: "https://cdn.nodaro.ai/audios/a.mp3" }), reader("tr", "transcribe")],
      [edge("src", "tr")],
      { src: { youtubeUrl: TIKTOK } },
    )
    expect(out?.src).toMatchObject({ rightsConfirmationId: "conf-8952" })
  })

  it("a refused confirmation stops the run — the request is never sent without it; a changed declaration unticks the box as well", async () => {
    tickVideoLinkRights("src", TIKTOK)
    confirmLink.mockRejectedValueOnce(new Error("Authentication required"))
    await expect(withVideoLinkRightsConfirmations([link("src", { youtubeUrl: TIKTOK }), reader("tr", "transcribe")], [edge("src", "tr")], undefined)).rejects.toThrow("Authentication required")
    expect(isVideoLinkRightsTicked("src", TIKTOK)).toBe(true)

    confirmLink.mockRejectedValueOnce(new DeclarationChangedError("changed"))
    await expect(withVideoLinkRightsConfirmations([link("src", { youtubeUrl: TIKTOK }), reader("tr", "transcribe")], [edge("src", "tr")], undefined)).rejects.toThrow("changed")
    expect(isVideoLinkRightsTicked("src", TIKTOK)).toBe(false)
  })
})

describe("useVideoLinkRightsVersion — what a memo over the inputs depends on", () => {
  it("changes on every tick, untick and clear", () => {
    const { result } = renderHook(() => useVideoLinkRightsVersion())
    const start = result.current
    act(() => tickVideoLinkRights("v1", YT))
    expect(result.current).toBe(start + 1)
    act(() => tickVideoLinkRights("v1", YT))
    expect(result.current).toBe(start + 1)
    act(() => untickVideoLinkRights("v1"))
    expect(result.current).toBe(start + 2)
  })
})
