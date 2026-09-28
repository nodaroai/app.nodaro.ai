import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
  extendZodWithOpenApi,
} from "@asteasolutions/zod-to-openapi"
import { z } from "zod"

// Enable .openapi() on every Zod schema in the codebase. Must run before any
// `registerPath` call references a schema, so we do it at import time here.
extendZodWithOpenApi(z)

export const openApiRegistry = new OpenAPIRegistry()

openApiRegistry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  // No bearerFormat: most of these tokens are opaque, not JWTs.
  description:
    "`Authorization: Bearer <token>`, where the token is one of: a signed-in session's Supabase JWT; " +
    "a personal API token (`ndr_…`); a developer app's OAuth access token (`ndr_app_…`, limited to the " +
    "scopes the user granted); or a billing key (`ndr_bill_…`). Operations marked `security: []` take none.",
})

type OpenApiOperation = Record<string, unknown>

/** Marks every operation that takes no credential `security: []` — the
 *  document's global requirement would otherwise claim a bearer for it. */
function markAnonymousOperations(
  paths: Record<string, Record<string, OpenApiOperation>>,
  isAnonymous: (method: string, path: string) => boolean,
): Record<string, Record<string, OpenApiOperation>> {
  return Object.fromEntries(
    Object.entries(paths).map(([path, operations]) => {
      // A template's parameters stand in as a literal segment for matching.
      const concrete = path.replace(/\{[^}]+\}/g, "x")
      return [
        path,
        Object.fromEntries(
          Object.entries(operations).map(([method, operation]) => [
            method,
            isAnonymous(method.toUpperCase(), concrete) ? { ...operation, security: [] } : operation,
          ]),
        ),
      ]
    }),
  )
}

/**
 * `isAnonymous` is the auth hook's own answer (`middleware/auth.ts ::
 * isAnonymousRoute`), passed in rather than imported so this module stays a
 * leaf that every route file can load.
 */
export function generateOpenApiDoc(opts: { isAnonymous?: (method: string, path: string) => boolean } = {}) {
  const generator = new OpenApiGeneratorV31(openApiRegistry.definitions)
  const doc = generator.generateDocument({
    openapi: "3.1.0",
    info: {
      title: "Nodaro API",
      version: "1.0.0",
      description:
        "AI workflow editor backend. NOTE: this machine-readable spec is a " +
        "curated subset — only the core automation endpoints (workflow run, " +
        "job status, node discovery, OAuth token exchange) are registered here. It is NOT a complete " +
        "description of every route; see docs/api-integration.md for the full " +
        "REST reference. Source: https://github.com/nodaroai/app.nodaro.ai",
    },
    servers: [{ url: "/" }],
    security: [{ bearerAuth: [] }],
  })
  if (!opts.isAnonymous) return doc
  const paths = (doc.paths ?? {}) as Record<string, Record<string, OpenApiOperation>>
  return { ...doc, paths: markAnonymousOperations(paths, opts.isAnonymous) as typeof doc.paths }
}
