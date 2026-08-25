import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

vi.mock("@/lib/edition", () => ({ isCloud: () => false }))
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ signInWithGoogle: vi.fn(), signInWithEmail: vi.fn() }),
}))
// Force the surface to advertise "sso" as an available method. Spread the real
// module — the i18n locale store also imports surfaceLocaleDefault from here.
vi.mock("@/lib/surface-selectors", async (orig) => ({
  ...(await orig<typeof import("@/lib/surface-selectors")>()),
  surfaceAuthMethods: (d: string[]) => d, // pass-through code default
  surfaceAuthSsoLabel: () => undefined,
}))

const providerList = vi.hoisted(() => ({ value: [] as { id: string; label: string; kind: string }[] }))
beforeEach(() => {
  providerList.value = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("/v1/sso/providers"))
        return { ok: true, json: async () => ({ providers: providerList.value }) } as Response
      if (url.includes("/v1/setup/status")) return { ok: true, json: async () => ({ hasUsers: true }) } as Response
      return { ok: false, json: async () => ({}) } as Response
    }),
  )
})

import LoginPage from "../login/page"

describe("login page SSO", () => {
  it("shows NO sso button when the provider probe returns none", async () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.queryByText("Single sign-on")).toBeNull())
  })

  it("shows an sso button when at least one provider is configured", async () => {
    providerList.value = [{ id: "librechat", label: "LibreChat", kind: "assertion" }]
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.getByText(/LibreChat|Single sign-on/)).toBeTruthy())
  })
})
