/**
 * Normalize an app or component's input schema into a flat,
 * LLM-readable shape.
 *
 * Apps and components both ultimately accept inputs via
 * `inputOverrides: Record<nodeId, Record<fieldKey, value>>` — but that
 * shape leaks node-id implementation details to the LLM. Instead we
 * surface a flat keyed schema to `get_app_inputs` / `get_component_inputs`
 * and translate flat → nested at run time.
 *
 *   LLM sees:    { product_image: "https://...", tone: "energetic" }
 *   Server uses: { "node-1": { url: "https://..." }, "node-2": { tone: "energetic" } }
 *
 * Two source-of-truth shapes feed this:
 *  - Apps: `presentationSettings.inputItems` (PresentationItem[]) +
 *    `snapshot_nodes` (need to look up node type → field key + io type).
 *  - Components: `component_metadata.inputs` (already typed; pre-tagged
 *    with handle.id, handle.fieldKey, handle.type, handle.required).
 *
 * Both produce the same NormalizedInputSchema so the run_* tools can use
 * one translation function.
 */
import type { ComponentMetadata, PresentationItem } from "@nodaro/shared"
import { migrateToItems } from "@nodaro/shared"
import { sanitizeSlug } from "./slug-sanitizer.js"

/** Public schema entry surfaced to the LLM. No node-id leak. */
export interface NormalizedInputField {
  /** Short, slug-style key the LLM passes in `inputs` */
  readonly key: string
  /** Human-readable label (taken from the node label or field name) */
  readonly label: string
  /** Coarse type hint so the LLM knows what kind of value to pass */
  readonly type: "image" | "video" | "audio" | "text" | "select" | "number" | "boolean" | "list"
  readonly required: boolean
  /** When type=select: enum of allowed values (string|number|boolean) */
  readonly options?: ReadonlyArray<string | number | boolean>
  /** Human description if we have one */
  readonly description?: string
}

/** Internal mapping for translating flat inputs → nested inputOverrides. */
export interface InputKeyMap {
  readonly [key: string]: { readonly nodeId: string; readonly fieldKey: string }
}

export interface NormalizedInputSchema {
  readonly fields: ReadonlyArray<NormalizedInputField>
  readonly keyMap: InputKeyMap
}

// Subset of node types whose presentationItems we know how to surface as
// node-level inputs. Each entry maps the node type → (write field, io type).
// For node types not in the table, we fall back to a generic text field.
const NODE_TYPE_INFO: Record<
  string,
  { fieldKey: string; type: NormalizedInputField["type"] }
> = {
  "text-prompt": { fieldKey: "text", type: "text" },
  "upload-image": { fieldKey: "url", type: "image" },
  "upload-video": { fieldKey: "url", type: "video" },
  "upload-audio": { fieldKey: "url", type: "audio" },
  list: { fieldKey: "items", type: "list" },
  // Phase 2 #4 — locations are app-input-parameterized via a `selectedVariant`
  // string in the form `"<bucket>/<variant>"` (e.g. `"weather/rain"`,
  // `"timeOfDay/night"`, `"lighting/neon"`). The orchestrator's override-
  // application step looks up the variant in the location's asset buckets
  // and replaces `sourceImageUrl` with the matching URL so all downstream
  // consumers (both legacy sourceImageUrl readers and the Phase 2 #2
  // ConnectedReference flow) see the variant as canonical.
  //
  // The field is typed as plain text rather than `select` because the
  // valid variants depend on which assets the publisher has generated for
  // that location — and that set may differ per app version. App callers
  // can introspect via `get_app_inputs` (the description hints at the
  // expected shape) and pick a variant they know exists.
  location: { fieldKey: "selectedVariant", type: "text" },
}

type InputPresentationItem = Extract<PresentationItem, { type: "node" | "field" }>

/** Walk presentationItems, flattening groups + dropping non-input items. */
function flattenInputItems(
  items: ReadonlyArray<PresentationItem>,
): InputPresentationItem[] {
  const out: InputPresentationItem[] = []
  for (const item of items) {
    if (item.type === "group") {
      out.push(...flattenInputItems(item.items))
    } else if (item.type === "node" || item.type === "field") {
      out.push(item)
    }
    // Skip output, richtext (no value to surface).
  }
  return out
}

/** Make a key collision-safe within the schema. */
function uniqueKey(seen: Set<string>, base: string, fallback: string): string {
  const root = sanitizeSlug(base) || sanitizeSlug(fallback) || "input"
  if (!seen.has(root)) {
    seen.add(root)
    return root
  }
  let i = 2
  while (seen.has(`${root}_${i}`)) i++
  const k = `${root}_${i}`
  seen.add(k)
  return k
}

interface ExtractFromAppArgs {
  readonly snapshotSettings: Record<string, unknown> | null | undefined
  readonly snapshotNodes:
    | ReadonlyArray<{ id: string; type?: string; data?: Record<string, unknown> }>
    | null
    | undefined
}

/** Build a normalized schema for an app from its snapshot. */
export function extractAppInputSchema({
  snapshotSettings,
  snapshotNodes,
}: ExtractFromAppArgs): NormalizedInputSchema {
  // Apps store presentation in one of two shapes:
  //  - Modern: presentationSettings.inputItems (PresentationItem[])
  //  - Legacy: presentationSettings.inputOrder (string[] of node-ids)
  // The frontend migrates legacy → modern at render time via
  // resolveInputItems(); we mirror that fallback here so older apps
  // (Zebrify and friends) still surface their inputs to the LLM
  // instead of returning an empty schema.
  const presSettings = (snapshotSettings ?? {}) as {
    presentationSettings?: {
      inputItems?: PresentationItem[]
      inputOrder?: string[]
    }
  }
  let items =
    presSettings.presentationSettings?.inputItems ??
    migrateToItems(presSettings.presentationSettings?.inputOrder)
  // Deepest fallback: app has no presentationSettings at all (e.g. apps
  // published before the presentation system existed, or apps that just
  // expose every source node by default — like "Zebrify" which has a
  // single upload-image node as its only input). Auto-derive: every
  // source-type node in the workflow becomes an implicit input. The
  // frontend's app-runner does the same when settings.inputItems is
  // empty, so this matches how users see the app today.
  if (!items?.length && snapshotNodes?.length) {
    items = snapshotNodes
      .filter((n) => n.type && NODE_TYPE_INFO[n.type])
      .map((n) => ({ type: "node" as const, nodeId: n.id }))
  }
  if (!items?.length) return { fields: [], keyMap: {} }

  const nodesById = new Map<
    string,
    { type?: string; data?: Record<string, unknown> }
  >()
  for (const n of snapshotNodes ?? []) {
    nodesById.set(n.id, { type: n.type, data: n.data })
  }

  const seen = new Set<string>()
  const fields: NormalizedInputField[] = []
  const keyMap: Record<string, { nodeId: string; fieldKey: string }> = {}

  for (const item of flattenInputItems(items)) {
    if (item.type === "node") {
      const node = nodesById.get(item.nodeId)
      const info = node?.type ? NODE_TYPE_INFO[node.type] : undefined
      // Unknown node types fall back to free-form text on a "value" field.
      const fieldKey = info?.fieldKey ?? "value"
      const type = info?.type ?? "text"
      const label =
        (node?.data?.label as string | undefined) ?? node?.type ?? item.nodeId
      const key = uniqueKey(seen, label, item.nodeId)
      fields.push({ key, label, type, required: type !== "text" })
      keyMap[key] = { nodeId: item.nodeId, fieldKey }
    } else {
      // type === "field"
      const node = nodesById.get(item.nodeId)
      const label =
        (node?.data?.label as string | undefined) ?? `${item.nodeId}.${item.field}`
      const key = uniqueKey(seen, `${label}_${item.field}`, `${item.nodeId}_${item.field}`)
      const type: NormalizedInputField["type"] = item.allowedValues ? "select" : "text"
      const field: NormalizedInputField = {
        key,
        label: `${label}: ${item.field}`,
        type,
        required: false,
        ...(item.allowedValues ? { options: item.allowedValues } : {}),
      }
      fields.push(field)
      keyMap[key] = { nodeId: item.nodeId, fieldKey: item.field }
    }
  }

  return { fields, keyMap }
}

/** Build a normalized schema for a component from its component_metadata. */
export function extractComponentInputSchema(
  metadata: ComponentMetadata | null | undefined,
): NormalizedInputSchema {
  if (!metadata?.inputs?.length) return { fields: [], keyMap: {} }
  const seen = new Set<string>()
  const fields: NormalizedInputField[] = []
  const keyMap: Record<string, { nodeId: string; fieldKey: string }> = {}
  for (const handle of metadata.inputs) {
    const key = uniqueKey(seen, handle.name, handle.id)
    const type: NormalizedInputField["type"] =
      handle.type === "image" || handle.type === "video" || handle.type === "audio"
        ? handle.type
        : "text"
    fields.push({
      key,
      label: handle.name,
      type,
      required: !!handle.required,
    })
    keyMap[key] = { nodeId: handle.id, fieldKey: handle.fieldKey }
  }
  return { fields, keyMap }
}

/**
 * Translate the LLM's flat `inputs` into the nested `inputOverrides`
 * shape `/v1/app/:slug/run` and `/v1/component/execute` accept.
 * Unknown keys are silently dropped — schema mismatch shouldn't bring
 * down the run.
 */
export function flatInputsToOverrides(
  flat: Record<string, unknown> | undefined,
  keyMap: InputKeyMap,
): Record<string, Record<string, unknown>> | undefined {
  if (!flat) return undefined
  const overrides: Record<string, Record<string, unknown>> = {}
  for (const [key, value] of Object.entries(flat)) {
    const target = keyMap[key]
    if (!target || value === undefined || value === null) continue
    overrides[target.nodeId] = {
      ...overrides[target.nodeId],
      [target.fieldKey]: value,
    }
  }
  return Object.keys(overrides).length ? overrides : undefined
}
