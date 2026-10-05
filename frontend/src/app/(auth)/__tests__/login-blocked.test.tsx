import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"

vi.mock("@/lib/edition", () => ({ isCloud: () => false }))
const signInWithEmail = vi.hoisted(() => vi.fn())
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ signInWithGoogle: vi.fn(), signInWithEmail }),
}))
vi.mock("@/lib/surface-selectors", async (orig) => ({
  ...(await orig<typeof import("@/lib/surface-selectors")>()),
  surfaceAuthMethods: (d: string[]) => d,
  surfaceAuthSsoLabel: () => undefined,
}))

beforeEach(() => {
  signInWithEmail.mockReset()
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("/v1/sso/providers")) return { ok: true, json: async () => ({ providers: [] }) } as Response
      if (url.includes("/v1/setup/status")) return { ok: true, json: async () => ({ hasUsers: true }) } as Response
      return { ok: false, json: async () => ({}) } as Response
    }),
  )
})

import LoginPage from "../login/page"

const BLOCKED = "Access to this account has been blocked."

async function signIn() {
  const user = userEvent.setup()
  await user.type(screen.getByPlaceholderText(/email/i), "person@x.test")
  await user.type(screen.getByPlaceholderText(/password/i), "secret-pass")
  await user.click(screen.getByRole("button", { name: /^sign in$/i }))
}

describe("login page — blocked account", () => {
  it("says the account is blocked when the OAuth callback sent it here", async () => {
    render(
      <MemoryRouter initialEntries={["/login?blocked=1"]}>
        <LoginPage />
      </MemoryRouter>,
    )
    expect(await screen.findByText(BLOCKED)).toBeInTheDocument()
  })

  it("says the account is blocked when GoTrue refuses the password sign-in with user_banned", async () => {
    signInWithEmail.mockRejectedValue(Object.assign(new Error("User is banned"), { code: "user_banned" }))
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    )
    await signIn()
    expect(await screen.findByText(BLOCKED)).toBeInTheDocument()
    expect(screen.queryByText("User is banned")).toBeNull()
  })

  it("keeps GoTrue's own sentence for any other failure", async () => {
    signInWithEmail.mockRejectedValue(
      Object.assign(new Error("Invalid login credentials"), { code: "invalid_credentials" }),
    )
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    )
    await signIn()
    expect(await screen.findByText("Invalid login credentials")).toBeInTheDocument()
    expect(screen.queryByText(BLOCKED)).toBeNull()
  })
})
