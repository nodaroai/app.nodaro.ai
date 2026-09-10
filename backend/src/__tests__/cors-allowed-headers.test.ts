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
import { POLL_KEY_HEADER } from "../routes/oauth-plugin-connect.js"

vi.mock("@/lib/dynamic-origins.js", () => ({ isOriginAllowedDynamic: async () => true }))

const { buildCorsOptions } = await import("../app.js")

const ORIGIN = "https://app.nodaro.ai"
const MCP_IFRAME_RE = /^https:\/\/[a-f0-9]+\.claudemcpcontent\.com$/

async function preflight(requestHeaders: string, origin: string = ORIGIN) {
  const app = Fastify({ logger: false })
  await app.register(cors, buildCorsOptions(MCP_IFRAME_RE) as never)
  app.get("/v1/me", async () => ({ ok: true }))
  await app.ready()
  const res = await app.inject({
    method: "OPTIONS",
    url: "/v1/me",
    headers: {
      origin,
      "access-control-request-method": "GET",
      "access-control-request-headers": requestHeaders,
    },
  })
  await app.close()
  return res
}

describe("CORS preflight", () => {
  it("allows every custom header the clients actually send", async () => {
    const res = await preflight(`content-type,authorization,${CLIENT_HEADER},${WORKSPACE_HEADER},${POLL_KEY_HEADER}`)
    expect(res.statusCode).toBeLessThan(300)
    const allowed = String(res.headers["access-control-allow-headers"] ?? "").toLowerCase()
    for (const header of ["content-type", "authorization", CLIENT_HEADER, WORKSPACE_HEADER, POLL_KEY_HEADER]) {
      expect(allowed, `${header} must survive the preflight`).toContain(header.toLowerCase())
    }
    expect(String(res.headers["access-control-allow-origin"])).toBe(ORIGIN)
    expect(String(res.headers["access-control-allow-credentials"])).toBe("true")
  })

  // A sandboxed iframe — the Figma plugin UI — sends the literal origin "null".
  // It has to be allowed, or the plugin can call nothing; and it must be allowed
  // WITHOUT credentials, or every opaque page on the web gets credentialed
  // access to the API.
  it("reflects an opaque (null) origin without credentials", async () => {
    const res = await preflight(`authorization,${POLL_KEY_HEADER}`, "null")
    expect(res.statusCode).toBeLessThan(300)
    expect(String(res.headers["access-control-allow-origin"])).toBe("null")
    expect(res.headers["access-control-allow-credentials"]).toBeUndefined()
    const allowed = String(res.headers["access-control-allow-headers"] ?? "").toLowerCase()
    expect(allowed).toContain("authorization")
    expect(allowed).toContain(POLL_KEY_HEADER)
  })

  it("allows the workspace header on its own", async () => {
    const res = await preflight(WORKSPACE_HEADER)
    expect(String(res.headers["access-control-allow-headers"] ?? "").toLowerCase()).toContain(
      WORKSPACE_HEADER.toLowerCase(),
    )
  })
})
