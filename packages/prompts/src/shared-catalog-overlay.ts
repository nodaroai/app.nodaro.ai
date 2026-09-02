import { getAnimalPromptHint, getAnimalTerm, getVehicle, getWeapon, getFurniture } from "@nodaro/shared"
import { composedHas, composedOption } from "./catalog-overlay.js"
import { deriveTerm } from "./term.js"

/**
 * The four object-entity catalogs — animals, vehicles, weapons, furniture —
 * are OWNED by `@nodaro/shared`, which cannot depend on this package, so
 * their getters cannot carry the `overlayEntry` the other 34 catalogs do.
 * These wrappers are the overlay for them, and EVERY prompt-text read of
 * those catalogs goes through here: the parameter-node dispatcher and the
 * subject fold both. Two call sites resolving the same id to different text
 * — one curated, one stock — is exactly what a second, un-overlaid path
 * produced during review.
 *
 * Precedence per id, same four outcomes as catalog-overlay.ts:
 *   - no pack on the catalog       → the stock getter, untouched
 *   - denied / not in the pack     → ""  (nothing reaches the prompt)
 *   - composed option present      → ITS promptHint / term. A pack author
 *     who rewrote an entry wrote the hint they want injected; rebuilding it
 *     from label + description would discard that
 *   - pack-added id (no stock row) → the composed option (covered by the
 *     branch above — the stock getter is never consulted when a pack exists)
 */

export function curatedAnimalPromptHint(id: string): string {
  if (!id) return ""
  if (!composedHas("animals", id)) return ""
  return composedOption("animals", id)?.promptHint ?? getAnimalPromptHint(id)
}
export function curatedAnimalTerm(id: string): string {
  if (!id) return ""
  if (!composedHas("animals", id)) return ""
  return composedOption("animals", id)?.term ?? getAnimalTerm(id)
}

type ObjectEntity = { readonly label: string; readonly description: string }

function objectEntityText(
  catalogId: string,
  id: string,
  stock: ObjectEntity | undefined,
  stockHint: (e: ObjectEntity) => string,
  stockTerm: (e: ObjectEntity) => string,
): { readonly hint: string; readonly term: string } {
  if (!id || !composedHas(catalogId, id)) return { hint: "", term: "" }
  const composed = composedOption(catalogId, id)
  if (composed) return { hint: composed.promptHint, term: composed.term }
  if (!stock) return { hint: "", term: "" }
  return { hint: stockHint(stock), term: stockTerm(stock) }
}

/**
 * The compact fragment for an OBJECT-entity entry (animal / vehicle / weapon /
 * furniture). Those catalogs carry no `promptHint` of their own — the full
 * fragment is synthesized as "featuring a {label}, {description}" — so the
 * compact form is the authored `term` when there is one and the derived label
 * otherwise (a concrete object's label IS its trade term). The framing verb
 * ("featuring a", "with a") belongs to the HINT; a term drops bare into
 * whatever sentence the consumer is building, and "the object is in the scene"
 * is precisely what these four nodes mean.
 *
 * The fallback MUST be `deriveTerm` and not a bare `toLowerCase()`: it is the
 * same fallback `objectOptions` uses to build the `/v1/catalogs` projection,
 * so a parenthetical label ("Rifle (bolt-action)") must strip identically here
 * or the injected fragment and the projected term would disagree.
 *
 * `term` is read structurally because it is being added to the shared entity
 * interfaces separately; this stays correct before and after that lands.
 */

function objectEntityTerm(entry: { readonly label: string }): string {
  return (entry as { term?: string }).term ?? deriveTerm(entry.label)
}

export function curatedVehicleText(id: string) {
  return objectEntityText("vehicles", id, getVehicle(id), (e) => `featuring a ${e.label.toLowerCase()}, ${e.description}`, objectEntityTerm)
}
export function curatedWeaponText(id: string) {
  return objectEntityText("weapons", id, getWeapon(id), (e) => `with a ${e.label.toLowerCase()}, ${e.description}`, objectEntityTerm)
}
export function curatedFurnitureText(id: string) {
  return objectEntityText("furniture", id, getFurniture(id), (e) => `including a ${e.label.toLowerCase()}, ${e.description}`, objectEntityTerm)
}
