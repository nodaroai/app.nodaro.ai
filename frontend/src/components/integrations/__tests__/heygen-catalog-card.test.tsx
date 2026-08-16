/**
 * Integrations → "HeyGen avatar catalog": the operator's manual refresh.
 *   - community: any signed-in user sees the card; pressing it POSTs the
 *     refresh and shows what each catalog did;
 *   - where the edition has admins: non-admins see nothing (the server would
 *     403 them), admins see the card;
 *   - a refused refresh (403 / network) surfaces as an error toast, no result line.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

const editionMock = vi.hoisted(() => ({ hasAdmin: false }))
const authMock = vi.hoisted(() => ({ isAdmin: false, roleLoaded: true }))
const apiMock = vi.hoisted(() => ({ refreshHeygenCatalog: vi.fn() }))
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))

vi.mock("@/lib/edition", () => ({ hasAdmin: () => editionMock.hasAdmin }))
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: "u1" }, isAdmin: authMock.isAdmin, roleLoaded: authMock.roleLoaded }) }))
vi.mock("@/lib/api", () => ({ refreshHeygenCatalog: (...args: unknown[]) => apiMock.refreshHeygenCatalog(...args) }))
vi.mock("sonner", () => ({ toast: toastMock }))

import { HeygenCatalogCard, describeRefresh } from "../heygen-catalog-card"

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <HeygenCatalogCard />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  editionMock.hasAdmin = false
  authMock.isAdmin = false
  authMock.roleLoaded = true
  apiMock.refreshHeygenCatalog.mockReset()
  toastMock.success.mockReset()
  toastMock.error.mockReset()
})

describe("describeRefresh", () => {
  it("says what each catalog did, in order", () => {
    expect(describeRefresh({ mode: "local", avatars: "started", privateAvatars: "already-running", voices: "locked-elsewhere" })).toBe(
      "Presets: refreshing in the background · Your own looks: a refresh is already running here · Voices: another server is refreshing it right now",
    )
    expect(describeRefresh({ mode: "local", avatars: "unconfigured", privateAvatars: "unconfigured", voices: "adopted" })).toContain("no HeyGen key")
    expect(describeRefresh({ mode: "connection", avatars: "relay-reset", privateAvatars: "relay-reset", voices: "relay-reset" })).toMatch(/nodaro\.ai/)
  })
})

describe("HeygenCatalogCard", () => {
  it("on community any signed-in user can refresh; the result line says what happened", async () => {
    apiMock.refreshHeygenCatalog.mockResolvedValue({ mode: "local", avatars: "started", privateAvatars: "started", voices: "started" })
    renderCard()
    fireEvent.click(screen.getByRole("button", { name: /Refresh now/i }))
    await waitFor(() => expect(screen.getByTestId("heygen-catalog-refresh-result")).toBeInTheDocument())
    expect(apiMock.refreshHeygenCatalog).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId("heygen-catalog-refresh-result").textContent).toContain("Presets: refreshing in the background")
    expect(toastMock.success).toHaveBeenCalled()
  })

  it("where the edition has admins, non-admins see nothing and admins see the card", () => {
    editionMock.hasAdmin = true
    const { unmount } = renderCard()
    expect(screen.queryByRole("button", { name: /Refresh now/i })).toBeNull()
    unmount()
    authMock.isAdmin = true
    renderCard()
    expect(screen.getByRole("button", { name: /Refresh now/i })).toBeInTheDocument()
  })

  it("a refused refresh shows an error toast and no result line", async () => {
    apiMock.refreshHeygenCatalog.mockRejectedValue(new Error("Only an admin can refresh the HeyGen catalog on this edition"))
    renderCard()
    fireEvent.click(screen.getByRole("button", { name: /Refresh now/i }))
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Only an admin can refresh the HeyGen catalog on this edition"))
    expect(screen.queryByTestId("heygen-catalog-refresh-result")).toBeNull()
  })
})
