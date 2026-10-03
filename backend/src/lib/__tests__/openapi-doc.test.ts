import { describe, it, expect } from "vitest"
// Route modules register their paths at import time (core) or at route
// registration (ee — imported directly here to exercise those too).
import "../../routes/jobs.js"
import "../../routes/workflows.js"
import "../../routes/workflow-execution.js"
import "../../routes/nodes.js"
import "../../routes/oauth.js"
import "../../routes/generate-image.js"
import "../../routes/generate-video.js"
import { generateOpenApiDoc } from "../openapi-registry.js"
import { isAnonymousRoute } from "../../middleware/auth.js"

// Pins the SDK-parity surface of the public OpenAPI spec. A route rename or
// a dropped registration fails here before polyglot codegen users notice.
describe("OpenAPI document", () => {
  const doc = generateOpenApiDoc() as { openapi: string; paths: Record<string, unknown> }

  it("is OpenAPI 3.1 and generates without throwing", () => {
    expect(doc.openapi).toBe("3.1.0")
  })

  it.each([
    "/v1/jobs/{id}",
    "/v1/jobs/{id}/status",
    "/v1/nodes",
    "/v1/nodes/{type}",
    "/v1/generate-image",
    "/v1/generate-video",
    "/v1/oauth/token",
    "/v1/oauth/app-info",
  ])("includes %s", (p) => {
    expect(doc.paths[p]).toBeDefined()
  })
})

// The served document marks what the auth hook lets through with no credential
// `security: []`; everything else keeps the global bearer requirement. It used
// to claim a bearer for node discovery and the OAuth token exchange, whose own
// description says it takes none.
describe("OpenAPI security per operation", () => {
  type Op = { security?: unknown[] }
  const served = generateOpenApiDoc({ isAnonymous: isAnonymousRoute }) as unknown as { paths: Record<string, Record<string, Op>> }
  const op = (path: string, method: string) => served.paths[path]?.[method]

  it.each([
    ["/v1/nodes", "get"],
    ["/v1/nodes/{type}", "get"],
    ["/v1/oauth/token", "post"],
    ["/v1/oauth/app-info", "get"],
  ])("%s %s takes no credential", (path, method) => {
    expect(op(path, method)?.security).toEqual([])
  })

  it.each([
    ["/v1/jobs/{id}", "get"],
    ["/v1/generate-image", "post"],
    ["/v1/workflows/{id}/run", "post"],
  ])("%s %s keeps the bearer requirement", (path, method) => {
    const operation = op(path, method)
    expect(operation).toBeDefined()
    // Its own `[{ bearerAuth: [] }]`, or the document's global one.
    expect(operation?.security ?? [{ bearerAuth: [] }]).toEqual([{ bearerAuth: [] }])
  })

  it("a route the hook lets through that checks a bearer itself is not anonymous", () => {
    expect(isAnonymousRoute("POST", "/v1/api/run")).toBe(false)
    expect(isAnonymousRoute("POST", "/mcp")).toBe(false)
    expect(isAnonymousRoute("GET", "/v1/nodes")).toBe(true)
  })

  it("the bearer scheme does not claim every token is a JWT", () => {
    const doc = generateOpenApiDoc() as unknown as { components?: { securitySchemes?: Record<string, { bearerFormat?: string; description?: string }> } }
    const scheme = doc.components?.securitySchemes?.bearerAuth
    expect(scheme?.bearerFormat).toBeUndefined()
    expect(scheme?.description).toContain("ndr_app_")
  })
})
