/**
 * The way in of a request (lib/import-via.ts) comes from how the auth hook
 * signed it in: a session, a key, a connected app, or an agent's internal
 * request naming itself in the header — which an outside caller cannot do.
 */
import { describe, it, expect } from "vitest"
import { IMPORT_VIA_HEADER, importViaOf, parseImportVia } from "../import-via.js"

function req(authKind: string | undefined, headers: Record<string, string | string[]> = {}) {
  return { authKind, headers } as Parameters<typeof importViaOf>[0]
}

describe("parseImportVia", () => {
  it("accepts the four ways in and nothing else", () => {
    expect(parseImportVia("session")).toBe("session")
    expect(parseImportVia("api")).toBe("api")
    expect(parseImportVia("app")).toBe("app")
    expect(parseImportVia("mcp")).toBe("mcp")
    expect(parseImportVia("admin")).toBeNull()
    expect(parseImportVia("")).toBeNull()
    expect(parseImportVia(undefined)).toBeNull()
    expect(parseImportVia(7)).toBeNull()
  })
})

describe("importViaOf", () => {
  it("reads the auth kind: a session, a personal or billing key, a connected app", () => {
    expect(importViaOf(req("jwt"))).toBe("session")
    expect(importViaOf(req("api_token"))).toBe("api")
    expect(importViaOf(req("billing_key"))).toBe("api")
    expect(importViaOf(req("app_token"))).toBe("app")
  })

  it("an internal request names its way in with the header; one that names none has none", () => {
    expect(importViaOf(req("internal", { [IMPORT_VIA_HEADER]: "mcp" }))).toBe("mcp")
    expect(importViaOf(req("internal", { [IMPORT_VIA_HEADER]: "api" }))).toBe("api")
    expect(importViaOf(req("internal", { [IMPORT_VIA_HEADER]: ["session", "mcp"] }))).toBe("session")
    expect(importViaOf(req("internal", { [IMPORT_VIA_HEADER]: "bogus" }))).toBeNull()
    expect(importViaOf(req("internal"))).toBeNull()
  })

  it("the header is read on the internal lane only: a session or a key cannot name another way in", () => {
    expect(importViaOf(req("jwt", { [IMPORT_VIA_HEADER]: "mcp" }))).toBe("session")
    expect(importViaOf(req("api_token", { [IMPORT_VIA_HEADER]: "session" }))).toBe("api")
    expect(importViaOf(req(undefined, { [IMPORT_VIA_HEADER]: "mcp" }))).toBeNull()
  })
})
