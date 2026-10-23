/**
 * Job provenance derivation.
 *
 * The precedence order is the whole substance of this module — signals
 * legitimately co-occur (the MCP server calls our own HTTP routes, so an
 * MCP-originated request also carries that hop's transport headers), and
 * getting the order wrong means confidently mislabelling the caller. These
 * tests pin the order, not just the individual cases.
 */
import { describe, it, expect } from "vitest"
import type { FastifyRequest } from "fastify"
import { deriveJobSource, jobSourceColumns, JOB_SOURCES } from "../job-source.js"

const req = (over: Partial<{ headers: Record<string, string>; body: unknown; isInternalCall: boolean; appAuthorization: { appId: string; authorizationId: string; scopes: string[] } }> = {}) =>
  ({ headers: {}, body: {}, ...over }) as unknown as FastifyRequest

describe("deriveJobSource", () => {
  it("defaults to api when nothing identifies the caller", () => {
    expect(deriveJobSource(req())).toEqual({ source: "api", sourceDetail: null })
  })

  it("an MCP verb's internal hop is mcp, not internal", () => {
    // The MCP verbs inject() our routes WITH the internal secret, so internal
    // must not be checked first: every MCP job read as internal for months.
    const r = req({ isInternalCall: true, body: { mcp_client: "Claude" } })
    expect(deriveJobSource(r)).toEqual({ source: "mcp", sourceDetail: "Claude" })
  })

  it("internal orchestrator wins over every transport signal", () => {
    // The orchestrator's own HTTP hop carries an Origin and may carry a body;
    // without this check a workflow node would read as a browser call.
    const r = req({
      isInternalCall: true,
      headers: { origin: "https://app.nodaro.ai", "x-nodaro-client": "cli/1.0.0" },
    })
    expect(deriveJobSource(r)).toEqual({ source: "internal", sourceDetail: null })
  })

  it("mcp beats the transport headers of the MCP server's own hop", () => {
    const r = req({ body: { mcp_client: "Claude" }, headers: { origin: "https://app.nodaro.ai" } })
    expect(deriveJobSource(r)).toEqual({ source: "mcp", sourceDetail: "Claude" })
  })

  it("a browser app using the SDK is its ORIGIN, not a generic \"sdk\"", () => {
    // Every Nodaro client app (studio / person / voice / recast / recut /
    // stitch) is a browser SPA built on @nodaro/sdk, so it sends BOTH signals.
    // If the header won, all six would collapse into one undifferentiated
    // "SDK" row and the per-app visibility this feature exists for would be
    // gone. This is the test that pins it.
    for (const host of ["studio.nodaro.ai", "person.nodaro.ai", "voice.nodaro.ai", "recast.nodaro.ai"]) {
      expect(
        deriveJobSource(req({ headers: { origin: `https://${host}`, "x-nodaro-client": "sdk/1.12.0" } })),
        host,
      ).toEqual({ source: "web", sourceDetail: host })
    }
  })

  it("the CLI is unaffected by that ordering — Node sends no Origin", () => {
    expect(deriveJobSource(req({ headers: { "x-nodaro-client": "cli/1.6.0" } })))
      .toEqual({ source: "cli", sourceDetail: "cli/1.6.0" })
  })

  it("a developer app beats the client header — which integration matters more than how", () => {
    const r = req({
      appAuthorization: { appId: "app_123", authorizationId: "auth_1", scopes: [] },
      headers: { "x-nodaro-client": "sdk/1.4.0" },
    })
    expect(deriveJobSource(r)).toEqual({ source: "app", sourceDetail: "app_123" })
  })

  it("reads cli and sdk from the client header, keeping the version", () => {
    expect(deriveJobSource(req({ headers: { "x-nodaro-client": "cli/1.4.0" } })))
      .toEqual({ source: "cli", sourceDetail: "cli/1.4.0" })
    expect(deriveJobSource(req({ headers: { "x-nodaro-client": "sdk/2.0.0-beta.1" } })))
      .toEqual({ source: "sdk", sourceDetail: "sdk/2.0.0-beta.1" })
  })

  it("ignores a client header claiming anything we don't recognise", () => {
    // Unauthenticated header: it may only SELECT among known values, never
    // invent one, or any caller could label itself whatever it liked.
    for (const bogus of ["web", "internal", "mcp", "totally-made-up", "cli-ish"]) {
      expect(deriveJobSource(req({ headers: { "x-nodaro-client": `${bogus}/9` } })).source).toBe("api")
    }
  })

  it("classifies a browser-extension Origin as `extension`, not `web`", () => {
    // The scheme is browser-set (trusted, like Origin generally); the host is
    // the store-assigned extension id. Grouping these under `web` would bury
    // them behind an opaque hash where a product host is expected.
    expect(deriveJobSource(req({ headers: { origin: "chrome-extension://abcdefghijklmnop" } })))
      .toEqual({ source: "extension", sourceDetail: "abcdefghijklmnop" })
    expect(deriveJobSource(req({ headers: { origin: "moz-extension://0b1c2d3e" } })).source)
      .toBe("extension")
  })

  it("an extension/<name> header upgrades the DETAIL; the scheme still decides the KIND", () => {
    const r = req({
      headers: {
        origin: "chrome-extension://abcdefghijklmnop",
        "x-nodaro-client": "extension/recut-clipper@1.2.0",
      },
    })
    expect(deriveJobSource(r)).toEqual({ source: "extension", sourceDetail: "extension/recut-clipper@1.2.0" })
  })

  it("a non-extension header does NOT override the extension origin's id detail", () => {
    const r = req({ headers: { origin: "chrome-extension://abcdef", "x-nodaro-client": "sdk/1.12.0" } })
    expect(deriveJobSource(r)).toEqual({ source: "extension", sourceDetail: "abcdef" })
  })

  it("honours a bare extension/<name> header when no Origin is present", () => {
    expect(deriveJobSource(req({ headers: { "x-nodaro-client": "extension/recut-clipper" } })))
      .toEqual({ source: "extension", sourceDetail: "extension/recut-clipper" })
  })

  it("stores the ORIGIN HOST for browsers, so a new subdomain needs no code change", () => {
    // The point of the design: person.nodaro.ai has never been mentioned in
    // job-source.ts, and still classifies correctly on the day it launches.
    expect(deriveJobSource(req({ headers: { origin: "https://studio.nodaro.ai" } })))
      .toEqual({ source: "web", sourceDetail: "studio.nodaro.ai" })
    expect(deriveJobSource(req({ headers: { origin: "https://person.nodaro.ai" } })))
      .toEqual({ source: "web", sourceDetail: "person.nodaro.ai" })
    expect(deriveJobSource(req({ headers: { origin: "http://localhost:3000" } })))
      .toEqual({ source: "web", sourceDetail: "localhost:3000" })
  })

  it("falls back to api on an unparseable or null Origin rather than storing junk", () => {
    // `Origin: null` is what a sandboxed iframe / file:// page sends.
    expect(deriveJobSource(req({ headers: { origin: "null" } })).source).toBe("api")
    expect(deriveJobSource(req({ headers: { origin: "not a url" } })).source).toBe("api")
  })

  it("truncates an over-long detail instead of dropping it", () => {
    const long = "x".repeat(500)
    const d = deriveJobSource(req({ body: { mcp_client: long } })).sourceDetail
    expect(d).not.toBeNull()
    expect(d!.length).toBeLessThanOrEqual(80)
  })

  it("only ever emits a value from the declared vocabulary", () => {
    const cases = [
      req(),
      req({ isInternalCall: true }),
      req({ body: { mcp_client: "X" } }),
      req({ headers: { origin: "https://a.b" } }),
      req({ headers: { origin: "chrome-extension://abcdef" } }),
      req({ headers: { "x-nodaro-client": "cli/1" } }),
      req({ appAuthorization: { appId: "a", authorizationId: "b", scopes: [] } }),
    ]
    for (const c of cases) {
      expect(JOB_SOURCES).toContain(deriveJobSource(c).source)
    }
  })
})

describe("jobSourceColumns", () => {
  it("maps onto the real column names", () => {
    expect(jobSourceColumns(req({ headers: { origin: "https://studio.nodaro.ai" } })))
      .toEqual({ source: "web", source_detail: "studio.nodaro.ai" })
  })

  it("emits source_detail: null rather than omitting the key", () => {
    // The column exists; writing undefined would leave a stale value in place
    // on any future upsert path.
    const cols = jobSourceColumns(req())
    expect("source_detail" in cols).toBe(true)
    expect(cols.source_detail).toBeNull()
  })
})
