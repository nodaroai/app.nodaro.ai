/**
 * The paste field behind every Install-health tile. What it must guarantee:
 *   - a pasted key goes to PUT /v1/setup/provider-keys/:id and is never
 *     echoed back into the DOM after saving;
 *   - an env-managed key is read-only here (env wins) with a hint naming the
 *     variable, and the OAuth-connected nodaro.ai tile is read-only too;
 *   - an app-managed key can be cleared;
 *   - the instance's honest error (409 managed_by_env, 403 forbidden, 401)
 *     is shown in place, never swallowed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

vi.mock("@/lib/api", () => ({
  getAuthHeaders: vi.fn(async () => ({ Authorization: "Bearer test" })),
}))

import { ProviderKeyTile } from "../provider-key-tile"
import type { ProviderTile } from "@/lib/provider-tiles"

const fetchMock = vi.fn()

function tile(over: Partial<ProviderTile> = {}): ProviderTile {
  return {
    id: "kie",
    name: "KIE.ai",
    env: "KIE_API_KEY",
    powers: "broadest media-model coverage",
    whereToGet: "kie.ai",
    cloudCovered: true,
    scope: "core",
    present: false,
    source: null,
    state: "missing",
    editable: true,
    disabled: false,
    ignoreEnv: false,
    canReplaceEnv: false,
    canDisable: false,
    ...over,
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe("ProviderKeyTile", () => {
  it("shows the tile's name, what it powers and its state", () => {
    render(<ProviderKeyTile tile={tile()} onChanged={vi.fn()} />)
    expect(screen.getByText("KIE.ai")).toBeInTheDocument()
    expect(screen.getByText(/broadest media-model coverage/)).toBeInTheDocument()
    expect(screen.getByText("missing")).toBeInTheDocument()
  })

  it("saves a pasted key through PUT and never leaves the value in the DOM", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { id: "kie", set: true, source: "app" }))
    const onChanged = vi.fn()
    render(<ProviderKeyTile tile={tile()} onChanged={onChanged} />)
    fireEvent.click(screen.getByRole("button", { name: /paste key/i }))
    const input = screen.getByLabelText(/KIE_API_KEY/i) as HTMLInputElement
    expect(input.type).toBe("password")
    fireEvent.change(input, { target: { value: "kie_live_123" } })
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledWith(
      "/v1/setup/provider-keys/kie",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ value: "kie_live_123" }) }),
    )
    expect(document.body.innerHTML).not.toContain("kie_live_123")
  })

  it("is read-only when the key is managed by the environment, and says which variable", () => {
    render(<ProviderKeyTile tile={tile({ present: true, source: "env", state: "set (env)", editable: false })} onChanged={vi.fn()} />)
    expect(screen.queryByRole("button", { name: /paste key|change key/i })).toBeNull()
    expect(screen.getByText(/remove KIE_API_KEY from \.env \(or use Replace\) to manage it here/i)).toBeInTheDocument()
  })

  it("is read-only when nodaro.ai is connected via OAuth", () => {
    render(
      <ProviderKeyTile
        tile={tile({ id: "nodaro", name: "nodaro.ai", env: "NODARO_API_KEY", present: true, source: "oauth", state: "connected", editable: false })}
        onChanged={vi.fn()}
      />,
    )
    expect(screen.getByText("connected")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /paste key|change key/i })).toBeNull()
  })

  it("can clear an app-managed key", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { id: "fal", set: false, source: null }))
    const onChanged = vi.fn()
    render(<ProviderKeyTile tile={tile({ id: "fal", name: "fal.ai", env: "FAL_KEY", present: true, source: "app", state: "set (app)" })} onChanged={onChanged} />)
    fireEvent.click(screen.getByRole("button", { name: /remove/i }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledWith("/v1/setup/provider-keys/fal", expect.objectContaining({ method: "DELETE" }))
  })

  it("shows the instance's own error in place when a save is refused", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(409, { error: { code: "managed_by_env", message: "KIE_API_KEY is set in this install's environment, which takes precedence — remove it from .env (and restart) to manage this key here." } }),
    )
    render(<ProviderKeyTile tile={tile()} onChanged={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: /paste key/i }))
    fireEvent.change(screen.getByLabelText(/KIE_API_KEY/i), { target: { value: "x" } })
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }))
    expect(await screen.findByRole("alert")).toHaveTextContent(/takes precedence/)
  })

  it("marks a tile the nodaro.ai connection does not cover", () => {
    render(<ProviderKeyTile tile={tile({ id: "heygen", name: "HeyGen", env: "HEYGEN_API_KEY", cloudCovered: false, powers: "AI Avatar" })} onChanged={vi.fn()} />)
    expect(screen.getByText(/own key needed/i)).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// 4b provider control affordances
// ---------------------------------------------------------------------------
describe("4b: Replace .env + Disable", () => {
  it("an env-managed tile with canReplaceEnv offers REPLACE instead of a dead end", () => {
    render(
      <ProviderKeyTile
        tile={tile({ present: true, source: "env", state: "set (env)", editable: false, canReplaceEnv: true, canDisable: true })}
        onChanged={vi.fn()}
      />,
    )
    expect(screen.getByRole("button", { name: /replace \.env key/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /^disable$/i })).toBeInTheDocument()
  })

  it("a disabled tile offers ENABLE", () => {
    render(
      <ProviderKeyTile
        tile={tile({ present: true, source: "env", state: "disabled", editable: false, disabled: true, canDisable: true })}
        onChanged={vi.fn()}
      />,
    )
    expect(screen.getByRole("button", { name: /^enable$/i })).toBeInTheDocument()
  })
})
