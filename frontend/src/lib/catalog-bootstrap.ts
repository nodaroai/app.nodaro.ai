import { PICKER_CATALOGS, PEOPLE, registerCatalogPack, resetCatalogPacks, type PickerCatalogInput } from "@nodaro/prompts"

/**
 * Bring the deployment's CURATED catalogs into the browser.
 *
 * The bundle ships the stock catalogs. A deployment's overlay registers
 * catalog packs — in the BACKEND process. The browser's copy of the registry
 * knew nothing about them, so every picker, and every presentation-mode card
 * on the anonymous /app, /present and /embed routes, showed the stock entries
 * on a deployment that had curated them away. This fetches the composed
 * result (`GET /v1/catalogs?detail=full`, public) and registers each catalog
 * as a `replace` pack, so the registry-aware pickers and the run-path
 * resolvers in this process see exactly what the server sees.
 *
 * NOT AWAITED BY THE RENDER. First paint never waits on the network: the
 * registry publishes to `subscribeCatalogPacks`, every picker reads through
 * `useCuratedEntries`, and the presentation cards subscribe too, so a
 * registration landing after mount re-renders exactly the lists it changes.
 * On a curated deployment the fetch usually lands before the user has opened
 * a config panel at all.
 *
 * SAFETY DOES NOT DEPEND ON THIS. The server refuses any id the deployment
 * does not offer at every run lane (packages/prompts catalog-id-guard). This
 * is the display truth; that is the wall. So the bootstrap fails OPEN on a
 * network error or a timeout and logs loudly.
 *
 * `curated: false` arrives WITHOUT a body (the route omits the projection
 * when it has nothing to say), so a deployment with no packs pays a few
 * cached bytes per page load and registers nothing.
 */

interface CatalogsResponse {
  data?: unknown
  curated?: boolean
  packs?: number
  version?: number
}

let bootstrapped: Promise<void> | null = null
let registeredVersion: number | null = null

/** Which server catalogs this bundle can accept — a newer server may know a
 *  catalog this bundle does not, and `composePickerCatalogs` throws on an
 *  unknown id. */
const KNOWN = new Set(PICKER_CATALOGS.map((c) => c.catalogId))

export function applyServerCatalogs(payload: CatalogsResponse): number {
  if (!payload.curated) return 0
  const list = Array.isArray(payload.data) ? (payload.data as PickerCatalogInput[]) : []
  // Idempotent under StrictMode / HMR / a later refetch: a duplicate pack id
  // throws, so start from a clean slate every time this applies.
  resetCatalogPacks()
  let n = 0
  for (const cat of list) {
    if (!cat || typeof cat !== "object" || !KNOWN.has(cat.catalogId)) continue
    if (cat.catalogId === "person") {
      registerPersonFromWire(cat)
    } else {
      registerCatalogPack({ id: `wire:${cat.catalogId}`, catalogId: cat.catalogId, mode: "replace", catalog: cat })
    }
    n++
  }
  registeredVersion = typeof payload.version === "number" ? payload.version : 0
  return n
}

/**
 * `person` is the one catalog whose picker reads REBUILT entries from the
 * registry (`getRegisteredPeople`) rather than overlaying a bundled list. A
 * `replace` pack would rebuild every person from the wire projection, which
 * carries no `group` and no `shortLabel` — the picker's ethnicity / hair /
 * skin sections would collapse into "Other" with long labels, on any
 * deployment that curates anything at all. So person is expressed as what
 * a curation IS: a `deny` of the bundled ids the server no longer offers
 * (bundled entries keep every picker-only field), plus an `extend` for the
 * ids the server offers that the bundle lacks. A REWRITE of a bundled person
 * entry does not round-trip this way — accepted; no deployment rewrites
 * person today, and the run path resolves person server-side regardless.
 */
function registerPersonFromWire(cat: PickerCatalogInput): void {
  type Dim = NonNullable<PickerCatalogInput["dimensions"]>[number]
  type Opt = Dim["options"][number]
  const bundled = new Set(PEOPLE.map((p) => p.id))
  const offered = new Set<string>()
  const addedByField = new Map<string, { label: string; options: Opt[] }>()
  for (const d of cat.dimensions ?? []) {
    for (const o of d.options) {
      offered.add(o.id)
      if (bundled.has(o.id)) continue
      const slot = addedByField.get(d.field) ?? { label: d.label, options: [] }
      slot.options.push(o)
      addedByField.set(d.field, slot)
    }
  }
  const denyIds = PEOPLE.filter((p) => !offered.has(p.id)).map((p) => p.id)
  if (denyIds.length) registerCatalogPack({ id: "wire:person:deny", catalogId: "person", mode: "deny", denyIds })
  const dimensions: Dim[] = [...addedByField].map(([field, { label, options }]) => ({ field, label, options }))
  if (dimensions.length) registerCatalogPack({ id: "wire:person:extend", catalogId: "person", mode: "extend", dimensions })
}

export function bootstrapCatalogs(opts: { timeoutMs?: number } = {}): Promise<void> {
  if (bootstrapped) return bootstrapped
  const timeoutMs = opts.timeoutMs ?? 6000
  bootstrapped = (async () => {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), timeoutMs)
    try {
      const res = await fetch("/v1/catalogs?detail=full", { signal: ctl.signal })
      if (!res.ok) {
        console.error(`[catalog-bootstrap] GET /v1/catalogs → ${res.status}; pickers will show the bundled catalogs until reload`)
        return
      }
      const payload = (await res.json()) as CatalogsResponse
      const n = applyServerCatalogs(payload)
      if (n > 0) console.info(`[catalog-bootstrap] ${n} curated catalog(s) registered (packs=${payload.packs ?? "?"}, v${payload.version ?? "?"})`)
    } catch (err) {
      console.error("[catalog-bootstrap] failed — pickers will show the bundled catalogs until reload:", (err as Error).message)
    } finally {
      clearTimeout(timer)
    }
  })()
  return bootstrapped
}

/** Test hooks. */
export function __resetCatalogBootstrapForTests(): void {
  bootstrapped = null
  registeredVersion = null
  resetCatalogPacks()
}
export function __catalogBootstrapVersionForTests(): number | null {
  return registeredVersion
}
