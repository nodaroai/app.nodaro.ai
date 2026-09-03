/**
 * What the compose dialog must never let an admin do.
 *
 * Every case here is a message that would reach a real customer looking wrong:
 * a button with no destination, a screenshot with no words to stand in for it,
 * a send on a deployment that has no email provider, or a preview that no
 * longer matches the text on screen.
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
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { toast } from "sonner"
import { MessageUserDialog } from "../message-user-dialog"

const USER = "00000000-0000-4000-8000-000000000009"

const TEMPLATES = {
  loopsConfigured: true,
  dailyLimit: 50,
  templates: [
    {
      id: "issue_detected",
      label: "Issue detected",
      description: "Something went wrong.",
      supportsImage: false,
      subjectIsAuthored: false,
    },
    {
      id: "general_followup",
      label: "General follow-up",
      description: "Anything else service-related.",
      supportsImage: true,
      subjectIsAuthored: true,
    },
  ],
}

let templatesBody: unknown = TEMPLATES
const sendCalls: Array<Record<string, unknown>> = []
const previewCalls: Array<Record<string, unknown>> = []

function ok(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body } as unknown as Response)
}

const defaultFetch = (...call: [url: string, init?: RequestInit]) => {
  const [url, init] = call
  if (url === "/v1/admin/message-templates") return ok({ data: templatesBody })
  if (url.endsWith("/messages/preview")) {
    previewCalls.push(JSON.parse(String(init?.body)))
    return ok({ data: { subject: "Rendered subject", bodyHtml: "<p>rendered</p>", subjectIsAuthored: false } })
  }
  if (url.endsWith("/messages") && init?.method === "POST") {
    sendCalls.push(JSON.parse(String(init.body)))
    return ok({ data: { id: "m1", status: "sent" } })
  }
  if (url.endsWith("/messages")) return ok({ data: [], total: 0 })
  throw new Error(`unexpected fetch: ${url}`)
}

const fetchMock = vi.fn(defaultFetch)

function renderDialog() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MessageUserDialog open onOpenChange={() => {}} userId={USER} userEmail="user@test.com" />
    </QueryClientProvider>,
  )
}

const sendButton = () => screen.getByRole("button", { name: /^send$/i })
const previewButton = () => screen.getByRole("button", { name: /preview/i })

beforeEach(() => {
  vi.clearAllMocks()
  // clearAllMocks keeps implementations — restore the default explicitly so a
  // test that installs its own cannot leak into the ones declared after it.
  fetchMock.mockImplementation(defaultFetch)
  templatesBody = TEMPLATES
  sendCalls.length = 0
  previewCalls.length = 0
  vi.stubGlobal("fetch", fetchMock)
})

describe("required fields", () => {
  it("cannot send an empty form", async () => {
    renderDialog()
    await waitFor(() => expect(screen.getByLabelText(/what happened/i)).toBeInTheDocument())
    expect(sendButton()).toBeDisabled()
    expect(previewButton()).toBeDisabled()
  })

  it("enables send once every required field is filled", async () => {
    const user = userEvent.setup()
    renderDialog()
    await waitFor(() => expect(screen.getByLabelText(/what happened/i)).toBeInTheDocument())

    await user.type(screen.getByLabelText(/what happened/i), "It broke.")
    await user.type(screen.getByLabelText(/what we did/i), "We fixed it.")
    expect(sendButton()).toBeDisabled()

    await user.type(screen.getByLabelText(/next step/i), "Try again.")
    await waitFor(() => expect(sendButton()).toBeEnabled())
  })

  it("treats whitespace as empty", async () => {
    const user = userEvent.setup()
    renderDialog()
    await waitFor(() => expect(screen.getByLabelText(/what happened/i)).toBeInTheDocument())
    await user.type(screen.getByLabelText(/what happened/i), "   ")
    await user.type(screen.getByLabelText(/what we did/i), "   ")
    await user.type(screen.getByLabelText(/next step/i), "   ")
    expect(sendButton()).toBeDisabled()
  })
})

describe("the no-email-provider case", () => {
  it("refuses to send and says why when Loops is not configured", async () => {
    const user = userEvent.setup()
    templatesBody = { ...TEMPLATES, loopsConfigured: false }
    renderDialog()
    await waitFor(() =>
      expect(screen.getByText(/email is not configured on this deployment/i)).toBeInTheDocument(),
    )
    await user.type(screen.getByLabelText(/what happened/i), "a")
    await user.type(screen.getByLabelText(/what we did/i), "b")
    await user.type(screen.getByLabelText(/next step/i), "c")
    // Filled in, and still refused: the button is not the gate, the provider is.
    expect(sendButton()).toBeDisabled()
  })
})

describe("the consent and replies notices", () => {
  it("states that these are service messages, not marketing", async () => {
    renderDialog()
    await waitFor(() => expect(screen.getByText(/service messages only/i)).toBeInTheDocument())
    expect(screen.getByText(/regardless of marketing\s+consent/i)).toBeInTheDocument()
  })

  it("says where replies actually land", async () => {
    renderDialog()
    await waitFor(() => expect(screen.getByText(/info@nodaro\.ai/)).toBeInTheDocument())
    expect(screen.getByText(/not into\s+this app/i)).toBeInTheDocument()
  })
})

describe("general follow-up extras", () => {
  async function openFollowup(user: ReturnType<typeof userEvent.setup>) {
    renderDialog()
    await waitFor(() => expect(screen.getByLabelText(/message template/i)).toBeInTheDocument())
    await user.click(screen.getByLabelText(/message template/i))
    await user.click(await screen.findByRole("option", { name: /general follow-up/i }))
    await waitFor(() => expect(screen.getByRole("textbox", { name: /^subject/i })).toBeInTheDocument())
    await user.type(screen.getByRole("textbox", { name: /^subject/i }), "Hello")
    await user.type(screen.getByRole("textbox", { name: /^message/i }), "Some body text.")
  }

  it("refuses half a call-to-action", async () => {
    const user = userEvent.setup()
    await openFollowup(user)
    await waitFor(() => expect(sendButton()).toBeEnabled())

    await user.type(screen.getByLabelText(/button text/i), "Open it")
    await waitFor(() => expect(sendButton()).toBeDisabled())
    expect(screen.getByText(/needs both the text and the link/i)).toBeInTheDocument()

    await user.type(screen.getByLabelText(/button link/i), "https://app.nodaro.ai/x")
    await waitFor(() => expect(sendButton()).toBeEnabled())
  })

  it("offers the screenshot field only on a template that can show one", async () => {
    const user = userEvent.setup()
    renderDialog()
    await waitFor(() => expect(screen.getByLabelText(/message template/i)).toBeInTheDocument())
    // issue_detected has supportsImage: false
    expect(screen.queryByText(/attach a screenshot/i)).not.toBeInTheDocument()

    await user.click(screen.getByLabelText(/message template/i))
    await user.click(await screen.findByRole("option", { name: /general follow-up/i }))
    expect(await screen.findByText(/attach a screenshot/i)).toBeInTheDocument()
  })

  it("omits untouched optional fields from the payload entirely", async () => {
    // Sending "" for ctaUrl would trip the server's paired-field rule; absent
    // is what "no button" means on the wire.
    const user = userEvent.setup()
    await openFollowup(user)
    await waitFor(() => expect(sendButton()).toBeEnabled())
    await user.click(sendButton())
    await waitFor(() => expect(sendCalls).toHaveLength(1))
    expect(Object.keys(sendCalls[0].variables as object).sort()).toEqual(["bodyText", "subjectLine"])
  })
})

describe("preview", () => {
  it("renders the server's HTML in a sandboxed frame, never inline", async () => {
    const user = userEvent.setup()
    renderDialog()
    await waitFor(() => expect(screen.getByLabelText(/what happened/i)).toBeInTheDocument())
    await user.type(screen.getByLabelText(/what happened/i), "a")
    await user.type(screen.getByLabelText(/what we did/i), "b")
    await user.type(screen.getByLabelText(/next step/i), "c")
    await user.click(previewButton())

    const frame = await screen.findByTitle<HTMLIFrameElement>("Email preview")
    // No sandbox tokens at all: the frame may paint and nothing else.
    expect(frame.getAttribute("sandbox")).toBe("")
    expect(frame.getAttribute("srcdoc")).toContain("<p>rendered</p>")
  })

  it("marks a template-owned subject as coming from the template", async () => {
    const user = userEvent.setup()
    renderDialog()
    await waitFor(() => expect(screen.getByLabelText(/what happened/i)).toBeInTheDocument())
    await user.type(screen.getByLabelText(/what happened/i), "a")
    await user.type(screen.getByLabelText(/what we did/i), "b")
    await user.type(screen.getByLabelText(/next step/i), "c")
    await user.click(previewButton())
    expect(await screen.findByText(/from template/i)).toBeInTheDocument()
  })

  it("discards the preview as soon as the text changes", async () => {
    // An approved preview that no longer matches the form is the one way an
    // admin can approve one message and send another.
    const user = userEvent.setup()
    renderDialog()
    await waitFor(() => expect(screen.getByLabelText(/what happened/i)).toBeInTheDocument())
    await user.type(screen.getByLabelText(/what happened/i), "a")
    await user.type(screen.getByLabelText(/what we did/i), "b")
    await user.type(screen.getByLabelText(/next step/i), "c")
    await user.click(previewButton())
    await screen.findByTitle("Email preview")

    await user.type(screen.getByLabelText(/next step/i), " more")
    await waitFor(() => expect(screen.queryByTitle("Email preview")).not.toBeInTheDocument())
  })
})

describe("send", () => {
  it("posts the chosen template and the typed variables", async () => {
    const user = userEvent.setup()
    renderDialog()
    await waitFor(() => expect(screen.getByLabelText(/what happened/i)).toBeInTheDocument())
    await user.type(screen.getByLabelText(/what happened/i), "It broke.")
    await user.type(screen.getByLabelText(/what we did/i), "We fixed it.")
    await user.type(screen.getByLabelText(/next step/i), "Try again.")
    await user.click(sendButton())

    await waitFor(() => expect(sendCalls).toHaveLength(1))
    expect(sendCalls[0]).toEqual({
      templateId: "issue_detected",
      variables: { whatHappened: "It broke.", whatWeDid: "We fixed it.", nextStep: "Try again." },
    })
  })

  it("clears the form when the template changes, so nothing carries over", async () => {
    const user = userEvent.setup()
    renderDialog()
    await waitFor(() => expect(screen.getByLabelText(/what happened/i)).toBeInTheDocument())
    await user.type(screen.getByLabelText(/what happened/i), "leftover text")

    await user.click(screen.getByLabelText(/message template/i))
    await user.click(await screen.findByRole("option", { name: /general follow-up/i }))
    await waitFor(() => expect(screen.getByRole("textbox", { name: /^message/i })).toHaveValue(""))
    expect(sendButton()).toBeDisabled()
  })
})

describe("an upload in flight", () => {
  /** Holds the screenshot upload open so "still uploading" is observable. */
  let releaseUpload: (() => void) | null = null

  function holdUpload() {
    fetchMock.mockImplementation((...call: [url: string, init?: RequestInit]) => {
      const [url, init] = call
      if (url === "/v1/upload/image") {
        return new Promise<Response>((resolve) => {
          releaseUpload = () =>
            resolve({
              ok: true,
              status: 200,
              json: async () => ({ url: "https://cdn.test/uploads/shot.png" }),
            } as unknown as Response)
        })
      }
      if (url === "/v1/admin/message-templates") return ok({ data: templatesBody })
      if (url.endsWith("/messages") && init?.method === "POST") {
        sendCalls.push(JSON.parse(String(init.body)))
        return ok({ data: { id: "m1", status: "sent" } })
      }
      return ok({ data: [], total: 0 })
    })
  }

  it("cannot be outrun by Send — the message must not go without the screenshot", async () => {
    // The failure this prevents: Send stayed enabled during the upload, so the
    // email went with no attachment, the admin got a success toast, and the
    // dialog closed. They would only find out from the recipient.
    const user = userEvent.setup()
    holdUpload()
    renderDialog()
    await waitFor(() => expect(screen.getByLabelText(/message template/i)).toBeInTheDocument())
    await user.click(screen.getByLabelText(/message template/i))
    await user.click(await screen.findByRole("option", { name: /general follow-up/i }))
    await user.type(screen.getByRole("textbox", { name: /^subject/i }), "Hello")
    await user.type(screen.getByRole("textbox", { name: /^message/i }), "Body.")
    await waitFor(() => expect(sendButton()).toBeEnabled())

    const file = new File([new Uint8Array([1, 2, 3])], "shot.png", { type: "image/png" })
    await user.upload(screen.getByTestId("screenshot-input"), file)

    // Upload in flight: both buttons are shut.
    await waitFor(() => expect(sendButton()).toBeDisabled())
    expect(previewButton()).toBeDisabled()
    expect(sendCalls).toHaveLength(0)

    releaseUpload?.()
    await waitFor(() => expect(screen.getByLabelText(/link text/i)).toBeInTheDocument())
  })
})

describe("a template the client does not know", () => {
  it("keeps Send shut rather than posting an empty payload", async () => {
    // `[].every()` is true, so an unrecognised id used to render no fields,
    // count as fully filled, and enable Send with `variables: {}`.
    templatesBody = {
      ...TEMPLATES,
      templates: [
        {
          id: "brand_new_template",
          label: "Brand new",
          description: "Shipped by the server, unknown to this build.",
          supportsImage: false,
          subjectIsAuthored: false,
        },
      ],
    }
    renderDialog()
    await waitFor(() => expect(screen.getByLabelText(/message template/i)).toBeInTheDocument())
    expect(sendButton()).toBeDisabled()
    expect(previewButton()).toBeDisabled()
  })
})

describe("the form is locked while a preview is in flight", () => {
  let releasePreview: (() => void) | null = null

  it("cannot be edited or sent until the preview resolves", async () => {
    // This lock is the FIRST reason an approved preview always matches what is
    // sent (the request token in the component is the second). If it is ever
    // relaxed, this test is what says so.
    const user = userEvent.setup()
    fetchMock.mockImplementation((...call: [url: string, init?: RequestInit]) => {
      const [url] = call
      if (url === "/v1/admin/message-templates") return ok({ data: templatesBody })
      if (url.endsWith("/messages/preview")) {
        return new Promise<Response>((resolve) => {
          releasePreview = () =>
            resolve({
              ok: true,
              status: 200,
              json: async () => ({
                data: { subject: "s", bodyHtml: "<p>rendered</p>", subjectIsAuthored: false },
              }),
            } as unknown as Response)
        })
      }
      return ok({ data: [], total: 0 })
    })

    renderDialog()
    await waitFor(() => expect(screen.getByLabelText(/what happened/i)).toBeInTheDocument())
    await user.type(screen.getByLabelText(/what happened/i), "a")
    await user.type(screen.getByLabelText(/what we did/i), "b")
    await user.type(screen.getByLabelText(/next step/i), "c")
    await user.click(previewButton())

    await waitFor(() => expect(screen.getByLabelText(/what happened/i)).toBeDisabled())
    expect(sendButton()).toBeDisabled()
    expect(previewButton()).toBeDisabled()

    releasePreview?.()
    await screen.findByTitle("Email preview")
    await waitFor(() => expect(screen.getByLabelText(/what happened/i)).toBeEnabled())
  })
})

describe("a template list that does not contain the compiled default", () => {
  it("selects one the server actually offers, and keeps Send shut for an unknown one", async () => {
    // The initial templateId is a guess made before the server answers. Left
    // unreconciled, the Select renders a value that is not among its options.
    templatesBody = {
      ...TEMPLATES,
      templates: [
        {
          id: "brand_new_template",
          label: "Brand new",
          description: "Shipped by the server, unknown to this build.",
          supportsImage: false,
          subjectIsAuthored: false,
        },
      ],
    }
    renderDialog()
    await waitFor(() => expect(screen.getByText("Brand new")).toBeInTheDocument())
    // No fields are known for it, so nothing can be composed — and Send must
    // not be live on an empty payload (`[].every()` is true).
    expect(screen.queryByLabelText(/what happened/i)).not.toBeInTheDocument()
    expect(sendButton()).toBeDisabled()
    expect(previewButton()).toBeDisabled()
  })
})

describe("a send whose outcome we never learned", () => {
  function failSendWith(status: number, code: string, message: string) {
    fetchMock.mockImplementation((...call: [url: string, init?: RequestInit]) => {
      const [url, init] = call
      if (url === "/v1/admin/message-templates") return ok({ data: templatesBody })
      if (url.endsWith("/messages") && init?.method === "POST") {
        return Promise.resolve({
          ok: false,
          status,
          json: async () => ({ error: { code, message } }),
        } as unknown as Response)
      }
      return ok({ data: [], total: 0 })
    })
  }

  async function fillAndSend(user: ReturnType<typeof userEvent.setup>) {
    renderDialog()
    await waitFor(() => expect(screen.getByLabelText(/what happened/i)).toBeInTheDocument())
    await user.type(screen.getByLabelText(/what happened/i), "It broke.")
    await user.type(screen.getByLabelText(/what we did/i), "We fixed it.")
    await user.type(screen.getByLabelText(/next step/i), "Try again.")
    await user.click(sendButton())
  }

  it("locks Send and keeps the dialog open — a duplicate must not be one click away", async () => {
    // The backend answers 504 saying "we do not know whether this was
    // delivered; check before sending it again". Leaving Send armed on the same
    // draft put the duplicate it warns about one click below the warning.
    const user = userEvent.setup()
    failSendWith(504, "send_unconfirmed", "The email provider did not answer in time.")
    await fillAndSend(user)

    expect(await screen.findByText(/delivery unknown/i)).toBeInTheDocument()
    expect(screen.getByText(/did not answer in time/i)).toBeInTheDocument()
    await waitFor(() => expect(sendButton()).toBeDisabled())
    // Still open — closing would hide the one warning the admin needs.
    expect(screen.getByLabelText(/what happened/i)).toBeInTheDocument()
  })

  it("unlocks once the draft changes, because that is a different message", async () => {
    const user = userEvent.setup()
    failSendWith(504, "send_unconfirmed", "The email provider did not answer in time.")
    await fillAndSend(user)
    await waitFor(() => expect(sendButton()).toBeDisabled())

    await user.type(screen.getByLabelText(/next step/i), " Please retry.")
    await waitFor(() => expect(sendButton()).toBeEnabled())
    expect(screen.queryByText(/delivery unknown/i)).not.toBeInTheDocument()
  })

  it("does NOT latch on an ordinary rejection — that one really did not send", async () => {
    // 502 means the provider refused it. Nothing arrived, so re-sending after a
    // fix is exactly the right move and must stay available.
    const user = userEvent.setup()
    failSendWith(502, "send_failed", "The email provider rejected the message.")
    await fillAndSend(user)

    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(screen.queryByText(/delivery unknown/i)).not.toBeInTheDocument()
    expect(sendButton()).toBeEnabled()
  })
})
