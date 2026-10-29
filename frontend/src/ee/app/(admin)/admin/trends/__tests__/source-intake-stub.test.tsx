/**
 * Admin → Trends → the source clip on a build WITHOUT the shared media editor
 * (community, business, public CI, and tests by default: `virtual:media-editor`
 * is its stub). The editor is the one it always was: Upload and a library
 * video's address, the clip stored as it comes — no link, no range, no shape.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }))

import { fetchMock, renderWith, resetRoutes, routes, sentTo, TREND_ID } from "./harness"
import { SourceClipEditor } from "../components/SourceClipEditor"
import { mediaEditorParts } from "../components/source-intake/parts"

const BASE = `/v1/admin/trends/${TREND_ID}`

beforeEach(() => {
  resetRoutes()
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe("the source clip without the shared media editor", () => {
  it("has no editor parts", () => {
    expect(mediaEditorParts()).toBeNull()
  })

  it("is today's editor: a pasted address is stored at once, and there is no link field, range or shape", async () => {
    routes[`POST ${BASE}/media`] = () => ({ body: { data: { url: "https://cdn.test/trends/a1/new.mp4", durationSec: 10 } } })
    const onChange = vi.fn()
    const user = userEvent.setup()
    renderWith(<SourceClipEditor trendId={TREND_ID} source={null} previewStart={null} onChange={onChange} />)

    expect(screen.getByText("No source clip yet. Upload one (4–30 s) or paste a library video's URL.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Upload clip" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /get video/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/YouTube/)).not.toBeInTheDocument()

    await user.type(screen.getByLabelText("Upload clip: URL"), "https://u.example/clip.mp4{Enter}")
    await waitFor(() => expect(sentTo(`POST ${BASE}/media`)).toEqual([{ url: "https://u.example/clip.mp4", kind: "source" }]))
    expect(screen.queryByRole("group", { name: "New source clip" })).not.toBeInTheDocument()
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ source: expect.objectContaining({ videoUrl: "https://cdn.test/trends/a1/new.mp4", durationSec: 10 }), previewStart: null }))
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([`${BASE}/media`])
  })
})
