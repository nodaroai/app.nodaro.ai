/**
 * `@nodaro/sdk/templates` — the `templates` resource and its types.
 *
 * One of the package's subpath entries (see `src/index.ts`). The root
 * re-exports every entry, so each name here is also importable from
 * `@nodaro/sdk`.
 */
export { TemplatesResource } from "../resources/templates.js"

export type {
  TemplateBrowseCard,
  TemplateSort,
  BrowseTemplatesParams,
  BrowseTemplatesResult,
  Template,
  CloneTemplateParams,
  CloneTemplateResult,
} from "../resources/templates.js"
