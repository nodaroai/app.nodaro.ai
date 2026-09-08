import { describe, it, expect, afterEach, vi } from "vitest"
import ts from "typescript"
import { readFileSync, readdirSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import {
  registerUploadPolicy,
  clearUploadPolicies,
  hasUploadPolicies,
  applyUploadPolicies,
  uploadKindFromMime,
  uploadBlockedBody,
  type UploadCheckInput,
} from "../upload-policy.js"

const INPUT: UploadCheckInput = {
  kind: "image",
  lane: "upload-image",
  mime: "image/png",
  sizeBytes: 12,
  userId: "u1",
  buffer: Buffer.from("not-a-real-png"),
}

afterEach(() => clearUploadPolicies())

describe("upload-policy seam — inert default, ordered, fail-closed", () => {
  it("no policy registered = allow (mainline byte-identical)", async () => {
    expect(hasUploadPolicies()).toBe(false)
    expect(await applyUploadPolicies(INPUT)).toEqual({ allow: true })
  })

  it("first deny wins, carries the reason and the denying policy id", async () => {
    const order: string[] = []
    registerUploadPolicy({ id: "a", check: () => (order.push("a"), { allow: true }) })
    registerUploadPolicy({ id: "b", check: () => (order.push("b"), { allow: false, reason: "nope" }) })
    registerUploadPolicy({ id: "c", check: () => (order.push("c"), { allow: true }) })
    const d = await applyUploadPolicies(INPUT)
    expect(d).toEqual({ allow: false, reason: "nope", policyId: "b" })
    expect(order).toEqual(["a", "b"]) // deny short-circuits — c never runs
  })

  it("a policy that THROWS denies, loudly (fail-closed: a registered gate wants a gate)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    registerUploadPolicy({ id: "boom", check: () => Promise.reject(new Error("moderation timeout")) })
    const d = await applyUploadPolicies(INPUT)
    expect(d.allow).toBe(false)
    expect(d.policyId).toBe("boom")
    expect(spy.mock.calls.some((c) => String(c[0]).includes("fail-closed"))).toBe(true)
    spy.mockRestore()
  })

  it("async allow flows through", async () => {
    registerUploadPolicy({ id: "ok", check: async () => ({ allow: true }) })
    expect((await applyUploadPolicies(INPUT)).allow).toBe(true)
  })

  it("kind mapping from mime", () => {
    expect(uploadKindFromMime("image/jpeg")).toBe("image")
    expect(uploadKindFromMime("video/mp4")).toBe("video")
    expect(uploadKindFromMime("audio/mpeg")).toBe("audio")
    expect(uploadKindFromMime("application/json")).toBe("json")
    expect(uploadKindFromMime("application/pdf")).toBe("other")
  })

  it("deny body: one uniform shape, user-safe fallback message", () => {
    expect(uploadBlockedBody({ allow: false, reason: "modesty" }).error).toEqual({
      code: "upload_blocked",
      message: "modesty",
    })
    expect(uploadBlockedBody({ allow: false }).error.message).toContain("not allowed")
  })
})

// Most files cannot contain this decoded literal. Escapes always take the full
// parser path, preserving AST semantics around regexes and template expressions.
function importsPresigner(text: string): boolean {
  if (!text.includes("s3-request-presigner") && !text.includes("\\")) return false
  const source = ts.createSourceFile("scan.ts", text, ts.ScriptTarget.Latest, false)
  let found = false
  const inspect = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node) && node.text.includes("s3-request-presigner")) found = true
    if (!found) ts.forEachChild(node, inspect)
  }
  inspect(source)
  return found
}

/**
 * Totality half (mirrors prompt-policy-totality): every lane where upload
 * bytes flow through this backend must ask the seam before writing. The MCP
 * prepare/request upload verbs mint /v1/upload-proxy and /v1/upload-page
 * URLs (never raw presigned R2 PUTs — grep guard below), so policing these
 * three route files covers every ingestion path.
 */
describe("upload-policy totality — every byte-carrying lane polices", () => {
  const HERE = dirname(fileURLToPath(import.meta.url))
  const SRC = resolve(HERE, "..", "..")

  it("the three ingestion route files call applyUploadPolicies", () => {
    for (const f of ["routes/upload.ts", "routes/upload-proxy.ts", "routes/upload-handoff.ts"]) {
      const src = readFileSync(resolve(SRC, f), "utf8")
      expect(src.includes("applyUploadPolicies("), `${f} never asks the upload policy`).toBe(true)
    }
    // /v1/upload has four endpoints — each polices (4 asks in upload.ts).
    const uploadSrc = readFileSync(resolve(SRC, "routes/upload.ts"), "utf8")
    expect(uploadSrc.split("applyUploadPolicies(").length - 1).toBeGreaterThanOrEqual(4)
  })

  it("the presigner scan preserves decoded literals, template expressions and comments", () => {
    expect(importsPresigner(String.raw`import { getSignedUrl } from "@aws-sdk/s3-request-\u0070resigner"`)).toBe(true)
    expect(importsPresigner('const loader = import(`@aws-sdk/s3-request-presigner`)')).toBe(true)
    expect(importsPresigner('const nested = `${import("@aws-sdk/s3-request-presigner")}`')).toBe(true)
    expect(importsPresigner('// @aws-sdk/s3-request-presigner\nconst other = "safe"')).toBe(false)
  })

  it("public ingestion cannot mint presigned PUTs; private build output has one scoped quarantine lane", () => {
    // If someone imports @aws-sdk/s3-request-presigner, bytes could go
    // browser→R2 directly and bypass every policed lane — that lane must then
    // either be dropped again or grow its own policing point. (The package
    // itself sits unused in package.json; the import is what opens the lane.)
    const offenders: string[] = []
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) {
          if (e.name !== "__tests__" && e.name !== "node_modules") walk(resolve(dir, e.name))
        } else if (e.name.endsWith(".ts")) {
          const file = resolve(dir, e.name)
          if (!importsPresigner(readFileSync(file, "utf8"))) continue
          // Trusted build outputs land in a separate private bucket. They have
          // no readable revision until receipt verification, and their signed
          // conditional PUT cannot replace an existing artifact. This is not
          // the browser/MCP ingestion lane protected by the checks above.
          if (file !== resolve(SRC, "lib/private-plugins/scene3d-upload-grants.ts")) offenders.push(file)
        }
      }
    }
    walk(SRC)
    expect(offenders, `presigner imported by: ${offenders.join(", ")}`).toEqual([])
  })
})
