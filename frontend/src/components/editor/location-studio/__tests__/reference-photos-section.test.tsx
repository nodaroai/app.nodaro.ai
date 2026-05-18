import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

// sonner toast — we assert on it.
const toastInfo = vi.fn()
const toastError = vi.fn()
vi.mock("sonner", () => ({
  toast: {
    info: (...args: unknown[]) => toastInfo(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}))

import { ReferencePhotosSection } from "../reference-photos-section"
import type { LocationReferencePhoto } from "@/types/nodes"

describe("ReferencePhotosSection", () => {
  beforeEach(() => {
    toastInfo.mockClear()
    toastError.mockClear()
  })

  it("renders the empty state with the add controls", () => {
    render(<ReferencePhotosSection photos={[]} onChange={() => {}} />)
    expect(screen.getByPlaceholderText(/https:/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /^add$/i })).toBeDisabled()
  })

  it("renders thumbnails for existing photos with their kind label", () => {
    const photos: LocationReferencePhoto[] = [
      { kind: "wide", url: "https://example.com/wide.png" },
      { kind: "interior", url: "https://example.com/interior.png" },
    ]
    render(<ReferencePhotosSection photos={photos} onChange={() => {}} />)
    expect(screen.getByAltText("wide")).toBeInTheDocument()
    expect(screen.getByAltText("interior")).toBeInTheDocument()
    // Kind label is rendered as overlay text; getAllByText since "wide" also
    // appears as a <option> in the kind selector.
    expect(screen.getAllByText("wide").length).toBeGreaterThanOrEqual(2)
  })

  it("calls onChange with the new photo when Add is clicked", async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<ReferencePhotosSection photos={[]} onChange={onChange} />)
    await user.type(screen.getByPlaceholderText(/https:/), "https://example.com/new.png")
    await user.click(screen.getByRole("button", { name: /^add$/i }))
    expect(onChange).toHaveBeenCalledWith([{ kind: "moodBoard", url: "https://example.com/new.png" }])
  })

  it("dedups: adding a URL that already exists toasts and does NOT call onChange", async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    const photos: LocationReferencePhoto[] = [{ kind: "wide", url: "https://example.com/dup.png" }]
    render(<ReferencePhotosSection photos={photos} onChange={onChange} />)
    await user.type(screen.getByPlaceholderText(/https:/), "https://example.com/dup.png")
    await user.click(screen.getByRole("button", { name: /^add$/i }))
    expect(toastInfo).toHaveBeenCalledWith("Photo already added")
    expect(onChange).not.toHaveBeenCalled()
  })

  it("enforces max 20 photos: 21st add is rejected with a toast", async () => {
    const onChange = vi.fn()
    const photos: LocationReferencePhoto[] = Array.from({ length: 20 }, (_, i) => ({
      kind: "wide" as const,
      url: `https://example.com/p${i}.png`,
    }))
    render(<ReferencePhotosSection photos={photos} onChange={onChange} />)
    const input = screen.getByPlaceholderText(/https:/)
    fireEvent.change(input, { target: { value: "https://example.com/new.png" } })
    // The Add button gates with disabled when photos.length >= MAX, so click on it
    // becomes a no-op; the disabled state is what enforces the cap from the user's POV.
    expect(screen.getByRole("button", { name: /^add$/i })).toBeDisabled()
    // Programmatically clicking still triggers the toast guard for keyboard/enter paths.
    fireEvent.keyDown(input, { key: "Enter" })
    expect(toastError).toHaveBeenCalledWith("Max 20 reference photos")
    expect(onChange).not.toHaveBeenCalled()
  })

  it("removes a photo when its remove button is clicked", async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    const photos: LocationReferencePhoto[] = [
      { kind: "wide", url: "https://example.com/a.png" },
      { kind: "interior", url: "https://example.com/b.png" },
    ]
    render(<ReferencePhotosSection photos={photos} onChange={onChange} />)
    await user.click(screen.getByRole("button", { name: /remove wide/i }))
    expect(onChange).toHaveBeenCalledWith([{ kind: "interior", url: "https://example.com/b.png" }])
  })
})
