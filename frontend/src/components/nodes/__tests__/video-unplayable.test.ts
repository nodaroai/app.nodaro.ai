import { describe, expect, it, vi } from "vitest"
import { act, renderHook } from "@testing-library/react"
import { isPreviewUnavailableUrl, showsUnplayableNotice, unproxiedUrl, videoDownloadExtension } from "../video-unplayable"
import { useVideoUnplayable } from "../video-unplayable-notice"

const ORIGINAL = "https://cdn.test/videos/11111111-2222-4333-8444-555555555555-master.mov"
const PREVIEW = "https://cdn.test/videos/11111111-2222-4333-8444-555555555555.mp4"
const PROXIED = `/v1/image-proxy?url=${encodeURIComponent(ORIGINAL)}`

/** A media error event from a `<video>` playing `src`. */
function errorEvent(src: string, code: number | null): React.SyntheticEvent<HTMLVideoElement> {
  const el = document.createElement("video")
  el.setAttribute("src", src)
  Object.defineProperty(el, "error", { value: code === null ? null : { code } })
  return { currentTarget: el } as unknown as React.SyntheticEvent<HTMLVideoElement>
}

describe("the preview-unavailable flag on a result url", () => {
  it("is the kept original standing in for its preview, and nothing else", () => {
    expect(isPreviewUnavailableUrl(ORIGINAL)).toBe(true)
    expect(isPreviewUnavailableUrl(PREVIEW)).toBe(false)
    expect(isPreviewUnavailableUrl(undefined)).toBe(false)
  })

  it("a download is named by the real file's extension, through the proxy or a relative url too", () => {
    expect(videoDownloadExtension(PROXIED)).toBe("mov")
    expect(videoDownloadExtension("/videos/11111111-2222-4333-8444-555555555555-master.webm")).toBe("webm")
    expect(videoDownloadExtension(PREVIEW)).toBe("mp4")
  })

  it("is seen through the app's proxy", () => {
    expect(unproxiedUrl(PROXIED)).toBe(ORIGINAL)
    expect(isPreviewUnavailableUrl(PROXIED)).toBe(true)
    expect(isPreviewUnavailableUrl(`/v1/image-proxy?url=${encodeURIComponent(PREVIEW)}`)).toBe(false)
  })

  it("shows the notice only for a flagged url the browser could not decode or does not support (MediaError 3, 4)", () => {
    expect(showsUnplayableNotice({ code: 4 }, ORIGINAL)).toBe(true)
    expect(showsUnplayableNotice({ code: 3 }, ORIGINAL)).toBe(true)
    // An aborted load (1) or a network failure (2) is the node's own failed-to-load state.
    expect(showsUnplayableNotice({ code: 1 }, ORIGINAL)).toBe(false)
    expect(showsUnplayableNotice({ code: 2 }, ORIGINAL)).toBe(false)
    expect(showsUnplayableNotice({ code: 3 }, PREVIEW)).toBe(false)
    expect(showsUnplayableNotice(null, ORIGINAL)).toBe(false)
  })
})

describe("useVideoUnplayable", () => {
  it("flag + error → notice, and the node's own error handling is not called", () => {
    const other = vi.fn()
    const { result } = renderHook(() => useVideoUnplayable(ORIGINAL, other))
    act(() => result.current.onError(errorEvent(ORIGINAL, 4)))
    expect(result.current.unplayable).toBe(true)
    expect(other).not.toHaveBeenCalled()
  })

  it("no flag + error → no notice; the node's own error handling runs as before", () => {
    const other = vi.fn()
    const { result } = renderHook(() => useVideoUnplayable(PREVIEW, other))
    act(() => result.current.onError(errorEvent(PREVIEW, 3)))
    expect(result.current.unplayable).toBe(false)
    expect(other).toHaveBeenCalledTimes(1)
  })

  it("flag + a network error → no notice; the node's own handling runs", () => {
    const other = vi.fn()
    const { result } = renderHook(() => useVideoUnplayable(ORIGINAL, other))
    act(() => result.current.onError(errorEvent(ORIGINAL, 2)))
    expect(result.current.unplayable).toBe(false)
    expect(other).toHaveBeenCalledTimes(1)
  })

  it("a player reading the original through the proxy gets the notice too", () => {
    const { result } = renderHook(() => useVideoUnplayable(PROXIED))
    act(() => result.current.onError(errorEvent(PROXIED, 4)))
    expect(result.current.unplayable).toBe(true)
  })

  it("flag + plays fine → no notice", () => {
    const { result } = renderHook(() => useVideoUnplayable(ORIGINAL))
    expect(result.current.unplayable).toBe(false)
  })

  it("an error from a url already replaced → no stale notice on the new one (the node's own handling gets it, as before)", () => {
    const other = vi.fn()
    const { result, rerender } = renderHook(({ url }) => useVideoUnplayable(url, other), { initialProps: { url: ORIGINAL } })
    rerender({ url: PREVIEW })
    act(() => result.current.onError(errorEvent(ORIGINAL, 4)))
    expect(result.current.unplayable).toBe(false)
    expect(other).toHaveBeenCalledTimes(1)
    // A notice that was showing goes when the url changes.
    rerender({ url: ORIGINAL })
    act(() => result.current.onError(errorEvent(ORIGINAL, 4)))
    expect(result.current.unplayable).toBe(true)
    rerender({ url: PREVIEW })
    expect(result.current.unplayable).toBe(false)
  })
})
