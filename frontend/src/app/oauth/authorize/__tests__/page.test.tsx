import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

/**
 * The consent screen mints an authorization code for WHOEVER is signed in on
 * this browser. Before #663 it neither said who that was nor offered a way to
 * change it, so a self-hoster connecting an instance granted from whatever
 * session Chrome happened to hold, silently. These two contracts are the fix.
 */

const mockNavigate = vi.fn()
const mockSignOut = vi.fn().mockResolvedValue({ error: null })

vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
  useSearchParams: () => [new URLSearchParams(window.location.search)],
}))

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { id: "u1", email: "asafna2@gmail.com" }, loading: false }),
}))

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({ auth: { signOut: mockSignOut } }),
}))

vi.mock("@/lib/api", () => ({
  getOAuthAppInfo: () => Promise.resolve({ name: "Nodaro instance (localhost:3000)", kind: "user" }),
  oauthAuthorize: vi.fn(),
}))

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

// SUT imported AFTER the mocks so `vi.mock` takes effect.
import OAuthAuthorizePage from "../page"

const AUTHORIZE_PATH =
  "/oauth/authorize?client_id=cid-123&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fv1%2Fnodaro-connect%2Fcallback&scope=jobs%3Aread&response_type=code"

beforeEach(() => {
  vi.clearAllMocks()
  window.history.replaceState({}, "", AUTHORIZE_PATH)
})

describe("OAuth consent screen — which account is granting", () => {
  it("names the signed-in account the code will be minted for", async () => {
    render(<OAuthAuthorizePage />)
    expect(await screen.findByText(/asafna2@gmail\.com/)).toBeInTheDocument()
  })

  it("signs out and returns to the SAME consent URL when switching account", async () => {
    const user = userEvent.setup()
    render(<OAuthAuthorizePage />)

    await user.click(await screen.findByRole("button", { name: /use a different account/i }))

    await waitFor(() => expect(mockSignOut).toHaveBeenCalledTimes(1))
    // scope "local": switching accounts must not revoke the account's
    // sessions on other devices — the auth-js default is "global", which
    // does exactly that.
    expect(mockSignOut).toHaveBeenCalledWith({ scope: "local" })
    // Relative return_to — the login page drops absolute URLs, which is how
    // the consent screen got lost mid community-connect on 2026-08-14.
    expect(mockNavigate).toHaveBeenCalledWith(
      `/login?return_to=${encodeURIComponent(AUTHORIZE_PATH)}`,
    )
  })

  it("still navigates to login when sign-out reports an error, rather than stranding the user", async () => {
    // auth-js reports failure by RESOLVING { error } (it does not throw),
    // and removes the local session even then — the flow must proceed.
    mockSignOut.mockResolvedValueOnce({ error: new Error("server 500") })
    const user = userEvent.setup()
    render(<OAuthAuthorizePage />)

    await user.click(await screen.findByRole("button", { name: /use a different account/i }))

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith(
        `/login?return_to=${encodeURIComponent(AUTHORIZE_PATH)}`,
      ),
    )
  })

  it("still navigates to login when sign-out crashes (thrown), rather than stranding the user", async () => {
    mockSignOut.mockRejectedValueOnce(new Error("network down"))
    const user = userEvent.setup()
    render(<OAuthAuthorizePage />)

    await user.click(await screen.findByRole("button", { name: /use a different account/i }))

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith(
        `/login?return_to=${encodeURIComponent(AUTHORIZE_PATH)}`,
      ),
    )
  })
})
