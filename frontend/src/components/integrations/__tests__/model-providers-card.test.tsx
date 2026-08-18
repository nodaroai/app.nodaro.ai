/**
 * Integrations → "Model providers": the in-app home for the operator's own
 * provider keys (the /setup grid is the setup-time one). What it must
 * guarantee:
 *   - it renders from GET /v1/setup/status — the backend's provider list,
 *     grouped core / used-by-specific-nodes, with the coverage line;
 *   - a pasted key goes to PUT /v1/setup/provider-keys/:id and the card
 *     re-reads status — the value is never echoed;
 *   - an env-managed key is read-only with the variable named;
 *   - a missing instance encryption key is said out loud;
 *   - the cloud edition renders nothing (no keys to manage there).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

const editionMock = vi.hoisted(() => ({ cloud: false }))
vi.mock("@/lib/edition", () => ({ isCloud: () => editionMock.cloud }))
vi.mock("@/lib/api", () => ({
  getAuthHeaders: vi.fn(async () => ({ Authorization: "Bearer test" })),
}))

import { ModelProvidersCard } from "../model-providers-card"

const fetchMock = vi.fn()

function statusBody(over: { keys?: Record<string, boolean>; sources?: Record<string, string | null>; nodaroCloud?: boolean; encryptionOk?: boolean } = {}) {
  const keys = { nodaro: false, kie: false, replicate: false, heygen: false, ...(over.keys ?? {}) }
  const sources = { nodaro: null, kie: null, replicate: null, heygen: null, ...(over.sources ?? {}) }
  return {
    checks: {
      providers: {
        ok: false,
        nodaroCloud: over.nodaroCloud ?? false,
        keys,
        sources,
        meta: {
          nodaro: { name: "nodaro.ai", env: "NODARO_API_KEY", powers: "every model, one account", cloudCovered: false, scope: "core" },
          kie: { name: "KIE.ai", env: "KIE_API_KEY", whereToGet: "kie.ai", powers: "broadest media-model coverage", cloudCovered: true, scope: "core" },
          replicate: { name: "Replicate", env: "REPLICATE_API_TOKEN", whereToGet: "replicate.com", powers: "Flux 2 family", cloudCovered: true, scope: "core" },
          heygen: { name: "HeyGen", env: "HEYGEN_API_KEY", whereToGet: "heygen.com", powers: "AI Avatar + Cinematic Avatar nodes", cloudCovered: false, scope: "node" },
        },
      },
      encryption: { ok: over.encryptionOk ?? true, status: over.encryptionOk === false ? "missing" : "ok" },
    },
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response
}

function renderCard() {
  return render(
    <MemoryRouter>
      <ModelProvidersCard />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  editionMock.cloud = false
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe("ModelProvidersCard", () => {
  it("renders the backend's providers, grouped, with the coverage line and the set count", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, statusBody()))
    renderCard()
    expect(await screen.findByText("KIE.ai")).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith("/v1/setup/status", expect.objectContaining({ cache: "no-store" }))
    // Core grid + the node-specific group with HeyGen in it.
    const group = screen.getByText("Used by specific nodes").parentElement?.parentElement as HTMLElement
    expect(within(group).getByText("HeyGen")).toBeInTheDocument()
    expect(screen.getByText("0/4 set")).toBeInTheDocument()
    // Not connected: what connecting clears (kie, replicate) and what it does not (HeyGen).
    expect(screen.getByText(/clears 2 of the 3 missing keys/)).toBeInTheDocument()
    expect(screen.getByText(/not covered \(own key needed\): HeyGen/)).toBeInTheDocument()
  })

  it("saves a pasted key through PUT, re-reads status, and never leaves the value in the DOM", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, statusBody()))
      .mockResolvedValueOnce(jsonResponse(200, { id: "kie", set: true, source: "app" }))
      .mockResolvedValueOnce(jsonResponse(200, statusBody({ keys: { kie: true }, sources: { kie: "app" } })))
    renderCard()
    await screen.findByText("KIE.ai")
    // The KIE row's "Paste key" — the first core row after nodaro.
    const kieRow = screen.getByText("KIE.ai").closest("div.flex-col") as HTMLElement
    fireEvent.click(within(kieRow).getByRole("button", { name: /paste key/i }))
    const field = within(kieRow).getByLabelText("KIE_API_KEY")
    fireEvent.change(field, { target: { value: "kie-secret-123" } })
    fireEvent.click(within(kieRow).getByRole("button", { name: /^save$/i }))
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/v1/setup/provider-keys/kie",
        expect.objectContaining({ method: "PUT", body: JSON.stringify({ value: "kie-secret-123" }) }),
      )
    })
    // Re-read: the tile now says set (app) and offers Remove; the value is gone.
    expect(await screen.findByText("set (app)")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /remove/i })).toBeInTheDocument()
    expect(document.body.innerHTML).not.toContain("kie-secret-123")
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it("an env-managed key is no longer a dead end: Replace .env + Disable, never plain Change (4b)", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, statusBody({ keys: { replicate: true }, sources: { replicate: "env" } })))
    renderCard()
    await screen.findByText("Replicate")
    const row = screen.getByText("Replicate").closest("div.flex-col") as HTMLElement
    expect(within(row).getByText("set (env)")).toBeInTheDocument()
    // The old read-only caption is replaced by real affordances: an explicit
    // Replace action (paste-with-ignoreEnv) and the disable toggle. A plain
    // Change/Paste stays absent — env still wins unless replaced explicitly.
    expect(within(row).getByRole("button", { name: /replace \.env key/i })).toBeInTheDocument()
    expect(within(row).getByRole("button", { name: /^disable$/i })).toBeInTheDocument()
    expect(within(row).queryByRole("button", { name: /^(paste key|change key)$/i })).toBeNull()
  })

  it("says so when the instance has no encryption key", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, statusBody({ encryptionOk: false })))
    renderCard()
    expect(await screen.findByRole("alert")).toHaveTextContent(/no instance encryption key/i)
  })

  it("renders nothing on the cloud edition", () => {
    editionMock.cloud = true
    const { container } = renderCard()
    expect(container).toBeEmptyDOMElement()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
