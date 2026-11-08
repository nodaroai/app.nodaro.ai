import { isDeepStrictEqual } from "node:util"
import { runtimeSurfaceProfile } from "../surface-profile.js"
import { z } from "zod"
import { extractPresetData } from "@nodaro/shared/nodes"
import { RECAST_SEGMENT_PACKS } from "@nodaro/shared/apps"
import { FACTORY_PRESETS, getFactoryPresets, type FactoryPreset } from "@nodaro/prompts/presets"
import type { CatalogEntry } from "./preset-view.js"

// App namespaces share the owner-scoped preset library without pretending to
// be executable canvas nodes. Register each app's portable settings explicitly.
const recastRender = z.strictObject({
  schemaVersion: z.literal(1),
  provider: z.string().trim().min(1).max(120),
  resolution: z.enum(["480p", "720p", "1080p", "4k"]),
  segmentSec: z.enum(RECAST_SEGMENT_PACKS),
  renderMethod: z.enum(["extend", "keyframes"]),
  anchorMode: z.enum(["upfront", "progressive", "none"]),
  citeStyle: z.enum(["bare", "rich"]),
  promptTiming: z.boolean(),
  textOnly: z.boolean(),
  interactive: z.boolean(), anchorGates: z.boolean(), musicGates: z.boolean(),
  musicSource: z.enum(["generated", "original", "upload"]),
})

const contracts = new Map<string, z.ZodType<Record<string, unknown>>>([
  ["recast-render", recastRender],
])

const base = {
  schemaVersion: 1, provider: "seedance-2-5", resolution: "480p",
  anchorMode: "upfront", citeStyle: "bare", promptTiming: true, textOnly: false,
  interactive: true, anchorGates: false, musicGates: true, musicSource: "generated",
} as const

const recastFactories = [
  { id: "recast-render/continuous", name: "Continuous", description: "Uses the longest parts the model allows; each next part continues the previous clip.", data: { ...base, segmentSec: "max", renderMethod: "extend" } },
  { id: "recast-render/scene-cuts", name: "Scene cuts", description: "Groups whole scenes into parts; each next part continues the previous clip.", data: { ...base, segmentSec: "scenes-max", renderMethod: "extend" } },
  { id: "recast-render/keyframes", name: "Keyframes", description: "Groups whole scenes into parts and stages them from generated keyframes.", data: { ...base, segmentSec: "scenes-max", renderMethod: "keyframes" } },
].map(p => ({ ...p, group: "Render", groupKind: "functional" as const }))

// ── Deployment preset packs ──────────────────────────────────────────────────
//
// A deployment ships presets of its own by REGISTRATION (a deployment overlay's
// register(), lib/overlay/load.ts), never by editing the bundled catalog. The
// registry lives here, beside the one function that serves factory presets, so
// the collision check and the composition read the same catalog and no second
// module reads it (lib/presets/__tests__/factory-preset-funnel.test.ts).
// Design note: docs/design/preset-pack-seam.md.

/**
 * A preset a deployment ships: exactly a factory preset, plus an optional example
 * picture. A factory preset's picture is a file committed under /preset-previews/;
 * a deployment's is not, so it names its own absolute https URL (checked at boot,
 * lib/presets/preset-pack-check.ts).
 */
export interface PackPreset extends FactoryPreset {
  readonly previewUrl?: string
}

/** The presets a deployment registers for one node type (or app namespace). */
export interface PresetPack {
  readonly nodeType: string
  readonly presets: readonly PackPreset[]
}

let packs: readonly PresetPack[] = []

let factoryIds: ReadonlySet<string> | undefined
/** Every bundled preset id, on every node type and app namespace. */
function factoryPresetIds(): ReadonlySet<string> {
  factoryIds ??= new Set([
    ...Object.values(FACTORY_PRESETS).flatMap((list) => list.map((p) => p.id)),
    ...recastFactories.map((p) => p.id),
  ])
  return factoryIds
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

/**
 * Register a deployment's presets for `nodeType`. `presetCatalog` serves them
 * after the bundled ones, or alone when the surface profile sets
 * `catalogs.factoryPresets: false`. Several packs may target one node type;
 * they are served in registration order.
 *
 * THROWS (the overlay loader turns that into a refused boot), registering none
 * of the pack, on a preset it could not serve faithfully:
 *   - an id that is not `<nodeType>/<slug>` — the factory id shape, which also
 *     keeps a pack id from ever reading as a user's own preset (a uuid);
 *   - an id a factory preset uses, on any node type, or that is already
 *     registered — ids are what favorites and `presetId` lookups key on;
 *   - no name, or `data` that is not an object;
 *   - `data` the preset library would not carry as it is (a label, run state, an
 *     app namespace's contract broken): what is served is exactly what applies.
 *
 * Each preset is stored as a COPY, so what the boot check validated is what is
 * served, whatever the caller does with its own objects afterwards.
 */
export function registerPresetPack(pack: PresetPack): void {
  const nodeType: unknown = pack?.nodeType
  if (typeof nodeType !== "string" || nodeType === "" || nodeType !== nodeType.trim()) {
    throw new Error(`preset pack: the node type must be a plain name (got ${JSON.stringify(nodeType)})`)
  }
  const where = `preset pack for "${nodeType}"`
  if (!Array.isArray(pack.presets)) throw new Error(`${where}: presets must be an array`)

  const taken = new Set(packs.flatMap((p) => p.presets.map((x) => x.id)))
  const copies: PackPreset[] = []
  for (const preset of pack.presets) {
    const id: unknown = preset?.id
    if (typeof id !== "string" || !id.startsWith(`${nodeType}/`) || id.length === nodeType.length + 1) {
      throw new Error(`${where}: preset id ${JSON.stringify(id)} must be "${nodeType}/<slug>"`)
    }
    if (factoryPresetIds().has(id)) {
      throw new Error(`${where}: "${id}" is a factory preset's id — a pack adds presets under ids of its own`)
    }
    if (taken.has(id)) throw new Error(`${where}: "${id}" is already registered`)
    if (typeof preset.name !== "string" || preset.name.trim() === "") {
      throw new Error(`${where}: preset "${id}" needs a name`)
    }
    if (!isPlainObject(preset.data)) throw new Error(`${where}: preset "${id}" data must be an object`)
    const portable = portablePresetData(nodeType, preset.data)
    if (portable === null) {
      throw new Error(`${where}: preset "${id}" data breaks the "${nodeType}" contract`)
    }
    if (!isDeepStrictEqual(portable, preset.data)) {
      const dropped = Object.keys(preset.data).filter((k) => !(k in portable))
      throw new Error(
        dropped.length > 0
          ? `${where}: preset "${id}" data holds keys a preset never carries: ${dropped.join(", ")}`
          : `${where}: preset "${id}" data is not in the form the "${nodeType}" contract stores`,
      )
    }
    taken.add(id)
    copies.push(structuredClone(preset))
  }
  packs = [...packs, { nodeType, presets: copies }]
}

/** Every registered pack, in registration order. */
export function getRegisteredPresetPacks(): readonly PresetPack[] {
  return packs
}

/** Drop every registered pack (tests). */
export function resetPresetPacks(): void {
  packs = []
}

/**
 * THE factory-preset funnel: the catalog `GET /v1/node-presets/factory`, the MCP
 * preset tools and preset resolution (`resolvePreset`) all list. The bundled
 * presets (unless the surface profile switches them off), then every registered
 * pack's for this node type. With no pack for `nodeType` it returns exactly what
 * it did before packs existed — the bundled catalog itself.
 */
export function presetCatalog(nodeType: string): readonly CatalogEntry[] {
  const factory: readonly CatalogEntry[] =
    runtimeSurfaceProfile().catalogs?.factoryPresets === false
      ? []
      : nodeType === "recast-render"
        ? recastFactories
        : getFactoryPresets(nodeType)
  const packed = packs.filter((p) => p.nodeType === nodeType).flatMap((p) => p.presets)
  return packed.length === 0 ? factory : [...factory, ...packed]
}

/** null rejects malformed app snapshots; ordinary node presets retain their
 * existing portable-data extraction. This is shared by every write/read lane. */
export function portablePresetData(nodeType: string, data: Record<string, unknown>): Record<string, unknown> | null {
  const contract = contracts.get(nodeType)
  if (!contract) return extractPresetData(data, nodeType)
  const parsed = contract.safeParse(data)
  return parsed.success ? parsed.data : null
}
