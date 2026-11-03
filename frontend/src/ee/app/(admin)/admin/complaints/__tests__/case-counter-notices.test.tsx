import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react"
import type { CaseCounterNotice, ComplaintCase } from "@/ee/hooks/queries/use-admin-complaints-queries"

/**
 * The case page's counter-notices: the sender's details as typed, the steps
 * each state offers, a restore held back with its reason beside the button,
 * and a step's form that closes only once the step was taken.
 */

const calls = vi.hoisted(() => ({ list: [] as Array<[string, unknown]>, fail: new Set<string>() }))

vi.mock("@/ee/hooks/queries/use-admin-complaints-queries", () => {
  const mutation = (name: string) => () => ({
    isPending: false,
    mutateAsync: async (input: unknown) => {
      calls.list.push([name, input])
      if (calls.fail.has(name)) throw new Error(`${name} refused`)
      return { data: {} }
    },
  })
  return {
    useMarkCounterNoticeForwarded: mutation("forwarded"),
    useRecordCourtAction: mutation("court"),
    useRecordCourtActionEnded: mutation("ended"),
    useDeclineCounterNotice: mutation("decline"),
    useRestoreFromCounterNotice: mutation("restore"),
  }
})
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { CaseCounterNotices } from "../case-counter-notices"

const notice = (over: Partial<CaseCounterNotice> = {}): CaseCounterNotice => ({
  id: "n-1",
  reference: "CN-2026-000001",
  restrictionId: "r-1",
  receivedAt: "2026-11-24T02:00:00Z",
  receivedOn: "2026-11-23",
  opensOn: "2026-12-09",
  closesOn: "2026-12-11",
  position: "open",
  name: "Sam Owner",
  email: "sam@example.test",
  address: "1 Road\nTown",
  phone: "+1 555 0101",
  signature: "Sam Owner",
  unreadable: [],
  contentIdentification: "my-clip.mp4",
  locationBefore: "In my Nodaro account: my-clip.mp4",
  forwardedAt: "2026-11-24T10:00:00Z",
  forwardedBy: "admin-1",
  courtActionAt: null,
  courtActionBy: null,
  courtActionNote: null,
  courtActionEndedAt: null,
  courtActionEndedBy: null,
  courtActionEndedNote: null,
  declinedAt: null,
  declinedBy: null,
  declinedReason: null,
  restoredAt: null,
  restoredBy: null,
  restrictionLiftedAt: null,
  otherRestrictionIds: [],
  otherCaseReferences: [],
  ...over,
})

const complaintWith = (n: CaseCounterNotice, status = "counter_notice_received") =>
  ({ reference: "CR-2026-000001", status, complainantEmail: "claimant@example.test", counterNotices: [n] }) as unknown as ComplaintCase

const renderWith = (n: CaseCounterNotice, status?: string) => render(<CaseCounterNotices complaint={complaintWith(n, status)} />)
const button = (name: RegExp) => screen.queryByRole("button", { name })

beforeEach(() => {
  calls.list = []
  calls.fail = new Set()
})

describe("CaseCounterNotices", () => {
  it("shows the sender's details as typed, line breaks kept", () => {
    renderWith(notice())
    const address = screen.getByText((_, el) => el?.tagName === "DD" && el.textContent === "1 Road\nTown")
    expect(address.className).toContain("whitespace-pre-wrap")
  })

  it("restores a forwarded counter-notice inside its window", async () => {
    renderWith(notice())
    fireEvent.click(button(/^Restore the content$/)!)
    await waitFor(() => expect(calls.list).toEqual([["restore", { counterNoticeId: "n-1" }]]))
  })

  it("holds the restore back until it is marked sent, and says so", () => {
    renderWith(notice({ forwardedAt: null, forwardedBy: null }))
    expect((button(/^Restore the content$/) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/^Send the counter-notice to the complainant/)).toBeTruthy()
    fireEvent.click(button(/Mark as sent/)!)
    expect(calls.list).toEqual([["forwarded", { counterNoticeId: "n-1" }]])
  })

  it("a court action's form stays open when the step fails, and closes once it is taken", async () => {
    renderWith(notice())
    fireEvent.click(button(/Court action received/)!)
    fireEvent.change(screen.getByLabelText("A note on the court action"), { target: { value: "District Court, 1:26-cv-1" } })
    calls.fail.add("court")
    fireEvent.click(button(/Record the court action/)!)
    await waitFor(() => expect(calls.list).toHaveLength(1))
    expect(screen.getByLabelText("A note on the court action")).toBeTruthy()
    calls.fail.delete("court")
    fireEvent.click(button(/Record the court action/)!)
    await waitFor(() => expect(screen.queryByLabelText("A note on the court action")).toBeNull())
    expect(calls.list[1]).toEqual(["court", { counterNoticeId: "n-1", note: "District Court, 1:26-cv-1" }])
  })

  it("a decline needs its reason", async () => {
    renderWith(notice())
    fireEvent.click(button(/Decline as not valid/)!)
    expect((button(/Decline the counter-notice/) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(/Why the counter-notice is declined/), { target: { value: "No physical address was given." } })
    fireEvent.click(button(/Decline the counter-notice/)!)
    await waitFor(() => expect(calls.list).toEqual([["decline", { counterNoticeId: "n-1", reason: "No physical address was given." }]]))
  })

  it("while a court action holds the content: its note shown, its end offered, the restore held back", () => {
    renderWith(notice({ courtActionAt: "2026-12-01T00:00:00Z", courtActionNote: "District Court, 1:26-cv-1" }))
    expect(screen.getByText("District Court, 1:26-cv-1")).toBeTruthy()
    expect(button(/The court action ended/)).toBeTruthy()
    expect(button(/Court action received/)).toBeNull()
    expect(button(/Decline as not valid/)).toBeNull()
    expect((button(/^Restore the content$/) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/court action was received: the content stays restricted/)).toBeTruthy()
  })

  it("a declined counter-notice shows its reason and offers no step but the copy", () => {
    renderWith(notice({ declinedAt: "2026-12-01T00:00:00Z", declinedReason: "No physical address was given." }))
    expect(screen.getByText("No physical address was given.")).toBeTruthy()
    for (const name of [/^Restore the content$/, /Court action received/, /Decline as not valid/]) expect(button(name)).toBeNull()
    expect(button(/Copy the counter-notice/)).toBeTruthy()
  })

  it("a closed case holds the restore back", () => {
    renderWith(notice(), "closed")
    const item = screen.getByText("CN-2026-000001").closest("li")!
    expect(within(item).getByText(/The case is closed: reopen it/)).toBeTruthy()
  })
})
