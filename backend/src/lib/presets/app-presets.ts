import { runtimeSurfaceProfile } from "../surface-profile.js"
import { z } from "zod"
import { extractPresetData, RECAST_SEGMENT_PACKS } from "@nodaro/shared"
import { getFactoryPresets } from "@nodaro/prompts"

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

export function presetCatalog(nodeType: string) {
  if (runtimeSurfaceProfile().catalogs?.factoryPresets === false) return []
  return nodeType === "recast-render" ? recastFactories : getFactoryPresets(nodeType)
}

/** null rejects malformed app snapshots; ordinary node presets retain their
 * existing portable-data extraction. This is shared by every write/read lane. */
export function portablePresetData(nodeType: string, data: Record<string, unknown>): Record<string, unknown> | null {
  const contract = contracts.get(nodeType)
  if (!contract) return extractPresetData(data)
  const parsed = contract.safeParse(data)
  return parsed.success ? parsed.data : null
}
