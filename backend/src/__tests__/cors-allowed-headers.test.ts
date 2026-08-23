/**
 * A custom request header the clients send MUST survive the CORS preflight,
 * or the browser refuses every call from that origin — not one endpoint, the
 * whole app. That has happened once with the client header; this asserts the
 * real preflight rather than the presence of a symbol in the source, so a
 * header that is textually there but wrongly resolved still fails.
 */
import { describe, expect, it, vi } from "vitest"
import Fastify from "fastify"
import cors from "@fastify/cors"
import { WORKSPACE_HEADER } from "@nodaro/shared"
import { CLIENT_HEADER } from "../lib/job-source.js"

vi.mock("@/lib/dynamic-origins.js", () => ({ isOriginAllowedDynamic: async () => true }))

const { buildCorsOptions } = await import("../app.js")

const ORIGIN = "https://app.nodaro.ai"
const MCP_IFRAME_RE = /^https:\/\/[a-f0-9]+\.claudemcpcontent\.com$/

async function preflight(requestHeaders: string) {
  const app = Fastify({ logger: false })
  await app.register(cors, buildCorsOptions(MCP_IFRAME_RE) as never)
  app.get("/v1/me", async () => ({ ok: true }))
  await app.ready()
  const res = await app.inject({
    method: "OPTIONS",
    url: "/v1/me",
    headers: {
      origin: ORIGIN,
      "access-control-request-method": "GET",
      "access-control-request-headers": requestHeaders,
    },
  })
  await app.close()
  return res
}

describe("CORS preflight", () => {
  it("allows every custom header the clients actually send", async () => {
    const res = await preflight(`content-type,authorization,${CLIENT_HEADER},${WORKSPACE_HEADER}`)
    expect(res.statusCode).toBeLessThan(300)
    const allowed = String(res.headers["access-control-allow-headers"] ?? "").toLowerCase()
    for (const header of ["content-type", "authorization", CLIENT_HEADER, WORKSPACE_HEADER]) {
      expect(allowed, `${header} must survive the preflight`).toContain(header.toLowerCase())
    }
  })

  it("allows the workspace header on its own", async () => {
    const res = await preflight(WORKSPACE_HEADER)
    expect(String(res.headers["access-control-allow-headers"] ?? "").toLowerCase()).toContain(
      WORKSPACE_HEADER.toLowerCase(),
    )
  })
})
