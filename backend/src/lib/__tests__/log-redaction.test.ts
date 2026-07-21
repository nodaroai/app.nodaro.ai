import { describe, it, expect } from "vitest"
import Fastify from "fastify"
import { sanitizeLogUrl, requestLogSerializer } from "../log-redaction.js"

describe("sanitizeLogUrl", () => {
  it("redacts code, state and access_token values", () => {
    expect(sanitizeLogUrl("/v1/social/callback/instagram?code=AQD123&state=abc-def")).toBe(
      "/v1/social/callback/instagram?code=%5Bredacted%5D&state=%5Bredacted%5D",
    )
    expect(sanitizeLogUrl("/x?access_token=EAAG999")).toBe("/x?access_token=%5Bredacted%5D")
  })

  it("keeps non-sensitive params and their values", () => {
    const out = sanitizeLogUrl("/v1/social/callback/x?code=SECRET&error=access_denied")
    expect(out).toContain("error=access_denied")
    expect(out).not.toContain("SECRET")
  })

  it("returns URLs without sensitive params byte-identical (no re-encoding)", () => {
    const weird = "/v1/gallery?cursor=a%2Bb&limit=20"
    expect(sanitizeLogUrl(weird)).toBe(weird)
    expect(sanitizeLogUrl("/health")).toBe("/health")
  })

  it("is case-insensitive on the param name", () => {
    expect(sanitizeLogUrl("/cb?Code=SECRET")).not.toContain("SECRET")
  })
})

describe("requestLogSerializer", () => {
  it("mirrors Fastify's default req shape with a sanitized url", () => {
    const out = requestLogSerializer({
      method: "GET",
      url: "/v1/social/callback/instagram?code=SECRET",
      hostname: "app.nodaro.ai",
      ip: "1.2.3.4",
      socket: { remotePort: 55555 },
    })
    expect(out).toEqual({
      method: "GET",
      url: "/v1/social/callback/instagram?code=%5Bredacted%5D",
      hostname: "app.nodaro.ai",
      remoteAddress: "1.2.3.4",
      remotePort: 55555,
    })
  })
})

describe("end-to-end: Fastify request logging", () => {
  it("logs a /v1/social/callback hit without the code value", async () => {
    const lines: string[] = []
    const app = Fastify({
      logger: {
        // Same serializer wiring as buildApp() (app.ts), captured stream.
        serializers: { req: requestLogSerializer },
        stream: { write: (line: string) => void lines.push(line) },
      },
    })
    app.get("/v1/social/callback/:platform", async () => ({ ok: true }))

    await app.inject({
      method: "GET",
      url: "/v1/social/callback/instagram?code=AQDSECRETCODE123&state=SECRETSTATE456",
    })
    await app.close()

    const joined = lines.join("\n")
    // The request WAS logged, with the path visible…
    expect(joined).toContain("/v1/social/callback/instagram")
    // …but neither secret value survives anywhere in the log output.
    expect(joined).not.toContain("AQDSECRETCODE123")
    expect(joined).not.toContain("SECRETSTATE456")
    expect(joined).toContain("redacted")
  })
})
