import { injectUpstream } from "./inject-upstream.js"

/**
 * Resolve fieldMappings + {} injection for all text fields on a node.
 *
 * Two resolution mechanisms:
 *   1. fieldMappings: field mapped to source node → use that node's output
 *   2. {} injection: manual field contains {} → replace with upstreamText
 *
 * Does NOT inject upstream into empty unmapped fields — that stays in
 * per-node execution code (e.g., d.prompt || inputs.prompt).
 *
 * The `getSourceOutput` callback abstracts how source node output is
 * extracted — frontend reads from live React Flow state, backend reads
 * from NodeExecutionState.output. Same pattern as ancestor-refs.ts.
 */
export function resolveFieldMappings(
  data: Record<string, unknown>,
  upstreamText: string | undefined,
  mappableFieldNames: ReadonlyArray<string>,
  getSourceOutput: (sourceNodeId: string) => string | undefined,
): Record<string, unknown> {
  const fm = data.fieldMappings as Record<string, { sourceNodeId: string }> | undefined
  const resolved = { ...data }

  for (const field of mappableFieldNames) {
    const mapping = fm?.[field]

    if (mapping?.sourceNodeId) {
      const output = getSourceOutput(mapping.sourceNodeId)
      if (output != null) resolved[field] = output
    } else {
      const current = resolved[field]
      if (typeof current === "string") {
        const injected = injectUpstream(current, upstreamText)
        if (injected !== current) resolved[field] = injected
      }
    }
  }

  return resolved
}

/**
 * Location buckets that may carry generated/uploaded variants. Mirrors the
 * full set of attachable buckets in `entity-prompts.ts::LOCATION_ATTACH_COLUMNS`,
 * but in camelCase (matching the in-memory location object and the
 * `WorkflowExportLocation` export shape).
 */
const LOCATION_BUCKETS = [
  "timeOfDay",
  "weather",
  "seasons",
  "angles",
  "lighting",
  "atmosphereMotions",
] as const

interface LocationFieldEntry {
  /** Stable key — `sourceImageUrl` or `<bucket>[<index>]`. */
  key: string
  /** Human-readable label — `Main image` or `<bucket> / <variant.name>`. */
  label: string
  /** R2 URL of the image. */
  url: string
}

/**
 * Flatten a location's anchor image and every variant bucket into a single
 * ordered list of `{ key, label, url }` entries. Used by picker UIs and
 * ref-resolvers that need a stable, position-keyed view of every image
 * attached to a location.
 *
 * Bucket iteration order is fixed (see `LOCATION_BUCKETS`) so frontend and
 * backend produce identical lists from the same fixture. Missing buckets and
 * non-array values are treated as empty — the helper never throws.
 *
 * Mirrors the future character/object variants of this helper; same shape
 * (`key`, `label`, `url`) so callers can be polymorphic over entity kind.
 */
export function resolveLocationFields(
  loc: Record<string, unknown>,
): LocationFieldEntry[] {
  const out: LocationFieldEntry[] = []

  if (typeof loc.sourceImageUrl === "string" && loc.sourceImageUrl.length > 0) {
    out.push({
      key: "sourceImageUrl",
      label: "Main image",
      url: loc.sourceImageUrl,
    })
  }

  for (const bucket of LOCATION_BUCKETS) {
    const raw = loc[bucket]
    if (!Array.isArray(raw)) continue
    raw.forEach((item, i) => {
      if (!item || typeof item !== "object") return
      const variant = item as { name?: unknown; url?: unknown }
      if (typeof variant.url !== "string" || variant.url.length === 0) return
      const name = typeof variant.name === "string" ? variant.name : ""
      out.push({
        key: `${bucket}[${i}]`,
        label: `${bucket} / ${name}`,
        url: variant.url,
      })
    })
  }

  return out
}
