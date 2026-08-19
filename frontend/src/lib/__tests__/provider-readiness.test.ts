import { describe, it, expect, vi, afterEach } from "vitest"
import { fetchProviderReadiness } from "../provider-readiness"

function respond(body: unknown, status = 200) {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(typeof body === "string" ? body : JSON.stringify(body), { status }),
  )
}

describe("fetchProviderReadiness", () => {
  afterEach(() => vi.restoreAllMocks())

  it("reports a keyless, unconnected install as not ready", async () => {
    respond({ checks: { providers: { ok: false, nodaroCloud: false } } })
    expect(await fetchProviderReadiness()).toEqual({ ok: false, nodaroCloud: false })
  })

  it("reports a connected install as ready", async () => {
    respond({ checks: { providers: { ok: true, nodaroCloud: true } } })
    expect(await fetchProviderReadiness()).toEqual({ ok: true, nodaroCloud: true })
  })

  // Everything below must be null, never `{ ok: false }`. A transient failure
  // rendered as "not ready" would show a configuration dialog to an install
  // that is configured — the exact wrong-diagnosis shape this replaces.
  it("returns null on a server error rather than guessing not-ready", async () => {
    respond({ error: "boom" }, 500)
    expect(await fetchProviderReadiness()).toBeNull()
  })

  it("returns null when the payload has no providers slice", async () => {
    respond({ checks: {} })
    expect(await fetchProviderReadiness()).toBeNull()
  })

  it("returns null when `ok` is not a boolean", async () => {
    respond({ checks: { providers: { ok: "yes" } } })
    expect(await fetchProviderReadiness()).toBeNull()
  })

  it("returns null when the request throws (offline)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"))
    expect(await fetchProviderReadiness()).toBeNull()
  })

  it("returns null on a malformed body", async () => {
    respond("not json")
    expect(await fetchProviderReadiness()).toBeNull()
  })
})
