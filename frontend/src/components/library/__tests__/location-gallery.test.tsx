import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import React from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"

// ---------------------------------------------------------------------------
// Hoisted mocks — must precede the SUT import.
// ---------------------------------------------------------------------------

const toastSuccess = vi.fn()
const toastError = vi.fn()
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}))

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { id: "user-1" } }),
}))

const mockGetLocations = vi.fn()
const mockListArchived = vi.fn()
const mockRestore = vi.fn()
const mockPermanentDelete = vi.fn()

vi.mock("@/lib/api", () => ({
  getLocations: (...args: unknown[]) => mockGetLocations(...args),
  listArchivedLocations: (...args: unknown[]) => mockListArchived(...args),
  restoreLocation: (...args: unknown[]) => mockRestore(...args),
  permanentDeleteLocation: (...args: unknown[]) => mockPermanentDelete(...args),
}))

// Lightweight thumbnail stub — `CachedImage` pulls in IndexedDB plumbing that
// isn't useful for these tests.
vi.mock("@/components/ui/cached-image", () => ({
  CachedImage: (props: { src?: string; alt?: string; className?: string }) =>
    React.createElement("img", {
      src: props.src,
      alt: props.alt,
      className: props.className,
      "data-testid": "cached-image",
    }),
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface FakeLocation {
  id: string
  name: string
  sourceImageUrl: string | null
}

function makeLocation(id: string, name: string, imageUrl: string | null = null): FakeLocation {
  return { id, name, sourceImageUrl: imageUrl }
}

function renderWithProviders(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>
    </MemoryRouter>,
  )
}

// SUT imported AFTER all mocks so `vi.mock` calls take effect.
import LocationGallery from "../location-gallery"

beforeEach(() => {
  vi.clearAllMocks()
  // Default: empty active + archived lists.
  mockGetLocations.mockResolvedValue({ locations: [] })
  mockListArchived.mockResolvedValue({ locations: [] })
})

describe("LocationGallery", () => {
  describe("tab toggle", () => {
    it("renders Active and Archived tabs and starts on Active", async () => {
      mockGetLocations.mockResolvedValue({
        locations: [makeLocation("a1", "Forest")],
      })
      mockListArchived.mockResolvedValue({
        locations: [makeLocation("z1", "OldCafe")],
      })

      renderWithProviders(<LocationGallery />)

      // Both tab buttons render.
      const activeTab = await screen.findByRole("button", { name: /^Active/ })
      const archivedTab = screen.getByRole("button", { name: /^Archived/ })
      expect(activeTab).toBeInTheDocument()
      expect(archivedTab).toBeInTheDocument()

      // Active row visible by default; archived row is NOT.
      await waitFor(() => expect(screen.getByText("Forest")).toBeInTheDocument())
      expect(screen.queryByText("OldCafe")).not.toBeInTheDocument()
    })

    it("clicking Archived tab swaps the visible list", async () => {
      mockGetLocations.mockResolvedValue({
        locations: [makeLocation("a1", "Forest")],
      })
      mockListArchived.mockResolvedValue({
        locations: [makeLocation("z1", "OldCafe")],
      })

      renderWithProviders(<LocationGallery />)
      await screen.findByText("Forest")

      const archivedTab = screen.getByRole("button", { name: /^Archived/ })
      await userEvent.click(archivedTab)

      // After switching, OldCafe shows + Forest hidden.
      await waitFor(() => expect(screen.getByText("OldCafe")).toBeInTheDocument())
      expect(screen.queryByText("Forest")).not.toBeInTheDocument()
    })
  })

  describe("restore", () => {
    it("Restore button fires restoreLocation SDK and refetches", async () => {
      mockGetLocations.mockResolvedValue({ locations: [] })
      mockListArchived.mockResolvedValue({
        locations: [makeLocation("z1", "OldCafe")],
      })
      mockRestore.mockResolvedValue({ id: "z1", name: "OldCafe" })

      renderWithProviders(<LocationGallery />)

      // Switch to archived tab.
      const archivedTab = await screen.findByRole("button", { name: /^Archived/ })
      await userEvent.click(archivedTab)

      await screen.findByText("OldCafe")
      // The Restore button's accessible name is just "Restore" (text content);
      // `title="Restore OldCafe"` doesn't contribute to the accessible name.
      const restoreBtn = screen.getByRole("button", { name: /^Restore$/ })
      await userEvent.click(restoreBtn)

      await waitFor(() => expect(mockRestore).toHaveBeenCalledWith("z1"))
      expect(toastSuccess).toHaveBeenCalled()
    })

    it("shows a different toast when the backend renames on restore", async () => {
      mockListArchived.mockResolvedValue({
        locations: [makeLocation("z1", "OldCafe")],
      })
      mockRestore.mockResolvedValue({ id: "z1", name: "OldCafe (restored)" })

      renderWithProviders(<LocationGallery />)
      await userEvent.click(await screen.findByRole("button", { name: /^Archived/ }))
      await screen.findByText("OldCafe")
      await userEvent.click(screen.getByRole("button", { name: /^Restore$/ }))

      await waitFor(() => expect(toastSuccess).toHaveBeenCalled())
      const msg = toastSuccess.mock.calls.at(-1)?.[0] as string | undefined
      expect(msg).toContain("(restored)")
    })
  })

  describe("permanent delete (two-step)", () => {
    it("first click opens the typed-name confirm modal", async () => {
      mockListArchived.mockResolvedValue({
        locations: [makeLocation("z1", "OldCafe")],
      })

      renderWithProviders(<LocationGallery />)
      await userEvent.click(await screen.findByRole("button", { name: /^Archived/ }))
      await screen.findByText("OldCafe")

      // Permanently-delete icon button per archived row.
      const deleteBtn = screen.getByRole("button", { name: /Permanently delete OldCafe/ })
      await userEvent.click(deleteBtn)

      // Modal heading + typed-name input present.
      expect(screen.getByText(/Permanently delete 'OldCafe'/)).toBeInTheDocument()
      expect(
        screen.getByLabelText(/Type location name to confirm/),
      ).toBeInTheDocument()

      // Did NOT call the API yet — first click only opens the modal.
      expect(mockPermanentDelete).not.toHaveBeenCalled()
    })

    it("Permanently-delete confirm button stays disabled until typed text matches exactly", async () => {
      mockListArchived.mockResolvedValue({
        locations: [makeLocation("z1", "OldCafe")],
      })

      renderWithProviders(<LocationGallery />)
      await userEvent.click(await screen.findByRole("button", { name: /^Archived/ }))
      await screen.findByText("OldCafe")
      await userEvent.click(
        screen.getByRole("button", { name: /Permanently delete OldCafe/ }),
      )

      const input = screen.getByLabelText(/Type location name to confirm/) as HTMLInputElement
      const confirmBtn = screen.getByRole("button", { name: /^Permanently delete$/ })

      // Initially disabled.
      expect(confirmBtn).toBeDisabled()

      // Partial match — still disabled.
      await userEvent.type(input, "OldCaf")
      expect(confirmBtn).toBeDisabled()

      // Wrong case — still disabled (must be exact).
      await userEvent.clear(input)
      await userEvent.type(input, "oldcafe")
      expect(confirmBtn).toBeDisabled()

      // Exact match — enabled.
      await userEvent.clear(input)
      await userEvent.type(input, "OldCafe")
      expect(confirmBtn).toBeEnabled()
    })

    it("after permanent-delete, location is removed from list + toast fires", async () => {
      // First fetch: row present. Second fetch (after invalidation): empty.
      mockListArchived
        .mockResolvedValueOnce({ locations: [makeLocation("z1", "OldCafe")] })
        .mockResolvedValueOnce({ locations: [] })
      mockPermanentDelete.mockResolvedValue({ success: true, permanent: true })

      renderWithProviders(<LocationGallery />)
      await userEvent.click(await screen.findByRole("button", { name: /^Archived/ }))
      await screen.findByText("OldCafe")
      await userEvent.click(
        screen.getByRole("button", { name: /Permanently delete OldCafe/ }),
      )

      const input = screen.getByLabelText(/Type location name to confirm/) as HTMLInputElement
      await userEvent.type(input, "OldCafe")
      await userEvent.click(screen.getByRole("button", { name: /^Permanently delete$/ }))

      // SDK called with the row id.
      await waitFor(() => expect(mockPermanentDelete).toHaveBeenCalledWith("z1"))
      // Toast success.
      await waitFor(() => expect(toastSuccess).toHaveBeenCalled())
      // List re-fetched and the row is gone.
      await waitFor(() => expect(screen.queryByText("OldCafe")).not.toBeInTheDocument())
    })

    it("Cancel button closes the modal without calling the API", async () => {
      mockListArchived.mockResolvedValue({
        locations: [makeLocation("z1", "OldCafe")],
      })

      renderWithProviders(<LocationGallery />)
      await userEvent.click(await screen.findByRole("button", { name: /^Archived/ }))
      await screen.findByText("OldCafe")
      await userEvent.click(
        screen.getByRole("button", { name: /Permanently delete OldCafe/ }),
      )

      // Type something then cancel.
      const input = screen.getByLabelText(/Type location name to confirm/) as HTMLInputElement
      await userEvent.type(input, "OldCafe")
      await userEvent.click(screen.getByRole("button", { name: /^Cancel$/ }))

      // Modal gone; API not called.
      expect(screen.queryByText(/Permanently delete 'OldCafe'/)).not.toBeInTheDocument()
      expect(mockPermanentDelete).not.toHaveBeenCalled()
    })
  })
})
