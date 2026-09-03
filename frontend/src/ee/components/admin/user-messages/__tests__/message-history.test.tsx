/**
 * The log has to say three different things about three different outcomes.
 *
 * The one that is easy to get wrong is `sending`: it means "we wrote the row,
 * then the provider call did not come back" — which for a few seconds means
 * "in flight" and after that means "we do not know whether they got it". Those
 * are different facts and the badge must not conflate them, or an admin will
 * re-send a message the user already received.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

const h = vi.hoisted(() => ({ getAuthHeaders: vi.fn(async () => ({ Authorization: "Bearer t" })) }))
vi.mock("@/lib/api", () => ({ getAuthHeaders: h.getAuthHeaders }))
vi.mock("@/lib/edition", async (orig) => ({
  ...(await orig<typeof import("@/lib/edition")>()),
  hasAdmin: () => true,
}))

import { MessageHistory, statusPresentation } from "../message-history"

const USER = "00000000-0000-4000-8000-000000000009"

function message(over: Record<string, unknown> = {}) {
  return {
    id: "m1",
    userId: USER,
    recipientEmail: "user@test.com",
    sentByAdminId: "a1",
    sentByAdminEmail: "admin@test.com",
    templateId: "issue_detected",
    variables: {},
    renderedSubject: "About a problem with your run",
    renderedBody: "<p>the body</p>",
    imageUrl: null,
    loopsMessageId: "loops-1",
    status: "sent",
    errorMessage: null,
    sentAt: new Date().toISOString(),
    ...over,
  }
}

let body: unknown = { data: [], total: 0 }
const fetchMock = vi.fn((..._call: [url: string, init?: RequestInit]) =>
  Promise.resolve({ ok: true, status: 200, json: async () => body } as unknown as Response),
)

function renderHistory() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MessageHistory userId={USER} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  body = { data: [], total: 0 }
  vi.stubGlobal("fetch", fetchMock)
})

describe("statusPresentation", () => {
  const now = Date.parse("2026-09-03T12:00:00Z")

  it("reads a fresh 'sending' as in flight", () => {
    const s = statusPresentation(
      { status: "sending", sentAt: "2026-09-03T11:59:30Z" },
      now,
    )
    expect(s.tone).toBe("pending")
  })

  it("reads an old 'sending' as interrupted, not as still sending", () => {
    const s = statusPresentation({ status: "sending", sentAt: "2026-09-03T11:50:00Z" }, now)
    expect(s.tone).toBe("unknown")
    expect(s.label).toMatch(/delivery unknown/i)
  })

  it("never calls a failed message anything but failed", () => {
    expect(statusPresentation({ status: "failed", sentAt: "2020-01-01T00:00:00Z" }, now).tone).toBe(
      "failed",
    )
  })

  it("survives an unparseable timestamp without claiming delivery", () => {
    const s = statusPresentation({ status: "sending", sentAt: "not a date" }, now)
    expect(["pending", "unknown"]).toContain(s.tone)
    expect(s.tone).not.toBe("sent")
  })
})

describe("MessageHistory", () => {
  it("says plainly when nobody has messaged the user", async () => {
    renderHistory()
    expect(await screen.findByText(/no admin has messaged this user yet/i)).toBeInTheDocument()
  })

  it("names the admin who sent it, not just the message", async () => {
    body = { data: [message()], total: 1 }
    renderHistory()
    expect(await screen.findByText(/admin@test\.com/)).toBeInTheDocument()
    expect(screen.getByText(/about a problem with your run/i)).toBeInTheDocument()
  })

  it("still identifies a message whose sending admin has been deleted", async () => {
    body = { data: [message({ sentByAdminEmail: null })], total: 1 }
    renderHistory()
    expect(await screen.findByText(/admin who has since been removed/i)).toBeInTheDocument()
  })

  it("shows the provider's reason on a failed message", async () => {
    body = {
      data: [message({ status: "failed", errorMessage: "unknown transactionalId" })],
      total: 1,
    }
    const user = userEvent.setup()
    renderHistory()
    await screen.findByText(/failed/i)
    await user.click(screen.getByRole("button", { expanded: false }))
    expect(await screen.findByText(/never reached them: unknown transactionalId/i)).toBeInTheDocument()
  })

  it("renders the stored body in a sandboxed frame when expanded", async () => {
    body = { data: [message()], total: 1 }
    const user = userEvent.setup()
    renderHistory()
    await screen.findByText(/about a problem with your run/i)
    expect(screen.queryByTitle("Email preview")).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { expanded: false }))
    const frame = await screen.findByTitle<HTMLIFrameElement>("Email preview")
    expect(frame.getAttribute("sandbox")).toBe("")
    expect(frame.getAttribute("srcdoc")).toContain("<p>the body</p>")
  })

  it("explains an environment where the migration has not run yet", async () => {
    body = { data: [], total: 0, unavailable: true }
    renderHistory()
    expect(await screen.findByText(/database migration/i)).toBeInTheDocument()
  })

  it("asks for this user's messages, not the caller's", async () => {
    body = { data: [], total: 0 }
    renderHistory()
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(fetchMock.mock.calls[0][0]).toBe(`/v1/admin/users/${USER}/messages`)
  })
})
