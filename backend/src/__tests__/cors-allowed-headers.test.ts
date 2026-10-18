/**
 * A custom request header the clients send MUST survive the CORS preflight,
 * or the browser refuses every call from that origin — not one endpoint, the
 * whole app. That has happened once with the client header; this asserts the
 * real preflight rather than the presence of a symbol in the source, so a
 * header that is textually there but wrongly resolved still fails.
 */
// @test-watches packages/client/src/**/*.ts
import { describe, expect, it, vi } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import Fastify from "fastify"
import cors from "@fastify/cors"
import { WORKSPACE_HEADER } from "@nodaro/shared/organizations"
import { CLIENT_HEADER } from "../lib/job-source.js"
import { IDEMPOTENCY_HEADER } from "../lib/idempotency-header.js"
import { POLL_KEY_HEADER } from "../routes/oauth-plugin-connect.js"

vi.mock("@/lib/dynamic-origins.js", () => ({ isOriginAllowedDynamic: async () => true }))

const { buildCorsOptions } = await import("../app.js")

const ORIGIN = "https://app.nodaro.ai"
const MCP_IFRAME_RE = /^https:\/\/[a-f0-9]+\.claudemcpcontent\.com$/
const SDK_SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "packages", "client", "src")

/** Every `.ts` source file under `dir`, tests excluded. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : sourceFiles(path)
    return name.endsWith(".ts") && !name.endsWith(".test.ts") ? [path] : []
  })
}

/**
 * The custom request headers the SDK's source names as string literals: the
 * `X-Nodaro-*` provenance headers and `Idempotency-Key`. A header the SDK
 * starts sending shows up here on its own, so the preflight test below fails
 * the build before the six client apps find out.
 */
function sdkCustomHeaders(): string[] {
  const literal = /"(X-[A-Za-z0-9-]+|Idempotency-Key)"/g
  const found = new Set<string>()
  for (const file of sourceFiles(SDK_SRC)) {
    for (const match of readFileSync(file, "utf8").matchAll(literal)) found.add(match[1]!.toLowerCase())
  }
  return [...found].sort()
}

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
    const headers = ["content-type", "authorization", CLIENT_HEADER, WORKSPACE_HEADER, POLL_KEY_HEADER, IDEMPOTENCY_HEADER]
    const res = await preflight(headers.join(","))
    expect(res.statusCode).toBeLessThan(300)
    const allowed = String(res.headers["access-control-allow-headers"] ?? "").toLowerCase()
    for (const header of headers) {
      expect(allowed, `${header} must survive the preflight`).toContain(header.toLowerCase())
    }
    expect(String(res.headers["access-control-allow-origin"])).toBe(ORIGIN)
    expect(String(res.headers["access-control-allow-credentials"])).toBe("true")
  })

  // The census: whatever custom header the SDK's source sends, the preflight
  // must allow — a browser SPA on another origin (the worlds pages, studio,
  // person, voice, recast) otherwise gets `TypeError: Failed to fetch` on every
  // call that carries it. `Idempotency-Key` shipped in the SDK long before the
  // allowlist carried it; nothing noticed until Create Image sent it from the
  // worlds preview (2026-10-17).
  it("allows every custom header named in the SDK's source", async () => {
    const headers = sdkCustomHeaders()
    expect(headers, "the census found no SDK headers — did packages/client/src move?").toContain(IDEMPOTENCY_HEADER)
    const res = await preflight(`authorization,${headers.join(",")}`)
    expect(res.statusCode).toBeLessThan(300)
    const allowed = String(res.headers["access-control-allow-headers"] ?? "").toLowerCase()
    for (const header of headers) {
      expect(allowed, `the SDK sends ${header}; add it to allowedHeaders in app.ts`).toContain(header)
    }
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
