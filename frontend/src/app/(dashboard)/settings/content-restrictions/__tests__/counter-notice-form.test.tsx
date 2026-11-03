import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import type { MyRestriction } from "@/lib/api"

/**
 * The counter-notification form: the declaration shown verbatim from the
 * server, each statement affirmed on its own and only for the wording shown,
 * every detail required before the button works, what was restricted and
 * where prefilled in English (it goes to the complainant beside the English
 * declaration), the warning that the details go to the complainant shown
 * before the button, and a declaration that changed meanwhile read again
 * with both statements to affirm anew.
 */

const state = vi.hoisted(() => ({
  sent: [] as unknown[],
  refetched: 0,
  failWith: null as null | { code: string; message: string },
  declaration: {
    paragraphs: ["I declare, under penalty of perjury, the first statement.", "I consent to the jurisdiction, the second statement."],
    hash: "a".repeat(64),
  },
}))

vi.mock("@/hooks/queries/use-my-restrictions", () => ({
  useCounterNoticeDeclaration: () => ({
    data: state.declaration,
    isLoading: false,
    isError: false,
    refetch: () => {
      state.refetched += 1
      return Promise.resolve()
    },
  }),
  useSendCounterNotice: () => ({
    isPending: false,
    mutateAsync: async (input: unknown) => {
      state.sent.push(input)
      if (state.failWith) throw Object.assign(new Error(state.failWith.message), { code: state.failWith.code })
      return { data: { reference: "CN-2026-000001", receivedAt: "2026-11-23T20:00:00Z", opensOn: "2026-12-09", closesOn: "2026-12-11" } }
    },
  }),
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { CounterNoticeForm } from "../counter-notice-form"

const restriction: MyRestriction = {
  id: "r-1",
  caseReference: "CR-2026-000001",
  caseKind: "copyright",
  restrictedAt: "2026-11-02T00:00:00Z",
  liftedAt: null,
  item: { kind: "file", name: "clip.mp4", type: "video" },
  counterNotice: null,
  canSendCounterNotice: true,
}

function renderForm(onDone = vi.fn(), over: Partial<MyRestriction> = {}) {
  const view = render(<CounterNoticeForm restriction={{ ...restriction, ...over }} defaultEmail="sam@example.test" onDone={onDone} />)
  return { onDone, view }
}

const fill = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
const submit = () => screen.getByRole("button", { name: /Send the counter-notification/i }) as HTMLButtonElement
const affirmBoth = () => {
  fireEvent.click(screen.getByLabelText(/first statement, under penalty of perjury/i))
  fireEvent.click(screen.getByLabelText(/second statement/i))
}

function fillEverything() {
  fill(/^Full name/i, "Sam Owner")
  fill(/^Physical address/i, "1 Road, Town")
  fill(/^Phone number/i, "+1 555 0101")
  fill(/^Signature/i, "Sam Owner")
}

beforeEach(() => {
  state.sent = []
  state.refetched = 0
  state.failWith = null
  state.declaration = { ...state.declaration, hash: "a".repeat(64) }
})

describe("CounterNoticeForm", () => {
  it("shows the declaration verbatim and prefills, in English, what was restricted and where", () => {
    renderForm()
    expect(screen.getByText("I declare, under penalty of perjury, the first statement.")).toBeTruthy()
    expect(screen.getByText("I consent to the jurisdiction, the second statement.")).toBeTruthy()
    expect((screen.getByLabelText(/^What was restricted/i) as HTMLTextAreaElement).value).toBe("clip.mp4 (complaint CR-2026-000001)")
    expect((screen.getByLabelText(/^Where it was/i) as HTMLTextAreaElement).value).toBe("In my Nodaro account: clip.mp4")
    expect((screen.getByLabelText(/^Email/i) as HTMLInputElement).value).toBe("sam@example.test")
  })

  it("a nameless result is prefilled as one, in English", () => {
    renderForm(vi.fn(), { item: { kind: "result", name: null, type: null } })
    expect((screen.getByLabelText(/^What was restricted/i) as HTMLTextAreaElement).value).toBe("A generated result (complaint CR-2026-000001)")
  })

  it("each field takes no more than the server does", () => {
    renderForm()
    expect((screen.getByLabelText(/^Full name/i) as HTMLInputElement).maxLength).toBe(200)
    expect((screen.getByLabelText(/^Phone number/i) as HTMLInputElement).maxLength).toBe(60)
    expect((screen.getByLabelText(/^Signature/i) as HTMLInputElement).maxLength).toBe(200)
    expect((screen.getByLabelText(/^Physical address/i) as HTMLTextAreaElement).maxLength).toBe(1000)
  })

  it("the button waits for every detail and both statements, each affirmed on its own", () => {
    renderForm()
    expect(submit().disabled).toBe(true)
    fillEverything()
    expect(submit().disabled).toBe(true)
    fireEvent.click(screen.getByLabelText(/first statement, under penalty of perjury/i))
    expect(submit().disabled).toBe(true)
    fireEvent.click(screen.getByLabelText(/second statement/i))
    expect(submit().disabled).toBe(false)
  })

  it("says the details go to the person who complained before the button, not after", () => {
    renderForm()
    const warning = screen.getByText(/will be sent to the person who made the complaint/i)
    expect(warning.compareDocumentPosition(submit()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("sends the details with the declaration's hash and both statements affirmed", async () => {
    const { onDone } = renderForm()
    fillEverything()
    affirmBoth()
    fireEvent.click(submit())
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(state.sent).toEqual([
      {
        restrictionId: "r-1",
        input: expect.objectContaining({ name: "Sam Owner", email: "sam@example.test", declarationHash: "a".repeat(64), perjury: true, jurisdiction: true }),
      },
    ])
  })

  it("ticks made under one wording do not carry over to another: a changed declaration is affirmed anew", () => {
    const { view } = renderForm()
    fillEverything()
    affirmBoth()
    expect(submit().disabled).toBe(false)
    state.declaration = { ...state.declaration, hash: "b".repeat(64) }
    view.rerender(<CounterNoticeForm restriction={restriction} defaultEmail="sam@example.test" onDone={vi.fn()} />)
    expect(submit().disabled).toBe(true)
    affirmBoth()
    expect(submit().disabled).toBe(false)
  })

  it("a declaration that changed meanwhile is read again, and both statements must be affirmed anew", async () => {
    state.failWith = { code: "declaration_changed", message: "The declaration changed" }
    renderForm()
    fillEverything()
    affirmBoth()
    fireEvent.click(submit())
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/declaration changed/i))
    expect(state.refetched).toBe(1)
    expect(submit().disabled).toBe(true)
  })
})
