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
import type { ObjectReferencePhoto } from "@/types/nodes"

describe("Object ReferencePhotosSection", () => {
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
    const photos: ObjectReferencePhoto[] = [
      { kind: "front", url: "https://example.com/front.png" },
      { kind: "detail", url: "https://example.com/detail.png" },
    ]
    render(<ReferencePhotosSection photos={photos} onChange={() => {}} />)
    expect(screen.getByAltText("front")).toBeInTheDocument()
    expect(screen.getByAltText("detail")).toBeInTheDocument()
  })

  it("calls onChange with the new photo when Add is clicked", async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<ReferencePhotosSection photos={[]} onChange={onChange} />)
    await user.type(screen.getByPlaceholderText(/https:/), "https://example.com/new.png")
    await user.click(screen.getByRole("button", { name: /^add$/i }))
    expect(onChange).toHaveBeenCalledWith([
      { kind: "moodBoard", url: "https://example.com/new.png" },
    ])
  })

  it("dedups: adding a URL that already exists toasts and does NOT call onChange", async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    const photos: ObjectReferencePhoto[] = [
      { kind: "front", url: "https://example.com/dup.png" },
    ]
    render(<ReferencePhotosSection photos={photos} onChange={onChange} />)
    await user.type(screen.getByPlaceholderText(/https:/), "https://example.com/dup.png")
    await user.click(screen.getByRole("button", { name: /^add$/i }))
    expect(toastInfo).toHaveBeenCalledWith("Photo already added")
    expect(onChange).not.toHaveBeenCalled()
  })

  it("enforces max 20 photos: 21st add is rejected with a toast", () => {
    const onChange = vi.fn()
    const photos: ObjectReferencePhoto[] = Array.from({ length: 20 }, (_, i) => ({
      kind: "front" as const,
      url: `https://example.com/p${i}.png`,
    }))
    render(<ReferencePhotosSection photos={photos} onChange={onChange} />)
    const input = screen.getByPlaceholderText(/https:/)
    fireEvent.change(input, { target: { value: "https://example.com/new.png" } })
    expect(screen.getByRole("button", { name: /^add$/i })).toBeDisabled()
    fireEvent.keyDown(input, { key: "Enter" })
    expect(toastError).toHaveBeenCalledWith("Max 20 reference photos")
    expect(onChange).not.toHaveBeenCalled()
  })

  it("removes a photo when its remove button is clicked", async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    const photos: ObjectReferencePhoto[] = [
      { kind: "front", url: "https://example.com/a.png" },
      { kind: "detail", url: "https://example.com/b.png" },
    ]
    render(<ReferencePhotosSection photos={photos} onChange={onChange} />)
    await user.click(screen.getByRole("button", { name: /remove front/i }))
    expect(onChange).toHaveBeenCalledWith([
      { kind: "detail", url: "https://example.com/b.png" },
    ])
  })

  // Object-specific deltas
  it("renders 6 object-specific kind options in the dropdown (NOT location's set)", () => {
    render(<ReferencePhotosSection photos={[]} onChange={() => {}} />)
    const select = screen.getByLabelText(/reference kind/i) as HTMLSelectElement
    const optionValues = Array.from(select.options).map((o) => o.value)
    expect(optionValues).toEqual([
      "front",
      "side",
      "detail",
      "context",
      "moodBoard",
      "other",
    ])
  })

  it("does NOT render location's kind options (wide / interior / exterior)", () => {
    render(<ReferencePhotosSection photos={[]} onChange={() => {}} />)
    const select = screen.getByLabelText(/reference kind/i) as HTMLSelectElement
    const optionValues = Array.from(select.options).map((o) => o.value)
    expect(optionValues).not.toContain("wide")
    expect(optionValues).not.toContain("interior")
    expect(optionValues).not.toContain("exterior")
  })

  it("does NOT render any PII consent UI (object-specific delta)", () => {
    render(<ReferencePhotosSection photos={[]} onChange={() => {}} />)
    expect(screen.queryByLabelText(/rights and consent/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/consent recorded/i)).not.toBeInTheDocument()
  })
})
