import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ---------------------------------------------------------------------------
// Mock: Supabase client
// ---------------------------------------------------------------------------

const mockGetSession = vi.fn()

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    auth: { getSession: mockGetSession },
  }),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import {
  textToVideo,
  uploadFile,
  setCurrentWorkflowId,
  setForcePrivate,
  setUserPromptTemplate,
} from "../api"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetchJson(data: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  })
}

function noSession() {
  mockGetSession.mockResolvedValue({ data: { session: null } })
}

function parseBody(mock: ReturnType<typeof mockFetchJson>, callIndex = 0) {
  return JSON.parse(mock.mock.calls[callIndex][1].body as string)
}

function headersOf(mock: ReturnType<typeof mockFetchJson>, callIndex = 0) {
  return mock.mock.calls[callIndex][1].headers as Record<string, string>
}

// `textToVideo` is the chosen probe: it wraps its body in `withWorkflowId(body)`
// (so it exercises workflowId / forcePrivate / userPrompt injection) AND it
// threads `options.idempotencyKey` through `withIdempotencyHeader` — covering
// every context variant the future apiJson() helper must preserve.

beforeEach(() => {
  mockGetSession.mockReset()
  noSession()
  // Reset all module-level injection state so cases don't leak into each other.
  setCurrentWorkflowId(null)
  setForcePrivate(false)
  setUserPromptTemplate(undefined)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ===========================================================================
// withWorkflowId — workflowId injection
// ===========================================================================

describe("setCurrentWorkflowId / withWorkflowId", () => {
  it("injects workflowId into the body when a current workflow is set", async () => {
    const mock = mockFetchJson({ jobId: "j1" })
    vi.stubGlobal("fetch", mock)

    setCurrentWorkflowId("wf-1")
    await textToVideo("a clip")

    const body = parseBody(mock)
    expect(body.workflowId).toBe("wf-1")
    expect(body.prompt).toBe("a clip")
  })

  it("does NOT inject workflowId when cleared (set to null)", async () => {
    const mock = mockFetchJson({ jobId: "j1" })
    vi.stubGlobal("fetch", mock)

    setCurrentWorkflowId("wf-1")
    setCurrentWorkflowId(null)
    await textToVideo("a clip")

    const body = parseBody(mock)
    expect(body).not.toHaveProperty("workflowId")
  })

  it("keeps injecting workflowId across multiple calls (NOT one-shot)", async () => {
    const mock = mockFetchJson({ jobId: "j1" })
    vi.stubGlobal("fetch", mock)

    setCurrentWorkflowId("wf-7")
    await textToVideo("first")
    await textToVideo("second")

    expect(parseBody(mock, 0).workflowId).toBe("wf-7")
    expect(parseBody(mock, 1).workflowId).toBe("wf-7")
  })
})

// ===========================================================================
// setForcePrivate — one-shot forcePrivate injection
// ===========================================================================

describe("setForcePrivate (one-shot)", () => {
  it("injects forcePrivate:true into the NEXT call's body", async () => {
    const mock = mockFetchJson({ jobId: "j1" })
    vi.stubGlobal("fetch", mock)

    setForcePrivate(true)
    await textToVideo("clip")

    expect(parseBody(mock).forcePrivate).toBe(true)
  })

  it("auto-resets: the call AFTER omits forcePrivate", async () => {
    const mock = mockFetchJson({ jobId: "j1" })
    vi.stubGlobal("fetch", mock)

    setForcePrivate(true)
    await textToVideo("first") // consumes the flag
    await textToVideo("second") // flag already reset

    expect(parseBody(mock, 0).forcePrivate).toBe(true)
    expect(parseBody(mock, 1)).not.toHaveProperty("forcePrivate")
  })

  it("does not inject forcePrivate when never set", async () => {
    const mock = mockFetchJson({ jobId: "j1" })
    vi.stubGlobal("fetch", mock)

    await textToVideo("clip")

    expect(parseBody(mock)).not.toHaveProperty("forcePrivate")
  })
})

// ===========================================================================
// setUserPromptTemplate — one-shot userPrompt injection
// ===========================================================================

describe("setUserPromptTemplate (one-shot)", () => {
  it("injects userPrompt into the NEXT call's body", async () => {
    const mock = mockFetchJson({ jobId: "j1" })
    vi.stubGlobal("fetch", mock)

    setUserPromptTemplate("Hello {name}")
    await textToVideo("resolved prompt")

    const body = parseBody(mock)
    expect(body.userPrompt).toBe("Hello {name}")
    expect(body.prompt).toBe("resolved prompt")
  })

  it("auto-resets: the call AFTER omits userPrompt", async () => {
    const mock = mockFetchJson({ jobId: "j1" })
    vi.stubGlobal("fetch", mock)

    setUserPromptTemplate("tmpl")
    await textToVideo("first") // consumes the template
    await textToVideo("second") // template already reset

    expect(parseBody(mock, 0).userPrompt).toBe("tmpl")
    expect(parseBody(mock, 1)).not.toHaveProperty("userPrompt")
  })

  it("injects an empty-string template (only `undefined` means 'unset')", async () => {
    const mock = mockFetchJson({ jobId: "j1" })
    vi.stubGlobal("fetch", mock)

    setUserPromptTemplate("")
    await textToVideo("clip")

    // The guard is `_userPromptTemplate !== undefined`, so "" IS injected.
    expect(parseBody(mock).userPrompt).toBe("")
  })

  it("combines workflowId + forcePrivate + userPrompt in a single body", async () => {
    const mock = mockFetchJson({ jobId: "j1" })
    vi.stubGlobal("fetch", mock)

    setCurrentWorkflowId("wf-combo")
    setForcePrivate(true)
    setUserPromptTemplate("the template")
    await textToVideo("clip")

    const body = parseBody(mock)
    expect(body.workflowId).toBe("wf-combo")
    expect(body.forcePrivate).toBe(true)
    expect(body.userPrompt).toBe("the template")
  })
})

// ===========================================================================
// withIdempotencyHeader — Idempotency-Key header injection
// ===========================================================================

describe("withIdempotencyHeader (via textToVideo options.idempotencyKey)", () => {
  it("sends an Idempotency-Key header equal to the supplied key", async () => {
    const mock = mockFetchJson({ jobId: "j1" })
    vi.stubGlobal("fetch", mock)

    await textToVideo("clip", undefined, undefined, {
      idempotencyKey: "click-uuid-123",
    })

    expect(headersOf(mock)["Idempotency-Key"]).toBe("click-uuid-123")
    // The key must NOT leak into the JSON body.
    expect(parseBody(mock)).not.toHaveProperty("idempotencyKey")
  })

  it("omits the Idempotency-Key header when no key is supplied", async () => {
    const mock = mockFetchJson({ jobId: "j1" })
    vi.stubGlobal("fetch", mock)

    await textToVideo("clip")

    expect(headersOf(mock)["Idempotency-Key"]).toBeUndefined()
    // Content-Type is still present on this POST.
    expect(headersOf(mock)["Content-Type"]).toBe("application/json")
  })
})

// ===========================================================================
// FormData functions — OUT of the apiJson() refactor scope. Pinned here only
// to confirm they send a FormData body (NOT JSON) and omit Content-Type so the
// browser sets the multipart boundary. The refactor must leave these alone.
// ===========================================================================

describe("uploadFile (FormData — excluded from apiJson)", () => {
  it("sends a FormData body and no Content-Type header", async () => {
    const mock = mockFetchJson({
      data: {
        url: "https://r2/f.png",
        thumbnailUrl: null,
        assetId: "a1",
        category: "image",
        filename: "f.png",
        mimeType: "image/png",
        sizeBytes: 4,
        metadata: null,
        r2Key: "k",
      },
    })
    vi.stubGlobal("fetch", mock)

    const file = new File(["data"], "f.png", { type: "image/png" })
    await uploadFile(file, "user-1")

    const init = mock.mock.calls[0][1]
    expect(init.method).toBe("POST")
    expect(init.body).toBeInstanceOf(FormData)
    expect((init.headers as Record<string, string>)["Content-Type"]).toBeUndefined()
  })
})
