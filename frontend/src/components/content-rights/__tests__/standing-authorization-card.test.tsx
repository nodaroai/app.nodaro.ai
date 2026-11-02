/**
 * Settings → the standing authorization card: says whether the account's keys
 * and agents are authorized, authorizes only after a fresh tick (under the
 * declaration version it read), revokes with one click, and unticks when the
 * declaration changed under it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import React from "react"
import { en } from "@/lib/i18n/en"

const api = vi.hoisted(() => ({
  declaration: vi.fn(),
  authorization: vi.fn(),
  authorize: vi.fn(),
  revokeAuthorization: vi.fn(),
}))
vi.mock("@/lib/nodaro-client", () => ({
  nodaroClient: {
    contentRights: {
      declaration: (...a: unknown[]) => api.declaration(...a),
      authorization: (...a: unknown[]) => api.authorization(...a),
      authorize: (...a: unknown[]) => api.authorize(...a),
      revokeAuthorization: (...a: unknown[]) => api.revokeAuthorization(...a),
    },
  },
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { toast } from "sonner"
import { __resetContentRightsForTests } from "@/lib/content-rights"
import { StandingAuthorizationCard } from "../standing-authorization-card"

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <StandingAuthorizationCard />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  __resetContentRightsForTests()
  api.declaration.mockResolvedValue({ version: 3, text: "I hold the rights." })
  api.authorization.mockResolvedValue(null)
  api.authorize.mockResolvedValue({ id: "a1", declarationVersion: 3, createdAt: "2026-11-02T07:00:00Z" })
  api.revokeAuthorization.mockResolvedValue({ revoked: true })
})

describe("StandingAuthorizationCard", () => {
  it("with no authorization: the box starts unticked and the button waits for the tick, then authorizes under the version read", async () => {
    renderCard()
    expect(await screen.findByText(en["contentRights.notAuthorized"])).toBeInTheDocument()
    const button = await screen.findByRole("button", { name: en["contentRights.authorize"] })
    expect(button).toBeDisabled()
    const box = await screen.findByRole("checkbox")
    expect(box).not.toBeChecked()
    fireEvent.click(box)
    expect(button).toBeEnabled()
    fireEvent.click(button)
    await waitFor(() => expect(api.authorize).toHaveBeenCalledWith({ declarationVersion: 3 }))
    expect(toast.success).toHaveBeenCalledWith(en["contentRights.authorized"])
  })

  it("with one: says since when, and the revoke button ends it", async () => {
    api.authorization.mockResolvedValue({ id: "a1", declarationVersion: 3, createdAt: "2026-11-02T07:00:00Z" })
    renderCard()
    const state = await screen.findByTestId("standing-authorization-state")
    expect(state.textContent).toContain("2026")
    expect(screen.queryByRole("checkbox")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: en["contentRights.revoke"] }))
    await waitFor(() => expect(api.revokeAuthorization).toHaveBeenCalledTimes(1))
    expect(toast.success).toHaveBeenCalledWith(en["contentRights.revoked"])
  })

  it("a declaration that changed under the tick unticks the box and says so; nothing is authorized", async () => {
    api.authorize.mockRejectedValueOnce(Object.assign(new Error("stale"), { code: "rights_confirmation_stale" }))
    renderCard()
    const box = await screen.findByRole("checkbox")
    fireEvent.click(box)
    fireEvent.click(screen.getByRole("button", { name: en["contentRights.authorize"] }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(en["contentRights.declarationChanged"]))
    expect(screen.getByRole("checkbox")).not.toBeChecked()
    // The new text is read again for the next tick.
    await waitFor(() => expect(api.declaration).toHaveBeenCalledTimes(2))
  })
})
