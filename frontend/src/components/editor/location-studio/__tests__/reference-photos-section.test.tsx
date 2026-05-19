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

  // Phase 2 #7: pass a `piiConsentAt` so the consent gate is dismissed for
  // tests that exercise the add/dedup flow — the gate is covered by its own
  // describe block below.
  const PRECONSENT = "2026-01-01T00:00:00.000Z"

  it("calls onChange with the new photo when Add is clicked", async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<ReferencePhotosSection photos={[]} onChange={onChange} piiConsentAt={PRECONSENT} />)
    await user.type(screen.getByPlaceholderText(/https:/), "https://example.com/new.png")
    await user.click(screen.getByRole("button", { name: /^add$/i }))
    expect(onChange).toHaveBeenCalledWith([{ kind: "moodBoard", url: "https://example.com/new.png" }])
  })

  it("dedups: adding a URL that already exists toasts and does NOT call onChange", async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    const photos: LocationReferencePhoto[] = [{ kind: "wide", url: "https://example.com/dup.png" }]
    render(<ReferencePhotosSection photos={photos} onChange={onChange} piiConsentAt={PRECONSENT} />)
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
    render(<ReferencePhotosSection photos={photos} onChange={onChange} piiConsentAt={PRECONSENT} />)
    await user.click(screen.getByRole("button", { name: /remove wide/i }))
    expect(onChange).toHaveBeenCalledWith([{ kind: "interior", url: "https://example.com/b.png" }])
  })
})

// Phase 2 #7 — PII consent gate. When `piiConsentAt` is undefined the section
// shows a consent checkbox and disables Add until the box is ticked. On the
// first add after consent, `onConsent` fires with a fresh timestamp so the
// parent can persist it; subsequent renders hide the checkbox.
describe("ReferencePhotosSection — PII consent gate", () => {
  beforeEach(() => {
    toastInfo.mockClear()
    toastError.mockClear()
  })

  it("renders consent checkbox when piiConsentAt is undefined", () => {
    render(<ReferencePhotosSection photos={[]} onChange={() => {}} />)
    expect(screen.getByLabelText(/rights and consent/i)).toBeInTheDocument()
  })

  it("hides consent checkbox when piiConsentAt is set", () => {
    render(
      <ReferencePhotosSection
        photos={[]}
        onChange={() => {}}
        piiConsentAt="2026-01-01T00:00:00.000Z"
      />,
    )
    expect(screen.queryByLabelText(/rights and consent/i)).toBeNull()
    expect(screen.getByText(/Consent recorded/i)).toBeInTheDocument()
  })

  it("disables Add until consent is ticked", () => {
    render(<ReferencePhotosSection photos={[]} onChange={() => {}} />)
    const input = screen.getByPlaceholderText(/https:/) as HTMLInputElement
    fireEvent.change(input, { target: { value: "https://example.com/new.png" } })
    const addBtn = screen.getByRole("button", { name: /^add$/i })
    expect(addBtn).toBeDisabled()
    fireEvent.click(screen.getByLabelText(/rights and consent/i))
    expect(addBtn).not.toBeDisabled()
  })

  it("fires onConsent with a fresh ISO timestamp on first add after consent", async () => {
    const onChange = vi.fn()
    const onConsent = vi.fn()
    const user = userEvent.setup()
    render(
      <ReferencePhotosSection
        photos={[]}
        onChange={onChange}
        onConsent={onConsent}
      />,
    )
    await user.click(screen.getByLabelText(/rights and consent/i))
    await user.type(screen.getByPlaceholderText(/https:/), "https://example.com/new.png")
    await user.click(screen.getByRole("button", { name: /^add$/i }))
    expect(onChange).toHaveBeenCalledOnce()
    expect(onConsent).toHaveBeenCalledOnce()
    const ts = onConsent.mock.calls[0]?.[0] as string
    expect(typeof ts).toBe("string")
    // ISO-8601 looks like 2026-05-19T19:30:00.000Z
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })

  it("does not fire onConsent when the gate is already dismissed", async () => {
    const onChange = vi.fn()
    const onConsent = vi.fn()
    const user = userEvent.setup()
    render(
      <ReferencePhotosSection
        photos={[]}
        onChange={onChange}
        onConsent={onConsent}
        piiConsentAt="2026-01-01T00:00:00.000Z"
      />,
    )
    await user.type(screen.getByPlaceholderText(/https:/), "https://example.com/new.png")
    await user.click(screen.getByRole("button", { name: /^add$/i }))
    expect(onChange).toHaveBeenCalledOnce()
    expect(onConsent).not.toHaveBeenCalled()
  })
})

// Phase 2 #11 — Search/filter inside Location Studio asset grids.
// Reference photos have no `name` field — we match against the kind enum
// (e.g. "wide"), the human label from `LOCATION_REFERENCE_PHOTO_KIND_LABELS`
// (e.g. "wide-angle reference"), and the trailing URL filename.
describe("ReferencePhotosSection — search/filter", () => {
  beforeEach(() => {
    toastInfo.mockClear()
    toastError.mockClear()
  })

  function elevenPhotos(): LocationReferencePhoto[] {
    return [
      { kind: "wide", url: "https://example.com/wide-shot.png" },
      { kind: "interior", url: "https://example.com/cafe-interior.png" },
      { kind: "exterior", url: "https://example.com/storefront.png" },
      { kind: "detail", url: "https://example.com/door-detail.png" },
      { kind: "moodBoard", url: "https://example.com/mood-1.png" },
      { kind: "other", url: "https://example.com/misc.png" },
      { kind: "wide", url: "https://example.com/wide-2.png" },
      { kind: "interior", url: "https://example.com/booth-photo.png" },
      { kind: "moodBoard", url: "https://example.com/mood-2.png" },
      { kind: "detail", url: "https://example.com/menu.png" },
      { kind: "moodBoard", url: "https://example.com/mood-3.png" },
    ]
  }

  it("hides the search input when photos.length <= 10", () => {
    const photos: LocationReferencePhoto[] = Array.from({ length: 5 }, (_, i) => ({
      kind: "wide" as const,
      url: `https://example.com/p${i}.png`,
    }))
    render(<ReferencePhotosSection photos={photos} onChange={() => {}} />)
    expect(
      screen.queryByPlaceholderText(/search reference photos/i),
    ).not.toBeInTheDocument()
  })

  it("shows the search input when photos.length > 10", () => {
    render(<ReferencePhotosSection photos={elevenPhotos()} onChange={() => {}} />)
    expect(
      screen.getByPlaceholderText(/search reference photos/i),
    ).toBeInTheDocument()
  })

  it("filters by kind enum (case-insensitive)", async () => {
    const user = userEvent.setup()
    render(<ReferencePhotosSection photos={elevenPhotos()} onChange={() => {}} />)
    const search = screen.getByPlaceholderText(/search reference photos/i)
    await user.type(search, "mood")
    // moodBoard kind: 3 entries should remain; non-mood kinds filtered out.
    const wideThumbs = screen.queryAllByAltText("wide")
    expect(wideThumbs.length).toBe(0)
    const moodThumbs = screen.queryAllByAltText("moodBoard")
    expect(moodThumbs.length).toBe(3)
  })

  it("filters by URL filename", async () => {
    const user = userEvent.setup()
    render(<ReferencePhotosSection photos={elevenPhotos()} onChange={() => {}} />)
    const search = screen.getByPlaceholderText(/search reference photos/i)
    await user.type(search, "booth")
    // Only the interior photo with "booth-photo.png" filename should match.
    const interior = screen.queryAllByAltText("interior")
    expect(interior.length).toBe(1)
    // No other thumbs should be visible.
    expect(screen.queryAllByAltText("wide").length).toBe(0)
    expect(screen.queryAllByAltText("moodBoard").length).toBe(0)
  })

  it("renders zero-results banner with Clear button when nothing matches", async () => {
    const user = userEvent.setup()
    render(<ReferencePhotosSection photos={elevenPhotos()} onChange={() => {}} />)
    const search = screen.getByPlaceholderText(/search reference photos/i)
    await user.type(search, "noresultsxyz")
    expect(screen.getByText(/no matches for "noresultsxyz"/i)).toBeInTheDocument()
    const clearButtons = screen.getAllByRole("button", { name: /^clear$/i })
    expect(clearButtons.length).toBeGreaterThanOrEqual(1)
  })
})
