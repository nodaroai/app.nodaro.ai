import { PICKER_CATALOGS, getPickerCatalog } from "./picker-catalogs.js"
import { getRegisteredCatalogPacks, catalogPacksVersion } from "./catalog-packs.js"

/**
 * THE WALL: refuse work that names a catalog id this deployment does not
 * offer.
 *
 * A curated deployment composes its picker catalogs from packs — entries
 * removed, some rewritten. The browser is supposed to show only the composed
 * catalogs and the resolvers are supposed to honor them, but neither of those
 * is a SAFETY property: a stale tab, an imported workflow, a hand-made request
 * or a bug in either layer can still hand the run path an id the deployment
 * never offered. This module is what makes curation hold regardless — it is
 * consulted at the one place every run passes (the orchestrator, after input
 * overrides are merged), inside nested sub-workflows, and on the single-node
 * routes that carry ids on the wire.
 *
 * INERT WITHOUT PACKS. A deployment that registers no catalog packs offers
 * every base id, so there is nothing to refuse; the guard returns [] without
 * walking. Mainline behavior is unchanged by construction.
 *
 * WHAT COUNTS AS AN ID FIELD. Every field a picker catalog declares — a
 * single-dim catalog's `valueField`, a multi-dim catalog's `dimensions[].field`
 * — plus the few resolver side-fields the catalogs do not declare (the pose
 * sub-picks, the legacy direction keys). A field NOT in that table is never
 * validated: `preText`, `customText`, `customAge`, free-text notes and the
 * like are not ids and must not be refused. The table is derived from the
 * BASE catalogs, so a field a `replace` pack dropped is still recognised as an
 * id field and any value in it fails membership — which is the point.
 */

export interface ForeignCatalogId {
  /** The node carrying the id (undefined for a request body). */
  readonly nodeId?: string
  readonly nodeType: string
  readonly field: string
  readonly id: string
  readonly catalogId: string
}

/** Node-data fields that resolve against a catalog but are not declared by
 *  it. Kept beside the guard so a new one is a one-line, reviewed addition. */
const SIDE_FIELDS: ReadonlyArray<readonly [nodeType: string, field: string, catalogId: string]> = [
  // pose.ts resolves all four sub-picks through getPosePromptHint
  ["pose", "handPosition", "pose"],
  ["pose", "bodyLean", "pose"],
  ["pose", "headTilt", "pose"],
  ["pose", "activity", "pose"],
]

/** Legacy `direction` wire keys still accepted by direction-registry.ts. */
const DIRECTION_ALIASES: Readonly<Record<string, string>> = {
  framingId: "framing",
  framingAngleId: "framing",
  lightingId: "lighting",
  lensId: "lens",
  cameraFormatId: "camera-format",
}

interface FieldTable {
  /** nodeType → (field → catalogId) */
  readonly byNodeType: ReadonlyMap<string, ReadonlyMap<string, string>>
  /** field → catalogId, across every catalog (for direction/subject bodies) */
  readonly byField: ReadonlyMap<string, string>
}

let tableMemo: FieldTable | null = null
/** Derived from the BASE catalogs once — the field contract is code, not packs. */
function fieldTable(): FieldTable {
  if (tableMemo) return tableMemo
  const byNodeType = new Map<string, Map<string, string>>()
  const byField = new Map<string, string>()
  const put = (nodeType: string, field: string, catalogId: string) => {
    let m = byNodeType.get(nodeType)
    if (!m) byNodeType.set(nodeType, (m = new Map()))
    m.set(field, catalogId)
    if (!byField.has(field)) byField.set(field, catalogId)
  }
  for (const c of PICKER_CATALOGS) {
    if (c.valueField) put(c.nodeType, c.valueField, c.catalogId)
    for (const d of c.dimensions ?? []) put(c.nodeType, d.field, c.catalogId)
    for (const f of c.fields ?? []) put(c.nodeType, f, c.catalogId)
  }
  for (const [nodeType, field, catalogId] of SIDE_FIELDS) put(nodeType, field, catalogId)
  for (const [alias, catalogId] of Object.entries(DIRECTION_ALIASES)) if (!byField.has(alias)) byField.set(alias, catalogId)
  tableMemo = { byNodeType, byField }
  return tableMemo
}

let idsMemo: { v: number; byCatalog: Map<string, ReadonlySet<string>> } | null = null
/** Every id the COMPOSED catalog offers, across options and all dimensions. */
function composedIds(catalogId: string): ReadonlySet<string> {
  const v = catalogPacksVersion()
  if (!idsMemo || idsMemo.v !== v) idsMemo = { v, byCatalog: new Map() }
  const hit = idsMemo.byCatalog.get(catalogId)
  if (hit) return hit
  const cat = getPickerCatalog(catalogId)
  const ids = new Set<string>()
  for (const o of cat?.options ?? []) ids.add(o.id)
  for (const d of cat?.dimensions ?? []) for (const o of d.options) ids.add(o.id)
  idsMemo.byCatalog.set(catalogId, ids)
  return ids
}

function values(v: unknown): string[] {
  if (typeof v === "string") return v ? [v] : []
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string" && x.length > 0)
  return []
}

/** The guard is only meaningful once something curates. */
export function catalogGuardActive(): boolean {
  return getRegisteredCatalogPacks().length > 0
}

function checkRecord(
  nodeType: string,
  nodeId: string | undefined,
  data: Record<string, unknown>,
  fields: ReadonlyMap<string, string>,
  out: ForeignCatalogId[],
): void {
  for (const [field, catalogId] of fields) {
    const raw = data[field]
    if (raw === undefined || raw === null) continue
    const offered = composedIds(catalogId)
    for (const id of values(raw)) {
      if (!offered.has(id)) out.push({ nodeId, nodeType, field, id, catalogId })
    }
  }
}

/**
 * Walk a graph. Parameter nodes are checked against their own catalog's
 * fields; consumer nodes (generate-image, image-to-video, …) carry folded
 * `direction` / `subject` records whose keys are the same field names, so
 * those are checked against the global field table.
 */
export function findForeignCatalogIds(
  nodes: ReadonlyArray<{ id?: unknown; type?: unknown; data?: unknown }> | undefined,
): ForeignCatalogId[] {
  if (!catalogGuardActive() || !nodes) return []
  const table = fieldTable()
  const out: ForeignCatalogId[] = []
  for (const node of nodes) {
    const type = typeof node.type === "string" ? node.type : ""
    const nodeId = typeof node.id === "string" ? node.id : undefined
    const data = node.data && typeof node.data === "object" ? (node.data as Record<string, unknown>) : null
    if (!type || !data) continue
    const own = table.byNodeType.get(type)
    if (own) checkRecord(type, nodeId, data, own, out)
    for (const key of ["direction", "subject"] as const) {
      const rec = data[key]
      if (rec && typeof rec === "object" && !Array.isArray(rec)) {
        checkRecord(type, nodeId, rec as Record<string, unknown>, table.byField, out)
      }
    }
  }
  return out
}

/** A request body's `direction` / `subject` records (the single-node routes). */
export function findForeignCatalogIdsInBody(
  nodeType: string,
  body: { direction?: unknown; subject?: unknown } | undefined,
): ForeignCatalogId[] {
  if (!catalogGuardActive() || !body) return []
  const table = fieldTable()
  const out: ForeignCatalogId[] = []
  for (const key of ["direction", "subject"] as const) {
    const rec = body[key]
    if (rec && typeof rec === "object" && !Array.isArray(rec)) {
      checkRecord(nodeType, undefined, rec as Record<string, unknown>, table.byField, out)
    }
  }
  return out
}

/** One line, naming every offender — the audit trail and the user message. */
export function foreignCatalogIdMessage(found: readonly ForeignCatalogId[]): string {
  const parts = [...new Set(found.map((f) => `${f.field}="${f.id}"`))]
  return `This deployment does not offer the following picker value${parts.length === 1 ? "" : "s"}: ${parts.join(", ")}. Choose from the options shown in the picker.`
}

/** Test hook. */
export function __resetCatalogIdGuardForTests(): void {
  tableMemo = null
  idsMemo = null
}
