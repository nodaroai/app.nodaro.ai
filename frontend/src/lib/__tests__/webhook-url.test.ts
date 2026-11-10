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

  it("names the deployment's public host, never the Flow host, when the app's pages have moved", () => {
    apiUrl.value = ""
    window.__NODARO_RUNTIME__ = { linkOrigin: "https://app.example.test", flowUiOrigin: "https://flow.example.test", legacyUiHosts: ["app.example.test"] }
    expect(webhookEndpointUrl("/v1/webhooks/abc", "https://flow.example.test")).toBe("https://app.example.test/v1/webhooks/abc")
    delete window.__NODARO_RUNTIME__
  })

  it("on a host the deployment does not name, or without the rest of the move, it is built exactly as before", () => {
    apiUrl.value = ""
    window.__NODARO_RUNTIME__ = { linkOrigin: "https://app.example.test", flowUiOrigin: "https://flow.example.test", legacyUiHosts: ["app.example.test"] }
    expect(webhookEndpointUrl("/v1/webhooks/abc", "https://sai.example.test")).toBe("https://sai.example.test/v1/webhooks/abc")
    window.__NODARO_RUNTIME__ = { linkOrigin: "https://app.example.test" }
    expect(webhookEndpointUrl("/v1/webhooks/abc")).toBe(`${window.location.origin}/v1/webhooks/abc`)
    delete window.__NODARO_RUNTIME__
  })

  it("passes an absolute URL through", () => {
    expect(webhookEndpointUrl("https://hooks.example.com/v1/webhooks/abc")).toBe("https://hooks.example.com/v1/webhooks/abc")
  })
})
