import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"

const h = vi.hoisted(() => {
  class FakeOrgApiError extends Error {
    code: string
    status: number
    constructor(code: string, message: string, status = 400) {
      super(message)
      this.code = code
      this.status = status
    }
  }
  return {
    FakeOrgApiError,
    joinByCode: vi.fn(),
    hydrateWorkspaces: vi.fn(async () => {}),
    setActiveWorkspace: vi.fn(),
    navigate: vi.fn(),
    auth: { user: null as { id: string } | null, loading: false },
  }
})
const FakeOrgApiError = h.FakeOrgApiError

vi.mock("@/ee/lib/orgs-api", () => ({ OrgApiError: h.FakeOrgApiError, joinByCode: h.joinByCode }))
vi.mock("@/lib/workspace-context", () => ({
  hydrateWorkspaces: h.hydrateWorkspaces,
  setActiveWorkspace: h.setActiveWorkspace,
}))
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => h.auth }))
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>()
  return { ...actual, useNavigate: () => h.navigate }
})

import JoinCodePage from "../join-code-page"

function renderPage() {
  return render(
    <MemoryRouter>
      <JoinCodePage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  h.auth = { user: { id: "u-1" }, loading: false }
  h.joinByCode.mockResolvedValue({ orgId: "o-1", workspaceId: "w-1" })
})
afterEach(() => vi.clearAllMocks())

describe("joining with a code", () => {
  it("sends what the person typed — the server owns the folding rule", async () => {
    renderPage()
    // Lower case, with the hyphen, exactly as someone would type what they
    // heard. Normalizing here would mean two implementations of one rule.
    await userEvent.type(screen.getByLabelText(/join code/i), "bcdf-ghjk")
    await userEvent.click(screen.getByRole("button", { name: /^join$/i }))
    await waitFor(() => expect(h.joinByCode).toHaveBeenCalledWith("bcdf-ghjk"))
    expect(h.hydrateWorkspaces).toHaveBeenCalled()
    expect(h.setActiveWorkspace).toHaveBeenCalledWith("w-1")
    expect(h.navigate).toHaveBeenCalledWith("/w/w-1", { replace: true })
  })

  it("will not submit an empty code", async () => {
    renderPage()
    expect(screen.getByRole("button", { name: /^join$/i })).toBeDisabled()
    await userEvent.type(screen.getByLabelText(/join code/i), "  ")
    expect(screen.getByRole("button", { name: /^join$/i })).toBeDisabled()
    expect(h.joinByCode).not.toHaveBeenCalled()
  })

  it("asks a signed-out visitor to sign in, and returns them here", () => {
    h.auth = { user: null, loading: false }
    renderPage()
    expect(screen.getByRole("link", { name: /sign in to join/i })).toHaveAttribute("href", "/login?redirect=%2Fjoin")
    expect(screen.getByLabelText(/join code/i)).toBeDisabled()
  })

  it("waits for the session before offering anything", () => {
    h.auth = { user: null, loading: true }
    renderPage()
    expect(screen.getByRole("button", { name: /checking your session/i })).toBeDisabled()
  })
})

describe("when the code does not work", () => {
  async function submitAndRead(code: string, error: unknown): Promise<void> {
    h.joinByCode.mockRejectedValue(error)
    renderPage()
    await userEvent.type(screen.getByLabelText(/join code/i), code)
    await userEvent.click(screen.getByRole("button", { name: /^join$/i }))
  }

  it("gives one answer for every reason a code might not exist", async () => {
    // A code is short enough to guess at, so "no such code", "disabled" and
    // "archived workspace" must be indistinguishable — trying codes has to
    // teach nothing. The server already answers that way; the page must not
    // undo it by elaborating.
    await submitAndRead("BCDFGHJK", new FakeOrgApiError("join_code_invalid", "no"))
    expect(await screen.findByText(/that code is not valid/i)).toBeInTheDocument()
    expect(screen.queryByText(/disabled|archived|workspace/i)).not.toBeInTheDocument()
    expect(h.navigate).not.toHaveBeenCalled()
  })

  it.each([
    ["member_suspended", /suspended/i],
    ["domain_not_allowed", /only admits certain email/i],
    ["rate_limit_exceeded", /wait a minute/i],
  ])("%s is explained plainly", async (code, matcher) => {
    await submitAndRead("BCDFGHJK", new FakeOrgApiError(code, "no", 403))
    expect(await screen.findByText(matcher)).toBeInTheDocument()
  })

  it("a transient failure leaves the form usable", async () => {
    await submitAndRead("BCDFGHJK", new Error("network"))
    expect(await screen.findByText(/something went wrong joining/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /^join$/i })).toBeEnabled()
  })
})
