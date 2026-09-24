/**
 * Integrations → Telegram account: invisible unless the server offers it,
 * the account list with its per-status actions, disconnect (and its warning
 * when Telegram could not be told), and the wizard's first step — the served
 * terms and the gate on Continue.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"

const api = vi.hoisted(() => ({
  list: vi.fn(),
  consent: vi.fn(),
  disconnect: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  start: vi.fn(),
  poll: vi.fn(),
  cancel: vi.fn(),
}))
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }))

vi.mock("@/lib/api", () => ({
  listTelegramAccounts: () => api.list(),
  getTelegramConsent: () => api.consent(),
  disconnectTelegramAccount: (id: string) => api.disconnect(id),
  pauseTelegramAccount: (id: string) => api.pause(id),
  resumeTelegramAccount: (id: string) => api.resume(id),
  startTelegramLogin: (input: unknown) => api.start(input),
  pollTelegramLogin: (id: string) => api.poll(id),
  submitTelegramLoginCode: vi.fn(),
  submitTelegramLoginPassword: vi.fn(),
  cancelTelegramLogin: (id: string) => api.cancel(id),
}))
vi.mock("@/lib/edition", () => ({ isCloud: () => true }))
vi.mock("sonner", () => ({ toast: toastMock }))

import { TelegramAccountsCard } from "../telegram-accounts-card"

const ACTIVE = { id: "a1", label: "@radar", status: "active", statusReason: null, updatedAt: "2026-09-24T00:00:00.000Z" }
const PAUSED = { ...ACTIVE, id: "a2", label: "@quiet", status: "paused" }
const REVOKED = { ...ACTIVE, id: "a3", label: "@gone", status: "revoked" }

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(
    <QueryClientProvider client={qc}>
      <TelegramAccountsCard />
    </QueryClientProvider>,
  )
  return { ...view, qc }
}

function apiError(code: string) {
  return Object.assign(new Error(code), { code })
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset()
  for (const fn of Object.values(toastMock)) fn.mockReset()
  api.list.mockResolvedValue({ accounts: [ACTIVE, PAUSED, REVOKED] })
  api.consent.mockResolvedValue({ version: "2026-09-24", points: ["Your own account acts.", "Disconnect any time."] })
  api.cancel.mockResolvedValue(undefined)
})

describe("visibility", () => {
  it.each(["not_found", "feature_unavailable", "in_app_only"])("renders nothing when the server answers %s", async (code) => {
    api.list.mockRejectedValue(apiError(code))
    const { container, qc } = renderCard()
    // The card is null while loading too — so settle the query and flush its
    // notification first, or this would pass without ever seeing the answer.
    await waitFor(() => expect(qc.getQueryState(queryKeys.telegramAccounts.list())?.status).toBe("error"))
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)))
    expect(container).toBeEmptyDOMElement()
  })

  it("renders once the server lists the accounts", async () => {
    renderCard()
    expect(await screen.findByRole("heading", { name: /telegram account/i })).toBeInTheDocument()
    expect(screen.getByText("@radar")).toBeInTheDocument()
  })

  it("an unexpected failure shows the card with a load error instead of hiding it", async () => {
    api.list.mockRejectedValue(apiError("internal_error"))
    renderCard()
    expect(await screen.findByText(/couldn't load your telegram accounts/i)).toBeInTheDocument()
  })

  it("an empty list says what to do next", async () => {
    api.list.mockResolvedValue({ accounts: [] })
    renderCard()
    expect(await screen.findByText(/no account connected yet/i)).toBeInTheDocument()
  })
})

describe("account actions", () => {
  it("offers pause on an active account, resume on a paused one, reconnect on a revoked one", async () => {
    api.pause.mockResolvedValue({ id: "a1", status: "paused" })
    api.resume.mockResolvedValue({ id: "a2", status: "active" })
    renderCard()
    const active = (await screen.findByText("@radar")).closest("li")!
    const paused = screen.getByText("@quiet").closest("li")!
    const revoked = screen.getByText("@gone").closest("li")!

    expect(within(revoked).getByRole("button", { name: /reconnect/i })).toBeInTheDocument()
    expect(within(revoked).queryByRole("button", { name: /pause|resume/i })).toBeNull()

    fireEvent.click(within(active).getByRole("button", { name: /pause/i }))
    await waitFor(() => expect(api.pause).toHaveBeenCalledWith("a1"))
    fireEvent.click(within(paused).getByRole("button", { name: /resume/i }))
    await waitFor(() => expect(api.resume).toHaveBeenCalledWith("a2"))
    expect(toastMock.success).toHaveBeenCalledTimes(2)
  })

  it("disconnect asks first, then warns when Telegram could not be told", async () => {
    api.disconnect.mockResolvedValue({ deleted: true, loggedOut: false })
    renderCard()
    const active = (await screen.findByText("@radar")).closest("li")!
    fireEvent.click(within(active).getByRole("button", { name: /disconnect/i }))

    const confirm = await screen.findByRole("alertdialog")
    expect(within(confirm).getByText(/disconnect @radar\?/i)).toBeInTheDocument()
    fireEvent.click(within(confirm).getByRole("button", { name: /^disconnect$/i }))

    await waitFor(() => expect(api.disconnect).toHaveBeenCalledWith("a1"))
    await waitFor(() => expect(toastMock.warning).toHaveBeenCalled())
    expect(toastMock.success).not.toHaveBeenCalled()
  })
})

describe("the connect wizard", () => {
  it("shows the served terms, and Continue stays off until they are accepted and the keys are well-formed", async () => {
    api.start.mockResolvedValue({ attemptId: "33333333-3333-4333-8333-333333333333", state: { status: "pending", loginUrl: "tg://login?token=abc", expiresAt: 1 } })
    renderCard()
    fireEvent.click(await screen.findByRole("button", { name: /connect account/i }))
    const dialog = await screen.findByRole("dialog")
    expect(await within(dialog).findByText("Your own account acts.")).toBeInTheDocument()

    const next = within(dialog).getByRole("button", { name: /continue/i })
    expect(next).toBeDisabled()

    fireEvent.change(within(dialog).getByLabelText("api_id"), { target: { value: "123456" } })
    fireEvent.change(within(dialog).getByLabelText("api_hash"), { target: { value: "not-a-hash" } })
    expect(within(dialog).getByText(/32 letters and digits/i)).toBeInTheDocument()
    fireEvent.change(within(dialog).getByLabelText("api_hash"), { target: { value: "b".repeat(32) } })
    expect(next).toBeDisabled() // terms not accepted yet

    fireEvent.click(within(dialog).getByRole("checkbox"))
    expect(next).toBeEnabled()
    fireEvent.click(next)

    await waitFor(() =>
      expect(api.start).toHaveBeenCalledWith({ method: "qr", apiId: "123456", apiHash: "b".repeat(32), consentVersion: "2026-09-24" }),
    )
    expect(await within(dialog).findByText(/scan with your phone/i)).toBeInTheDocument()
  })

  it("closing the dialog mid-login cancels the attempt", async () => {
    api.start.mockResolvedValue({ attemptId: "44444444-4444-4444-8444-444444444444", state: { status: "pending", loginUrl: "tg://login?token=abc", expiresAt: 1 } })
    renderCard()
    fireEvent.click(await screen.findByRole("button", { name: /connect account/i }))
    const dialog = await screen.findByRole("dialog")
    await within(dialog).findByText("Your own account acts.")
    fireEvent.change(within(dialog).getByLabelText("api_id"), { target: { value: "1" } })
    fireEvent.change(within(dialog).getByLabelText("api_hash"), { target: { value: "c".repeat(32) } })
    fireEvent.click(within(dialog).getByRole("checkbox"))
    fireEvent.click(within(dialog).getByRole("button", { name: /continue/i }))
    await within(dialog).findByText(/scan with your phone/i)

    fireEvent.click(within(dialog).getByRole("button", { name: /cancel/i }))
    await waitFor(() => expect(api.cancel).toHaveBeenCalledWith("44444444-4444-4444-8444-444444444444"))
  })
})
