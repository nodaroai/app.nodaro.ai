/**
 * Dev tool — fetch a fal.ai model's metadata + input schema from the PUBLIC
 * models API (no FAL_KEY needed). Use it when wiring a new fal endpoint to learn
 * the exact input field names, types, and which are required, instead of
 * guessing from the playground.
 *
 * The endpoint returns an OpenAPI 3.0 doc; we surface the model metadata
 * (display name, category, status) and the `*Input` schema's properties.
 *
 * Usage:
 *   cd backend && npx tsx scripts/fetch-fal-schema.ts <endpoint-slug>
 * Example:
 *   cd backend && npx tsx scripts/fetch-fal-schema.ts fal-ai/sync-lipsync/v3
 */

interface OpenApiSchema {
  type?: string
  properties?: Record<string, unknown>
  required?: string[]
  anyOf?: unknown[]
  $ref?: string
  description?: string
  default?: unknown
  enum?: unknown[]
}

interface ModelEntry {
  endpoint_id?: string
  metadata?: Record<string, unknown>
  openapi?: {
    components?: { schemas?: Record<string, OpenApiSchema> }
  }
}

interface ModelsResponse {
  models?: ModelEntry[]
}

const FAL_MODELS_API = "https://api.fal.ai/v1/models"

/** Compact, human-readable type label for a single OpenAPI property schema. */
function describeType(def: unknown): string {
  if (!def || typeof def !== "object") return String(def)
  const d = def as OpenApiSchema
  if (typeof d.type === "string") return d.type
  if (d.$ref) return `ref(${d.$ref.split("/").pop()})`
  if (Array.isArray(d.anyOf)) {
    return d.anyOf.map((m) => describeType(m)).join(" | ")
  }
  return "object"
}

async function main(): Promise<void> {
  const slug = process.argv[2]
  if (!slug) {
    console.error(
      "Usage: npx tsx scripts/fetch-fal-schema.ts <endpoint-slug>\n" +
        "  e.g. npx tsx scripts/fetch-fal-schema.ts fal-ai/sync-lipsync/v3",
    )
    process.exit(1)
  }

  const url = `${FAL_MODELS_API}?endpoint_id=${encodeURIComponent(slug)}&expand=openapi-3.0`
  console.log(`Fetching ${url}\n`)

  const res = await fetch(url)
  if (!res.ok) {
    console.error(`Request failed: HTTP ${res.status} ${res.statusText}`)
    const body = await res.text().catch(() => "")
    if (body) console.error(body.slice(0, 500))
    process.exit(1)
  }

  const json = (await res.json()) as ModelsResponse
  const model = json.models?.[0]
  if (!model) {
    console.error(`No model found for endpoint_id="${slug}"`)
    process.exit(1)
  }

  // --- Model metadata ---
  console.log("=".repeat(70))
  console.log(`MODEL: ${model.endpoint_id ?? slug}`)
  console.log("=".repeat(70))
  const meta = model.metadata ?? {}
  for (const key of ["display_name", "category", "status", "description", "kind", "license_type"]) {
    if (meta[key] != null) console.log(`  ${key}: ${String(meta[key])}`)
  }

  // --- Input schema ---
  const schemas = model.openapi?.components?.schemas ?? {}
  const inputKey = Object.keys(schemas).find((k) => k.toLowerCase().endsWith("input"))
  console.log()
  if (!inputKey) {
    console.log("No *Input schema found in the OpenAPI doc.")
    console.log("Available schemas:", Object.keys(schemas).join(", ") || "(none)")
    return
  }

  const inputSchema = schemas[inputKey]
  const props = inputSchema.properties ?? {}
  const required = new Set(inputSchema.required ?? [])

  console.log("-".repeat(70))
  console.log(`INPUT SCHEMA: ${inputKey}`)
  console.log("-".repeat(70))
  const propNames = Object.keys(props)
  if (propNames.length === 0) {
    console.log("  (no properties)")
  }
  for (const name of propNames) {
    const def = props[name] as OpenApiSchema
    const flag = required.has(name) ? "required" : "optional"
    const type = describeType(def)
    let line = `  ${name}: ${type}  [${flag}]`
    if (def.default !== undefined) line += `  default=${JSON.stringify(def.default)}`
    console.log(line)
    if (def.description) console.log(`      ${String(def.description).split("\n")[0]}`)
    if (Array.isArray(def.enum)) console.log(`      enum: ${def.enum.map((e) => JSON.stringify(e)).join(", ")}`)
  }
}

main().catch((err) => {
  console.error("fetch-fal-schema failed:", err instanceof Error ? err.message : err)
  process.exit(1)
})
