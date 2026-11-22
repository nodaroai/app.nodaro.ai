import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/api", () => ({ getAuthHeaders: async () => ({ Authorization: "Bearer t" }) }))

import { hasSideBySide, SIDE_BY_SIDE_POLL_MS, SideBySideButton } from "../side-by-side-button"

/**
 * The admin job page's side by side: offered on a finished Video Remake run
 * only; a press starts the render and asks again until the file is there,
 * then offers it; a refusal is said in the server's words.
 */
const ID = "61c80648-e2e6-487c-8b04-2a865f6a0e63"
const reply = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status }))

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("hasSideBySide", () => {
  it("is a finished Video Remake run (its queue name or its input's type), nothing else", () => {
    expect(hasSideBySide({ status: "completed", job_type: "cast-swap", input_data: null })).toBe(true)
    expect(hasSideBySide({ status: "completed", job_type: "cast-swap-full-quality", input_data: null })).toBe(true)
    expect(hasSideBySide({ status: "completed", job_type: null, input_data: { type: "cast-swap" } })).toBe(true)
    expect(hasSideBySide({ status: "processing", job_type: "cast-swap", input_data: null })).toBe(false)
    expect(hasSideBySide({ status: "completed", job_type: "generate-video", input_data: { type: "generate-video" } })).toBe(false)
  })
})

describe("SideBySideButton", () => {
  it("starts the render, asks again while it is made (a 429 too), then offers the file", async () => {
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(reply(202, { data: { status: "making" } }))
      .mockReturnValueOnce(reply(429, { error: { code: "rate_limit_exceeded", message: "Too many requests." } }))
      .mockReturnValueOnce(reply(200, { data: { status: "ready", url: "https://cdn.test/v.mp4", fileName: "nodaro-remake-side-by-side-61c80648.mp4" } }))
    vi.stubGlobal("fetch", fetchMock)
    render(<SideBySideButton jobId={ID} />)
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Side by side" }))
    })
    expect(screen.getByRole("button", { name: "Making side by side…" })).toHaveProperty("disabled", true)
    // Asked too often in between: it keeps asking, never a failure.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SIDE_BY_SIDE_POLL_MS)
    })
    expect(screen.getByRole("button", { name: "Making side by side…" })).toBeTruthy()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SIDE_BY_SIDE_POLL_MS)
    })
    const link = screen.getByRole("link", { name: "Download side by side" })
    expect(link.getAttribute("href")).toBe("https://cdn.test/v.mp4")
    expect(link.getAttribute("download")).toBe("nodaro-remake-side-by-side-61c80648.mp4")
    expect(fetchMock).toHaveBeenCalledTimes(3)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`/v1/video-remake/${ID}/side-by-side`)
    expect(init.method).toBe("POST")
  })

  it("says a refusal in the server's words", async () => {
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(reply(409, { error: { code: "side_by_side_unavailable", message: "This run's original clip is not available." } })))
    render(<SideBySideButton jobId={ID} />)
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Side by side" }))
    })
    expect(screen.getByText("This run's original clip is not available.")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Side by side" })).toHaveProperty("disabled", false)
  })
})
