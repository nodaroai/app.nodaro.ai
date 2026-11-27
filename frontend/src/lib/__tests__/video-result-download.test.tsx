import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import {
  downloadVideoFile,
  downloadedVideoExtension,
  fetchVideoDownload,
  isStoredVideoAddress,
  openVideoDownload,
  unproxiedUrl,
  videoDownloadHref,
  videoDownloadLinkProps,
} from "../video-result-download"
import { VideoResultOverlay } from "@/components/nodes/video-result-overlay"
import { ActionBar } from "@/components/presentation/output-cards/action-bar"

/**
 * The Download of a video result (decided 2026-11-22): every surface asks the
 * app's download route for the kept original beside the preview it plays
 * (`/v1/download?original=1`), and keeps its own transport — a save in place
 * for the canvas, a new tab for the surfaces that opened the file there.
 */

vi.mock("@/components/editor/save-to-library-button", () => ({ SaveToLibraryButton: () => null }))
vi.mock("@/components/nodes/edit-video-button", () => ({ EditVideoButton: () => null }))

const JOB = "11111111-2222-4333-8444-555555555555"
const PREVIEW = `https://cdn.test/videos/${JOB}.mp4`
const ORIGINAL = `https://cdn.test/videos/${JOB}-master.mov`
const ENCODED = encodeURIComponent(PREVIEW)

/** The window's `/config.js` object, as the app reads it. */
const runtimeConfig = () => window as unknown as { __NODARO_RUNTIME__?: unknown }

/** Every link the page clicked: its address, its `download` and its target. */
let clicked: Array<{ href: string; download: string | null; target: string }>

beforeEach(() => {
  // The deployment's own storage, as /config.js names it (the server's list).
  runtimeConfig().__NODARO_RUNTIME__ = { storageOrigins: ["https://cdn.test"] }
  clicked = []
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push({ href: this.getAttribute("href") ?? "", download: this.hasAttribute("download") ? this.getAttribute("download") : null, target: this.target })
  })
})

afterEach(() => {
  delete runtimeConfig().__NODARO_RUNTIME__
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("which addresses can have an original", () => {
  it("an https address of a stored video: a preview or a kept original, through the proxy too", () => {
    expect(isStoredVideoAddress(PREVIEW)).toBe(true)
    expect(isStoredVideoAddress(ORIGINAL)).toBe(true)
    expect(isStoredVideoAddress(`https://cdn.test/videos/${JOB}-master.mkv`)).toBe(true)
    expect(isStoredVideoAddress(`/v1/image-proxy?url=${ENCODED}`)).toBe(true)
  })

  it("nothing else: an image, an upload, plain http storage, a relative or broken address", () => {
    expect(isStoredVideoAddress(`https://cdn.test/images/${JOB}.png`)).toBe(false)
    expect(isStoredVideoAddress("https://cdn.test/uploads/u1/clip.mp4")).toBe(false)
    expect(isStoredVideoAddress(`http://localhost:3000/storage/nodaro-assets/videos/${JOB}.mp4`)).toBe(false)
    expect(isStoredVideoAddress(`/videos/${JOB}.mp4`)).toBe(false)
    expect(isStoredVideoAddress("not a url")).toBe(false)
    expect(isStoredVideoAddress(undefined)).toBe(false)
  })

  it("only on the deployment's own storage: a video on any other host, a look-alike host or another port is not", () => {
    expect(isStoredVideoAddress(`https://other.test/videos/${JOB}.mp4`)).toBe(false)
    expect(isStoredVideoAddress(`https://cdn.test.evil.test/videos/${JOB}.mp4`)).toBe(false)
    expect(isStoredVideoAddress(`https://cdn.test:8443/videos/${JOB}.mp4`)).toBe(false)
    // The fallback host is accepted by the server but never published: its addresses keep their old download.
    expect(isStoredVideoAddress(`https://pub-123.r2.dev/videos/${JOB}.mp4`)).toBe(false)
  })

  it("only a path headed by a job id, the one the server can look up", () => {
    expect(isStoredVideoAddress("https://cdn.test/videos/clip.mp4")).toBe(false)
    expect(isStoredVideoAddress("https://cdn.test/videos/not-a-job-master.mov")).toBe(false)
    expect(isStoredVideoAddress(`https://cdn.test/videos/${JOB}-merged.mp4`)).toBe(true)
  })

  it("a deployment whose /config.js names no storage (a dev server, plain http storage) sends nothing to the route", () => {
    delete runtimeConfig().__NODARO_RUNTIME__
    expect(isStoredVideoAddress(PREVIEW)).toBe(false)
    runtimeConfig().__NODARO_RUNTIME__ = { storageOrigins: ["http://cdn.test", "nonsense"] }
    expect(isStoredVideoAddress(PREVIEW)).toBe(false)
  })

  it("reads the stored file a proxied player address names", () => {
    expect(unproxiedUrl(`/v1/image-proxy?url=${ENCODED}`)).toBe(PREVIEW)
  })
})

describe("the download link", () => {
  it("asks the app's download route for the original, for the stored file a player reads", () => {
    expect(videoDownloadHref(PREVIEW)).toBe(`/v1/download?url=${ENCODED}&original=1`)
    expect(videoDownloadHref(`/v1/image-proxy?url=${ENCODED}`)).toBe(`/v1/download?url=${ENCODED}&original=1`)
    expect(videoDownloadHref(PREVIEW, { open: true })).toBe(`/v1/download?url=${ENCODED}&original=1&open=1`)
  })

  it("the canvas saves in place, leaving the file's name to the server (a .mov original is never saved as .mp4)", () => {
    downloadVideoFile(PREVIEW)
    expect(clicked).toEqual([{ href: `/v1/download?url=${ENCODED}&original=1`, download: "", target: "" }])
  })

  it("the canvas keeps its proxy link for a video the route cannot serve", () => {
    const elsewhere = `https://elsewhere.test/videos/${JOB}.mp4`
    downloadVideoFile(elsewhere)
    expect(clicked).toEqual([{ href: `/v1/image-proxy?url=${encodeURIComponent(elsewhere)}&download=1`, download: "", target: "" }])
  })

  it("a surface that opened the file in a new tab opens the route there, which redirects when there is no original", () => {
    const asBefore = vi.fn()
    openVideoDownload(PREVIEW, asBefore)
    expect(clicked).toEqual([{ href: `/v1/download?url=${ENCODED}&original=1&open=1`, download: null, target: "_blank" }])
    expect(asBefore).not.toHaveBeenCalled()
  })

  it("an address the route cannot serve keeps the surface's own download, unchanged", () => {
    const asBefore = vi.fn()
    openVideoDownload("https://elsewhere.test/clip.mp4", asBefore)
    openVideoDownload(`https://elsewhere.test/videos/${JOB}.mp4`, asBefore)
    openVideoDownload(`http://localhost:3000/storage/nodaro-assets/videos/${JOB}.mp4`, asBefore)
    expect(asBefore).toHaveBeenCalledTimes(3)
    expect(clicked).toEqual([])
  })
})

describe("a Download link written in markup (chat view, split parts)", () => {
  it("a stored video opens the route in a new tab, like openVideoDownload", () => {
    expect(videoDownloadLinkProps(PREVIEW)).toEqual({ href: `/v1/download?url=${ENCODED}&original=1&open=1`, target: "_blank", rel: "noopener noreferrer" })
  })

  it("any other address stays the plain download link it was", () => {
    expect(videoDownloadLinkProps("https://elsewhere.test/clip.mp4")).toEqual({ href: "https://elsewhere.test/clip.mp4", download: "" })
  })
})

describe("a fetched Download (a list's Download all)", () => {
  it("gives the original's bytes and its own extension", async () => {
    const fetchMock = vi.fn(async () => new Response("original", { status: 200, headers: { "content-type": "video/quicktime", "content-disposition": `attachment; filename="${JOB}-master.mov"` } }))
    vi.stubGlobal("fetch", fetchMock)
    const got = await fetchVideoDownload(PREVIEW)
    expect(got?.ext).toBe("mov")
    expect(got?.blob.size).toBe("original".length)
    expect(fetchMock).toHaveBeenCalledWith(`/v1/download?url=${ENCODED}&original=1&open=1`, { redirect: "manual" })
  })

  it("gives nothing when the route redirects (no original), so the surface fetches the file as before", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ type: "opaqueredirect", ok: false, status: 0 }) as unknown as Response))
    expect(await fetchVideoDownload(PREVIEW)).toBeUndefined()
  })

  it("never asks for an address that cannot have an original, and survives a failed request", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("offline")
    })
    vi.stubGlobal("fetch", fetchMock)
    expect(await fetchVideoDownload("https://elsewhere.test/clip.mp4")).toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(await fetchVideoDownload(PREVIEW)).toBeUndefined()
  })

  it("names the extension by the content type, else the file name, of every container an original is kept as", () => {
    expect(downloadedVideoExtension(new Headers({ "content-type": "video/x-matroska" }))).toBe("mkv")
    expect(downloadedVideoExtension(new Headers({ "content-type": "video/webm; codecs=vp9" }))).toBe("webm")
    expect(downloadedVideoExtension(new Headers({ "content-type": "application/octet-stream", "content-disposition": 'attachment; filename="a-master.mov"' }))).toBe("mov")
    expect(downloadedVideoExtension(new Headers({}))).toBeUndefined()
  })
})

describe("each surface type", () => {
  it("a canvas node's result overlay saves through the route in place", () => {
    render(<VideoResultOverlay url={PREVIEW} videoAutoplay={false} label="Clip" hasResults onExpand={() => {}} onDelete={() => {}} />)
    fireEvent.click(screen.getAllByRole("button", { name: /download/i })[0]!)
    expect(clicked).toEqual([{ href: `/v1/download?url=${ENCODED}&original=1`, download: "", target: "" }])
  })

  it("an app result card's video opens the route in a new tab; its image keeps the direct link", () => {
    const { unmount } = render(<ActionBar mediaType="video" url={PREVIEW} label="Result" />)
    fireEvent.click(screen.getByRole("button", { name: /download/i }))
    expect(clicked).toEqual([{ href: `/v1/download?url=${ENCODED}&original=1&open=1`, download: null, target: "_blank" }])
    unmount()
    clicked = []
    const image = `https://cdn.test/images/${JOB}.png`
    render(<ActionBar mediaType="image" url={image} label="Result" />)
    fireEvent.click(screen.getByRole("button", { name: /download/i }))
    expect(clicked).toEqual([{ href: image, download: "result.png", target: "_blank" }])
  })
})
