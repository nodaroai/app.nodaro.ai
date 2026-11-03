import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import type { ComplaintCase } from "@/ee/hooks/queries/use-admin-complaints-queries"
import type { AccountRecord, RecordInfringement, RecordMeasure } from "@/ee/hooks/queries/use-admin-repeat-infringers"

/**
 * The account's record on a complaint case: what the policy names for the
 * count, the block as it is and where it disagrees with a closure (with the
 * unblock); each infringement with its case and a withdraw (suggested after a
 * counter-notice restored the content); each measure with what the owner was
 * told and a lift while it is in force (a suspension's in its own words,
 * with the lift's warning); recording an infringement once per case; and the
 * measure form, prefilled from the policy, asking why only when it departs
 * from it, a suspension always with its days.
 */

const calls = vi.hoisted(() => ({ list: [] as Array<[string, unknown]>, result: {} as Record<string, unknown> }))

vi.mock("@/ee/hooks/queries/use-admin-repeat-infringers", async (importOriginal) => {
  const mutation = (name: string) => () => ({
    isPending: false,
    mutateAsync: async (input: unknown) => {
      calls.list.push([name, input])
      return calls.result[name] ?? { data: {} }
    },
  })
  return {
    ...(await importOriginal<typeof import("@/ee/hooks/queries/use-admin-repeat-infringers")>()),
    useRecordInfringement: mutation("record"),
    useWithdrawInfringement: mutation("withdraw"),
    useApplyMeasure: mutation("apply"),
    useLiftMeasure: mutation("lift"),
    useUnblockAccount: mutation("unblock"),
  }
})
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

import { CaseAccountRecord } from "../case-account-record"

const infringement = (over: Partial<RecordInfringement> = {}): RecordInfringement => ({
  id: "i-1",
  complaintId: "c-1",
  caseReference: "CR-2026-000001",
  caseStatus: "resolved",
  caseKind: "copyright",
  note: "The film is theirs",
  recordedAt: "2026-10-01T00:00:00Z",
  withdrawnAt: null,
  withdrawReason: null,
  counts: true,
  restoredAfterCounterNotice: false,
  ...over,
})
const measure = (over: Partial<RecordMeasure> = {}): RecordMeasure => ({
  id: "m-1",
  kind: "imports_blocked",
  appliedAt: "2026-10-02T00:00:00Z",
  endsAt: "2026-11-30T00:00:00Z",
  reason: "Importing is blocked for now.",
  note: "Second strike",
  complaintId: "c-1",
  caseReference: "CR-2026-000001",
  infringementId: null,
  infringementsInWindow: 2,
  policyStep: { infringements: 2 },
  departureReason: null,
  liftedAt: null,
  liftReason: null,
  inForce: true,
  ...over,
})
const record = (over: Partial<AccountRecord> = {}): AccountRecord => ({
  userId: "u-1",
  windowMonths: 24,
  inWindow: 2,
  step: { infringements: 2, kind: "imports_blocked", days: 30 },
  infringements: [],
  measures: [],
  blocked: false,
  block: null,
  ...over,
})
const closureBlock = { reason: "Closed under the repeat-infringer policy (case CR-2026-000001)", blockedAt: "2026-10-05T00:00:00Z" }
const complaint = (over: Partial<ComplaintCase> = {}) =>
  ({ id: "c-1", reference: "CR-2026-000001", kind: "copyright", verifiedAt: "2026-10-01T00:00:00Z", userId: "u-1", record: record(), ...over }) as ComplaintCase

const show = (c: ComplaintCase) =>
  render(
    <MemoryRouter>
      <CaseAccountRecord complaint={c} />
    </MemoryRouter>,
  )

beforeEach(() => {
  calls.list = []
  calls.result = {}
})

describe("CaseAccountRecord", () => {
  it("asks for the case's account first; says when the record could not be read", () => {
    const { unmount } = show(complaint({ userId: null, record: null }))
    expect(screen.getByText("Name the case's account to record an infringement or take a measure.")).toBeTruthy()
    unmount()
    show(complaint({ record: null }))
    expect(screen.getByText("The account's record could not be read.")).toBeTruthy()
  })

  it("says what the policy names for the count, and whether the account is blocked", () => {
    show(complaint())
    expect(screen.getByText("The policy names: Importing links blocked for 30 days, for 2 infringements in 24 months.")).toBeTruthy()
    expect(screen.getByText("The account is not blocked.")).toBeTruthy()
  })

  it("a block that could not be read says so, and claims no disagreement with the closures", () => {
    show(complaint({ record: record({ blocked: null, measures: [measure({ kind: "closed", endsAt: null })] }) }))
    expect(screen.getByText("Whether the account is blocked could not be read.")).toBeTruthy()
    expect(screen.queryByText(/A closure stands, but the account is not blocked/)).toBeNull()
  })

  it("a block shows since when and why", () => {
    show(complaint({ record: record({ blocked: true, block: closureBlock, measures: [measure({ kind: "closed", endsAt: null })] }) }))
    expect(screen.getByText(/^The account is blocked since .+: Closed under the repeat-infringer policy \(case CR-2026-000001\)$/)).toBeTruthy()
  })

  it("a closure lifted while the account stays blocked offers the unblock beside the block's reason, and says when the sign-in stayed blocked", async () => {
    const lifted = measure({ id: "m-2", kind: "closed", endsAt: null, inForce: false, liftedAt: "2026-10-20T00:00:00Z", liftReason: "Closed in error" })
    show(complaint({ record: record({ blocked: true, block: { reason: "Fraud", blockedAt: "2026-09-01T00:00:00Z" }, measures: [lifted] }) }))
    expect(screen.getByText(/^The account is blocked since .+: Fraud$/)).toBeTruthy()
    expect(screen.getByText(/read the block's reason above before you unblock it/)).toBeTruthy()
    calls.result.unblock = { data: { blocked: false, signInBlocked: true, warning: "The account is unblocked, but lifting its sign-in block failed. Press Unblock again to retry." } }
    fireEvent.click(screen.getByRole("button", { name: "Unblock the account" }))
    await waitFor(() => expect(calls.list).toEqual([["unblock", { userId: "u-1" }]]))
    const { toast } = await import("sonner")
    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith("The account is unblocked, but lifting its sign-in block failed. Press Unblock again to retry."))
  })

  it("a closure standing on an account that is not blocked says what to do", () => {
    show(complaint({ record: record({ blocked: false, measures: [measure({ kind: "closed", endsAt: null })] }) }))
    expect(screen.getByText("A closure stands, but the account is not blocked: block it from its page, or lift the closure with a reason.")).toBeTruthy()
  })

  it("records an infringement from the case, with its reasoning; once per case while it stands", async () => {
    const { unmount } = show(complaint())
    fireEvent.click(screen.getByRole("button", { name: "Record an infringement…" }))
    fireEvent.change(screen.getByLabelText("Why the complaint is substantiated"), { target: { value: "The film is theirs" } })
    fireEvent.click(screen.getByRole("button", { name: "Record the infringement" }))
    await waitFor(() => expect(calls.list).toEqual([["record", { complaintId: "c-1", userId: "u-1", note: "The film is theirs" }]]))
    unmount()
    show(complaint({ record: record({ infringements: [infringement()] }) }))
    expect((screen.getByRole("button", { name: "Record an infringement…" }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText("An infringement from this case is recorded.")).toBeTruthy()
  })

  it("an unverified case records and measures nothing", () => {
    show(complaint({ verifiedAt: null }))
    expect((screen.getByRole("button", { name: "Record an infringement…" }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole("button", { name: "Take a measure…" }) as HTMLButtonElement).disabled).toBe(true)
  })

  it("lists each infringement with its case, and withdraws one with a reason, suggested after a counter-notice restored the content", async () => {
    const other = infringement({ id: "i-2", complaintId: "c-2", caseReference: "CR-2026-000002", restoredAfterCounterNotice: true, note: null })
    show(complaint({ record: record({ infringements: [infringement(), other, infringement({ id: "i-3", withdrawnAt: "2026-09-01T00:00:00Z", withdrawReason: "Appeal upheld", counts: false })] }) }))
    expect(screen.getByRole("link", { name: "CR-2026-000002" }).getAttribute("href")).toBe("/admin/complaints/c-2")
    expect(screen.getByText("Appeal upheld")).toBeTruthy()
    expect(screen.getAllByRole("button", { name: "Withdraw…" })).toHaveLength(2)
    expect(screen.getByText(/restored after a counter-notice: withdraw the infringement/)).toBeTruthy()
    fireEvent.click(screen.getAllByRole("button", { name: "Withdraw…" })[1]!)
    expect((screen.getByLabelText("Why the infringement is withdrawn") as HTMLInputElement).value).toBe("Content restored after a counter-notice")
    fireEvent.click(screen.getByRole("button", { name: "Withdraw the infringement" }))
    await waitFor(() => expect(calls.list).toEqual([["withdraw", { infringementId: "i-2", reason: "Content restored after a counter-notice" }]]))
  })

  it("lists each measure with what the owner was told, and lifts one in force with a reason; a warning or an ended one is not lifted", async () => {
    show(
      complaint({
        record: record({
          measures: [
            measure(),
            measure({ id: "m-2", kind: "warning", endsAt: null, inForce: false, reason: "A first warning", policyStep: null, departureReason: "First contact" }),
            measure({ id: "m-3", endsAt: "2026-10-30T00:00:00Z", inForce: false }),
          ],
        }),
      }),
    )
    expect(screen.getByText("The owner was told: A first warning")).toBeTruthy()
    expect(screen.getByText(/Departed from the policy, at 2 infringement\(s\): First contact/)).toBeTruthy()
    expect(screen.getAllByRole("button", { name: "Lift…" })).toHaveLength(1)
    fireEvent.click(screen.getByRole("button", { name: "Lift…" }))
    fireEvent.change(screen.getByLabelText("Why the measure is lifted"), { target: { value: "Appeal upheld" } })
    fireEvent.click(screen.getByRole("button", { name: "Lift the measure" }))
    await waitFor(() => expect(calls.list).toEqual([["lift", { measureId: "m-1", reason: "Appeal upheld" }]]))
  })

  it("a suspension in force runs until its end, is lifted as a suspension, and the lift's warning is shown", async () => {
    show(complaint({ record: record({ measures: [measure({ kind: "suspended", endsAt: "2026-11-17T12:00:00Z", reason: "Suspended for two weeks." })] }) }))
    expect(screen.getByText("Account suspended")).toBeTruthy()
    expect(screen.getByText(/^in force until /)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Lift…" }))
    fireEvent.change(screen.getByLabelText("Why the measure is lifted"), { target: { value: "Appeal upheld" } })
    calls.result.lift = { data: { warning: "The suspension is lifted and the account's requests are let through, but allowing its sign-in failed." } }
    fireEvent.click(screen.getByRole("button", { name: "Lift the suspension" }))
    await waitFor(() => expect(calls.list).toEqual([["lift", { measureId: "m-1", reason: "Appeal upheld" }]]))
    const { toast } = await import("sonner")
    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith("The suspension is lifted and the account's requests are let through, but allowing its sign-in failed."))
    expect(toast.success).toHaveBeenCalledWith("Suspension lifted")
  })
})

describe("the measure form", () => {
  it("starts at the policy's step, the owner's words suggested, and takes it with no departure asked", async () => {
    show(complaint({ record: record({ infringements: [infringement()] }) }))
    fireEvent.click(screen.getByRole("button", { name: "Take a measure…" }))
    expect((screen.getByLabelText("Importing links blocked") as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText("Days (empty: until lifted)") as HTMLInputElement).value).toBe("30")
    expect((screen.getByLabelText("What the account's owner is told") as HTMLTextAreaElement).value).toContain("importing links is blocked")
    expect(screen.queryByLabelText("Why this departs from the policy")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Take the measure" }))
    await waitFor(() => expect(calls.list).toHaveLength(1))
    expect(calls.list[0]).toEqual([
      "apply",
      {
        complaintId: "c-1",
        userId: "u-1",
        kind: "imports_blocked",
        days: 30,
        reason: "We upheld repeated complaints about content in your account, so importing links is blocked on it for now.",
        note: null,
        infringementId: "i-1",
        departureReason: null,
      },
    ])
  })

  it("a measure that departs from the step asks why before it can be taken", async () => {
    show(complaint())
    fireEvent.click(screen.getByRole("button", { name: "Take a measure…" }))
    fireEvent.change(screen.getByLabelText("Days (empty: until lifted)"), { target: { value: "7" } })
    const submit = screen.getByRole("button", { name: "Take the measure" }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText("Why this departs from the policy"), { target: { value: "A first block, kept short" } })
    expect(submit.disabled).toBe(false)
    fireEvent.click(submit)
    await waitFor(() => expect(calls.list[0]?.[1]).toMatchObject({ days: 7, departureReason: "A first block, kept short", infringementId: null }))
  })

  it("days that are not a number keep the form from being sent", () => {
    show(complaint())
    fireEvent.click(screen.getByRole("button", { name: "Take a measure…" }))
    fireEvent.change(screen.getByLabelText("Days (empty: until lifted)"), { target: { value: "0" } })
    expect(screen.getByText(/A whole number of days from 1 to 3650, or empty\./)).toBeTruthy()
    expect((screen.getByRole("button", { name: "Take the measure" }) as HTMLButtonElement).disabled).toBe(true)
  })

  it("closing the account says what it does, and keeps the owner's words the administrator typed", async () => {
    show(complaint({ record: record({ step: { infringements: 3, kind: "closed" }, inWindow: 3 }) }))
    fireEvent.click(screen.getByRole("button", { name: "Take a measure…" }))
    expect(screen.getByText(/Closing blocks the account/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText("What the account's owner is told"), { target: { value: "Closed after three upheld complaints." } })
    fireEvent.click(screen.getByLabelText("Warning"))
    fireEvent.click(screen.getByLabelText("Account closed"))
    expect((screen.getByLabelText("What the account's owner is told") as HTMLTextAreaElement).value).toBe("Closed after three upheld complaints.")
    calls.result.apply = { data: { warning: "The account is blocked, but blocking its sign-in failed." } }
    fireEvent.click(screen.getByRole("button", { name: "Close the account" }))
    await waitFor(() => expect(calls.list[0]?.[1]).toMatchObject({ kind: "closed", days: null, reason: "Closed after three upheld complaints.", departureReason: null }))
    const { toast } = await import("sonner")
    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith("The account is blocked, but blocking its sign-in failed."))
  })

  it("a suspension the policy names starts at its days, says what it does, and is taken as one", async () => {
    show(complaint({ record: record({ step: { infringements: 3, kind: "suspended", days: 14 }, inWindow: 3 }) }))
    fireEvent.click(screen.getByRole("button", { name: "Take a measure…" }))
    expect((screen.getByLabelText("Account suspended") as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText("Days") as HTMLInputElement).value).toBe("14")
    expect((screen.getByLabelText("What the account's owner is told") as HTMLTextAreaElement).value).toContain("the account is suspended")
    expect(screen.getByText(/Suspending refuses the account's sign-in and every request until the suspension ends/)).toBeTruthy()
    expect(screen.queryByLabelText("Why this departs from the policy")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Suspend the account" }))
    await waitFor(() => expect(calls.list[0]?.[1]).toMatchObject({ kind: "suspended", days: 14, departureReason: null }))
    const { toast } = await import("sonner")
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Account suspended"))
  })

  it("a suspension is never sent without its days", () => {
    show(complaint())
    fireEvent.click(screen.getByRole("button", { name: "Take a measure…" }))
    fireEvent.click(screen.getByLabelText("Account suspended"))
    const days = screen.getByLabelText("Days") as HTMLInputElement
    fireEvent.change(days, { target: { value: "" } })
    fireEvent.change(screen.getByLabelText("Why this departs from the policy"), { target: { value: "Suspended instead of a block" } })
    expect(screen.getByText("A whole number of days from 1 to 3650.")).toBeTruthy()
    expect((screen.getByRole("button", { name: "Suspend the account" }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(days, { target: { value: "7" } })
    expect((screen.getByRole("button", { name: "Suspend the account" }) as HTMLButtonElement).disabled).toBe(false)
  })
})
