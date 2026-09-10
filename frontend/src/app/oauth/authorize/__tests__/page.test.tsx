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
  useAuth: () => ({ user: { id: "u1", email: "user@example.com" }, loading: false }),
}))

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({ auth: { signOut: mockSignOut } }),
}))

const mockAppInfo = vi.fn()

vi.mock("@/lib/api", () => ({
  getOAuthAppInfo: (...args: unknown[]) => mockAppInfo(...args),
  oauthAuthorize: vi.fn(),
}))

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

// SUT imported AFTER the mocks so `vi.mock` takes effect.
import OAuthAuthorizePage from "../page"

const AUTHORIZE_PATH =
  "/oauth/authorize?client_id=cid-123&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fv1%2Fnodaro-connect%2Fcallback&scope=jobs%3Aread&response_type=code"

const REDIRECT_URI = "http://localhost:3000/v1/nodaro-connect/callback"

beforeEach(() => {
  vi.clearAllMocks()
  mockAppInfo.mockResolvedValue({ name: "Nodaro instance (localhost:3000)", kind: "user", redirectUriRegistered: true })
  window.history.replaceState({}, "", AUTHORIZE_PATH)
})

describe("OAuth consent screen — which account is granting", () => {
  it("names the signed-in account the code will be minted for", async () => {
    render(<OAuthAuthorizePage />)
    expect(await screen.findByText(/user@example\.com/)).toBeInTheDocument()
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

/**
 * The Cancel button sends the browser to redirect_uri without ever reaching
 * POST /v1/oauth/authorize, which is where the Allow path checks the URI
 * against the registered list. Cancel used to trust the query string
 * verbatim: an open redirect from a Nodaro URL, and possibly worse. Now the
 * page asks the server up front and refuses to render, or navigate, for an
 * unregistered URI.
 */
describe("OAuth consent screen — redirect_uri must be registered", () => {
  it("asks the server about the exact redirect_uri from the query string", async () => {
    render(<OAuthAuthorizePage />)
    await screen.findByRole("button", { name: /allow/i })
    expect(mockAppInfo).toHaveBeenCalledWith("cid-123", REDIRECT_URI)
  })

  it("renders an error and no Allow/Cancel when the redirect_uri is not registered", async () => {
    mockAppInfo.mockResolvedValue({ name: "Nodaro instance (localhost:3000)", kind: "user", redirectUriRegistered: false })
    render(<OAuthAuthorizePage />)
    expect(await screen.findByText(/not registered for this app/i)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /allow/i })).toBeNull()
    expect(screen.queryByRole("button", { name: /cancel/i })).toBeNull()
  })

  it("offers no redirect at all when the app could not be loaded (unknown or suspended client_id)", async () => {
    mockAppInfo.mockRejectedValue(new Error("Unknown client_id or app suspended"))
    render(<OAuthAuthorizePage />)
    expect(await screen.findByText(/unknown client_id/i)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /cancel/i })).toBeNull()
    expect(screen.queryByRole("button", { name: /allow/i })).toBeNull()
  })

  it("keeps working against a server that does not answer the question (older backend)", async () => {
    mockAppInfo.mockResolvedValue({ name: "Nodaro instance (localhost:3000)", kind: "user" })
    render(<OAuthAuthorizePage />)
    expect(await screen.findByRole("button", { name: /allow/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument()
  })
})
