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
