import { resolveTemplateCategory } from "@nodaro/shared/apps"
import { DEFAULT_TEMPLATE_SORT, isTemplateSort, type TemplateSort } from "@/lib/template-utils"

/**
 * The templates page keeps everything a link should be able to open in the
 * URL: the use-case filter and sort (`?category=…&sort=…`), the template whose
 * detail is open (`?template=<slug>`) and whether that template is being
 * previewed on the full-screen canvas (`&view=canvas`). A reload lands on the
 * same screen, the home screen's tiles link straight into a filtered grid, and
 * a pasted `?template=` link opens the detail even when the card is not on the
 * loaded page. Unknown values read as unset; a category from the previous
 * taxonomy reads as its new home, so an old link still lands on a filter.
 */
export type TemplateView = "detail" | "canvas"

export interface TemplatesUrlState {
  readonly category: string | undefined
  readonly sort: TemplateSort
  readonly templateSlug: string | null
  /** `null` when no template is open — the canvas needs a slug to show. */
  readonly view: TemplateView | null
}

export interface TemplatesUrlPatch {
  /** An explicit `undefined` clears the filter. */
  readonly category?: string | undefined
  readonly sort?: TemplateSort
  /** `null` closes the detail (and the canvas with it). */
  readonly templateSlug?: string | null
  /** "detail" drops the canvas flag; "canvas" is ignored without a slug. */
  readonly view?: TemplateView
}

/** Slugs are generated server-side from a name: word characters and hyphens. */
const SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/

export function readTemplatesUrlState(params: URLSearchParams): TemplatesUrlState {
  const sort = params.get("sort")
  const slug = params.get("template")
  const templateSlug = slug !== null && SLUG_PATTERN.test(slug) ? slug : null
  return {
    category: resolveTemplateCategory(params.get("category")),
    sort: isTemplateSort(sort) ? sort : DEFAULT_TEMPLATE_SORT,
    templateSlug,
    view: templateSlug === null ? null : params.get("view") === "canvas" ? "canvas" : "detail",
  }
}

/** A new params object with the patch applied; the input is left untouched. */
export function writeTemplatesUrlState(params: URLSearchParams, patch: TemplatesUrlPatch): URLSearchParams {
  const next = new URLSearchParams(params)
  if ("category" in patch) {
    if (patch.category === undefined) next.delete("category")
    else next.set("category", patch.category)
  }
  if (patch.sort !== undefined) {
    // The default sort needs no param, so a bare link stays bare.
    if (patch.sort === DEFAULT_TEMPLATE_SORT) next.delete("sort")
    else next.set("sort", patch.sort)
  }
  if ("templateSlug" in patch) {
    if (patch.templateSlug === null || patch.templateSlug === undefined) {
      next.delete("template")
      next.delete("view")
    } else {
      next.set("template", patch.templateSlug)
    }
  }
  if (patch.view === "detail") next.delete("view")
  if (patch.view === "canvas" && next.has("template")) next.set("view", "canvas")
  return next
}
