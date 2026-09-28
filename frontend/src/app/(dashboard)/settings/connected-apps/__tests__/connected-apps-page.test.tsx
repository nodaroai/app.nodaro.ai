/**
 * Settings → Connected apps: every app with OAuth access to the account, and
 * a revoke that asks first. There was no screen for this at all — a grant
 * could be undone only by the app itself.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"
import React from "react"
import { en } from "@/lib/i18n/en"

const { apps, revoked } = vi.hoisted(() => ({ apps: [] as unknown[], revoked: [] as string[] }))

vi.mock("@/lib/api", () => ({
  listConnectedApps: vi.fn(async () => ({ apps })),
  revokeConnectedApp: vi.fn(async (id: string) => {
    revoked.push(id)
    return { ok: true }
  }),
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import ConnectedAppsPage from "../page"

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ConnectedAppsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  revoked.length = 0
  apps.length = 0
  apps.push(
    { authorizationId: "a-1", name: "Claude", kind: "dynamic_mcp", homepageUrl: null, scopes: ["workflows:read"], connectedAt: "2026-09-01T10:00:00Z", lastUsedAt: null },
    { authorizationId: "a-2", name: "Zap Studio", kind: "user", homepageUrl: null, scopes: [], connectedAt: "2026-09-02T10:00:00Z", lastUsedAt: "2026-09-20T10:00:00Z" },
  )
})

describe("Connected apps page", () => {
  it("lists every app with its kind; a self-registered MCP client is marked as naming itself", async () => {
    renderPage()
    expect(await screen.findByText("Claude")).toBeInTheDocument()
    expect(screen.getByText("Zap Studio")).toBeInTheDocument()
    expect(screen.getByText(en["connApps.kindMcp"])).toBeInTheDocument()
    expect(screen.getByText(en["connApps.kindUser"])).toBeInTheDocument()
    expect(screen.getByText("workflows:read")).toBeInTheDocument()
    expect(screen.getByText(en["connApps.neverUsed"])).toBeInTheDocument()
  })

  it("revokes only after the confirmation, and only that app", async () => {
    renderPage()
    await screen.findByText("Claude")
    fireEvent.click(screen.getAllByRole("button", { name: en["connApps.revoke"] })[0]!)
    expect(revoked).toEqual([])
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === en["connApps.revoke"])!)
    await waitFor(() => expect(revoked).toEqual(["a-1"]))
  })

  it("says so when no app has access", async () => {
    apps.length = 0
    renderPage()
    expect(await screen.findByText(en["connApps.empty"])).toBeInTheDocument()
  })
})
