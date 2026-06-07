import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ---------------------------------------------------------------------------
// Mock: Supabase client (matches the sibling api-*-studio test convention —
// these tests stub global fetch, so auth headers resolve to {} with no session)
// ---------------------------------------------------------------------------

const mockGetSession = vi.fn()

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    auth: { getSession: mockGetSession },
  }),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks are declared)
// ---------------------------------------------------------------------------

import { generateReferenceSheet } from "../api"

function mockFetchJson(data: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  })
}

beforeEach(() => {
  mockGetSession.mockReset()
  mockGetSession.mockResolvedValue({ data: { session: null } })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("generateReferenceSheet", () => {
  it("POSTs to /v1/reference-sheet and returns { jobId }", async () => {
    const fetchMock = mockFetchJson({ jobId: "job-1" }, 202)
    vi.stubGlobal("fetch", fetchMock)

    const out = await generateReferenceSheet({
      type: "turnaround",
      skin: "studio",
      entityKind: "character",
      entityDbId: "id-1",
      flavour: {
        outputFormat: "still",
        withText: true,
        showLabels: true,
        aspect: "landscape",
        background: "grey",
        sections: [{ kind: "head-turnaround" }],
      },
    })

    expect(out.jobId).toBe("job-1")
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain("/v1/reference-sheet")
    expect((init as RequestInit).method).toBe("POST")
    const body = JSON.parse((init as { body: string }).body)
    expect(body.type).toBe("turnaround")
    expect(body.skin).toBe("studio")
    expect(body.entityKind).toBe("character")
    expect(body.entityDbId).toBe("id-1")
    expect(body.flavour.outputFormat).toBe("still")
  })
})
