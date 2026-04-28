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
  bearerFormat: "JWT",
  description: "Supabase user JWT, developer-app access token, or API token.",
})

export function generateOpenApiDoc() {
  const generator = new OpenApiGeneratorV31(openApiRegistry.definitions)
  return generator.generateDocument({
    openapi: "3.1.0",
    info: {
      title: "Nodaro API",
      version: "1.0.0",
      description:
        "AI workflow editor backend. See https://github.com/nodaroai/app.nodaro.ai for source.",
    },
    servers: [{ url: "/" }],
    security: [{ bearerAuth: [] }],
  })
}
