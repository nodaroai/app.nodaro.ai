import { getRegisteredPickerCatalogs, type PickerCatalog } from "@nodaro/prompts/picker-catalogs"
import { ownPickerPicturesShown } from "./picker-images.js"
import { getRegisteredPickerPictures, type PickerPictureEntry } from "./picker-pictures.js"

/**
 * The boot check on a deployment's own picker pictures (lib/picker-pictures.ts).
 * The overlay loader runs it once the overlay's register() has returned
 * (lib/overlay/load.ts), so the catalogs it reads already carry the overlay's
 * own catalog packs, in whatever order register() made its calls.
 *
 * Each entry's catalog must be a picker catalog of this deployment, and its
 * option an option of that catalog as composed: base catalogs plus every
 * registered catalog pack, so a picture cannot name an option the deployment's
 * curation removed, and may name one it added. Returns every problem, one line
 * each; empty = fits. Like a preset pack's problems, any problem refuses the
 * boot: the deployment named something it does not have, and serving a
 * picture for nothing would hide the mistake.
 *
 * The shape, the address host rule and duplicates were refused at
 * registration already (registerPickerPictures).
 */
export function pickerPictureProblems(): string[] {
  const entries = getRegisteredPickerPictures()
  if (entries.length === 0) return []
  const optionsOf = optionIdsByCatalog(getRegisteredPickerCatalogs())
  const problems: string[] = []
  for (const e of entries) {
    const options = optionsOf.get(e.catalogId)
    const key = `"${e.catalogId}/${e.optionId}"`
    if (!options) problems.push(`${key}: no picker catalog "${e.catalogId}" on this deployment`)
    else if (!options.has(e.optionId)) problems.push(`${key}: "${e.optionId}" is not an option of this deployment's "${e.catalogId}" catalog`)
  }
  return problems
}

/**
 * The one line the overlay loader logs at boot about the deployment's own
 * pictures, or undefined when none is registered (a deployment without them
 * logs nothing). An option with no picture is not an error — it shows none —
 * so the line counts, per catalog that has any, how many of its options have
 * one, and how many catalogs have none. When the deployment's
 * `catalogs.images` is not `"own"` the line says the pictures are not shown.
 */
export function pickerPictureSummary(): string | undefined {
  const entries = getRegisteredPickerPictures()
  if (entries.length === 0) return undefined
  const catalogs = getRegisteredPickerCatalogs()
  const optionsOf = optionIdsByCatalog(catalogs)
  const pictured = picturedByCatalog(entries, optionsOf)
  const total = [...optionsOf.values()].reduce((n, ids) => n + ids.size, 0)
  const shown = [...pictured.values()].reduce((n, ids) => n + ids.size, 0)
  const perCatalog = catalogs
    .filter((c) => (pictured.get(c.catalogId)?.size ?? 0) > 0)
    .map((c) => `${c.catalogId} ${pictured.get(c.catalogId)!.size} of ${optionsOf.get(c.catalogId)!.size}`)
  const without = catalogs.length - perCatalog.length
  const line = `own pictures for ${shown} of ${total} picker options: ${perCatalog.join(", ")} (${without} other catalogs have none)`
  return ownPickerPicturesShown() ? line : `${line} — not shown: this deployment's catalogs.images is not "own"`
}

/** Every option id of each composed catalog, across its dimensions. */
function optionIdsByCatalog(catalogs: readonly PickerCatalog[]): Map<string, ReadonlySet<string>> {
  return new Map(
    catalogs.map((c) => [c.catalogId, new Set([...(c.options ?? []), ...(c.dimensions ?? []).flatMap((d) => d.options)].map((o) => o.id))]),
  )
}

/** The registered options that exist, per catalog. */
function picturedByCatalog(entries: readonly PickerPictureEntry[], optionsOf: Map<string, ReadonlySet<string>>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const e of entries) {
    if (!optionsOf.get(e.catalogId)?.has(e.optionId)) continue
    const ids = out.get(e.catalogId) ?? new Set<string>()
    ids.add(e.optionId)
    out.set(e.catalogId, ids)
  }
  return out
}
