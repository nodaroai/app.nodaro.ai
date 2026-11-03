import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import type { MyCounterNotice, MyRestriction } from "@/lib/api"

/**
 * Settings → Content restrictions: why each restriction was made (the kind of
 * complaint, never an administrator's note), where a counter-notification
 * stands (the window while it waits; a decline with its reason; a court
 * action and its end; a restore), and the form only where one can be sent.
 */

const state = vi.hoisted(() => ({ data: [] as MyRestriction[] }))

vi.mock("@/hooks/queries/use-my-restrictions", () => ({
  useMyRestrictions: () => ({ data: state.data, isLoading: false, isError: false }),
  useCounterNoticeDeclaration: () => ({ data: { paragraphs: ["First.", "Second."], hash: "a".repeat(64) }, isLoading: false, isError: false, refetch: vi.fn() }),
  useSendCounterNotice: () => ({ isPending: false, mutateAsync: vi.fn() }),
}))
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { email: "sam@example.test" } }) }))

import ContentRestrictionsPage from "../page"

const restriction = (over: Partial<MyRestriction> = {}): MyRestriction => ({
  id: "r-1",
  caseReference: "CR-2026-000001",
  caseKind: "copyright",
  restrictedAt: "2026-11-02T00:00:00Z",
  liftedAt: null,
  item: { kind: "file", name: "clip.mp4", type: "video" },
  counterNotice: null,
  canSendCounterNotice: true,
  ...over,
})

const sent = (over: Partial<MyCounterNotice> = {}): MyCounterNotice => ({
  reference: "CN-2026-000001",
  receivedAt: "2026-11-23T20:00:00Z",
  opensOn: "2026-12-09",
  closesOn: "2026-12-11",
  forwarded: false,
  courtAction: false,
  courtActionEnded: false,
  declined: false,
  declinedReason: null,
  restored: false,
  ...over,
})

const show = (...rows: MyRestriction[]) => {
  state.data = rows
  render(
    <MemoryRouter>
      <ContentRestrictionsPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  state.data = []
})

describe("ContentRestrictionsPage", () => {
  it("says why by the kind of complaint, and offers the form only where a counter-notification can be sent", () => {
    show(restriction(), restriction({ id: "r-2", caseKind: "other", canSendCounterNotice: false }))
    expect(screen.getByText(/A copyright owner reported that this content uses their work/)).toBeTruthy()
    expect(screen.getByText(/reported under our content rules/)).toBeTruthy()
    expect(screen.getByText(/not about copyright, so a counter-notification does not apply/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: /Send a counter-notification/ }))
    expect(screen.getByRole("button", { name: /Send the counter-notification/ })).toBeTruthy()
  })

  it("while a counter-notification waits: whether it was sent on, and the window", () => {
    show(restriction({ counterNotice: sent(), canSendCounterNotice: false }), restriction({ id: "r-2", counterNotice: sent({ reference: "CN-2026-000002", forwarded: true }), canSendCounterNotice: false }))
    expect(screen.getByText(/It is being sent to the person who complained/)).toBeTruthy()
    expect(screen.getByText(/It was sent to the person who complained/)).toBeTruthy()
    expect(screen.getAllByText(/The content can be restored from/)).toHaveLength(2)
  })

  it("each outcome in its own words: a decline with its reason, a court action and its end, a restore", () => {
    show(
      restriction({ counterNotice: sent({ declined: true, declinedReason: "No physical address was given." }), canSendCounterNotice: false }),
      restriction({ id: "r-2", counterNotice: sent({ reference: "CN-2", courtAction: true }), canSendCounterNotice: false }),
      restriction({ id: "r-3", counterNotice: sent({ reference: "CN-3", courtAction: true, courtActionEnded: true }), canSendCounterNotice: false }),
      restriction({ id: "r-4", counterNotice: sent({ reference: "CN-4", restored: true }), canSendCounterNotice: false, liftedAt: "2026-12-10T00:00:00Z" }),
    )
    expect(screen.getByText("Your counter-notification was declined: No physical address was given.")).toBeTruthy()
    expect(screen.getByText(/has gone to court: the content stays restricted/)).toBeTruthy()
    expect(screen.getByText(/The court case has ended/)).toBeTruthy()
    expect(screen.getByText("The content was restored.")).toBeTruthy()
    expect(screen.queryByText(/The content can be restored from/)).toBeNull()
  })

  it("a lifted restriction with no counter-notification asks nothing", () => {
    show(restriction({ liftedAt: "2026-11-05T00:00:00Z", canSendCounterNotice: false }))
    expect(screen.queryByRole("button", { name: /Send a counter-notification/ })).toBeNull()
    expect(screen.getByText(/Restriction lifted/)).toBeTruthy()
  })

  it("nothing restricted says so", () => {
    show()
    expect(screen.getByText("Nothing of yours is restricted.")).toBeTruthy()
  })
})
