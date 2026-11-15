import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"

/**
 * A sign-in made on the page itself (email and password) signs the visitor in
 * while the page is still showing. The page also sends an already signed-in
 * visitor on, so the two used to race: the forward spent the destination the
 * page had kept and went to the projects, or went there right after the
 * sign-in had gone to the kept page. A sign-in started on this page goes on by
 * its own handler, once, and the forward stands down for it.
 */

const nav = vi.hoisted(() => vi.fn())
vi.mock("react-router-dom", async (orig) => ({
  ...(await orig<typeof import("react-router-dom")>()),
  useNavigate: () => nav,
}))
vi.mock("@/lib/leave-page", () => ({ leaveTo: vi.fn() }))
vi.mock("@/lib/edition", async (orig) => ({
  ...(await orig<typeof import("@/lib/edition")>()),
  isCloud: () => false,
  hasCredits: () => false,
}))
// The app's account state, as the real hook keeps it: it changes the moment a
// sign-in succeeds, and every reader re-renders.
const account = vi.hoisted(() => {
  let user: { id: string } | null = null
  const listeners = new Set<() => void>()
  return {
    get: () => user,
    set: (next: { id: string } | null) => {
      user = next
      listeners.forEach((listener) => listener())
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
})
const signInWithEmail = vi.hoisted(() => vi.fn())
vi.mock("@/hooks/use-auth", async () => {
  const { useSyncExternalStore } = await import("react")
  return {
    useAuth: () => ({
      user: useSyncExternalStore(account.subscribe, account.get),
      loading: false,
      signInWithGoogle: vi.fn(),
      signInWithEmail,
    }),
  }
})
const server = vi.hoisted(() => ({ reads: 0 }))
vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    auth: {
      getUser: async () => {
        server.reads++
        return { data: { user: account.get() } }
      },
    },
  }),
}))
vi.mock("@/lib/surface-selectors", async (orig) => ({
  ...(await orig<typeof import("@/lib/surface-selectors")>()),
  surfaceAuthMethods: (d: string[]) => d,
  surfaceAuthSsoLabel: () => undefined,
}))

import LoginPage from "../login/page"
import { registerAppRoutes } from "@/lib/sign-in-redirect"
import { AUTH_REDIRECT_KEY } from "@/lib/storage-keys"

beforeEach(() => {
  nav.mockClear()
  signInWithEmail.mockReset()
  account.set(null)
  server.reads = 0
  localStorage.clear()
  registerAppRoutes([
    { path: "/login" },
    { path: "/app/:slug" },
    { children: [{ path: "/projects" }] },
    { path: "*" },
  ])
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ providers: [], hasUsers: true }) }) as Response),
  )
})
afterEach(() => {
  registerAppRoutes(null)
  vi.unstubAllGlobals()
})

async function signInByEmail() {
  const user = userEvent.setup()
  await user.type(screen.getByPlaceholderText(/email/i), "person@x.test")
  await user.type(screen.getByPlaceholderText(/password/i), "secret-pass")
  await user.click(screen.getByRole("button", { name: /^sign in$/i }))
  await waitFor(() => expect(signInWithEmail).toHaveBeenCalled())
  // Everything the sign-in set off: the handler's own navigation, the account
  // state's re-render and whatever the forward would do after its server read.
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve()
  })
}

describe("login page — a sign-in made on the page itself", () => {
  it("goes once, to the destination kept in storage (a page that sent the visitor to a bare /login)", async () => {
    // A published app whose sign-in pop-up was blocked keeps its address in
    // storage and opens /login with nothing on it.
    localStorage.setItem(AUTH_REDIRECT_KEY, "/app/x")
    signInWithEmail.mockImplementation(async () => account.set({ id: "u1" }))
    render(
      <MemoryRouter initialEntries={["/login"]}>
        <LoginPage />
      </MemoryRouter>,
    )
    await signInByEmail()
    expect(nav.mock.calls).toEqual([["/app/x", { replace: true }]])
  })

  it("goes once, to the address's ?redirect=", async () => {
    signInWithEmail.mockImplementation(async () => account.set({ id: "u1" }))
    render(
      <MemoryRouter initialEntries={["/login?redirect=%2Fapp%2Fx"]}>
        <LoginPage />
      </MemoryRouter>,
    )
    await signInByEmail()
    expect(nav.mock.calls).toEqual([["/app/x", { replace: true }]])
  })

  it("after a refused attempt, the page is itself again: nothing has moved", async () => {
    signInWithEmail.mockRejectedValue(new Error("Invalid login credentials"))
    render(
      <MemoryRouter initialEntries={["/login?redirect=%2Fapp%2Fx"]}>
        <LoginPage />
      </MemoryRouter>,
    )
    await signInByEmail()
    expect(nav).not.toHaveBeenCalled()
    expect(await screen.findByText("Invalid login credentials")).toBeInTheDocument()
  })
})

describe("login page — a visitor who is already signed in, while the account state settles", () => {
  it("asks the auth server once, though the account state hands over the same user anew", async () => {
    // The account state first reports the user it found in the browser, then
    // the same user as the server returned it: a new object, the same person.
    // Starting over for it kept the form on screen for a second round trip.
    account.set({ id: "u1" })
    render(
      <MemoryRouter initialEntries={["/login"]}>
        <LoginPage />
      </MemoryRouter>,
    )
    act(() => account.set({ id: "u1" }))
    await waitFor(() => expect(nav).toHaveBeenCalledWith("/projects", { replace: true }))
    expect(server.reads).toBe(1)
    expect(nav).toHaveBeenCalledTimes(1)
  })
})
