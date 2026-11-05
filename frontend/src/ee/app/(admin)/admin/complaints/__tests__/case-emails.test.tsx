import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react"
import type { CaseRestriction, ComplaintCase, ComplaintNoticePreview } from "@/ee/hooks/queries/use-admin-complaints-queries"

/**
 * The case page's emails: the account's notice offered per restriction in
 * force on an open copyright case only, with a reason written here for the
 * account; the complainant's update held back until their email is proven and
 * the case has a decision; each email shown as it will be sent before it is
 * sent, the send naming what was previewed, and its preview closing once it
 * went out or the case changed.
 */

const calls = vi.hoisted(() => ({
  list: [] as Array<[string, unknown]>,
  fail: new Set<string>(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock("@/ee/hooks/queries/use-admin-complaints-queries", () => {
  const mutation = (name: string) => () => ({
    isPending: false,
    mutateAsync: async (input: unknown) => {
      calls.list.push([name, input])
      if (calls.fail.has(name)) throw new Error(`${name} refused`)
      return { data: {} }
    },
  })
  const preview = (name: string, answer: (...args: unknown[]) => ComplaintNoticePreview) => async (...args: unknown[]) => {
    calls.list.push([name, args])
    if (calls.fail.has(name)) throw new Error(`${name} refused`)
    return answer(...args)
  }
  return {
    previewAccountNotice: preview("preview-account", (_id, _restrictionId, reason) => ({
      to: "owner@example.test",
      values: { content: "clip.mp4 (video, stored 2 Nov 2026)", source: "Not available", reason: String(reason), reference: "CR-2026-000001", counterNoticeUrl: "https://app.example.test/settings/content-restrictions" },
      digest: "d-account",
    })),
    previewComplainantUpdate: preview("preview-complainant", () => ({
      to: "dana@example.test",
      values: { reference: "CR-2026-000001", status: "Content restricted", action: "Access to the clip was disabled." },
      digest: "d-update",
    })),
    useSendAccountNotice: mutation("send-account"),
    useSendComplainantUpdate: mutation("send-complainant"),
  }
})
vi.mock("sonner", () => ({ toast: { success: calls.toastSuccess, error: calls.toastError } }))

import { CaseEmails } from "../case-emails"

const REASON = "The rights holder of the original film reported this file."

const restriction = (over: Partial<CaseRestriction> = {}): CaseRestriction =>
  ({ id: "r-1", assetId: "a-1", jobId: null, reason: "Internal: checked against the master.", restrictedAt: "2026-11-02T10:00:00Z", liftedAt: null, liftReason: null, ...over }) as CaseRestriction

const complaint = (over: Partial<ComplaintCase> = {}) =>
  ({
    id: "c-1",
    reference: "CR-2026-000001",
    kind: "copyright",
    status: "content_restricted",
    updatedAt: "stamp-1",
    verifiedAt: "2026-11-01T00:00:00Z",
    decision: "Access to the clip was disabled.",
    restrictions: [restriction()],
    ...over,
  }) as unknown as ComplaintCase

const button = (name: RegExp) => screen.queryByRole("button", { name }) as HTMLButtonElement | null
const reasonBox = () => screen.queryByLabelText(/reason the account will read/i) as HTMLTextAreaElement | null

function writeReason(text = REASON) {
  fireEvent.change(reasonBox()!, { target: { value: text } })
}

beforeEach(() => {
  calls.list = []
  calls.fail = new Set()
  calls.toastSuccess.mockReset()
  calls.toastError.mockReset()
})

describe("CaseEmails — the account's notice", () => {
  it("waits for a reason written for the account, never offering the restriction's own note", () => {
    render(<CaseEmails complaint={complaint()} />)
    expect(screen.queryByText(/checked against the master/i)).toBeNull()
    expect(reasonBox()!.value).toBe("")
    expect(button(/preview the email/i)!.disabled).toBe(true)
    writeReason("   ")
    expect(button(/preview the email/i)!.disabled).toBe(true)
    writeReason()
    expect(button(/preview the email/i)!.disabled).toBe(false)
  })

  it("previews the email with that reason, then sends exactly what was previewed, the preview closing", async () => {
    render(<CaseEmails complaint={complaint()} />)
    writeReason()
    fireEvent.click(button(/preview the email/i)!)
    await waitFor(() => expect(screen.getByText("owner@example.test")).toBeInTheDocument())
    expect(screen.getByText(REASON)).toBeInTheDocument()
    expect(screen.getByText("clip.mp4 (video, stored 2 Nov 2026)")).toBeInTheDocument()
    expect(calls.list).toEqual([["preview-account", ["c-1", "r-1", REASON]]])

    fireEvent.click(button(/^send$/i)!)
    await waitFor(() => expect(calls.toastSuccess).toHaveBeenCalledWith("Email sent to the account"))
    expect(calls.list.at(-1)).toEqual(["send-account", { id: "c-1", restrictionId: "r-1", reason: REASON, digest: "d-account" }])
    expect(screen.queryByText("owner@example.test")).toBeNull()
  })

  it("keeps the preview when the send is refused, saying why", async () => {
    calls.fail.add("send-account")
    render(<CaseEmails complaint={complaint()} />)
    writeReason()
    fireEvent.click(button(/preview the email/i)!)
    await waitFor(() => expect(button(/^send$/i)).not.toBeNull())
    fireEvent.click(button(/^send$/i)!)
    await waitFor(() => expect(calls.toastError).toHaveBeenCalledWith("send-account refused"))
    expect(screen.getByText("owner@example.test")).toBeInTheDocument()
  })

  it("Cancel closes the preview, keeps the reason, and sends nothing", async () => {
    render(<CaseEmails complaint={complaint()} />)
    writeReason()
    fireEvent.click(button(/preview the email/i)!)
    await waitFor(() => expect(button(/cancel/i)).not.toBeNull())
    fireEvent.click(button(/cancel/i)!)
    expect(screen.queryByText("owner@example.test")).toBeNull()
    expect(reasonBox()!.value).toBe(REASON)
    expect(calls.list.map((c) => c[0])).toEqual(["preview-account"])
  })

  it("is offered once per restriction in force, never for a lifted one, a closed case, or a complaint that is not about copyright", () => {
    const one = render(<CaseEmails complaint={complaint({ restrictions: [restriction(), restriction({ id: "r-2", liftedAt: "2026-11-03T00:00:00Z" })] })} />)
    expect(screen.getAllByRole("button", { name: /preview the email/i })).toHaveLength(1)
    one.unmount()

    const lifted = render(<CaseEmails complaint={complaint({ restrictions: [restriction({ liftedAt: "2026-11-03T00:00:00Z" })] })} />)
    expect(button(/preview the email/i)).toBeNull()
    expect(screen.getByText(/nothing to tell the account about/i)).toBeInTheDocument()
    lifted.unmount()

    const closed = render(<CaseEmails complaint={complaint({ status: "resolved" })} />)
    expect(button(/preview the email/i)).toBeNull()
    expect(screen.getByText(/the case is closed/i)).toBeInTheDocument()
    closed.unmount()

    render(<CaseEmails complaint={complaint({ kind: "other" })} />)
    expect(button(/preview the email/i)).toBeNull()
    expect(screen.getByText(/for a copyright complaint/i)).toBeInTheDocument()
  })

  it("closes an open preview when the case changes, so nothing older than the case is sent", async () => {
    const { rerender } = render(<CaseEmails complaint={complaint()} />)
    writeReason()
    fireEvent.click(button(/preview the email/i)!)
    await waitFor(() => expect(screen.getByText("owner@example.test")).toBeInTheDocument())
    rerender(<CaseEmails complaint={complaint({ updatedAt: "stamp-2" })} />)
    expect(screen.queryByText("owner@example.test")).toBeNull()
  })
})

describe("CaseEmails — the complainant's update", () => {
  it("previews the update, then sends exactly what was previewed", async () => {
    render(<CaseEmails complaint={complaint()} />)
    fireEvent.click(button(/preview the update/i)!)
    await waitFor(() => expect(screen.getByText("dana@example.test")).toBeInTheDocument())
    expect(screen.getByText("Content restricted")).toBeInTheDocument()
    fireEvent.click(button(/^send$/i)!)
    await waitFor(() => expect(calls.toastSuccess).toHaveBeenCalledWith("Update sent to the complainant"))
    expect(calls.list).toEqual([
      ["preview-complainant", ["c-1"]],
      ["send-complainant", { id: "c-1", digest: "d-update" }],
    ])
  })

  it.each([
    ["a complainant who has not proven their email", { verifiedAt: null }, /not proven their email/i],
    ["a case with no decision", { decision: "  " }, /write the decision first/i],
  ])("is held back for %s, saying why", (_label, over, why) => {
    render(<CaseEmails complaint={complaint(over as Partial<ComplaintCase>)} />)
    expect(button(/preview the update/i)!.disabled).toBe(true)
    const section = screen.getByRole("region", { name: /emails/i })
    expect(within(section).getByText(why)).toBeInTheDocument()
  })
})
