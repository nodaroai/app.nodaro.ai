import { getPickerCatalog, findForeignCatalogIds } from "@nodaro/prompts/picker-catalogs"
import { surfaceCatalogsRequired } from "./surface-selectors"

/** Strip unavailable catalog selections from defaults and preset resets.
 * Free text and non-catalog settings are preserved. Existing saved graphs
 * remain subject to the server's catalog guard rather than silently edited. */
export function curatedNodeDefaults<T extends Record<string, unknown>>(nodeType: string, data: T): T {
  if (!surfaceCatalogsRequired()) return data
  const invalid = findForeignCatalogIds([{ type: nodeType, data }])
  if (!invalid.length && nodeType !== "text-to-speech") return data
  const result: Record<string, unknown> = { ...data }
  for (const { field, id } of invalid) {
    const strip = (record: Record<string, unknown>) => {
      const current = record[field]
      if (Array.isArray(current)) record[field] = current.filter((v) => v !== id)
      else if (current === id) record[field] = undefined
    }
    strip(result)
    for (const key of ["direction", "subject"]) {
      const nested = result[key]
      if (nested && typeof nested === "object" && !Array.isArray(nested)) {
        const copy = { ...nested } as Record<string, unknown>
        strip(copy)
        result[key] = copy
      }
    }
  }
  // A removed Person factory type must not turn an unspecified subject into
  // a female figure. Use the deployment's offered male choice, when available.
  if (nodeType === "person" && !result.type) {
    const types = getPickerCatalog("person")?.dimensions?.find((d) => d.field === "type")?.options
    if (types?.some((o) => o.id === "man")) result.type = "man"
  }
  if (nodeType === "text-to-speech") {
    // No bundled voice is an approved deployment default. Require an explicit
    // choice from the server-filtered voice picker instead of seeding Rachel.
    result.voiceId = ""
    result.voiceDisplayName = undefined
    result.voiceLabel = undefined
  }
  return result as T
}
