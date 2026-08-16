/**
 * POST /v1/nodaro-connect/start must answer with EITHER a consent URL or an
 * error a self-hoster can act on. Before this, the cloud's own refusal
 * ("Community cloud-connect is not enabled on this server") was passed
 * through verbatim as a 502 — it reads as if the LOCAL server is broken —
 * and a network failure surfaced as a generic internal error. The setup
 * screen then hid both behind a silent hop to /integrations (2026-08-16
 * fresh-install test).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const { mockGetConnection, mockReadState, mockSave, mockFetch, mockCredential } = vi.hoisted(() => ({
  mockGetConnection: vi.fn(),
  mockReadState: vi.fn(),
  mockSave: vi.fn(),
  mockFetch: vi.fn(),
  mockCredential: vi.fn(),
}))

vi.mock("../../lib/nodaro-connect.js", () => ({
  clearNodaroConnection: vi.fn(),
  getNodaroConnection: mockGetConnection,
  readNodaroConnectionState: mockReadState,
  isNodaroConnected: vi.fn(async () => false),
  getNodaroCredential: mockCredential,
  nodaroCloudBase: () => "https://cloud.example",
  nodaroCloudFetch: vi.fn(),
  saveNodaroConnection: mockSave,
}))

vi.mock("../../lib/deployment-urls.js", () => ({
  appBaseUrl: () => "http://localhost:3002",
}))

import { nodaroConnectRoutes } from "../nodaro-connect.js"

let app: FastifyInstance

beforeEach(async () => {
  mockGetConnection.mockReset()
  mockReadState.mockReset()
  mockSave.mockReset()
  mockFetch.mockReset()
  vi.stubGlobal("fetch", mockFetch)
  app = Fastify({ logger: false })
  await app.register(nodaroConnectRoutes)
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await app.close()
})

function cloudResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response
}

async function start() {
  const res = await app.inject({ method: "POST", url: "/v1/nodaro-connect/start" })
  return { status: res.statusCode, body: res.json() as { authorizeUrl?: string; error?: { code: string; message: string } } }
}

// Mirrors tools/community-smoke.mjs assertActionable: nothing raw, short,
// and it names something the user can act on.
function expectActionable(message: string) {
  expect(message.length).toBeGreaterThan(0)
  expect(message.length).toBeLessThanOrEqual(200)
  for (const raw of ["ECONNREFUSED", "TypeError", "    at ", "undefined", "403", "401", "[object Object]"]) {
    expect(message).not.toContain(raw)
  }
  expect(message).toMatch(/nodaro\.ai|provider keys|API key/)
  // The cloud's own refusal says "not enabled on this server" — relayed to a
  // self-hoster that blames THEIR server. The probe rejects the phrase.
  expect(message).not.toMatch(/this server/i)
}

describe("POST /v1/nodaro-connect/start", () => {
  it("registers once with the cloud and hands back the consent URL", async () => {
    mockReadState.mockResolvedValue({ state: "not-connected" })
    mockGetConnection.mockResolvedValue(null)
    mockFetch.mockResolvedValue(cloudResponse(201, { client_id: "ndr_dcr_1", client_secret: "s3" }))

    const { status, body } = await start()

    expect(status).toBe(200)
    expect(body.authorizeUrl).toMatch(/^https:\/\/cloud\.example\/oauth\/authorize\?client_id=ndr_dcr_1&redirect_uri=/)
    expect(mockSave).toHaveBeenCalledWith({ clientId: "ndr_dcr_1", clientSecret: "s3" })
    expect(mockFetch).toHaveBeenCalledWith("https://cloud.example/v1/oauth/register", expect.objectContaining({ method: "POST" }))
  })

  it("reuses a stored registration instead of registering again", async () => {
    mockReadState.mockResolvedValue({ state: "not-connected" })
    mockGetConnection.mockResolvedValue({ clientId: "ndr_dcr_kept", clientSecret: "s" })

    const { status, body } = await start()

    expect(status).toBe(200)
    expect(body.authorizeUrl).toContain("client_id=ndr_dcr_kept")
    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockSave).not.toHaveBeenCalled()
  })

  it("names the cloud, not 'this server', when nodaro.ai has the feature switched off", async () => {
    mockReadState.mockResolvedValue({ state: "not-connected" })
    mockGetConnection.mockResolvedValue(null)
    mockFetch.mockResolvedValue(
      cloudResponse(403, { error: { code: "community_connect_disabled", message: "Community cloud-connect is not enabled on this server." } }),
    )

    const { status, body } = await start()

    expect(status).toBe(503)
    expect(body.error?.code).toBe("cloud_connect_unavailable")
    expectActionable(body.error!.message)
    expect(body.error!.message).toMatch(/nodaro\.ai/)
    expect(body.error!.message).not.toMatch(/this server/i)
    expect(mockSave).not.toHaveBeenCalled()
  })

  it("says the cloud rejected the registration when it answers any other refusal", async () => {
    mockReadState.mockResolvedValue({ state: "not-connected" })
    mockGetConnection.mockResolvedValue(null)
    mockFetch.mockResolvedValue(cloudResponse(400, { error: { code: "invalid_redirect_uri", message: "redirect_uris must be https" } }))

    const { status, body } = await start()

    expect(status).toBe(502)
    expect(body.error?.code).toBe("cloud_registration_failed")
    expectActionable(body.error!.message)
    expect(body.error!.message).toContain("redirect_uris must be https")
  })

  it("says nodaro.ai is unreachable when the registration call cannot connect", async () => {
    mockReadState.mockResolvedValue({ state: "not-connected" })
    mockGetConnection.mockResolvedValue(null)
    mockFetch.mockRejectedValue(new TypeError("fetch failed"))

    const { status, body } = await start()

    expect(status).toBe(503)
    expect(body.error?.code).toBe("cloud_unreachable")
    expectActionable(body.error!.message)
    expect(body.error!.message).toContain("cloud.example")
  })

  it("does not re-register against the cloud when it cannot read its OWN store", async () => {
    // A transport failure reading app_settings must not be mistaken for "no
    // registration yet" — that path would mint a duplicate DCR client on the
    // cloud and overwrite the stored one the moment the store came back.
    mockReadState.mockResolvedValue({ state: "unavailable", reason: "fetch failed" })
    mockGetConnection.mockResolvedValue(null)

    const { status, body } = await start()

    expect(status).toBe(503)
    expect(body.error?.code).toBe("settings_unavailable")
    expectActionable(body.error!.message)
    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockSave).not.toHaveBeenCalled()
  })
})

describe("GET /v1/nodaro-connect/status", () => {
  it("reports not connected without a credential", async () => {
    mockCredential.mockResolvedValue(null)
    const res = await app.inject({ method: "GET", url: "/v1/nodaro-connect/status" })
    expect(res.json()).toEqual({ connected: false })
  })

  it("names the credential source so the card knows whether it can disconnect", async () => {
    // Balance is fetched through the (mocked) nodaroCloudFetch — best effort.
    mockCredential.mockResolvedValue({ token: "ndr_personal", source: "env" })
    const res = await app.inject({ method: "GET", url: "/v1/nodaro-connect/status" })
    const body = res.json()
    expect(body.connected).toBe(true)
    expect(body.source).toBe("env")
    expect(JSON.stringify(body)).not.toContain("ndr_personal")
  })
})
