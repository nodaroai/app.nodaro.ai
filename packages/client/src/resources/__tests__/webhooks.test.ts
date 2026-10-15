import { describe, it, expect, vi } from "vitest"
import { createClient, StaticTokenAuth } from "../../index.js"
import type { WebhookDelivery, WebhookEndpoint } from "../../index.js"

function mockOk<T>(body: T, status = 200) {
  return Promise.resolve({ ok: true, status, json: async () => body } as unknown as Response)
}

function client(fetchMock: ReturnType<typeof vi.fn>) {
  return createClient({ baseUrl: "https://api.example.com", auth: new StaticTokenAuth("t"), fetch: fetchMock })
}

function call(fetchMock: ReturnType<typeof vi.fn>, n = 0) {
  const [url, init] = fetchMock.mock.calls[n] as [string, { method: string; body?: string }]
  return { url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined }
}

const ID = "00000000-0000-4000-8000-0000000000e1"

const ENDPOINT: WebhookEndpoint = {
  id: ID,
  url: "https://hooks.example.com/in",
  description: "orders",
  events: ["job.completed", "job.failed"],
  isActive: true,
  disabledReason: null,
  disabledAt: null,
  consecutiveFailures: 0,
  appId: null,
  secretCreatedAt: "2026-10-15T10:00:00Z",
  previousSecretExpiresAt: null,
  createdAt: "2026-10-15T10:00:00Z",
  updatedAt: "2026-10-15T10:00:00Z",
}

const DELIVERY: WebhookDelivery = {
  id: "00000000-0000-4000-8000-0000000000d1",
  webhookId: ID,
  event: "ping",
  jobId: null,
  status: "pending",
  attempts: 0,
  responseStatus: null,
  responseBody: null,
  durationMs: null,
  error: null,
  requestBody: null,
  createdAt: "2026-10-15T10:00:00Z",
  lastAttemptAt: null,
  nextAttemptAt: "2026-10-15T10:00:00Z",
  deliveredAt: null,
}

describe("webhooks resource", () => {
  it("create() POSTs the endpoint and hands back the secret", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: ENDPOINT, secret: "whsec_abc" }, 201))
    const out = await client(fetchMock).webhooks.create({ url: "https://hooks.example.com/in", events: ["job.failed"], description: "orders" })
    const { url, method, body } = call(fetchMock)
    expect(method).toBe("POST")
    expect(url).toBe("https://api.example.com/v1/webhook-endpoints")
    expect(body).toEqual({ url: "https://hooks.example.com/in", events: ["job.failed"], description: "orders" })
    expect(out).toEqual({ data: ENDPOINT, secret: "whsec_abc" })
  })

  it("list() and get() read the endpoints", async () => {
    const fetchMock = vi.fn()
      .mockReturnValueOnce(mockOk({ data: [ENDPOINT] }))
      .mockReturnValueOnce(mockOk({ data: ENDPOINT }))
    const c = client(fetchMock)
    expect((await c.webhooks.list()).data).toEqual([ENDPOINT])
    expect(call(fetchMock, 0)).toMatchObject({ method: "GET", url: "https://api.example.com/v1/webhook-endpoints" })
    expect((await c.webhooks.get(ID)).data).toEqual(ENDPOINT)
    expect(call(fetchMock, 1)).toMatchObject({ method: "GET", url: `https://api.example.com/v1/webhook-endpoints/${ID}` })
  })

  it("update() PATCHes only what is given", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: { ...ENDPOINT, isActive: false } }))
    const out = await client(fetchMock).webhooks.update(ID, { isActive: false, description: null })
    expect(call(fetchMock)).toEqual({
      method: "PATCH",
      url: `https://api.example.com/v1/webhook-endpoints/${ID}`,
      body: { isActive: false, description: null },
    })
    expect(out.data.isActive).toBe(false)
  })

  it("delete() DELETEs the endpoint", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ success: true }))
    expect(await client(fetchMock).webhooks.delete(ID)).toEqual({ success: true })
    expect(call(fetchMock)).toMatchObject({ method: "DELETE", url: `https://api.example.com/v1/webhook-endpoints/${ID}` })
  })

  it("rotateSecret() POSTs and returns the new secret, and until when the old one still signs", async () => {
    const fetchMock = vi.fn()
      .mockReturnValueOnce(mockOk({ secret: "whsec_new", previousSecretExpiresAt: "2026-10-16T10:00:00Z" }))
      .mockReturnValueOnce(mockOk({ secret: "whsec_newer", previousSecretExpiresAt: null }))
    const c = client(fetchMock)
    expect(await c.webhooks.rotateSecret(ID)).toEqual({ secret: "whsec_new", previousSecretExpiresAt: "2026-10-16T10:00:00Z" })
    expect(call(fetchMock, 0)).toEqual({ method: "POST", url: `https://api.example.com/v1/webhook-endpoints/${ID}/rotate-secret`, body: {} })
    await c.webhooks.rotateSecret(ID, { gracePeriodSeconds: 0 })
    expect(call(fetchMock, 1).body).toEqual({ gracePeriodSeconds: 0 })
  })

  it("getDelivery() reads one delivery by its id", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: DELIVERY }))
    const out = await client(fetchMock).webhooks.getDelivery(ID, DELIVERY.id)
    expect(call(fetchMock)).toMatchObject({
      method: "GET",
      url: `https://api.example.com/v1/webhook-endpoints/${ID}/deliveries/${DELIVERY.id}`,
    })
    expect(out.data).toEqual(DELIVERY)
  })

  it("deliveries() pages the log with only the filters given", async () => {
    const fetchMock = vi.fn()
      .mockReturnValueOnce(mockOk({ data: [DELIVERY], next: "c2" }))
      .mockReturnValueOnce(mockOk({ data: [], next: null }))
    const c = client(fetchMock)
    const page = await c.webhooks.deliveries(ID, { status: "failed", limit: 10 })
    expect(call(fetchMock, 0).url).toBe(`https://api.example.com/v1/webhook-endpoints/${ID}/deliveries?status=failed&limit=10`)
    expect(page).toEqual({ data: [DELIVERY], next: "c2" })
    await c.webhooks.deliveries(ID, { cursor: "c2" })
    expect(call(fetchMock, 1).url).toBe(`https://api.example.com/v1/webhook-endpoints/${ID}/deliveries?cursor=c2`)
  })

  it("test() queues a ping and returns its delivery", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: DELIVERY }, 202))
    const out = await client(fetchMock).webhooks.test(ID)
    expect(call(fetchMock)).toMatchObject({ method: "POST", url: `https://api.example.com/v1/webhook-endpoints/${ID}/test` })
    expect(out.data).toEqual(DELIVERY)
  })

  it("encodes the id", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: ENDPOINT }))
    await client(fetchMock).webhooks.get("a/b")
    expect(call(fetchMock).url).toBe("https://api.example.com/v1/webhook-endpoints/a%2Fb")
  })
})
