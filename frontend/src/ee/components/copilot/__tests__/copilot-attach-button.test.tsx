/**
 * Attaching a file from the machine.
 *
 * The happy path is the least interesting part. What matters is that every way
 * this can fail produces something the user can act on, because the alternative
 * — a chip that looks attached and does nothing — is the exact silence the
 * whole file feature was built to end.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"

const upload = vi.fn()
vi.mock("@/hooks/use-file-upload", () => ({
  useFileUpload: () => ({ upload, isUploading: false }),
}))

import { CopilotAttachButton } from "../copilot-attach-button"
import type { CopilotMention } from "@/ee/lib/copilot/types"

/** A complete upload result, so each test only varies the field it is about. */
function uploaded(overrides: Record<string, unknown> = {}) {
  return {
    url: "https://r2.example/cat.png",
    thumbnailUrl: "https://r2.example/cat-thumb.png",
    assetId: "11111111-1111-4111-8111-111111111111",
    category: "image",
    filename: "cat.png",
    mimeType: "image/png",
    sizeBytes: 10,
    metadata: null,
    r2Key: "k",
    ...overrides,
  }
}

function pick(onAttached: (m: CopilotMention) => void) {
  const { container } = render(<CopilotAttachButton onAttached={onAttached} />)
  const input = container.querySelector('input[type="file"]') as HTMLInputElement
  const file = new File(["x"], "cat.png", { type: "image/png" })
  fireEvent.change(input, { target: { files: [file] } })
  return input
}

beforeEach(() => {
  upload.mockReset()
})

describe("CopilotAttachButton", () => {
  it("turns an upload into a mention the model can use", async () => {
    upload.mockResolvedValue(uploaded())
    const onAttached = vi.fn()

    pick(onAttached)

    await waitFor(() => expect(onAttached).toHaveBeenCalled())
    expect(onAttached.mock.calls[0]![0]).toEqual({
      id: "11111111-1111-4111-8111-111111111111",
      name: "cat.png",
      kind: "image",
      imageUrl: "https://r2.example/cat-thumb.png",
    })
  })

  it("attaches nothing when the upload produced no id", async () => {
    // The model can only use a file it can NAME to the server. A URL is the one
    // thing `edit_workflow` refuses, so an upload with no asset row is an
    // attachment that cannot be used — and a chip that silently does nothing
    // would be worse than saying so.
    upload.mockResolvedValue(uploaded({ assetId: null }))
    const onAttached = vi.fn()

    pick(onAttached)

    await waitFor(() => expect(screen.getByRole("button").title).toMatch(/library/i))
    expect(onAttached).not.toHaveBeenCalled()
  })

  it("attaches nothing when the upload failed", async () => {
    upload.mockRejectedValue(new Error("quota"))
    const onAttached = vi.fn()

    pick(onAttached)

    await waitFor(() => expect(screen.getByRole("button").title).toMatch(/could not be uploaded/i))
    expect(onAttached).not.toHaveBeenCalled()
  })

  it("attaches nothing for a kind no node can take", async () => {
    upload.mockResolvedValue(uploaded({ category: "document", filename: "notes.pdf" }))
    const onAttached = vi.fn()

    pick(onAttached)

    await waitFor(() => expect(screen.getByRole("button").title).toMatch(/images, videos and audio/i))
    expect(onAttached).not.toHaveBeenCalled()
  })

  it("handles a second pick without getting stuck on the first", async () => {
    // The component clears the input's value after each pick, because a real
    // file input fires no `change` for an unchanged value — pick a file, undo,
    // pick the same one, and nothing happens without it.
    //
    // jsdom cannot show that: a file input's value is not settable there, so it
    // reads as "" whether or not the clear ran, and no assertion here can tell
    // the two apart. What this DOES pin is that a second pick is handled at all
    // — the part that would break if the handler latched after one file.
    upload.mockResolvedValue(uploaded())
    const onAttached = vi.fn()
    const input = pick(onAttached)

    await waitFor(() => expect(onAttached).toHaveBeenCalledTimes(1))

    fireEvent.change(input, { target: { files: [new File(["x"], "dog.png", { type: "image/png" })] } })
    await waitFor(() => expect(onAttached).toHaveBeenCalledTimes(2))
  })
})
