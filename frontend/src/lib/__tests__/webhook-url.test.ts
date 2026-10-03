import { describe, it, expect, vi } from "vitest"

const { apiUrl } = vi.hoisted(() => ({ apiUrl: { value: "" } }))
vi.mock("@/lib/runtime-config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/runtime-config")>()),
  runtimeApiUrl: () => apiUrl.value,
}))

import { webhookEndpointUrl } from "../webhook-url"

describe("webhookEndpointUrl", () => {
  it("serves a relative path from this page's origin when the API shares it", () => {
    apiUrl.value = ""
    expect(webhookEndpointUrl("/v1/webhooks/abc")).toBe(`${window.location.origin}/v1/webhooks/abc`)
  })

  it("uses the API's own base when the deployment names one", () => {
    apiUrl.value = "https://api.example.com/"
    expect(webhookEndpointUrl("/v1/webhooks/abc")).toBe("https://api.example.com/v1/webhooks/abc")
  })

  it("keeps a relative API base on this page's origin", () => {
    apiUrl.value = "/api"
    expect(webhookEndpointUrl("v1/webhooks/abc")).toBe(`${window.location.origin}/api/v1/webhooks/abc`)
  })

  it("passes an absolute URL through", () => {
    expect(webhookEndpointUrl("https://hooks.example.com/v1/webhooks/abc")).toBe("https://hooks.example.com/v1/webhooks/abc")
  })
})
