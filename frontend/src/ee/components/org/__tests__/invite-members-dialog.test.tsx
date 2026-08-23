import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

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
  return { FakeOrgApiError, createInvitations: vi.fn(), writeText: vi.fn() }
})
const FakeOrgApiError = h.FakeOrgApiError

vi.mock("@/ee/lib/orgs-api", () => ({
  OrgApiError: h.FakeOrgApiError,
  createInvitations: h.createInvitations,
}))

import { InviteMembersDialog, MAX_EMAILS, parseEmails } from "../invite-members-dialog"

const WORKSPACE = {
  id: "ws-1",
  orgId: "org-1",
  name: "Class 1",
  slug: "class-1",
  description: null,
  settings: {},
  defaultProjectId: null,
  archived: false,
  archivedAt: null,
  createdAt: "",
  updatedAt: "",
}

function renderDialog(props: Partial<Parameters<typeof InviteMembersDialog>[0]> = {}) {
  const onOpenChange = vi.fn()
  const onInvited = vi.fn()
  render(
    <InviteMembersDialog
      orgId="org-1"
      open
      onOpenChange={onOpenChange}
      vocabulary={{ workspace: "Class", org_admin: "Administrator", workspace_member: "Student" }}
      {...props}
    />,
  )
  return { onOpenChange, onInvited }
}

const field = () => screen.getByLabelText(/email addresses/i)
const sendButton = () => screen.getByRole("button", { name: /send/i })

beforeEach(() => {
  h.createInvitations.mockResolvedValue([{ email: "a@t.test", status: "sent" }])
  Object.assign(navigator, { clipboard: { writeText: h.writeText } })
})
afterEach(() => vi.clearAllMocks())

/**
 * Addresses arrive from a spreadsheet column, an email To: field, or a
 * message. Rejecting a paste because of its separators would send someone
 * to a text editor to reformat a list they already have.
 */
describe("parseEmails", () => {
  it("accepts every separator a person might paste", () => {
    expect(parseEmails("a@t.test, b@t.test; c@t.test\nd@t.test e@t.test").valid).toEqual([
      "a@t.test",
      "b@t.test",
      "c@t.test",
      "d@t.test",
      "e@t.test",
    ])
  })

  it("lower-cases and counts repeats rather than silently dropping them", () => {
    const parsed = parseEmails("Ada@T.test, ada@t.test, ADA@T.TEST, bob@t.test")
    expect(parsed.valid).toEqual(["ada@t.test", "bob@t.test"])
    expect(parsed.duplicates).toBe(2)
  })

  it("separates what it could not read, without repeating it", () => {
    const parsed = parseEmails("good@t.test, notanemail, notanemail, also bad@")
    expect(parsed.valid).toEqual(["good@t.test"])
    expect(parsed.invalid).toEqual(["notanemail", "also", "bad@"])
  })

  it("is empty for empty input, and ignores stray separators", () => {
    expect(parseEmails("").valid).toEqual([])
    expect(parseEmails("  , ; \n ").valid).toEqual([])
  })
})

describe("the field", () => {
  it("says what it understood before anything is sent", async () => {
    renderDialog()
    await userEvent.type(field(), "a@t.test, b@t.test, a@t.test")
    expect(screen.getByText("2 addresses, 1 repeated.")).toBeInTheDocument()
    expect(sendButton()).toHaveTextContent("Send 2 invitations")
  })

  it("names what it could not read", async () => {
    renderDialog()
    await userEvent.type(field(), "good@t.test nonsense")
    expect(screen.getByText(/not an address: nonsense/i)).toBeInTheDocument()
  })

  it("will not send nothing", () => {
    renderDialog()
    expect(sendButton()).toBeDisabled()
  })

  it("refuses more than the server would take, and says the number", async () => {
    renderDialog()
    const many = Array.from({ length: MAX_EMAILS + 1 }, (_, i) => `p${i}@t.test`).join(",")
    await userEvent.click(field())
    await userEvent.paste(many)
    expect(screen.getByText(new RegExp(`${MAX_EMAILS} at a time is the limit`))).toBeInTheDocument()
    expect(sendButton()).toBeDisabled()
  })
})

describe("sending", () => {
  it("sends the parsed list and closes when everything was emailed", async () => {
    const { onOpenChange, onInvited } = renderDialog({ onInvited: vi.fn() })
    await userEvent.type(field(), "a@t.test")
    await userEvent.click(sendButton())
    await waitFor(() => expect(h.createInvitations).toHaveBeenCalledWith("org-1", { emails: ["a@t.test"] }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    void onInvited
  })

  it("includes the workspace and the admin role only when they were chosen", async () => {
    renderDialog({ workspaces: [WORKSPACE], canInviteAdmins: true })
    await userEvent.type(field(), "a@t.test")
    await userEvent.click(sendButton())
    await waitFor(() => expect(h.createInvitations).toHaveBeenCalledWith("org-1", { emails: ["a@t.test"] }))
  })

  it("offers the admin role only to someone who may grant it", async () => {
    renderDialog({ canInviteAdmins: false })
    expect(screen.queryByLabelText(/role in the organization/i)).not.toBeInTheDocument()
    renderDialog({ canInviteAdmins: true })
    expect(screen.getByLabelText(/role in the organization/i)).toBeInTheDocument()
  })

  it("names the workspace choice in the organization's own word", () => {
    renderDialog({ workspaces: [WORKSPACE] })
    expect(screen.getByLabelText(/add to a class/i)).toBeInTheDocument()
  })
})

/**
 * The half that matters: an invitation that exists and cannot be reached is
 * worse than one that was never created.
 */
describe("when an address could not be emailed", () => {
  beforeEach(() => {
    h.createInvitations.mockResolvedValue([
      { email: "sent@t.test", status: "sent" },
      { email: "nomail@t.test", status: "link_only", link: "https://app.test/join/tok-1" },
      { email: "bounced@t.test", status: "failed", link: "https://app.test/join/tok-2" },
    ])
  })

  it("stays open and shows every link that has to be passed on", async () => {
    const { onOpenChange } = renderDialog()
    await userEvent.type(field(), "sent@t.test nomail@t.test bounced@t.test")
    await userEvent.click(sendButton())

    expect(await screen.findByText("1 sent, 2 to pass on.")).toBeInTheDocument()
    expect(screen.getByText("https://app.test/join/tok-1")).toBeInTheDocument()
    expect(screen.getByText("https://app.test/join/tok-2")).toBeInTheDocument()
    // Closing over the top of this is how an invitation becomes unreachable.
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it("copies a link on request", async () => {
    renderDialog()
    await userEvent.type(field(), "nomail@t.test")
    await userEvent.click(sendButton())
    const copy = await screen.findAllByRole("button", { name: /copy link/i })
    await userEvent.click(copy[0])
    expect(h.writeText).toHaveBeenCalledWith("https://app.test/join/tok-1")
  })

  it("only then closes, when the person says so", async () => {
    const { onOpenChange } = renderDialog()
    await userEvent.type(field(), "nomail@t.test")
    await userEvent.click(sendButton())
    await userEvent.click(await screen.findByRole("button", { name: /done/i }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})

describe("when the request fails", () => {
  it.each([
    ["bulk_invite_cap_exceeded", /invitation limit for today/i],
    ["insufficient_role", /cannot invite people here/i],
    ["workspace_archived", /archived and cannot take new people/i],
  ])("%s is explained and the list is kept", async (code, matcher) => {
    h.createInvitations.mockRejectedValue(new FakeOrgApiError(code, "no", 403))
    renderDialog()
    await userEvent.type(field(), "a@t.test")
    await userEvent.click(sendButton())
    expect(await screen.findByText(matcher)).toBeInTheDocument()
    expect(field()).toHaveValue("a@t.test")
  })
})
